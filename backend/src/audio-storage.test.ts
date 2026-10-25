import Fastify from 'fastify'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { externalAudioUri, resolveAudioPath } from './audio-storage.js'
import { referencedMediaFiles } from './backup-integrity.js'
import { loadConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'
import { AppError } from './errors.js'
import { MediaService } from './media.js'
import { SongService } from './songs.js'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'animeuta-audio-links-'))
  directories.push(directory)
  const sourceRoot = join(directory, 'originals')
  const mediaRoot = join(directory, 'media')
  mkdirSync(sourceRoot)
  mkdirSync(mediaRoot)
  const path = join(sourceRoot, '歌 & space.mp3')
  writeFileSync(path, '0123456789abcdefghijklmnopqrstuvwxyz')
  const config = { ...loadConfig(directory), databasePath: join(directory, 'test.sqlite'), mediaRoot, audioLibraryRoots: [sourceRoot] }
  const database = openDatabase(config.databasePath)
  runMigrations(database)
  database.prepare("INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, 'owner@example.com', 'hash', 'salt', 'Owner', 'owner')").run()
  database.prepare("INSERT INTO song(id, title_ja, audio_source_uri, audio_mime_type, submitted_by, review_status, visibility) VALUES (1, 'Song', ?, 'audio/mpeg', 1, 'approved', 'shared')").run(externalAudioUri(path, config))
  return { directory, path, config, database, media: new MediaService(database, config) }
}

describe('referenced original audio', () => {
  it('streams original files and byte ranges without a project copy', async () => {
    const { path, config, database, media } = setup()
    const app = Fastify()
    app.get<{ Params: { id: string }; Querystring: { expires: string; signature: string } }>('/api/v1/songs/:id/stream', async (request, reply) => {
      await media.streamSong(request, reply, Number(request.params.id), Number(request.query.expires), request.query.signature)
    })
    try {
      const url = media.createStreamUrl(1)
      const full = await app.inject(url)
      expect(full.statusCode).toBe(200)
      expect(full.rawPayload).toEqual(readFileSync(path))
      const range = await app.inject({ url, headers: { range: 'bytes=10-15' } })
      expect(range.statusCode).toBe(206)
      expect(range.headers['content-range']).toBe('bytes 10-15/36')
      expect(range.body).toBe('abcdef')
      expect(existsSync(join(config.mediaRoot, 'audio'))).toBe(false)
      rmSync(path)
      const missing = await app.inject(url)
      expect(missing.statusCode).toBe(404)
    } finally { await app.close(); database.close() }
  })

  it('rejects unconfigured originals and traversal outside managed storage', () => {
    const { path, config, database, directory } = setup()
    try {
      expect(resolveAudioPath(externalAudioUri(path, config), config)).toBe(path)
      const outside = join(directory, 'originals-other', 'private.mp3')
      mkdirSync(join(directory, 'originals-other'))
      writeFileSync(outside, 'outside')
      expect(() => resolveAudioPath(pathToFileURL(outside).href, config)).toThrow(AppError)
      expect(() => resolveAudioPath('../originals-other/private.mp3', config)).toThrow(AppError)
      expect(() => externalAudioUri(path, { ...config, audioLibraryRoots: [] })).toThrow(AppError)
    } finally { database.close() }
  })

  it('deletes only the song record and never deletes original audio', () => {
    const { path, config, database, media } = setup()
    try {
      const uri = externalAudioUri(path, config)
      media.removeSavedUpload({ relativePath: uri, absolutePath: path, originalFilename: 'song.mp3', mimeType: 'audio/mpeg', sizeBytes: 36, checksum: 'unused' })
      expect(existsSync(path)).toBe(true)
      expect(referencedMediaFiles(config.databasePath)).toEqual([])
      const songs = new SongService(database, config, media)
      songs.delete({ id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN' }, 1)
      expect(database.prepare('SELECT id FROM song').all()).toEqual([])
      expect(existsSync(path)).toBe(true)
    } finally { database.close() }
  })
})
