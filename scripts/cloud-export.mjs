import { DatabaseSync, backup } from 'node:sqlite'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, linkSync, statSync, createReadStream } from 'node:fs'
import { resolve, join, extname, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { parseEnv } from 'node:util'

const root = fileURLToPath(new URL('..', import.meta.url))
const target = resolve(root, 'artifacts/cloud/initial-20261024')
if (existsSync(target)) throw new Error('Export already exists; choose a new destination rather than overwrite it')
const env = parseEnv(readFileSync(join(root, 'backend/.env'), 'utf8'))
const localDb = resolve(root, 'backend', env.DATABASE_PATH || 'data/animeuta.sqlite')
const media = resolve(root, 'backend', env.MEDIA_ROOT || 'data/media')
const { referencedMediaFiles } = await import('../backend/dist/backup-integrity.js')
const hashes = []
async function digest(path) {
  const hash = createHash('sha256')
  for await (const part of createReadStream(path)) hash.update(part)
  return hash.digest('hex')
}
async function addFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true })
  // Staging links avoid another full copy of the original music on this PC.
  linkSync(source, destination)
  const sha256 = await digest(source)
  hashes.push({ path: relative(target, destination).split(sep).join('/'), sha256, bytes: statSync(source).size })
  return sha256
}
mkdirSync(join(target, 'shared/data'), { recursive: true })
const source = new DatabaseSync(localDb, { readOnly: true })
const snapshot = join(target, 'shared/data/animeuta.sqlite')
try { await backup(source, snapshot) } finally { source.close() }
const db = new DatabaseSync(snapshot)
if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Invalid snapshot')
const songs = db.prepare('SELECT id, audio_source_uri, audio_checksum FROM song').all()
for (const song of songs) {
  if (!song.audio_source_uri.startsWith('file:')) continue
  const path = fileURLToPath(song.audio_source_uri)
  const name = `${song.id}${extname(path).toLowerCase()}`
  const sha256 = await addFile(path, join(target, 'shared/music', name))
  if (song.audio_checksum && song.audio_checksum !== sha256) throw new Error(`Checksum mismatch for song ${song.id}`)
  db.prepare('UPDATE song SET audio_source_uri=? WHERE id=?').run(`file:///opt/animeuta/shared/music/${name}`, song.id)
}
for (const path of referencedMediaFiles(snapshot)) {
  const absolute = resolve(media, path)
  if (!absolute.startsWith(resolve(media) + sep)) throw new Error('Invalid media path')
  await addFile(absolute, join(target, 'shared/media', path))
}
await addFile(resolve(root, 'backend', env.TOMOSHI_DICTIONARY_PATH || 'data/dictionaries/tomoshi-dict-open.db'), join(target, 'shared/dictionaries/tomoshi-dict-open.db'))
const counts = {}
for (const table of ['app_user', 'song', 'lyric_line', 'playlist', 'playlist_song', 'user_favorite_song', 'study_card', 'review_log']) {
  counts[table] = db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
db.close()
hashes.push({ path: 'shared/data/animeuta.sqlite', sha256: await digest(snapshot), bytes: statSync(snapshot).size })
const config = {
  HOST: '127.0.0.1', PORT: '8080', DATABASE_PATH: '/opt/animeuta/shared/data/animeuta.sqlite',
  MEDIA_ROOT: '/opt/animeuta/shared/media', AUDIO_LIBRARY_ROOTS: '/opt/animeuta/shared/music',
  TOMOSHI_DICTIONARY_PATH: '/opt/animeuta/shared/dictionaries/tomoshi-dict-open.db',
  APP_ORIGIN: 'http://127.0.0.1:18090', REGISTRATION_MODE: 'closed',
  MEDIA_SIGNING_SECRET: env.MEDIA_SIGNING_SECRET || randomBytes(32).toString('hex'),
}
for (const key of ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'TRANSCRIPTION_BASE_URL', 'TRANSCRIPTION_MODEL', 'TRANSCRIPTION_API_KEY', 'AI_DAILY_LIMIT', 'ACCESS_TOKEN_TTL_MINUTES', 'REFRESH_TOKEN_TTL_DAYS']) {
  if (env[key]) config[key] = env[key]
}
writeFileSync(join(target, 'shared/backend.env'), Object.entries(config).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n')
for (const part of ['backend/dist', 'frontend/dist', 'deploy']) cpSync(join(root, part), join(target, 'release', part), { recursive: true })
for (const name of ['package.json', 'package-lock.json']) cpSync(join(root, 'backend', name), join(target, 'release/backend', name))
writeFileSync(join(target, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), counts, files: hashes }, null, 2))
console.log(JSON.stringify({ target, counts, files: hashes.length, totalGiB: hashes.reduce((sum, item) => sum + item.bytes, 0) / 1024 ** 3, externalAiConfigured: Boolean(config.LLM_API_KEY) }))
