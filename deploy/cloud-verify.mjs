import { readFileSync, createReadStream, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { AuthService } from '/opt/animeuta/current/backend/dist/auth.js'
import { loadConfig } from '/opt/animeuta/current/backend/dist/config.js'
import { hashToken } from '/opt/animeuta/current/backend/dist/security.js'

process.loadEnvFile('/opt/animeuta/shared/backend.env')
const config = loadConfig()
const manifest = JSON.parse(readFileSync('/opt/animeuta/backups/initial-manifest.json'))
const db = new DatabaseSync(config.databasePath)
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
if (!process.argv.includes('--skip-initial-counts')) {
  for (const [table, count] of Object.entries(manifest.counts)) {
    assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, count, table)
  }
}
if (!process.argv.includes('--core-only') && !process.argv.includes('--skip-file-hashes')) {
  for (const file of manifest.files) {
    if (file.path === 'shared/data/animeuta.sqlite') continue
    const path = '/opt/animeuta/' + file.path
    assert.equal(statSync(path).size, file.bytes, path)
    const hash = createHash('sha256')
    for await (const data of createReadStream(path)) hash.update(data)
    assert.equal(hash.digest('hex'), file.sha256, path)
  }
  console.log('All media and dictionary files match original SHA-256 values')
}

const base = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:8090'
assert.equal((await fetch(base + '/health')).status, 200)
assert.equal((await fetch(base + '/api/v1/songs')).status, 401)
assert.equal((await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({email:'invalid@example.invalid', password:'invalid'}) })).status, 401)
const user = db.prepare("SELECT id FROM app_user WHERE role='owner' AND status='active' ORDER BY id LIMIT 1").get()
assert.ok(user)
const auth = new AuthService(db, config)
// Short-lived server-side acceptance session; never printed or retained.
const session = auth.issueSession(user.id, 'cloud-migration-acceptance')
try {
  for (const path of ['/api/v1/auth/me', '/api/v1/users/me/lyric-preferences', '/api/v1/songs?page=1&page_size=20', '/api/v1/me/playlists', '/api/v1/study/today', '/api/v1/study/grammar/path', '/api/v1/study/reviews/history']) {
    const response = await fetch(base + path, {headers:{Authorization:`Bearer ${session.token}`}})
    assert.equal(response.status, 200, path)
    await response.json()
    console.log('PASS ' + path)
  }
  const songs = db.prepare('SELECT id FROM song ORDER BY id').all()
  const sample = [songs[0], songs[Math.floor(songs.length/2)], songs.at(-1)]
  for (const song of sample) {
    const headers = {Authorization:`Bearer ${session.token}`}
    const detail = await fetch(`${base}/api/v1/songs/${song.id}`, {headers})
    assert.equal(detail.status,200)
    const lyrics = await fetch(`${base}/api/v1/songs/${song.id}/lyrics`, {headers})
    assert.equal(lyrics.status,200)
    if (!process.argv.includes('--core-only')) {
      const { MediaService } = await import('/opt/animeuta/current/backend/dist/media.js')
      const media = new MediaService(db, config)
      const stream = await fetch(base + media.createStreamUrl(song.id), {headers:{Range:'bytes=0-4095'}})
      assert.equal(stream.status,206)
      assert.equal((await stream.arrayBuffer()).byteLength,4096)
      console.log(`PASS song ${song.id}: lyrics and audio Range`)
    }
  }
} finally {
  auth.logout(session.token)
  db.prepare('DELETE FROM auth_session WHERE access_token_hash=?').run(hashToken(session.token))
  db.close()
}
console.log('CLOUD_ACCEPTANCE_OK')
