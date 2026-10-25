import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthUser } from './auth.js'
import type { AppConfig } from './config.js'
import { openDatabase, runMigrations, type SqliteDatabase } from './db.js'
import { MediaService, type SavedUpload } from './media.js'
import { SongService } from './songs.js'

const directories: string[] = []

function setup(): { database: SqliteDatabase; songs: SongService; user: AuthUser; mediaRoot: string } {
  const directory = mkdtempSync(join(tmpdir(), 'animeuta-imports-'))
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
  database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, 'owner@example.com', 'hash', 'salt', 'Owner', 'owner')`).run()
  const media = new MediaService(database, config)
  return {
    database,
    songs: new SongService(database, config, media),
    user: { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN' },
    mediaRoot,
  }
}

function savedFile(mediaRoot: string, relativePath: string): SavedUpload {
  const absolutePath = join(mediaRoot, relativePath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, 'temporary')
  return {
    relativePath, absolutePath, originalFilename: relativePath.split('/').at(-1) ?? 'file',
    mimeType: 'application/octet-stream', sizeBytes: 9, checksum: 'test',
  }
}

function savedWave(mediaRoot: string): SavedUpload {
  const relativePath = 'audio/import.wav'
  const absolutePath = join(mediaRoot, relativePath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  const sampleRate = 8000
  const samples = sampleRate
  const dataSize = samples * 2
  const bytes = Buffer.alloc(44 + dataSize)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + dataSize, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(dataSize, 40)
  writeFileSync(absolutePath, bytes)
  return {
    relativePath, absolutePath, originalFilename: 'Detected Artist - Detected Title.wav',
    mimeType: 'audio/wav', sizeBytes: bytes.byteLength, checksum: 'test-wave',
  }
}

function insertPreview(database: SqliteDatabase, files: Record<string, SavedUpload>, createdAt = new Date().toISOString()): number {
  return Number(database.prepare(`
    INSERT INTO import_session(requested_by, status, matched_files_json, created_at, updated_at)
    VALUES (1, 'ready', ?, ?, ?)
  `).run(JSON.stringify(files), createdAt, createdAt).lastInsertRowid)
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('import preview lifecycle', () => {
  it('publishes only the submitter lyric and preserves another user private current lyric', () => {
    const { database, songs, user } = setup()
    try {
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (2, 'submitter@example.com', 'hash', 'salt', 'Submitter', 'user')`).run()
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (3, 'listener@example.com', 'hash', 'salt', 'Listener', 'user')`).run()
      database.prepare(`INSERT INTO song(id, title_ja, submitted_by, review_status, visibility) VALUES (1, 'Pending song', 2, 'pending', 'private')`).run()
      database.prepare(`INSERT INTO lyric(id, song_id, original_text, uploaded_by, review_status, visibility, is_current) VALUES (1, 1, '投稿者の歌詞', 2, 'pending', 'private', 1)`).run()
      database.prepare(`INSERT INTO lyric(id, song_id, original_text, uploaded_by, review_status, visibility, is_current) VALUES (2, 1, '学習者の歌詞', 3, 'pending', 'private', 1)`).run()

      songs.review(user, 1, 'approved')

      expect(database.prepare('SELECT review_status, visibility, is_current FROM lyric WHERE id = 1').get()).toMatchObject({
        review_status: 'approved', visibility: 'shared', is_current: 1,
      })
      expect(database.prepare('SELECT review_status, visibility, is_current FROM lyric WHERE id = 2').get()).toMatchObject({
        review_status: 'pending', visibility: 'private', is_current: 1,
      })
      expect(songs.currentLyrics(user, 1)).toMatchObject({ id: 1, visibility: 'public', isCurrent: true })
    } finally {
      database.close()
    }
  })

  it('lets a listener keep a private lyric version without replacing the shared lyric', () => {
    const { database, songs, user } = setup()
    try {
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (2, 'friend@example.com', 'hash', 'salt', 'Friend', 'user')`).run()
      database.prepare(`INSERT INTO song(id, title_ja, submitted_by, review_status, visibility) VALUES (1, 'Shared song', 1, 'approved', 'shared')`).run()
      database.prepare(`INSERT INTO lyric(id, song_id, original_text, uploaded_by, review_status, visibility, is_current) VALUES (1, 1, '共有歌詞', 1, 'approved', 'shared', 1)`).run()
      database.prepare(`INSERT INTO lyric_line(lyric_id, line_index, start_ms, original_text) VALUES (1, 0, 1000, '共有歌詞')`).run()
      const friend: AuthUser = { id: 2, email: 'friend@example.com', role: 'user', displayName: 'Friend', preferredLanguage: 'zh-CN' }

      const first = songs.uploadLyrics(friend, 1, '[00:01.00]自分の歌詞', 'friend.lrc', 'ja')
      expect(first).toMatchObject({ uploadedBy: 2, visibility: 'private', reviewStatus: 'pending', isCurrent: true })
      expect(songs.currentLyrics(user, 1)).toMatchObject({ id: 1, visibility: 'public', isCurrent: true })

      const second = songs.uploadLyrics(friend, 1, '[00:02.00]新しい歌詞', 'friend-new.lrc', 'ja')
      expect(second).toMatchObject({ uploadedBy: 2, visibility: 'private', isCurrent: true })
      expect(database.prepare(`SELECT id, is_current FROM lyric WHERE uploaded_by = 2 ORDER BY id`).all()).toEqual([
        { id: first.id, is_current: 0 },
        { id: second.id, is_current: 1 },
      ])
      expect(database.prepare('SELECT is_current FROM lyric WHERE id = 1').get()).toMatchObject({ is_current: 1 })
    } finally {
      database.close()
    }
  })

  it('abandons a preview and removes every temporary file', () => {
    const { database, songs, user, mediaRoot } = setup()
    try {
      const files = {
        audio: savedFile(mediaRoot, 'audio/pending.mp3'),
        cover: savedFile(mediaRoot, 'images/pending.jpg'),
        lyrics: savedFile(mediaRoot, 'lyrics/pending.lrc'),
      }
      const id = insertPreview(database, files)

      expect(songs.discardImport(user, id)).toEqual({ ok: true })
      expect(database.prepare('SELECT status FROM import_session WHERE id = ?').get(id)).toMatchObject({ status: 'abandoned' })
      expect(Object.values(files).every((file) => !existsSync(file.absolutePath))).toBe(true)
    } finally {
      database.close()
    }
  })

  it('cleans previews that have been left ready for more than one day', () => {
    const { database, songs, mediaRoot } = setup()
    try {
      const audio = savedFile(mediaRoot, 'audio/expired.mp3')
      const id = insertPreview(database, { audio }, '2000-01-01T00:00:00.000Z')
      const interrupted = Number(database.prepare(`
        INSERT INTO import_session(requested_by, status, matched_files_json)
        VALUES (1, 'processing', '{}')
      `).run().lastInsertRowid)

      expect(songs.cleanupAbandonedImports()).toBe(1)
      expect(database.prepare('SELECT status FROM import_session WHERE id = ?').get(id)).toMatchObject({ status: 'abandoned' })
      expect(database.prepare('SELECT status FROM import_session WHERE id = ?').get(interrupted)).toMatchObject({ status: 'processing' })
      expect(songs.recoverInterruptedImports()).toBe(1)
      expect(database.prepare('SELECT status FROM import_session WHERE id = ?').get(interrupted)).toMatchObject({ status: 'ready' })
      expect(existsSync(audio.absolutePath)).toBe(false)
    } finally {
      database.close()
    }
  })

  it('returns a failed commit to ready so the preview can be corrected or retried', async () => {
    const { database, songs, user, mediaRoot } = setup()
    try {
      const id = insertPreview(database, { audio: savedFile(mediaRoot, 'audio/invalid.mp3') })
      database.prepare("UPDATE import_session SET detected_metadata_json = '{' WHERE id = ?").run(id)

      await expect(songs.commitImport(user, id, {})).rejects.toBeTruthy()
      expect(database.prepare('SELECT status FROM import_session WHERE id = ?').get(id)).toMatchObject({ status: 'ready' })
      expect(database.prepare('SELECT count(*) AS count FROM song').get()).toMatchObject({ count: 0 })
    } finally {
      database.close()
    }
  })

  it('commits a preview only once when confirmation requests overlap', async () => {
    const { database, songs, user, mediaRoot } = setup()
    try {
      const id = insertPreview(database, { audio: savedWave(mediaRoot) })

      const results = await Promise.allSettled([
        songs.commitImport(user, id, { title: 'Single import' }),
        songs.commitImport(user, id, { title: 'Duplicate import' }),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find((result) => result.status === 'rejected')
      expect(rejected?.status === 'rejected' ? rejected.reason : undefined).toMatchObject({
        statusCode: 409, code: 'import_not_ready',
      })
      expect(database.prepare('SELECT status FROM import_session WHERE id = ?').get(id)).toMatchObject({ status: 'committed' })
      expect(database.prepare('SELECT count(*) AS count FROM song').get()).toMatchObject({ count: 1 })
    } finally {
      database.close()
    }
  })

  it('commits corrected artist, album and work values from the preview', async () => {
    const { database, songs, user, mediaRoot } = setup()
    try {
      const audio = savedWave(mediaRoot)
      const result = database.prepare(`
        INSERT INTO import_session(requested_by, status, detected_metadata_json, matched_files_json)
        VALUES (1, 'ready', ?, ?)
      `).run(
        JSON.stringify({ title: 'Detected Title', artist: 'Detected Artist', languageCode: 'ja' }),
        JSON.stringify({ audio }),
      )

      const committed = await songs.commitImport(user, Number(result.lastInsertRowid), {
        title: 'Corrected Title', languageCode: 'ja', artistName: 'Corrected Artist',
        albumTitle: 'Corrected Album', workTitle: 'Corrected Work',
      })

      expect(committed.song).toMatchObject({
        displayTitle: 'Corrected Title',
        primaryArtistName: 'Corrected Artist',
        primaryWorkTitle: 'Corrected Work',
        artists: [expect.objectContaining({ displayName: 'Corrected Artist' })],
        albums: [expect.objectContaining({ displayTitle: 'Corrected Album' })],
        works: [expect.objectContaining({ displayTitle: 'Corrected Work' })],
      })
      expect(database.prepare('SELECT status FROM import_session WHERE id = ?').get(Number(result.lastInsertRowid)))
        .toMatchObject({ status: 'committed' })
    } finally {
      database.close()
    }
  })

  it('stores uploaded kana guides as ruby and preserves them on translation-only edits', async () => {
    const { database, songs, user, mediaRoot } = setup()
    try {
      const audio = savedWave(mediaRoot)
      const result = database.prepare(`
        INSERT INTO import_session(requested_by, status, detected_metadata_json, matched_files_json)
        VALUES (1, 'ready', ?, ?)
      `).run(
        JSON.stringify({ title: 'Ruby Song', languageCode: 'ja' }),
        JSON.stringify({ audio, inlineLyrics: '[00:01.00]光(ひかり)の中《なか》で歌う' }),
      )

      const committed = await songs.commitImport(user, Number(result.lastInsertRowid), {})
      expect(committed.lyric?.lines[0]).toMatchObject({
        originalText: '光の中で歌う',
        originalRuby: [
          { text: '光', ruby: 'ひかり' },
          { text: 'の' },
          { text: '中', ruby: 'なか' },
          { text: 'で歌う' },
        ],
      })

      const lyricId = committed.lyric!.id as number
      const line = committed.lyric!.lines[0]!
      const lexemeId = Number(database.prepare(`
        INSERT INTO lexeme(language_code, lemma, writing, reading) VALUES ('ja', '光', '光', 'ひかり')
      `).run().lastInsertRowid)
      database.prepare('INSERT INTO lyric_token(line_id, lexeme_id, token_index, surface) VALUES (?, ?, 0, ?)')
        .run(line.id, lexemeId, '光')

      const updated = songs.updateLyricLines(user, lyricId, [{
        id: line.id,
        originalText: line.originalText,
        translatedText: '在光芒中歌唱',
        startMs: line.startMs,
        endMs: line.endMs,
      }])
      expect(updated.lines[0]).toMatchObject({
        originalText: '光の中で歌う',
        translatedText: '在光芒中歌唱',
        originalRuby: expect.arrayContaining([{ text: '光', ruby: 'ひかり' }]),
      })
      expect(database.prepare('SELECT count(*) AS count FROM lyric_token WHERE line_id = ?').get(line.id))
        .toMatchObject({ count: 1 })
    } finally {
      database.close()
    }
  })

  it('persists embedded multilingual timelines as original, translation, and romaji fields', async () => {
    const { database, songs, user, mediaRoot } = setup()
    try {
      const audio = savedWave(mediaRoot)
      const multilingualLyrics = [
        '[00:10.00]君の声',
        '[00:20.00]光の中で歌う',
        '[00:10.00]你的声音',
        '[00:20.00]在光芒中歌唱',
        '[00:10.00]kimi no koe',
        '[00:20.00]hikari no naka de utau',
      ].join('\n')
      const result = database.prepare(`
        INSERT INTO import_session(requested_by, status, detected_metadata_json, matched_files_json)
        VALUES (1, 'ready', ?, ?)
      `).run(
        JSON.stringify({ title: 'Multilingual Song', languageCode: 'ja' }),
        JSON.stringify({ audio, inlineLyrics: multilingualLyrics }),
      )

      const committed = await songs.commitImport(user, Number(result.lastInsertRowid), {})
      expect(committed.lyric?.lines).toEqual([
        expect.objectContaining({
          originalText: '君の声', translatedText: '你的声音', romajiText: 'kimi no koe', startMs: 10_000,
        }),
        expect.objectContaining({
          originalText: '光の中で歌う', translatedText: '在光芒中歌唱', romajiText: 'hikari no naka de utau', startMs: 20_000,
        }),
      ])
      expect(database.prepare(`
        SELECT original_text, translated_text, romaji_text FROM lyric_line ORDER BY line_index
      `).all()).toEqual([
        { original_text: '君の声', translated_text: '你的声音', romaji_text: 'kimi no koe' },
        { original_text: '光の中で歌う', translated_text: '在光芒中歌唱', romaji_text: 'hikari no naka de utau' },
      ])
    } finally {
      database.close()
    }
  })
})
