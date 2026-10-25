import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { assertDatabaseIntegrity, resolveManifestPath, sha256File, type BackupFileRecord } from './backup-integrity.js'
import { loadConfig } from './config.js'

try { process.loadEnvFile() } catch { /* Process environment is enough. */ }

const backupArgument = process.argv.find((value) => value.startsWith('--backup='))?.slice('--backup='.length)
if (!backupArgument) throw new Error('Use --backup=<backup-directory> to select a backup.')
const backupRoot = resolve(backupArgument)
const manifestPath = join(backupRoot, 'manifest.json')
const sourceDatabase = join(backupRoot, 'animeuta.sqlite')
if (!existsSync(manifestPath) || !existsSync(sourceDatabase)) throw new Error('The directory is not a complete AnimeUta backup.')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  format?: string
  databaseSha256?: string
  mediaFiles?: BackupFileRecord[]
  includesMedia?: boolean
  includesEnvironment?: boolean
  environmentSha256?: string
}
if (manifest.format !== 'animeuta-backup-v1') throw new Error('Unsupported AnimeUta backup format.')
const sourceDatabaseHash = await sha256File(sourceDatabase)
if (manifest.databaseSha256 && sourceDatabaseHash !== manifest.databaseSha256) throw new Error('The backup database checksum does not match its manifest.')
assertDatabaseIntegrity(sourceDatabase)

const sourceMedia = join(backupRoot, 'media')
if (manifest.includesMedia === true && !existsSync(sourceMedia)) throw new Error('The backup media directory is missing.')
async function validateMedia(root: string): Promise<void> {
  for (const file of manifest.mediaFiles ?? []) {
    if (!Number.isInteger(file.sizeBytes) || file.sizeBytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('The backup media manifest is invalid.')
    const sourcePath = resolveManifestPath(root, file.path)
    if (!existsSync(sourcePath) || statSync(sourcePath).size !== file.sizeBytes || await sha256File(sourcePath) !== file.sha256) {
      throw new Error(`The backup media file is missing or corrupted: ${file.path}`)
    }
  }
}
await validateMedia(sourceMedia)

const sourceEnvironment = join(backupRoot, 'backend.env')
if (manifest.includesEnvironment === true && !existsSync(sourceEnvironment)) throw new Error('The backup environment file is missing.')
if (manifest.environmentSha256) {
  if (!/^[a-f0-9]{64}$/.test(manifest.environmentSha256)) throw new Error('The backup environment checksum is invalid.')
  if (!existsSync(sourceEnvironment) || await sha256File(sourceEnvironment) !== manifest.environmentSha256) {
    throw new Error('The backup environment checksum does not match its manifest.')
  }
}

const force = process.argv.includes('--force')
const restoreEnvironment = process.argv.includes('--restore-env')
const config = loadConfig()
if (existsSync(config.databasePath) && !force) throw new Error('The target database already exists. Stop AnimeUta and add --force to restore it.')
if (existsSync(config.mediaRoot) && !force) throw new Error('The target media directory already exists. Add --force to restore it.')

type SwapKind = 'file' | 'directory'
interface SwapEntry {
  target: string
  previous: string
  kind: SwapKind
  staged?: string
  moved: boolean
  installed: boolean
}

const token = `${process.pid}-${Date.now()}`
const stagedDatabase = `${config.databasePath}.restore-stage-${token}`
const stagedMedia = `${config.mediaRoot}.restore-stage-${token}`
const environmentPath = join(process.cwd(), '.env')
const stagedEnvironment = `${environmentPath}.restore-stage-${token}`
const swaps: SwapEntry[] = [
  { target: config.databasePath, staged: stagedDatabase, previous: `${config.databasePath}.restore-previous-${token}`, kind: 'file', moved: false, installed: false },
  { target: `${config.databasePath}-wal`, previous: `${config.databasePath}-wal.restore-previous-${token}`, kind: 'file', moved: false, installed: false },
  { target: `${config.databasePath}-shm`, previous: `${config.databasePath}-shm.restore-previous-${token}`, kind: 'file', moved: false, installed: false },
  { target: config.mediaRoot, staged: stagedMedia, previous: `${config.mediaRoot}.restore-previous-${token}`, kind: 'directory', moved: false, installed: false },
]
if (restoreEnvironment && existsSync(sourceEnvironment)) {
  swaps.push({ target: environmentPath, staged: stagedEnvironment, previous: `${environmentPath}.restore-previous-${token}`, kind: 'file', moved: false, installed: false })
}

const remove = (path: string, kind: SwapKind) => rmSync(path, { recursive: kind === 'directory', force: true })
try {
  mkdirSync(dirname(stagedDatabase), { recursive: true })
  copyFileSync(sourceDatabase, stagedDatabase)
  if (await sha256File(stagedDatabase) !== sourceDatabaseHash) throw new Error('The staged database copy failed checksum verification.')
  assertDatabaseIntegrity(stagedDatabase)

  if (existsSync(sourceMedia)) cpSync(sourceMedia, stagedMedia, { recursive: true })
  else mkdirSync(stagedMedia, { recursive: true })
  await validateMedia(stagedMedia)
  if (restoreEnvironment && existsSync(sourceEnvironment)) copyFileSync(sourceEnvironment, stagedEnvironment)

  for (const swap of swaps) {
    if (!existsSync(swap.target)) continue
    renameSync(swap.target, swap.previous)
    swap.moved = true
  }
  for (const swap of swaps) {
    if (!swap.staged) continue
    renameSync(swap.staged, swap.target)
    swap.installed = true
  }
  assertDatabaseIntegrity(config.databasePath)
  await validateMedia(config.mediaRoot)
} catch (error) {
  for (const swap of [...swaps].reverse()) {
    try {
      if (swap.installed && existsSync(swap.target)) remove(swap.target, swap.kind)
      if (swap.moved && existsSync(swap.previous)) renameSync(swap.previous, swap.target)
    } catch { /* Preserve the original restore failure. */ }
  }
  throw error
} finally {
  for (const swap of swaps) {
    if (swap.staged && existsSync(swap.staged)) remove(swap.staged, swap.kind)
  }
}
for (const swap of swaps) {
  try {
    if (swap.moved && existsSync(swap.previous)) remove(swap.previous, swap.kind)
  } catch { /* A stale previous copy is safer than rolling back a completed restore. */ }
}

console.log(`AnimeUta restored from: ${backupRoot}`)
