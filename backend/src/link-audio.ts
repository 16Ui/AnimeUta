import { backup, DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { externalAudioUri, resolveAudioPath } from './audio-storage.js'
import { assertDatabaseIntegrity, sha256File } from './backup-integrity.js'
import { loadConfig } from './config.js'
import { audioExtensions } from './media.js'

try { process.loadEnvFile() } catch { /* Process environment is enough. */ }

interface AudioRow { id: number; title_ja: string; audio_source_uri: string; audio_checksum: string | null }
interface LinkedAudio { database: string; songId: number; title: string; previousUri: string; uri: string; source: string; sha256: string; sizeBytes: number }
interface CleanupFile { path: string; source: string; sha256: string; sizeBytes: number }

const config = loadConfig()
const projectRoot = resolve(process.cwd(), '..')
const apply = process.argv.includes('--apply')
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const reportRoot = join(projectRoot, 'reports', 'storage')
const reportPath = join(reportRoot, `audio-links-${timestamp}.json`)
const backupRoot = join(projectRoot, 'backups')
const databases = [config.databasePath]
const manifests = new Map<string, string>()
if (existsSync(backupRoot)) {
  for (const entry of readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(backupRoot, entry.name)
    const databasePath = join(directory, 'animeuta.sqlite')
    const manifestPath = join(directory, 'manifest.json')
    if (!existsSync(databasePath) || !existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.format !== 'animeuta-backup-v1') continue
    databases.push(databasePath)
    manifests.set(databasePath, manifestPath)
  }
}

function visit(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return visit(path)
    return entry.isFile() && audioExtensions.has(extname(entry.name).toLowerCase()) ? [path] : []
  })
}

function readRows(databasePath: string): AudioRow[] {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try { return database.prepare('SELECT id, title_ja, audio_source_uri, audio_checksum FROM song WHERE audio_source_uri IS NOT NULL').all() as unknown as AudioRow[] }
  finally { database.close() }
}

const rowsByDatabase = new Map(databases.map((path) => [path, readRows(path)]))
const neededHashes = new Set([...rowsByDatabase.values()].flatMap((rows) => rows.map((row) => row.audio_checksum)))
const sources = new Map<string, string>()
for (const root of config.audioLibraryRoots ?? []) {
  for (const path of visit(root)) {
    externalAudioUri(path, config)
    const digest = await sha256File(path)
    if (neededHashes.has(digest) && !sources.has(digest)) sources.set(digest, path)
  }
}
if (sources.size === 0) throw new Error('No byte-identical originals found. Configure AUDIO_LIBRARY_ROOTS before linking audio.')

const linked: LinkedAudio[] = []
const retained: Array<{ database: string; songId: number; title: string; reason: string }> = []
const cleanup = new Map<string, CleanupFile>()
for (const [databasePath, rows] of rowsByDatabase) {
  const mediaRoot = databasePath === config.databasePath ? config.mediaRoot : join(dirname(databasePath), 'media')
  for (const row of rows) {
    if (row.audio_source_uri.startsWith('file:')) continue
    const source = row.audio_checksum ? sources.get(row.audio_checksum) : undefined
    if (!source) { retained.push({ database: databasePath, songId: row.id, title: row.title_ja, reason: 'Original file with the same checksum was not found.' }); continue }
    const path = resolveAudioPath(row.audio_source_uri, { ...config, mediaRoot })
    const sourceSize = statSync(source).size
    if (!existsSync(path) || statSync(path).size !== sourceSize || await sha256File(path) !== row.audio_checksum) {
      retained.push({ database: databasePath, songId: row.id, title: row.title_ja, reason: 'Stored audio is missing or differs from its recorded checksum.' })
      continue
    }
    linked.push({ database: databasePath, songId: row.id, title: row.title_ja, previousUri: row.audio_source_uri, uri: externalAudioUri(source, config), source, sha256: row.audio_checksum!, sizeBytes: sourceSize })
    cleanup.set(path, { path, source, sha256: row.audio_checksum!, sizeBytes: sourceSize })
  }
}
mkdirSync(reportRoot, { recursive: true })

const snapshots: string[] = []
if (apply) {
  for (const databasePath of databases) {
    const changes = linked.filter((item) => item.database === databasePath)
    if (!changes.length) continue
    const database = new DatabaseSync(databasePath)
    try {
      database.exec('PRAGMA busy_timeout = 5000')
      const snapshotPath = join(reportRoot, `before-audio-links-${snapshots.length}-${timestamp}.sqlite`)
      await backup(database, snapshotPath)
      snapshots.push(snapshotPath)
      database.exec('BEGIN IMMEDIATE')
      try {
        const update = database.prepare('UPDATE song SET audio_source_uri = ? WHERE id = ? AND audio_source_uri = ? AND audio_checksum = ?')
        for (const item of changes) {
          if (update.run(item.uri, item.songId, item.previousUri, item.sha256).changes !== 1) throw new Error(`Song changed during migration: ${item.songId}`)
        }
        database.exec('COMMIT')
      } catch (error) { database.exec('ROLLBACK'); throw error }
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } finally { database.close() }
    assertDatabaseIntegrity(databasePath)

    const manifestPath = manifests.get(databasePath)
    if (manifestPath) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const removedPaths = new Set(changes.map((item) => item.previousUri.replace(/\\/g, '/')))
      manifest.mediaFiles = manifest.mediaFiles.filter((file: { path: string }) => !removedPaths.has(file.path))
      manifest.databaseSha256 = await sha256File(databasePath)
      manifest.externalAudio = changes.map((item) => ({ songId: item.songId, uri: item.uri, sha256: item.sha256, sizeBytes: item.sizeBytes }))
      const environmentPath = join(dirname(databasePath), 'backend.env')
      if (existsSync(environmentPath)) {
        const contents = readFileSync(environmentPath, 'utf8')
        const setting = `AUDIO_LIBRARY_ROOTS=${(config.audioLibraryRoots ?? []).join(';')}`
        writeFileSync(environmentPath, /^AUDIO_LIBRARY_ROOTS=/m.test(contents) ? contents.replace(/^AUDIO_LIBRARY_ROOTS=.*$/m, setting) : `${contents.trimEnd()}\n${setting}\n`)
        manifest.environmentSha256 = await sha256File(environmentPath)
      }
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    }
  }
}

writeFileSync(reportPath, JSON.stringify({ applied: apply, createdAt: new Date().toISOString(), linked, retained, cleanup: [...cleanup.values()], snapshots }, null, 2))
console.log(JSON.stringify({ applied: apply, linkedSongs: linked.filter((item) => item.database === config.databasePath).length, linkedBackupSongs: linked.filter((item) => item.database !== config.databasePath).length, retained, verifiedDuplicateFiles: cleanup.size, duplicateBytes: [...cleanup.values()].reduce((sum, file) => sum + file.sizeBytes, 0), reportPath }, null, 2))
