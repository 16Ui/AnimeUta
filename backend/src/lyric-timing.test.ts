import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthUser } from './auth.js'
import type { AppConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'
import { MediaService } from './media.js'
import { SongService } from './songs.js'

const directories: string[] = []

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'animeuta-lyric-timing-'))
  directories.push(directory)
  const config: AppConfig = {
    host: '127.0.0.1', port: 0, databasePath: join(directory, 'test.sqlite'), mediaRoot: join(directory, 'media'), appOrigins: [],
    registrationMode: 'invite', friendShareReview: true, bootstrapAdminName: 'Owner', accessTokenTtlMinutes: 30,
    refreshTokenTtlDays: 30, maxAudioBytes: 1024, maxImageBytes: 1024, mediaSigningSecret: 'test',
    llmBaseUrl: 'http://127.0.0.1', llmModel: 'test', transcriptionModel: 'test', aiDailyLimit: 20,
  }
  const database = openDatabase(config.databasePath)
  runMigrations(database)
  database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, 'owner@example.com', 'hash', 'salt', 'Owner', 'owner')`).run()
  database.prepare(`INSERT INTO song(id, title_ja, submitted_by, review_status, visibility) VALUES (1, '光', 1, 'approved', 'shared')`).run()
  database.prepare(`INSERT INTO lyric(id, song_id, original_text, uploaded_by, visibility) VALUES (1, 1, '君の声', 1, 'shared')`).run()
  database.prepare(`INSERT INTO lyric_line(id, lyric_id, line_index, start_ms, end_ms, original_text) VALUES (1, 1, 0, 1000, 3000, '君の声')`).run()
  return { database, songs: new SongService(database, config, new MediaService(database, config)) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('lyric timing offset', () => {
  it('persists a reversible whole-track offset without rewriting line timestamps', () => {
    const { database, songs } = setup()
    const owner: AuthUser = { id: 1, email: 'owner@example.com', displayName: 'Owner', role: 'owner', preferredLanguage: 'zh-CN' }

    expect(songs.updateLyricTimingOffset(owner, 1, 1500)).toMatchObject({ timingOffsetMs: 1500 })
    expect(songs.currentLyrics(owner, 1)).toMatchObject({ timingOffsetMs: 1500 })
    expect(database.prepare('SELECT start_ms, end_ms FROM lyric_line WHERE id = 1').get()).toEqual({ start_ms: 1000, end_ms: 3000 })
    expect(songs.updateLyricTimingOffset(owner, 1, 0)).toMatchObject({ timingOffsetMs: 0 })

    database.close()
  })

  it('rejects offsets outside the supported range', () => {
    const { database, songs } = setup()
    const owner: AuthUser = { id: 1, email: 'owner@example.com', displayName: 'Owner', role: 'owner', preferredLanguage: 'zh-CN' }

    expect(() => songs.updateLyricTimingOffset(owner, 1, 30_001)).toThrow('歌词偏移量必须在正负 30 秒以内')
    database.close()
  })
})
