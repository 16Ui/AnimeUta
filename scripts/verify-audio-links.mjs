import { openSync, closeSync, readSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { loadConfig } from '../backend/dist/config.js'
import { resolveAudioPath } from '../backend/dist/audio-storage.js'
import { MediaService } from '../backend/dist/media.js'

try { process.loadEnvFile() } catch { /* Run from the backend directory. */ }
const config = loadConfig()
const database = new DatabaseSync(config.databasePath, { readOnly: true })
const media = new MediaService(database, config)
const reportArgument = process.argv.find((argument) => argument.startsWith('--report='))?.slice('--report='.length)
const failures = []
let requests = 0
let songs = 0
try {
  const health = await fetch(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(10000) })
  if (!health.ok) throw new Error(`Backend is not ready: ${health.status}`)
  const rows = database.prepare('SELECT id, audio_source_uri FROM song WHERE audio_source_uri IS NOT NULL ORDER BY id').all()
  for (const row of rows) {
    try {
      const path = resolveAudioPath(row.audio_source_uri, config)
      const size = statSync(path).size
      const url = `http://127.0.0.1:${config.port}${media.createStreamUrl(row.id)}`
      const descriptor = openSync(path, 'r')
      try {
        for (const start of new Set([0, Math.max(0, size - 1024)])) {
          const end = Math.min(start + 1023, size - 1)
          const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(10000) })
          const bytes = Buffer.from(await response.arrayBuffer())
          const expected = Buffer.alloc(end - start + 1)
          readSync(descriptor, expected, 0, expected.length, start)
          if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}` || !bytes.equals(expected)) throw new Error(`Byte range mismatch: ${response.status}`)
          requests += 1
        }
      } finally { closeSync(descriptor) }
      songs += 1
    } catch (error) { failures.push({ songId: row.id, error: error.message }) }
  }
} finally { database.close() }
const report = { checkedAt: new Date().toISOString(), songs, requests, failures }
if (reportArgument) writeFileSync(resolve(reportArgument), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (failures.length) process.exitCode = 1
