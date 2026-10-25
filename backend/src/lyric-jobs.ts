import { resolveAudioPath } from './audio-storage.js'
import type { AuthUser } from './auth.js'
import type { AppConfig } from './config.js'
import type { SqliteDatabase } from './db.js'
import { nowIso } from './db.js'
import { AppError, assertApp } from './errors.js'
import { alignLyricLines } from './lyric-alignment.js'
import type { LlmClient } from './llm.js'
import type { SongService } from './songs.js'
import type { StudyService } from './study.js'
import { zonedDayRange } from './time.js'

type JobType = 'transcribe' | 'translate' | 'furigana' | 'align' | 'annotate' | 'tokenize'

interface JobRow {
  id: number
  song_id: number
  lyric_id: number | null
  job_type: JobType
  status: 'pending' | 'processing' | 'succeeded' | 'failed'
  input_payload_json: string
  output_payload_json: string | null
  error_code: string | null
  error_message: string | null
  retry_count: number
  requested_by: number | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface TranscriptSegment {
  start: number
  end: number
  text: string
}

interface TranscriptWord {
  start: number
  end: number
  text: string
}

export class LyricJobService {
  private timer: NodeJS.Timeout | undefined
  private processing = false
  private inFlight: Promise<void> | undefined

  constructor(
    private readonly database: SqliteDatabase,
    private readonly config: AppConfig,
    private readonly songs: SongService,
    private readonly llm: LlmClient,
    private readonly study?: StudyService,
  ) {}

  start(): void {
    if (this.timer) return
    this.database.prepare(`
      UPDATE lyric_processing_job
      SET status = 'pending', started_at = NULL, completed_at = NULL,
        error_code = 'job_interrupted', error_message = '服务中断，任务已自动恢复', updated_at = ?
      WHERE status = 'processing'
    `).run(nowIso())
    this.timer = setInterval(() => this.scheduleRun(), 1500)
    this.timer.unref()
    this.scheduleRun()
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.inFlight
  }

