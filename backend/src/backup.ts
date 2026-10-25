import { backup } from 'node:sqlite'
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { assertDatabaseIntegrity, inventoryFiles, referencedExternalAudio, referencedMediaFiles, sha256File } from './backup-integrity.js'
import { loadConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'

try { process.loadEnvFile() } catch { /* Process environment is enough. */ }

const outputArgument = process.argv.find((value) => value.startsWith('--output='))?.slice('--output='.length)
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const backupRoot = resolve(outputArgument || join(process.cwd(), '..', 'backups', `animeuta-${timestamp}`))
if (existsSync(backupRoot)) throw new Error(`Backup destination already exists: ${backupRoot}`)
mkdirSync(backupRoot, { recursive: true })

try {
  const config = loadConfig()
  const database = openDatabase(config.databasePath)
  const databaseBackup = join(backupRoot, 'animeuta.sqlite')
  try {
    runMigrations(database)
    await backup(database, databaseBackup)
  } finally {
    database.close()
  }
  assertDatabaseIntegrity(databaseBackup)

  const mediaBackup = join(backupRoot, 'media')
  if (existsSync(config.mediaRoot)) cpSync(config.mediaRoot, mediaBackup, { recursive: true })
  const mediaFiles = await inventoryFiles(mediaBackup)
  const backedUpPaths = new Set(mediaFiles.map((file) => file.path))
  const missingMedia = referencedMediaFiles(databaseBackup).filter((path) => !backedUpPaths.has(path))
  if (missingMedia.length > 0) throw new Error(`Backup is missing referenced media: ${missingMedia.join(', ')}`)
  const envPath = join(process.cwd(), '.env')
  if (existsSync(envPath)) copyFileSync(envPath, join(backupRoot, 'backend.env'))
  const environmentSha256 = existsSync(envPath) ? await sha256File(envPath) : undefined
  writeFileSync(join(backupRoot, 'manifest.json'), JSON.stringify({
    format: 'animeuta-backup-v1',
    createdAt: new Date().toISOString(),
    sourceDatabase: basename(config.databasePath),
    databaseSha256: await sha256File(databaseBackup),
    mediaFiles,
    externalAudio: referencedExternalAudio(databaseBackup),
    includesMedia: existsSync(config.mediaRoot),
    includesEnvironment: existsSync(envPath),
    ...(environmentSha256 ? { environmentSha256 } : {}),
  }, null, 2))

  console.log(`AnimeUta backup created: ${backupRoot}`)
} catch (error) {
  rmSync(backupRoot, { recursive: true, force: true })
  throw error
}
