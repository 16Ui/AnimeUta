import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthUser } from './auth.js'
import type { AppConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'
import { MediaService } from './media.js'
import { SongService } from './songs.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('song deletion media lifecycle', () => {
  it('removes private song files while preserving an image until its final visible reference is deleted', () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-delete-'))
    directories.push(directory)
    const mediaRoot = join(directory, 'media')
    const config: AppConfig = {
      host: '127.0.0.1', port: 0, databasePath: join(directory, 'test.sqlite'), mediaRoot, appOrigins: [],
      registrationMode: 'invite', friendShareReview: true, bootstrapAdminName: 'Owner', accessTokenTtlMinutes: 30,
      refreshTokenTtlDays: 30, maxAudioBytes: 1024, maxImageBytes: 1024, mediaSigningSecret: 'test',
      llmBaseUrl: 'http://127.0.0.1', llmModel: 'test', transcriptionModel: 'test', aiDailyLimit: 20,
    }
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const songs = new SongService(database, config, new MediaService(database, config))
    const user: AuthUser = { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN' }
    const audioPath = join(mediaRoot, 'audio/one.mp3')
    const lyricPath = join(mediaRoot, 'lyrics/one.lrc')
    const coverPath = join(mediaRoot, 'images/shared.jpg')
    for (const path of [audioPath, lyricPath, coverPath]) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'media')
    }
    try {
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, 'owner@example.com', 'hash', 'salt', 'Owner', 'owner')`).run()
      database.prepare(`
        INSERT INTO song(id, title_ja, audio_source_uri, cover_url, submitted_by, review_status, visibility)
        VALUES (1, 'One', 'audio/one.mp3', '/media/images/shared.jpg', 1, 'approved', 'shared'),
               (2, 'Two', NULL, '/media/images/shared.jpg', 1, 'approved', 'shared')
      `).run()
      database.prepare(`INSERT INTO lyric(song_id, original_text, source_ref, uploaded_by) VALUES (1, 'line', 'lyrics/one.lrc', 1)`).run()

      songs.delete(user, 1)
      expect(existsSync(audioPath)).toBe(false)
      expect(existsSync(lyricPath)).toBe(false)
      expect(existsSync(coverPath)).toBe(true)

      songs.delete(user, 2)
      expect(existsSync(coverPath)).toBe(false)
    } finally {
      database.close()
    }
  })
})