  create(user: AuthUser, songId: number, jobType: string) {
    this.songs.assertVisible(user, songId)
    assertApp(['transcribe', 'translate', 'furigana', 'align', 'annotate', 'tokenize'].includes(jobType), 400, 'invalid_job_type', '不支持该歌词处理任务')
    const song = this.database.prepare('SELECT language_code FROM song WHERE id = ?').get(songId) as { language_code: string } | undefined
    assertApp(jobType !== 'translate' || song?.language_code !== 'zh', 400, 'translation_not_needed', '中文歌词不需要生成中文翻译')
    const isModerator = user.role === 'owner' || user.role === 'admin'
    const active = isModerator
      ? this.database.prepare(`
          SELECT j.id
          FROM lyric_processing_job j
          LEFT JOIN app_user u ON u.id = j.requested_by
          WHERE j.song_id = ? AND j.job_type = ? AND j.status IN ('pending', 'processing')
            AND (j.requested_by IS NULL OR u.role IN ('owner', 'admin'))
          LIMIT 1
        `).get(songId, jobType)
      : this.database.prepare(`
          SELECT id FROM lyric_processing_job
          WHERE song_id = ? AND job_type = ? AND requested_by = ? AND status IN ('pending', 'processing')
          LIMIT 1
        `).get(songId, jobType, user.id)
    assertApp(!active, 409, 'job_already_active', '同类型任务正在处理中')
    if (user.role === 'user') {
      const day = zonedDayRange(user.timezone || 'UTC')
      const usage = this.database.prepare(`
        SELECT count(*) AS count FROM lyric_processing_job
        WHERE requested_by = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)
      `).get(user.id, day.start.toISOString(), day.end.toISOString()) as { count: number }
      assertApp(usage.count < this.config.aiDailyLimit, 429, 'ai_daily_limit', '今天的 AI 处理次数已用完')
    }
    let lyric = this.database.prepare(`
      SELECT id, visibility, uploaded_by FROM lyric
      WHERE song_id = ? AND is_current = 1 AND (visibility = 'shared' OR uploaded_by = ?)
      ORDER BY CASE WHEN uploaded_by = ? AND visibility = 'private' THEN 0 ELSE 1 END, created_at DESC LIMIT 1
    `).get(songId, user.id, user.id) as { id: number; visibility: string; uploaded_by: number | null } | undefined
    assertApp(jobType === 'transcribe' || lyric, 400, 'lyrics_required', '该任务需要先添加歌词')
    let jobId = 0
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (user.role === 'user' && jobType !== 'transcribe' && lyric?.visibility === 'shared') {
        lyric = { id: this.createPrivateLyricDraft(lyric.id, user.id), visibility: 'private', uploaded_by: user.id }
      }
      const result = this.database.prepare(`
        INSERT INTO lyric_processing_job(song_id, lyric_id, job_type, input_payload_json, requested_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(songId, lyric?.id ?? null, jobType, JSON.stringify({ outputScope: isModerator ? 'shared' : 'private' }), user.id)
      jobId = Number(result.lastInsertRowid)
      this.database.prepare(`INSERT INTO behavior_event(user_id, event_type, subject_type, subject_id, metadata_json) VALUES (?, 'lyric_job_create', 'song', ?, ?)`).run(user.id, songId, JSON.stringify({ jobType }))
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    this.scheduleRun()
    return this.get(jobId)
  }

  list(user: AuthUser, songId: number, limit: number) {
    this.songs.assertVisible(user, songId)
    const rows = this.database.prepare(`
      SELECT * FROM lyric_processing_job WHERE song_id = ? AND requested_by = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(songId, user.id, Math.min(50, Math.max(1, limit))) as unknown as JobRow[]
    return rows.map((row) => this.serialize(row))
  }

  retry(user: AuthUser, jobId: number) {
    const row = this.database.prepare('SELECT * FROM lyric_processing_job WHERE id = ?').get(jobId) as unknown as JobRow | undefined
    assertApp(row, 404, 'job_not_found', '任务不存在')
    this.songs.assertVisible(user, row.song_id)
    assertApp(row.requested_by === user.id, 404, 'job_not_found', '任务不存在')
    assertApp(row.status === 'failed', 409, 'job_not_failed', '只能重试失败的任务')
    assertApp(row.retry_count < 3, 409, 'retry_limit', '该任务已达到最大重试次数')
    this.database.prepare(`
      UPDATE lyric_processing_job SET status = 'pending', retry_count = retry_count + 1,
        error_code = NULL, error_message = NULL,
        started_at = NULL, completed_at = NULL, updated_at = ? WHERE id = ?
    `).run(nowIso(), jobId)
    this.scheduleRun()
    return this.get(jobId)
  }

  private scheduleRun(): void {
    if (this.inFlight) return
    this.inFlight = this.runOne().finally(() => {
      this.inFlight = undefined
    })
  }

  private async runOne(): Promise<void> {
    if (this.processing) return
    this.processing = true
    let job: JobRow | undefined
    try {
      job = this.database.prepare(`
        UPDATE lyric_processing_job SET status = 'processing', started_at = ?, updated_at = ?
        WHERE id = (SELECT id FROM lyric_processing_job WHERE status = 'pending' ORDER BY created_at LIMIT 1)
        RETURNING *
      `).get(nowIso(), nowIso()) as unknown as JobRow | undefined
      if (!job) return
      await this.process(job)
    } catch (error) {
      if (job) {
        const code = error instanceof AppError ? error.code : 'internal_error'
        const message = error instanceof Error ? error.message : String(error)
        const now = nowIso()
        this.database.prepare(`
          UPDATE lyric_processing_job SET status = 'failed', error_code = ?, error_message = ?,
            completed_at = ?, updated_at = ? WHERE id = ?
        `).run(code, message.slice(0, 2000), now, now, job.id)
      }
    } finally {
      this.processing = false
    }
  }

  private async process(job: JobRow): Promise<Record<string, unknown>> {
    if (job.job_type === 'transcribe' || job.job_type === 'align') return this.processAudioJob(job)
    const lyricId = job.lyric_id
    assertApp(lyricId !== null, 400, 'lyrics_required', '该任务需要先添加歌词')
    const lines = this.database.prepare('SELECT id, line_index, start_ms, end_ms, original_text FROM lyric_line WHERE lyric_id = ? ORDER BY line_index').all(lyricId) as Array<{ id: number; line_index: number; start_ms: number | null; end_ms: number | null; original_text: string }>
    assertApp(lines.length > 0, 400, 'lyrics_empty', '歌词中没有可处理的句子')
    if (job.job_type === 'translate') {
      const lyricLanguage = this.database.prepare('SELECT language_code FROM lyric WHERE id = ?').get(lyricId) as { language_code: string } | undefined
      assertApp(lyricLanguage?.language_code !== 'zh', 400, 'translation_not_needed', '中文歌词不需要生成中文翻译')
      const output = await this.llm.chatJson(
        'Translate every Japanese lyric line into natural Simplified Chinese. Preserve lineIndex. Schema: {"lines":[{"lineIndex":0,"translatedText":"..."}]}',
        { lines: lines.map((line) => ({ lineIndex: line.line_index, text: line.original_text })) },
      )
      const translated = this.requireArray(output.lines, 'lines')
      const normalized = translated.map((item) => {
        const value = this.record(item)
        assertApp(Number.isInteger(value.lineIndex) && typeof value.translatedText === 'string' && value.translatedText.trim(), 502, 'llm_schema_error', '翻译结果缺少行号或译文')
        return { lineIndex: Number(value.lineIndex), translatedText: value.translatedText }
      })
      this.assertLineCoverage(lines, normalized)
      const result = { message: '中文翻译已生成', lines: normalized }
      const update = this.database.prepare('UPDATE lyric_line SET translated_text = ?, updated_at = ? WHERE lyric_id = ? AND line_index = ?')
      this.database.exec('BEGIN IMMEDIATE')
      try {
        for (const value of normalized) update.run(value.translatedText, nowIso(), lyricId, value.lineIndex)
        this.completeJob(job.id, result)
        this.database.exec('COMMIT')
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
      return result
    }
    if (job.job_type === 'furigana') {
      assertApp(this.study, 500, 'study_service_unavailable', '日语注音服务不可用')
      const normalized = await this.study.annotateLines(lines.map((line) => ({ lineIndex: line.line_index, text: line.original_text })))
      this.assertLineCoverage(lines, normalized)
      const result = { message: '假名注音与罗马音已在本地生成', lines: normalized }
      const update = this.database.prepare('UPDATE lyric_line SET ruby_json = ?, romaji_text = ?, updated_at = ? WHERE lyric_id = ? AND line_index = ?')
      this.database.exec('BEGIN IMMEDIATE')
      try {
        for (const value of normalized) update.run(JSON.stringify(value.ruby), value.romaji ?? null, nowIso(), lyricId, value.lineIndex)
        this.completeJob(job.id, result)
        this.database.exec('COMMIT')
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
      return result
    }
    if (job.job_type === 'annotate') {
      const output = await this.llm.chatJson(
        'Create concise Chinese Japanese-learning notes only where useful. category must be vocabulary, grammar, culture, or translation. Schema: {"annotations":[{"lineIndex":0,"category":"grammar","body":"..."}]}',
        { lines: lines.map((line) => ({ lineIndex: line.line_index, text: line.original_text })) },
      )
      const annotations = this.requireArray(output.annotations, 'annotations')
      const moderator = this.targetsSharedContent(job)
      const normalized = annotations.map((item) => {
        const value = this.record(item)
        const line = lines.find((candidate) => candidate.line_index === value.lineIndex)
        assertApp(line && ['vocabulary', 'grammar', 'culture', 'translation'].includes(String(value.category)) && typeof value.body === 'string' && value.body.trim(), 502, 'llm_schema_error', '学习批注结果格式无效')
        return { lineId: line.id, lineIndex: Number(value.lineIndex), category: String(value.category), body: value.body.trim() }
      })
      const insert = this.database.prepare(`
        INSERT INTO lyric_annotation(lyric_id, line_id, category, body, visibility, annotation_scope, created_by, review_status)
        VALUES (?, ?, ?, ?, ?, 'learning', ?, ?)
      `)
      const result = { message: '学习批注已生成', annotations: normalized }
      this.database.exec('BEGIN IMMEDIATE')
      try {
        for (const value of normalized) insert.run(lyricId, value.lineId, value.category, value.body, moderator ? 'shared' : 'private', job.requested_by, moderator ? 'approved' : 'pending')
        this.completeJob(job.id, result)
        this.database.exec('COMMIT')
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
      return result
    }
    assertApp(this.study && job.requested_by, 500, 'study_pipeline_unavailable', '日语学习分析器未初始化')
    const requester = this.database.prepare(`
      SELECT id, email, role, display_name, avatar_url, bio, preferred_language, timezone
      FROM app_user WHERE id = ?
    `).get(job.requested_by) as Record<string, unknown> | undefined
    assertApp(requester, 404, 'job_requester_not_found', '任务发起用户不存在')
    const analyzed = await this.study.tokenizeSong({
      id: Number(requester.id), email: String(requester.email), role: requester.role as 'owner' | 'admin' | 'user',
      displayName: String(requester.display_name),
      ...(requester.avatar_url ? { avatarUrl: String(requester.avatar_url) } : {}),
      ...(requester.bio ? { bio: String(requester.bio) } : {}),
      preferredLanguage: String(requester.preferred_language), timezone: String(requester.timezone),
    }, job.song_id)
    const result = { message: 'Kuromoji 分词与 Tomoshi 词典解析已完成', analysis: analyzed.analysis }
    this.completeJob(job.id, result)
    return result
  }

  private async processAudioJob(job: JobRow): Promise<Record<string, unknown>> {
    const song = this.database.prepare('SELECT audio_source_uri, audio_mime_type, language_code FROM song WHERE id = ?').get(job.song_id) as { audio_source_uri: string | null; audio_mime_type: string | null; language_code: string | null } | undefined
    assertApp(song?.audio_source_uri, 400, 'audio_required', '该歌曲没有可供识别的音频')
    const output = await this.llm.transcribe(
      resolveAudioPath(song.audio_source_uri, this.config),
      song.audio_mime_type || 'audio/mpeg',
      song.language_code || undefined,
    )
    const segments = this.transcriptSegments(output)
    const words = this.transcriptWords(output)
    assertApp(segments.length > 0, 502, 'transcription_empty', '语音识别没有返回带时间的分段')
    if (job.job_type === 'transcribe') {
      const moderator = this.targetsSharedContent(job)
      const result = { message: '歌词转写已完成，等待确认', segments }
      this.database.exec('BEGIN IMMEDIATE')
      try {
        if (moderator) this.database.prepare("UPDATE lyric SET is_current = 0 WHERE song_id = ? AND visibility = 'shared'").run(job.song_id)
        else this.database.prepare("UPDATE lyric SET is_current = 0 WHERE song_id = ? AND uploaded_by = ? AND visibility = 'private'").run(job.song_id, job.requested_by)
        const text = segments.map((segment) => segment.text).join('\n')
        const lyricResult = this.database.prepare(`
          INSERT INTO lyric(song_id, language_code, source_type, original_text, review_status, visibility, uploaded_by, version_label)
          VALUES (?, 'ja', 'ai_transcription', ?, ?, ?, ?, 'AI 语音识别')
        `).run(job.song_id, text, moderator ? 'approved' : 'pending', moderator ? 'shared' : 'private', job.requested_by)
        const lyricId = Number(lyricResult.lastInsertRowid)
        const insert = this.database.prepare(`INSERT INTO lyric_line(lyric_id, line_index, start_ms, end_ms, original_text) VALUES (?, ?, ?, ?, ?)`)
        const lineIds: number[] = []
        segments.forEach((segment, index) => {
          const result = insert.run(lyricId, index, Math.round(segment.start * 1000), Math.round(segment.end * 1000), segment.text)
          lineIds.push(Number(result.lastInsertRowid))
        })
        if (words.length > 0) this.storeTranscriptWords(lineIds, segments, words)
        this.database.prepare('UPDATE lyric_processing_job SET lyric_id = ? WHERE id = ?').run(lyricId, job.id)
        this.completeJob(job.id, result)
        this.database.exec('COMMIT')
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
      return result
    }
    const lines = this.database.prepare('SELECT id, line_index, original_text FROM lyric_line WHERE lyric_id = ? ORDER BY line_index').all(job.lyric_id) as Array<{ id: number; line_index: number; original_text: string }>
    assertApp(lines.length > 0, 400, 'lyrics_empty', '歌词中没有可对齐的句子')
    const update = this.database.prepare('UPDATE lyric_line SET start_ms = ?, end_ms = ?, updated_at = ? WHERE id = ?')
    const alignment = alignLyricLines(lines.map((line) => line.original_text), segments)
    const result = {
      message: '歌词时间轴已重新对齐',
      segments,
      alignment: lines.map((line, index) => ({ lineIndex: line.line_index, ...alignment[index]! })),
      averageConfidence: alignment.reduce((sum, line) => sum + line.confidence, 0) / alignment.length,
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      lines.forEach((line, index) => {
        const aligned = alignment[index]!
        update.run(Math.round(aligned.start * 1000), Math.round(aligned.end * 1000), nowIso(), line.id)
      })
      this.refreshTokenTimes(job.lyric_id as number)
      this.completeJob(job.id, result)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return result
  }

  private transcriptSegments(output: Record<string, unknown>): TranscriptSegment[] {
    if (!Array.isArray(output.segments)) return []
    return output.segments.flatMap((item) => {
      const value = this.record(item)
      const start = Number(value.start)
      const end = Number(value.end)
      const text = String(value.text ?? '').trim()
      return Number.isFinite(start) && Number.isFinite(end) && text ? [{ start, end, text }] : []
    })
  }

  private transcriptWords(output: Record<string, unknown>): TranscriptWord[] {
    const topLevelWords = Array.isArray(output.words) ? output.words : []
    const segmentWords = Array.isArray(output.segments)
      ? output.segments.flatMap((segment) => {
          const value = this.record(segment)
          return Array.isArray(value.words) ? value.words : []
        })
      : []
    const words = topLevelWords.length > 0 ? topLevelWords : segmentWords
    return words.flatMap((item) => {
      const value = this.record(item)
      const start = Number(value.start)
      const end = Number(value.end)
      const text = String(value.word ?? value.text ?? '').trim()
      return Number.isFinite(start) && Number.isFinite(end) && end >= start && text ? [{ start, end, text }] : []
    })
  }

  private storeTranscriptWords(lineIds: number[], segments: TranscriptSegment[], words: TranscriptWord[]): void {
    const tokenIndexes = new Map<number, number>()
    for (const word of words) {
      const midpoint = (word.start + word.end) / 2
      const lineIndex = segments.findIndex((segment) => midpoint >= segment.start && midpoint <= segment.end)
      if (lineIndex < 0 || !lineIds[lineIndex] || !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(word.text)) continue
      const lineId = lineIds[lineIndex]!
      let lexeme = this.database.prepare(`SELECT id FROM lexeme WHERE language_code = 'ja' AND lemma = ? AND writing = ? AND coalesce(reading, '') = ''`).get(word.text, word.text) as { id: number } | undefined
      if (!lexeme) lexeme = { id: Number(this.database.prepare(`INSERT INTO lexeme(language_code, lemma, writing, reading, source) VALUES ('ja', ?, ?, '', 'transcription')`).run(word.text, word.text).lastInsertRowid) }
      const tokenIndex = tokenIndexes.get(lineId) ?? 0
      this.database.prepare(`
        INSERT INTO lyric_token(line_id, lexeme_id, token_index, surface, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?)
      `).run(lineId, lexeme.id, tokenIndex, word.text, Math.round(word.start * 1000), Math.round(word.end * 1000))
      tokenIndexes.set(lineId, tokenIndex + 1)
    }
  }

  private refreshTokenTimes(lyricId: number): void {
    const tokens = this.database.prepare(`
      SELECT lt.id, lt.start_offset, lt.end_offset, ll.start_ms, ll.end_ms, length(ll.original_text) AS line_length
      FROM lyric_token lt JOIN lyric_line ll ON ll.id = lt.line_id WHERE ll.lyric_id = ?
    `).all(lyricId) as Array<{ id: number; start_offset: number | null; end_offset: number | null; start_ms: number | null; end_ms: number | null; line_length: number }>
    const update = this.database.prepare('UPDATE lyric_token SET start_ms = ?, end_ms = ? WHERE id = ?')
    for (const token of tokens) {
      if (token.start_ms === null || token.end_ms === null || !token.line_length) continue
      const startOffset = token.start_offset ?? 0
      const endOffset = token.end_offset ?? startOffset
      update.run(
        Math.round(token.start_ms + (token.end_ms - token.start_ms) * startOffset / token.line_length),
        Math.round(token.start_ms + (token.end_ms - token.start_ms) * endOffset / token.line_length),
        token.id,
      )
    }
  }

  private requireArray(value: unknown, name: string): unknown[] {
    assertApp(Array.isArray(value), 502, 'llm_schema_error', `AI 返回结果缺少 ${name} 数组`)
    return value
  }

  private assertLineCoverage(
    sourceLines: Array<{ line_index: number }>,
    resultLines: Array<{ lineIndex: number }>,
  ): void {
    const indexes = resultLines.map((line) => line.lineIndex)
    assertApp(
      indexes.length === sourceLines.length
        && new Set(indexes).size === indexes.length
        && sourceLines.every((line) => indexes.includes(line.line_index)),
      502,
      'llm_schema_error',
      'AI 结果必须完整且不重复地覆盖每一句歌词',
    )
  }

  private completeJob(jobId: number, output: Record<string, unknown>): void {
    const now = nowIso()
    this.database.prepare(`
      UPDATE lyric_processing_job SET status = 'succeeded', output_payload_json = ?,
        error_code = NULL, error_message = NULL, completed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'processing'
    `).run(JSON.stringify(output), now, now, jobId)
  }

  private record(value: unknown): Record<string, unknown> {
    assertApp(value && typeof value === 'object' && !Array.isArray(value), 502, 'llm_schema_error', 'AI 返回结果包含无效对象')
    return value as Record<string, unknown>
  }

  private get(id: number) {
    const row = this.database.prepare('SELECT * FROM lyric_processing_job WHERE id = ?').get(id) as unknown as JobRow
    return this.serialize(row)
  }

  private targetsSharedContent(job: JobRow): boolean {
    try {
      const input = JSON.parse(job.input_payload_json) as { outputScope?: unknown }
      if (input.outputScope === 'shared') return true
      if (input.outputScope === 'private') return false
    } catch { /* Legacy or manually repaired jobs fall back to the requester role. */ }
    if (job.requested_by === null) return false
    const user = this.database.prepare('SELECT role FROM app_user WHERE id = ?').get(job.requested_by) as { role: string } | undefined
    return user?.role === 'owner' || user?.role === 'admin'
  }

  private createPrivateLyricDraft(sourceLyricId: number, userId: number): number {
    const source = this.database.prepare('SELECT * FROM lyric WHERE id = ?').get(sourceLyricId) as {
      song_id: number; language_code: string; source_type: string; original_text: string; version_label: string | null; source_ref: string | null
    }
    this.database.prepare("UPDATE lyric SET is_current = 0 WHERE song_id = ? AND uploaded_by = ? AND visibility = 'private'").run(source.song_id, userId)
    const result = this.database.prepare(`
      INSERT INTO lyric(song_id, language_code, source_type, original_text, review_status, visibility, is_current, version_label, source_ref, uploaded_by)
      VALUES (?, ?, ?, ?, 'pending', 'private', 1, ?, ?, ?)
    `).run(source.song_id, source.language_code, source.source_type, source.original_text, source.version_label ?? '学习处理草稿', source.source_ref ?? null, userId)
    const draftId = Number(result.lastInsertRowid)
    this.database.prepare(`
      INSERT INTO lyric_line(lyric_id, line_index, start_ms, end_ms, original_text, translated_text, ruby_json, romaji_text)
      SELECT ?, line_index, start_ms, end_ms, original_text, translated_text, ruby_json, romaji_text
      FROM lyric_line WHERE lyric_id = ? ORDER BY line_index
    `).run(draftId, sourceLyricId)
    return draftId
  }

  private serialize(row: JobRow) {
    return {
      id: row.id, songId: row.song_id, lyricId: row.lyric_id ?? undefined, jobType: row.job_type,
      status: row.status, inputPayload: JSON.parse(row.input_payload_json),
      outputPayload: row.output_payload_json ? JSON.parse(row.output_payload_json) : undefined,
      errorCode: row.error_code ?? undefined, errorMessage: row.error_message ?? undefined,
      retryCount: row.retry_count,
      requestedBy: row.requested_by ?? undefined, startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }
}
