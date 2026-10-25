import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase, runMigrations } from './db.js'

const directories: string[] = []
const backendRoot = fileURLToPath(new URL('..', import.meta.url))
const tsxCli = join(backendRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')

function runCli(script: 'backup' | 'restore', cwd: string, databasePath: string, mediaRoot: string, args: string[]): string {
  return execFileSync(process.execPath, [tsxCli, join(backendRoot, 'src', `${script}.ts`), ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_PATH: databasePath, MEDIA_ROOT: mediaRoot, MEDIA_SIGNING_SECRET: 'backup-test-secret' },
  })
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('backup and restore', () => {
  it('backs up external audio references without copying the original music', () => {
    const directory = join(tmpdir(), `animeuta-backup-links-${crypto.randomUUID()}`)
    directories.push(directory)
    mkdirSync(directory, { recursive: true })
    const original = join(directory, 'original.mp3')
    writeFileSync(original, 'original audio')
    const sourceDatabase = join(directory, 'source.sqlite')
    const sourceMedia = join(directory, 'source-media')
    mkdirSync(sourceMedia)
    const source = openDatabase(sourceDatabase)
    runMigrations(source)
    source.prepare("INSERT INTO song(title_ja, audio_source_uri, audio_size_bytes) VALUES ('Original song', ?, 14)").run(pathToFileURL(original).href)
    source.close()
    const backupRoot = join(directory, 'backup')
    runCli('backup', directory, sourceDatabase, sourceMedia, [`--output=${backupRoot}`])
    const manifest = JSON.parse(readFileSync(join(backupRoot, 'manifest.json'), 'utf8'))
    expect(manifest.mediaFiles).toEqual([])
    expect(manifest.externalAudio).toEqual([expect.objectContaining({ songId: 1, uri: pathToFileURL(original).href, sizeBytes: 14 })])
    expect(existsSync(join(backupRoot, 'media', 'original.mp3'))).toBe(false)
    const targetDatabase = join(directory, 'restored.sqlite')
    runCli('restore', directory, targetDatabase, join(directory, 'restored-media'), [`--backup=${backupRoot}`])
    const restored = openDatabase(targetDatabase)
    expect(restored.prepare('SELECT audio_source_uri FROM song').get()).toEqual({ audio_source_uri: pathToFileURL(original).href })
    restored.close()
    expect(readFileSync(original, 'utf8')).toBe('original audio')
  })

  it('restores a checksummed snapshot and rejects corruption before replacing current data', () => {
    const directory = join(tmpdir(), `animeuta-backup-${crypto.randomUUID()}`)
    directories.push(directory)
    mkdirSync(directory, { recursive: true })
    const sourceDatabase = join(directory, 'source.sqlite')
    const sourceMedia = join(directory, 'source-media')
    const environmentPath = join(directory, '.env')
    writeFileSync(environmentPath, 'APP_ORIGIN=https://source.example.test\n')
    const mediaPath = join(sourceMedia, 'audio', 'song.mp3')
    mkdirSync(join(sourceMedia, 'audio'), { recursive: true })
    writeFileSync(mediaPath, 'owned audio bytes')
    const source = openDatabase(sourceDatabase)
    runMigrations(source)
    source.prepare(`INSERT INTO app_user(email, password_hash, password_salt, display_name, role) VALUES ('source@example.com', 'hash', 'salt', 'Source', 'owner')`).run()
    source.prepare(`INSERT INTO song(title_ja, submitted_by, review_status, visibility, audio_source_uri) VALUES ('Source song', 1, 'approved', 'shared', 'audio/song.mp3')`).run()
    source.close()

    const backupRoot = join(directory, 'backup')
    expect(runCli('backup', directory, sourceDatabase, sourceMedia, [`--output=${backupRoot}`])).toContain('backup created')
    const manifest = JSON.parse(readFileSync(join(backupRoot, 'manifest.json'), 'utf8')) as {
      databaseSha256: string
      environmentSha256: string
      mediaFiles: Array<{ path: string; sizeBytes: number; sha256: string }>
    }
    expect(manifest.databaseSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.environmentSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.mediaFiles).toEqual([
      expect.objectContaining({ path: 'audio/song.mp3', sizeBytes: 17, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ])

    const collisionPath = join(directory, 'collision.sqlite')
    const collision = openDatabase(collisionPath)
    runMigrations(collision)
    collision.prepare(`INSERT INTO app_user(email, password_hash, password_salt, display_name, role) VALUES ('preserve@example.com', 'hash', 'salt', 'Preserve', 'owner')`).run()
    collision.close()
    expect(() => runCli('restore', directory, collisionPath, collisionPath, [`--backup=${backupRoot}`, '--force'])).toThrow()
    const rolledBack = openDatabase(collisionPath)
    expect(rolledBack.prepare('SELECT email FROM app_user').all()).toEqual([{ email: 'preserve@example.com' }])
    rolledBack.close()

    rmSync(mediaPath)
    const incompleteRoot = join(directory, 'incomplete-backup')
    expect(() => runCli('backup', directory, sourceDatabase, sourceMedia, [`--output=${incompleteRoot}`])).toThrow()
    expect(existsSync(incompleteRoot)).toBe(false)

    const targetDatabase = join(directory, 'target.sqlite')
    const targetMedia = join(directory, 'target-media')
    const existing = openDatabase(targetDatabase)
    runMigrations(existing)
    existing.prepare(`INSERT INTO app_user(email, password_hash, password_salt, display_name, role) VALUES ('old@example.com', 'hash', 'salt', 'Old', 'owner')`).run()
    existing.close()
    mkdirSync(targetMedia, { recursive: true })
    writeFileSync(join(targetMedia, 'old.txt'), 'old media')

    writeFileSync(environmentPath, 'APP_ORIGIN=https://target.example.test\n')
    expect(runCli('restore', directory, targetDatabase, targetMedia, [`--backup=${backupRoot}`, '--force', '--restore-env'])).toContain('restored from')
    const restored = openDatabase(targetDatabase)
    expect(restored.prepare('SELECT email FROM app_user').all()).toEqual([{ email: 'source@example.com' }])
    restored.close()
    expect(readFileSync(join(targetMedia, 'audio', 'song.mp3'), 'utf8')).toBe('owned audio bytes')
    expect(readFileSync(environmentPath, 'utf8')).toBe('APP_ORIGIN=https://source.example.test\n')

    const corruptEnvironmentRoot = join(directory, 'corrupt-environment-backup')
    cpSync(backupRoot, corruptEnvironmentRoot, { recursive: true })
    appendFileSync(join(corruptEnvironmentRoot, 'backend.env'), 'TAMPERED=true\n')
    expect(() => runCli('restore', directory, targetDatabase, targetMedia, [`--backup=${corruptEnvironmentRoot}`, '--force', '--restore-env'])).toThrow()
    expect(readFileSync(environmentPath, 'utf8')).toBe('APP_ORIGIN=https://source.example.test\n')

    const current = openDatabase(targetDatabase)
    current.prepare(`INSERT INTO app_user(email, password_hash, password_salt, display_name, role) VALUES ('keep@example.com', 'hash', 'salt', 'Keep', 'user')`).run()
    current.close()
    const corruptRoot = join(directory, 'corrupt-backup')
    cpSync(backupRoot, corruptRoot, { recursive: true })
    appendFileSync(join(corruptRoot, 'animeuta.sqlite'), 'corrupt')
    expect(() => runCli('restore', directory, targetDatabase, targetMedia, [`--backup=${corruptRoot}`, '--force'])).toThrow()

    const preserved = openDatabase(targetDatabase)
    expect(preserved.prepare("SELECT count(*) AS count FROM app_user WHERE email = 'keep@example.com'").get()).toEqual({ count: 1 })
    preserved.close()
    expect(readFileSync(join(targetMedia, 'audio', 'song.mp3'), 'utf8')).toBe('owned audio bytes')
  })
})
