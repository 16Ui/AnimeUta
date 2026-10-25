import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from './auth.js'
import type { AppConfig } from './config.js'
import { openDatabase, runMigrations, type SqliteDatabase } from './db.js'
import { LyricJobService } from './lyric-jobs.js'
import type { LlmClient } from './llm.js'
import { MediaService } from './media.js'
import { SongService } from './songs.js'
import type { StudyService } from './study.js'

const directories: string[] = []

function setup(): { database: SqliteDatabase; config: AppConfig; user: AuthUser } {
  const directory = mkdtempSync(join(tmpdir(), 'animeuta-jobs-'))
  directories.push(directory)
  const database = openDatabase(join(directory, 'test.sqlite'))
  runMigrations(database)
  database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, 'owner@example.com', 'hash', 'salt', 'Owner', 'owner')`).run()
  database.prepare(`INSERT INTO song(id, title_ja, submitted_by, review_status, visibility) VALUES (1, '光', 1, 'approved', 'shared')`).run()
  database.prepare(`INSERT INTO lyric(id, song_id, original_text, review_status, visibility) VALUES (1, 1, '君の声', 'approved', 'shared')`).run()
  database.prepare(`INSERT INTO lyric_line(id, lyric_id, line_index, start_ms, end_ms, original_text) VALUES (1, 1, 0, 1000, 3000, '君の声')`).run()
  return {
    database,
    config: {
      host: '127.0.0.1', port: 0, databasePath: join(directory, 'test.sqlite'), mediaRoot: join(directory, 'media'),
      appOrigins: [], registrationMode: 'invite', friendShareReview: true, bootstrapAdminName: 'Owner',
      accessTokenTtlMinutes: 30, refreshTokenTtlDays: 30, maxAudioBytes: 1024, maxImageBytes: 1024,
      mediaSigningSecret: 'test', llmBaseUrl: 'http://127.0.0.1', llmModel: 'test', transcriptionModel: 'test', aiDailyLimit: 20,
    },
    user: { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN' },
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('lyric job worker', () => {
  it('persists a successful translation and updates lyric lines', async () => {
    const { database, config, user } = setup()
    try {
      const chatJson = vi.fn().mockResolvedValue({ lines: [{ lineIndex: 0, translatedText: '你的声音' }] })
      const jobs = new LyricJobService(database, config, { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService, { chatJson } as unknown as LlmClient)
      const created = jobs.create(user, 1, 'translate')
      await vi.waitFor(() => expect(jobs.list(user, 1, 10)[0]?.status).toBe('succeeded'))
      expect(created.jobType).toBe('translate')
      expect(chatJson).toHaveBeenCalledOnce()
      expect((database.prepare('SELECT translated_text FROM lyric_line WHERE id = 1').get() as { translated_text: string }).translated_text).toBe('你的声音')
    } finally {
      database.close()
    }
  })

  it('records schema failures and retries the same persistent job', async () => {
    const { database, config, user } = setup()
    try {
      const chatJson = vi.fn().mockResolvedValueOnce({ lines: [{ lineIndex: 0 }] })
        .mockResolvedValueOnce({ lines: [{ lineIndex: 0, translatedText: '你的声音' }] })
      const jobs = new LyricJobService(database, config, { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService, { chatJson } as unknown as LlmClient)
      const created = jobs.create(user, 1, 'translate')
      await vi.waitFor(() => expect(jobs.list(user, 1, 10)[0]?.status).toBe('failed'))
      expect(jobs.list(user, 1, 10)[0]?.errorCode).toBe('llm_schema_error')
      expect(jobs.list(user, 1, 10)[0]?.errorMessage).toContain('翻译结果')

      jobs.retry(user, created.id)
      await vi.waitFor(() => expect(jobs.list(user, 1, 10)[0]?.status).toBe('succeeded'))
      expect(jobs.list(user, 1, 10)[0]?.retryCount).toBe(1)
    } finally {
      database.close()
    }
  })

  it('maps unexpected worker failures to a stable internal error code', async () => {
    const { database, config, user } = setup()
    try {
      const chatJson = vi.fn().mockRejectedValue(new Error('provider socket closed'))
      const jobs = new LyricJobService(
        database,
        config,
        { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService,
        { chatJson } as unknown as LlmClient,
      )

      const created = jobs.create(user, 1, 'translate')
      await vi.waitFor(() => expect(jobs.list(user, 1, 10).find((job) => job.id === created.id)?.status).toBe('failed'))
      const failed = jobs.list(user, 1, 10).find((job) => job.id === created.id)
      expect(failed?.errorCode).toBe('internal_error')
      expect(failed?.errorMessage).toBe('provider socket closed')
    } finally {
      database.close()
    }
  })

  it('does not leave partially translated lines when a later result is invalid', async () => {
    const { database, config, user } = setup()
    try {
      database.prepare(`INSERT INTO lyric_line(lyric_id, line_index, start_ms, end_ms, original_text) VALUES (1, 1, 3000, 5000, '届くまで')`).run()
      const chatJson = vi.fn().mockResolvedValue({
        lines: [
          { lineIndex: 0, translatedText: '你的声音' },
          { lineIndex: 1 },
        ],
      })
      const jobs = new LyricJobService(database, config, { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService, { chatJson } as unknown as LlmClient)

      const created = jobs.create(user, 1, 'translate')
      await vi.waitFor(() => expect(jobs.list(user, 1, 10).find((job) => job.id === created.id)?.status).toBe('failed'))
      expect(database.prepare('SELECT translated_text FROM lyric_line WHERE lyric_id = 1 ORDER BY line_index').all())
        .toEqual([{ translated_text: null }, { translated_text: null }])
    } finally {
      database.close()
    }
  })

  it('rolls back lyric changes when the task success state cannot be committed', async () => {
    const { database, config, user } = setup()
    try {
      database.exec(`
        CREATE TRIGGER reject_job_success
        BEFORE UPDATE OF status ON lyric_processing_job
        WHEN NEW.status = 'succeeded'
        BEGIN
          SELECT RAISE(ABORT, 'forced success failure');
        END;
      `)
      const chatJson = vi.fn().mockResolvedValue({ lines: [{ lineIndex: 0, translatedText: '你的声音' }] })
      const jobs = new LyricJobService(database, config, { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService, { chatJson } as unknown as LlmClient)

      const created = jobs.create(user, 1, 'translate')
      await vi.waitFor(() => expect(jobs.list(user, 1, 10).find((job) => job.id === created.id)?.status).toBe('failed'))
      expect(database.prepare('SELECT translated_text FROM lyric_line WHERE id = 1').get()).toEqual({ translated_text: null })
      expect(database.prepare('SELECT status, output_payload_json FROM lyric_processing_job WHERE id = ?').get(created.id))
        .toEqual({ status: 'failed', output_payload_json: null })
    } finally {
      database.close()
    }
  })

  it('delegates tokenization to the Kuromoji and dictionary study pipeline', async () => {
    const { database, config, user } = setup()
    try {
      const chatJson = vi.fn()
      const tokenizeSong = vi.fn().mockResolvedValue({ analysis: { dictionaryAvailable: true, resolved: 3, llmResolved: 0, unresolved: 0 } })
      const jobs = new LyricJobService(
        database,
        config,
        { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService,
        { chatJson } as unknown as LlmClient,
        { tokenizeSong } as unknown as StudyService,
      )

      const created = jobs.create(user, 1, 'tokenize')
      await vi.waitFor(() => expect(jobs.list(user, 1, 10).find((job) => job.id === created.id)?.status).toBe('succeeded'))
      expect(tokenizeSong).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 1)
      expect(chatJson).not.toHaveBeenCalled()
    } finally {
      database.close()
    }
  })

  it('preserves existing tokens when the study pipeline fails', async () => {
    const { database, config, user } = setup()
    try {
      const lexemeId = Number(database.prepare(`
        INSERT INTO lexeme(language_code, lemma, writing, reading, source) VALUES ('ja', '既存', '既存', 'きそん', 'manual')
      `).run().lastInsertRowid)
      database.prepare(`
        INSERT INTO lyric_token(line_id, lexeme_id, token_index, surface, start_offset, end_offset)
        VALUES (1, ?, 0, '既存', 0, 1)
      `).run(lexemeId)
      const jobs = new LyricJobService(
        database,
        config,
        { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService,
        { chatJson: vi.fn() } as unknown as LlmClient,
        { tokenizeSong: vi.fn().mockRejectedValue(new Error('dictionary unavailable')) } as unknown as StudyService,
      )

      const created = jobs.create(user, 1, 'tokenize')
      await vi.waitFor(() => expect(jobs.list(user, 1, 10).find((job) => job.id === created.id)?.status).toBe('failed'))
      expect(jobs.list(user, 1, 10).find((job) => job.id === created.id)?.errorCode).toBe('internal_error')
      expect(database.prepare('SELECT surface FROM lyric_token WHERE line_id = 1').all()).toEqual([{ surface: '既存' }])
    } finally {
      database.close()
    }
  })

  it('runs a regular user job against a private draft instead of the shared lyric', async () => {
    const { database, config } = setup()
    try {
      database.prepare(`
        INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role)
        VALUES (2, 'friend@example.com', 'hash', 'salt', 'Friend', 'user'),
               (3, 'other@example.com', 'hash', 'salt', 'Other', 'user')
      `).run()
      const user: AuthUser = { id: 2, email: 'friend@example.com', role: 'user', displayName: 'Friend', preferredLanguage: 'zh-CN' }
      const chatJson = vi.fn().mockResolvedValue({ lines: [{ lineIndex: 0, translatedText: '你的声音' }] })
      const songs = new SongService(database, config, new MediaService(database, config))
      const jobs = new LyricJobService(database, config, songs, { chatJson } as unknown as LlmClient)

      expect(() => songs.assertEditable(user, 1)).toThrowError(expect.objectContaining({ code: 'forbidden' }))
      database.prepare(`
        INSERT INTO lyric_processing_job(song_id, lyric_id, job_type, status, requested_by)
        VALUES (1, 1, 'translate', 'processing', 3)
      `).run()

      const created = jobs.create(user, 1, 'translate')
      await vi.waitFor(() => expect(jobs.list(user, 1, 10)[0]?.status).toBe('succeeded'))
      const persistedJob = database.prepare('SELECT lyric_id FROM lyric_processing_job WHERE id = ?').get(created.id) as { lyric_id: number }
      expect(persistedJob.lyric_id).not.toBe(1)
      expect(database.prepare('SELECT translated_text FROM lyric_line WHERE lyric_id = 1').get()).toMatchObject({ translated_text: null })
      expect(database.prepare('SELECT translated_text FROM lyric_line WHERE lyric_id = ?').get(persistedJob.lyric_id)).toMatchObject({ translated_text: '你的声音' })
      expect(database.prepare('SELECT review_status, visibility, is_current, uploaded_by FROM lyric WHERE id = ?').get(persistedJob.lyric_id)).toMatchObject({ review_status: 'pending', visibility: 'private', is_current: 1, uploaded_by: 2 })
      expect(database.prepare('SELECT visibility, is_current FROM lyric WHERE id = 1').get()).toMatchObject({ visibility: 'shared', is_current: 1 })
      expect(database.prepare("SELECT count(*) AS count FROM lyric_processing_job WHERE song_id = 1 AND job_type = 'translate'").get()).toMatchObject({ count: 2 })
    } finally {
      database.close()
    }
  })

  it('allows only the requester to list and retry a personal job on a shared song', async () => {
    const { database, config } = setup()
    try {
      database.prepare(`
        INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role)
        VALUES (2, 'friend@example.com', 'hash', 'salt', 'Friend', 'user'),
               (3, 'other@example.com', 'hash', 'salt', 'Other', 'user')
      `).run()
      const user: AuthUser = { id: 2, email: 'friend@example.com', role: 'user', displayName: 'Friend', preferredLanguage: 'zh-CN' }
      const other: AuthUser = { id: 3, email: 'other@example.com', role: 'user', displayName: 'Other', preferredLanguage: 'zh-CN' }
      const owner: AuthUser = { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN' }
      const chatJson = vi.fn()
        .mockResolvedValueOnce({ lines: [{ lineIndex: 0 }] })
        .mockResolvedValueOnce({ lines: [{ lineIndex: 0, translatedText: '你的声音' }] })
      const jobs = new LyricJobService(
        database,
        config,
        new SongService(database, config, new MediaService(database, config)),
        { chatJson } as unknown as LlmClient,
      )

      const created = jobs.create(user, 1, 'translate')
      await vi.waitFor(() => expect(jobs.list(user, 1, 10)[0]?.status).toBe('failed'))
      expect(jobs.list(other, 1, 10)).toEqual([])
      expect(jobs.list(owner, 1, 10)).toEqual([])
      expect(() => jobs.retry(other, created.id)).toThrowError(expect.objectContaining({ code: 'job_not_found' }))
      expect(() => jobs.retry(owner, created.id)).toThrowError(expect.objectContaining({ code: 'job_not_found' }))

      jobs.retry(user, created.id)
      await vi.waitFor(() => expect(jobs.list(user, 1, 10)[0]?.status).toBe('succeeded'))
      const privateLyricId = (database.prepare('SELECT lyric_id FROM lyric_processing_job WHERE id = ?').get(created.id) as { lyric_id: number }).lyric_id
      expect(database.prepare('SELECT translated_text FROM lyric_line WHERE lyric_id = ?').get(privateLyricId)).toMatchObject({ translated_text: '你的声音' })
      expect(database.prepare('SELECT translated_text FROM lyric_line WHERE lyric_id = 1').get()).toMatchObject({ translated_text: null })
    } finally {
      database.close()
    }
  })

  it('enforces the daily AI task quota for regular users without consuming moderator quota', async () => {
    const { database, config } = setup()
    try {
      database.prepare("UPDATE app_user SET role = 'user' WHERE id = 1").run()
      config.aiDailyLimit = 2
      const user: AuthUser = { id: 1, email: 'friend@example.com', role: 'user', displayName: 'Friend', preferredLanguage: 'zh-CN' }
      database.prepare(`
        INSERT INTO lyric_processing_job(song_id, lyric_id, job_type, status, requested_by)
        VALUES (1, 1, 'translate', 'succeeded', 1), (1, 1, 'furigana', 'succeeded', 1)
      `).run()
      const jobs = new LyricJobService(
        database,
        config,
        { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService,
        { chatJson: vi.fn().mockResolvedValue({ annotations: [] }) } as unknown as LlmClient,
      )

      expect(() => jobs.create(user, 1, 'annotate')).toThrowError(expect.objectContaining({ code: 'ai_daily_limit' }))

      database.prepare("UPDATE app_user SET role = 'owner' WHERE id = 1").run()
      const owner = { ...user, role: 'owner' as const }
      const created = jobs.create(owner, 1, 'annotate')
      expect(created).toMatchObject({ jobType: 'annotate' })
      await vi.waitFor(() => expect(jobs.list(owner, 1, 10).find((job) => job.id === created.id)?.status).toBe('succeeded'))
    } finally {
      database.close()
    }
  })

  it('recovers a task left processing by an interrupted service', async () => {
    const { database, config, user } = setup()
    const chatJson = vi.fn().mockResolvedValue({ lines: [{ lineIndex: 0, translatedText: '恢复后的译文' }] })
    const jobs = new LyricJobService(
      database,
      config,
      { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService,
      { chatJson } as unknown as LlmClient,
    )
    try {
      const result = database.prepare(`
        INSERT INTO lyric_processing_job(song_id, lyric_id, job_type, status, requested_by, started_at)
        VALUES (1, 1, 'translate', 'processing', 1, CURRENT_TIMESTAMP)
      `).run()

      jobs.start()
      await vi.waitFor(() => expect(jobs.list(user, 1, 10).find((job) => job.id === Number(result.lastInsertRowid))?.status).toBe('succeeded'))
      expect(chatJson).toHaveBeenCalledOnce()
      expect(database.prepare('SELECT translated_text FROM lyric_line WHERE id = 1').get()).toMatchObject({ translated_text: '恢复后的译文' })
    } finally {
      await jobs.stop()
      database.close()
    }
  })

  it('writes validated furigana, learning annotations and token timing', async () => {
    const cases = [
      {
        type: 'furigana',
        output: { lines: [{ lineIndex: 0, romaji: 'kimi no koe', ruby: [{ text: '君', ruby: 'きみ' }, { text: 'の' }, { text: '声', ruby: 'こえ' }] }] },
        verify(database: SqliteDatabase) {
          expect(database.prepare('SELECT ruby_json, romaji_text FROM lyric_line WHERE id = 1').get()).toMatchObject({
            ruby_json: JSON.stringify([{ text: '君', ruby: 'きみ' }, { text: 'の' }, { text: '声', ruby: 'こえ' }]),
            romaji_text: 'kimi no koe',
          })
        },
      },
      {
        type: 'annotate',
        output: { annotations: [{ lineIndex: 0, category: 'grammar', body: '「の」连接两个名词。' }] },
        verify(database: SqliteDatabase) {
          expect(database.prepare('SELECT category, body, visibility, review_status FROM lyric_annotation').get()).toMatchObject({
            category: 'grammar', body: '「の」连接两个名词。', visibility: 'shared', review_status: 'approved',
          })
        },
      },
    ] as const

    for (const testCase of cases) {
      const { database, config, user } = setup()
      try {
        const jobs = new LyricJobService(
          database,
          config,
          { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService,
          { chatJson: vi.fn().mockResolvedValue(testCase.output) } as unknown as LlmClient,
          testCase.type === 'furigana'
            ? { annotateLines: vi.fn().mockResolvedValue(testCase.output.lines) } as unknown as StudyService
            : undefined,
        )
        const created = jobs.create(user, 1, testCase.type)
        await vi.waitFor(() => expect(jobs.list(user, 1, 10).find((job) => job.id === created.id)?.status).toBe('succeeded'))
        testCase.verify(database)
      } finally {
        database.close()
      }
    }
  })

  it('creates timed lyrics from transcription and realigns an existing lyric', async () => {
    const transcription = {
      segments: [{
        start: 2,
        end: 4,
        text: '君の声',
        words: [{ start: 2, end: 2.8, word: '君' }, { start: 2.8, end: 3.1, word: 'の' }, { start: 3.1, end: 4, word: '声' }],
      }],
    }

    const transcribeSetup = setup()
    try {
      transcribeSetup.database.prepare("UPDATE song SET audio_source_uri = 'audio/song.mp3', audio_mime_type = 'audio/mpeg' WHERE id = 1").run()
      transcribeSetup.database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (2, 'friend@example.com', 'hash', 'salt', 'Friend', 'user')`).run()
      transcribeSetup.database.prepare(`
        INSERT INTO lyric(song_id, original_text, uploaded_by, review_status, visibility, is_current)
        VALUES (1, '友達の個人歌詞', 2, 'pending', 'private', 1)
      `).run()
      const transcribe = vi.fn().mockResolvedValue(transcription)
      const jobs = new LyricJobService(
        transcribeSetup.database,
        transcribeSetup.config,
        { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService,
        { transcribe } as unknown as LlmClient,
      )
      const created = jobs.create(transcribeSetup.user, 1, 'transcribe')
      await vi.waitFor(() => expect(jobs.list(transcribeSetup.user, 1, 10).find((job) => job.id === created.id)?.status).toBe('succeeded'))
      const lyric = transcribeSetup.database.prepare(`SELECT id, source_type, original_text, is_current FROM lyric WHERE source_type = 'ai_transcription'`).get() as { id: number; source_type: string; original_text: string; is_current: number }
      expect(lyric).toMatchObject({ source_type: 'ai_transcription', original_text: '君の声', is_current: 1 })
      expect(transcribeSetup.database.prepare('SELECT start_ms, end_ms FROM lyric_line WHERE lyric_id = ?').get(lyric.id)).toMatchObject({ start_ms: 2000, end_ms: 4000 })
      expect(transcribeSetup.database.prepare('SELECT count(*) AS count FROM lyric_token WHERE line_id IN (SELECT id FROM lyric_line WHERE lyric_id = ?)').get(lyric.id)).toMatchObject({ count: 3 })
      expect(transcribe).toHaveBeenCalledWith(expect.stringContaining('song.mp3'), 'audio/mpeg', 'ja')
      expect(transcribeSetup.database.prepare("SELECT is_current FROM lyric WHERE uploaded_by = 2 AND visibility = 'private'").get())
        .toMatchObject({ is_current: 1 })
    } finally {
      transcribeSetup.database.close()
    }

    const alignSetup = setup()
    try {
      alignSetup.database.prepare("UPDATE song SET audio_source_uri = 'audio/song.mp3', audio_mime_type = 'audio/mpeg' WHERE id = 1").run()
      const jobs = new LyricJobService(
        alignSetup.database,
        alignSetup.config,
        { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService,
        { transcribe: vi.fn().mockResolvedValue(transcription) } as unknown as LlmClient,
      )
      const created = jobs.create(alignSetup.user, 1, 'align')
      await vi.waitFor(() => expect(jobs.list(alignSetup.user, 1, 10).find((job) => job.id === created.id)?.status).toBe('succeeded'))
      expect(alignSetup.database.prepare('SELECT start_ms, end_ms FROM lyric_line WHERE id = 1').get()).toMatchObject({ start_ms: 2000, end_ms: 4000 })
    } finally {
      alignSetup.database.close()
    }
  })

  it('keeps a personal task private when the requester role changes before completion', async () => {
    const { database, config, user } = setup()
    try {
      database.prepare("UPDATE song SET audio_source_uri = 'audio/song.mp3', audio_mime_type = 'audio/mpeg' WHERE id = 1").run()
      const regularUser: AuthUser = { ...user, role: 'user' }
      const jobs = new LyricJobService(
        database,
        config,
        { assertVisible: vi.fn(), assertEditable: vi.fn() } as unknown as SongService,
        { transcribe: vi.fn().mockResolvedValue({ segments: [{ start: 1, end: 2, text: '個人の歌詞' }] }) } as unknown as LlmClient,
      )

      const created = jobs.create(regularUser, 1, 'transcribe')
      expect(created.inputPayload).toMatchObject({ outputScope: 'private' })
      await vi.waitFor(() => expect(jobs.list(regularUser, 1, 10).find((job) => job.id === created.id)?.status).toBe('succeeded'))
      expect(database.prepare("SELECT visibility, uploaded_by FROM lyric WHERE source_type = 'ai_transcription'").get())
        .toMatchObject({ visibility: 'private', uploaded_by: 1 })
    } finally {
      database.close()
    }
  })
})
