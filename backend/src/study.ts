import type { AuthUser } from './auth.js'
import type { SqliteDatabase } from './db.js'
import { nowIso } from './db.js'
import { assertApp } from './errors.js'
import type { SongService } from './songs.js'
import { JapaneseStudyAnalyzer, type AnalyzedStudyToken, type JlptLevel } from './japanese-study.js'
import { zonedDateKey, zonedDayRange } from './time.js'
import { toRomaji } from 'wanakana'
import { fsrs, Rating, State, type Card } from 'ts-fsrs'
import { findGrammarLesson, grammarCatalog } from './grammar-catalog.js'

type StudyDirection = 'ja_zh' | 'zh_ja'

interface StudyPreference {
  dailyNewLimit: number
  dailyReviewLimit: number
  defaultDirection: StudyDirection
  autoplayPronunciation: boolean
}

interface CardRow {
  id: number
  user_id: number
  deck_id: number
  lexeme_id: number
  source_song_id: number | null
  source_line_id: number | null
  direction: StudyDirection
  state: 'new' | 'learning' | 'review' | 'suspended'
  due_at: string
  stability: number
  difficulty: number
  repetitions: number
  lapses: number
  fsrs_state: number
  scheduled_days: number
  learning_steps: number
  last_reviewed_at: string | null
  lemma: string
  writing: string
  reading: string | null
  reading_katakana: string | null
  romaji: string | null
  part_of_speech: string | null
  meaning_zh: string | null
  meaning_en: string | null
  example_ja: string | null
  example_zh: string | null
  resolution_status: 'resolved' | 'ambiguous' | 'unresolved'
}

interface GrammarProgressRow {
  user_id: number
  lesson_id: string
  status: 'new' | 'learning' | 'review' | 'mastered'
  due_at: string
  stability: number
  difficulty: number
  repetitions: number
  lapses: number
  fsrs_state: number
  scheduled_days: number
  learning_steps: number
  started_at: string | null
  completed_at: string | null
  last_reviewed_at: string | null
  updated_at: string
}

const lyricCreditPattern = /^\s*(?:作[词詞曲]|[编編]曲|制作(?:人)?|演唱|歌手|原唱|填词|填詞|谱曲|譜曲|lyrics?|lyricist|composer|arranger|producer)\s*[:：]/iu
const jlptTargetLevels: JlptLevel[] = ['N5', 'N4', 'N3', 'N2']
const reviewScheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 3650,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ['10m', '1h'],
  relearning_steps: ['10m'],
})

function isStudyLyricLine(text: string): boolean {
  const value = text.trim()
  if (!value || lyricCreditPattern.test(value)) return false
  if (value.startsWith('[') && value.includes(':') && value.endsWith(']')) return false
  return !((value.startsWith('{') || value.startsWith('"{')) && ['作词', '作詞', '作曲', '编曲', '編曲', '制作人'].some((keyword) => value.includes(keyword)))
}

function hiraganaToKatakana(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return [...value].map((character) => {
    const code = character.charCodeAt(0)
    return code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : character
  }).join('')
}

function katakanaToHiragana(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return [...value].map((character) => {
    const code = character.charCodeAt(0)
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : character
  }).join('')
}

export class StudyService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly songs: SongService,
    private readonly analyzer = new JapaneseStudyAnalyzer(),
  ) {}

  close(): void {
    this.analyzer.close()
  }

  annotateLines(lines: Array<{ lineIndex: number; text: string }>) {
    return this.analyzer.annotateLines(lines)
  }

  async tokenizeSong(user: AuthUser, songId: number) {
    const lyricId = this.currentLyricId(user, songId)
    assertApp(lyricId, 404, 'lyrics_not_found', '请先为歌曲添加歌词')
    const lines = this.database.prepare('SELECT * FROM lyric_line WHERE lyric_id = ? ORDER BY line_index').all(lyricId) as Array<Record<string, unknown>>
    const analysis = await this.analyzer.analyze(lines.filter((line) => isStudyLyricLine(String(line.original_text))).map((line) => ({
      id: Number(line.id),
      lineIndex: Number(line.line_index),
      originalText: String(line.original_text),
      ...(typeof line.translated_text === 'string' && line.translated_text ? { translatedText: line.translated_text } : {}),
      ...(typeof line.start_ms === 'number' ? { startMs: line.start_ms } : {}),
      ...(typeof line.end_ms === 'number' ? { endMs: line.end_ms } : {}),
    })))
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const line of lines) this.database.prepare('DELETE FROM lyric_token WHERE line_id = ?').run(Number(line.id))
      for (const line of analysis.lines) {
        for (const [tokenIndex, token] of line.tokens.entries()) {
          const lexemeId = this.findOrCreateLexeme(token, line.originalText, line.translatedText, analysis.dictionaryVersion)
          const lineLength = line.originalText.length
          const tokenStart = line.startMs !== undefined && line.endMs !== undefined && lineLength > 0
            ? Math.round(line.startMs + (line.endMs - line.startMs) * token.startOffset / lineLength)
            : null
          const tokenEnd = line.startMs !== undefined && line.endMs !== undefined && lineLength > 0
            ? Math.round(line.startMs + (line.endMs - line.startMs) * token.endOffset / lineLength)
            : null
          this.database.prepare(`
            INSERT INTO lyric_token(
              line_id, lexeme_id, token_index, surface, start_offset, end_offset, start_ms, end_ms,
              basic_form, reading_katakana, part_of_speech, conjugated_type, conjugated_form
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(line.id, lexemeId, tokenIndex, token.surface, token.startOffset, token.endOffset, tokenStart, tokenEnd,
            token.lemma, token.surfaceReadingKatakana || null, token.partOfSpeech || null, token.conjugatedType || null, token.conjugatedForm || null)
        }
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return {
      ...this.songWords(user, songId),
      analysis: {
        dictionaryAvailable: analysis.dictionaryAvailable,
        dictionaryVersion: analysis.dictionaryVersion,
        resolved: analysis.resolved,
        llmResolved: analysis.llmResolved,
        unresolved: analysis.unresolved,
        ...(analysis.llmFallbackError ? { llmFallbackError: analysis.llmFallbackError } : {}),
      },
    }
  }

  songWords(user: AuthUser, songId: number) {
    const lyricId = this.currentLyricId(user, songId)
    if (!lyricId) return { songId, words: [] }
    const rows = this.database.prepare(`
      SELECT lt.id AS token_id, lt.surface, lt.start_offset, lt.end_offset, lt.start_ms AS token_start_ms, lt.end_ms AS token_end_ms,
        ll.id AS line_id, ll.line_index, ll.start_ms, ll.original_text, ll.translated_text,
        lx.id AS lexeme_id, lx.lemma,
        coalesce(ulo.writing, lx.writing) AS writing,
        coalesce(ulo.reading, lx.reading) AS reading,
        coalesce(ulo.reading_katakana, lx.reading_katakana) AS reading_katakana,
        coalesce(ulo.romaji, lx.romaji) AS romaji,
        coalesce(ulo.part_of_speech, lx.part_of_speech) AS part_of_speech,
        coalesce(ulo.meaning_zh, lx.meaning_zh) AS meaning_zh,
        coalesce(ulo.meaning_en, lx.meaning_en) AS meaning_en,
        coalesce(ulo.example_ja, lx.example_ja) AS example_ja,
        coalesce(ulo.example_zh, lx.example_zh) AS example_zh,
        lx.dictionary_entry_id,
        CASE WHEN ulo.user_id IS NOT NULL THEN 'resolved' ELSE lx.resolution_status END AS resolution_status
      FROM lyric l JOIN lyric_line ll ON ll.lyric_id = l.id
      JOIN lyric_token lt ON lt.line_id = ll.id JOIN lexeme lx ON lx.id = lt.lexeme_id
      LEFT JOIN user_lexeme_override ulo ON ulo.lexeme_id = lx.id AND ulo.user_id = ?
      WHERE l.id = ? ORDER BY ll.line_index, lt.token_index
    `).all(user.id, lyricId) as Array<Record<string, unknown>>
    const entryIds = [...new Set(rows.map((row) => String(row.dictionary_entry_id ?? '')).filter(Boolean))]
    const jlptLevels = this.analyzer.jlptLevels(entryIds)
    const grouped = new Map<number, Record<string, unknown>>()
    for (const row of rows) {
      if (!isStudyLyricLine(String(row.original_text))) continue
      const lexemeId = Number(row.lexeme_id)
      let item = grouped.get(lexemeId)
      if (!item) {
        item = {
          id: lexemeId, lemma: row.lemma, writing: row.writing, reading: row.reading ?? undefined,
          readingKatakana: row.reading_katakana ?? hiraganaToKatakana(row.reading), romaji: row.romaji ?? undefined,
          partOfSpeech: row.part_of_speech ?? undefined, meaningZh: row.meaning_zh ?? undefined,
          meaningEn: row.meaning_en ?? undefined, exampleJa: row.example_ja ?? row.original_text ?? undefined,
          exampleZh: row.example_zh ?? row.translated_text ?? undefined,
          jlptLevel: row.dictionary_entry_id ? jlptLevels.get(String(row.dictionary_entry_id)) : undefined,
          resolutionStatus: row.resolution_status ?? 'unresolved', occurrences: [],
        }
        grouped.set(lexemeId, item)
      }
      ;(item.occurrences as Array<Record<string, unknown>>).push({
        tokenId: row.token_id, lineId: row.line_id, lineIndex: row.line_index, surface: row.surface,
        startOffset: row.start_offset, endOffset: row.end_offset,
        startMs: row.token_start_ms ?? row.start_ms ?? undefined, endMs: row.token_end_ms ?? undefined,
        lineText: row.original_text, lineTranslatedText: row.translated_text ?? undefined,
      })
    }
    return {
      songId,
      words: [...grouped.values()],
      coverage: this.buildJlptCoverage(entryIds, grouped.size),
    }
  }

  jlptCoverage(user: AuthUser) {
    const isModerator = user.role === 'owner' || user.role === 'admin'
    const visibility = `(
      (? = 1)
      OR (s.review_status = 'approved' AND s.visibility = 'shared' AND l.visibility = 'shared')
      OR (s.submitted_by = ? AND (l.uploaded_by = ? OR l.visibility = 'shared'))
    )`
    const entryRows = this.database.prepare(`
      SELECT DISTINCT lx.dictionary_entry_id AS entry_id
      FROM song s JOIN lyric l ON l.song_id = s.id AND l.is_current = 1
      JOIN lyric_line ll ON ll.lyric_id = l.id JOIN lyric_token lt ON lt.line_id = ll.id
      JOIN lexeme lx ON lx.id = lt.lexeme_id
      WHERE s.language_code = 'ja' AND lx.dictionary_entry_id IS NOT NULL AND ${visibility}
    `).all(isModerator ? 1 : 0, user.id, user.id) as Array<{ entry_id: string }>
    const songCounts = this.database.prepare(`
      SELECT count(DISTINCT s.id) AS total_songs,
        count(DISTINCT CASE WHEN lt.id IS NOT NULL THEN s.id END) AS analyzed_songs
      FROM song s LEFT JOIN lyric l ON l.song_id = s.id AND l.is_current = 1
      LEFT JOIN lyric_line ll ON ll.lyric_id = l.id LEFT JOIN lyric_token lt ON lt.line_id = ll.id
      WHERE s.language_code = 'ja' AND ${visibility}
    `).get(isModerator ? 1 : 0, user.id, user.id) as { total_songs: number; analyzed_songs: number }
    return {
      ...this.buildJlptCoverage(entryRows.map((row) => row.entry_id)),
      songs: { total: Number(songCounts.total_songs), analyzed: Number(songCounts.analyzed_songs) },
    }
  }

  listDecks(user: AuthUser) {
    this.ensureDefaultDeck(user.id)
    const rows = this.database.prepare(`
      SELECT d.*,
        (SELECT count(*) FROM study_card c WHERE c.deck_id = d.id AND c.state <> 'suspended') AS card_count,
        (SELECT count(*) FROM study_card c WHERE c.deck_id = d.id AND c.state <> 'suspended' AND datetime(c.due_at) <= datetime(?)) AS due_count
      FROM study_deck d WHERE d.user_id = ? ORDER BY d.is_default DESC, d.sort_order, d.updated_at DESC
    `).all(nowIso(), user.id) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id, name: row.name, description: row.description ?? undefined, sourceSongId: row.source_song_id ?? undefined,
      isDefault: Boolean(row.is_default), cardCount: row.card_count, dueCount: row.due_count,
      sortOrder: Number(row.sort_order),
      createdAt: row.created_at, updatedAt: row.updated_at,
    }))
  }

  createDeck(user: AuthUser, input: { name: string; description?: string; sourceSongId?: number }) {
    assertApp(input.name.trim(), 400, 'deck_name_required', '请输入词库名称')
    if (input.sourceSongId) this.songs.assertVisible(user, input.sourceSongId)
    const result = this.database.prepare(`
      INSERT INTO study_deck(user_id, name, description, source_song_id) VALUES (?, ?, ?, ?)
    `).run(user.id, input.name.trim(), input.description?.trim() || null, input.sourceSongId ?? null)
    return this.listDecks(user).find((deck) => deck.id === Number(result.lastInsertRowid))
  }

  updateDeck(user: AuthUser, deckId: number, input: { name?: string; description?: string }) {
    const current = this.requireDeck(user, deckId)
    const name = input.name === undefined ? String(current.name) : input.name.trim()
    assertApp(name, 400, 'deck_name_required', '请输入词库名称')
    const description = input.description === undefined ? (current.description ? String(current.description) : null) : input.description.trim() || null
    this.database.prepare('UPDATE study_deck SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(name, description, nowIso(), deckId)
    return this.listDecks(user).find((deck) => deck.id === deckId)
  }

  deleteDeck(user: AuthUser, deckId: number): void {
    const deck = this.requireDeck(user, deckId)
    assertApp(!deck.is_default, 400, 'default_deck_protected', '默认词库不能删除')
    this.database.prepare('DELETE FROM study_deck WHERE id = ?').run(deckId)
  }

  reorderDecks(user: AuthUser, deckIds: number[]): void {
    const rows = this.database.prepare('SELECT id FROM study_deck WHERE user_id = ? ORDER BY id').all(user.id) as Array<{ id: number }>
    assertApp(rows.length === deckIds.length && new Set(deckIds).size === deckIds.length && rows.every((row) => deckIds.includes(row.id)), 400, 'invalid_deck_order', '词库顺序与当前内容不一致')
    const update = this.database.prepare('UPDATE study_deck SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    const now = nowIso()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      deckIds.forEach((id, index) => update.run(index, now, id, user.id))
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  updateLexeme(user: AuthUser, lexemeId: number, input: { writing?: string; reading?: string; readingKatakana?: string; romaji?: string; partOfSpeech?: string; meaningZh?: string; meaningEn?: string; exampleJa?: string; exampleZh?: string }) {
    const canonical = this.database.prepare('SELECT * FROM lexeme WHERE id = ?').get(lexemeId) as Record<string, unknown> | undefined
    assertApp(canonical, 404, 'lexeme_not_found', '词条不存在')
    this.assertLexemeAccessible(user, lexemeId)
    const writing = input.writing === undefined ? String(canonical.writing) : input.writing.trim()
    assertApp(writing, 400, 'lexeme_writing_required', '词条写法不能为空')
    const values = {
      writing,
      reading: input.reading === undefined ? (canonical.reading ? String(canonical.reading) : null) : input.reading.trim() || null,
      readingKatakana: input.readingKatakana === undefined ? (canonical.reading_katakana ? String(canonical.reading_katakana) : null) : input.readingKatakana.trim() || null,
      romaji: input.romaji === undefined ? (canonical.romaji ? String(canonical.romaji) : null) : input.romaji.trim() || null,
      partOfSpeech: input.partOfSpeech === undefined ? (canonical.part_of_speech ? String(canonical.part_of_speech) : null) : input.partOfSpeech.trim() || null,
      meaningZh: input.meaningZh === undefined ? (canonical.meaning_zh ? String(canonical.meaning_zh) : null) : input.meaningZh.trim() || null,
      meaningEn: input.meaningEn === undefined ? (canonical.meaning_en ? String(canonical.meaning_en) : null) : input.meaningEn.trim() || null,
      exampleJa: input.exampleJa === undefined ? (canonical.example_ja ? String(canonical.example_ja) : null) : input.exampleJa.trim() || null,
      exampleZh: input.exampleZh === undefined ? (canonical.example_zh ? String(canonical.example_zh) : null) : input.exampleZh.trim() || null,
    }
    const now = nowIso()
    if (user.role === 'owner' || user.role === 'admin') {
      this.database.prepare(`
        UPDATE lexeme SET writing = ?, reading = ?, reading_katakana = ?, romaji = ?, part_of_speech = ?, meaning_zh = ?, meaning_en = ?, example_ja = ?, example_zh = ?, source = 'manual', updated_at = ? WHERE id = ?
      `).run(values.writing, values.reading, values.readingKatakana, values.romaji, values.partOfSpeech, values.meaningZh, values.meaningEn, values.exampleJa, values.exampleZh, now, lexemeId)
    } else {
      this.database.prepare(`
        INSERT INTO user_lexeme_override(user_id, lexeme_id, writing, reading, reading_katakana, romaji, part_of_speech, meaning_zh, meaning_en, example_ja, example_zh, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, lexeme_id) DO UPDATE SET writing = excluded.writing, reading = excluded.reading,
          reading_katakana = excluded.reading_katakana, romaji = excluded.romaji,
          part_of_speech = excluded.part_of_speech, meaning_zh = excluded.meaning_zh, meaning_en = excluded.meaning_en,
          example_ja = excluded.example_ja, example_zh = excluded.example_zh,
          updated_at = excluded.updated_at
      `).run(user.id, lexemeId, values.writing, values.reading, values.readingKatakana, values.romaji, values.partOfSpeech, values.meaningZh, values.meaningEn, values.exampleJa, values.exampleZh, now)
    }
    return this.effectiveLexeme(user.id, lexemeId)
  }

  preferences(user: AuthUser): StudyPreference {
    this.database.prepare('INSERT OR IGNORE INTO study_preference(user_id) VALUES (?)').run(user.id)
    const row = this.database.prepare('SELECT * FROM study_preference WHERE user_id = ?').get(user.id) as Record<string, unknown>
    return {
      dailyNewLimit: Number(row.daily_new_limit),
      dailyReviewLimit: Number(row.daily_review_limit),
      defaultDirection: row.default_direction as StudyDirection,
      autoplayPronunciation: Boolean(row.autoplay_pronunciation),
    }
  }

  updatePreferences(user: AuthUser, input: Partial<StudyPreference>): StudyPreference {
    const current = this.preferences(user)
    const dailyNewLimit = input.dailyNewLimit ?? current.dailyNewLimit
    const dailyReviewLimit = input.dailyReviewLimit ?? current.dailyReviewLimit
    const defaultDirection = input.defaultDirection ?? current.defaultDirection
    const autoplayPronunciation = input.autoplayPronunciation ?? current.autoplayPronunciation
    assertApp(Number.isInteger(dailyNewLimit) && dailyNewLimit >= 1 && dailyNewLimit <= 200, 400, 'invalid_daily_new_limit', '每日新词数量应为 1 到 200')
    assertApp(Number.isInteger(dailyReviewLimit) && dailyReviewLimit >= 1 && dailyReviewLimit <= 1000, 400, 'invalid_daily_review_limit', '每日复习数量应为 1 到 1000')
    assertApp(defaultDirection === 'ja_zh' || defaultDirection === 'zh_ja', 400, 'invalid_direction', '默认背诵方向无效')
    this.database.prepare(`
      UPDATE study_preference SET daily_new_limit = ?, daily_review_limit = ?, default_direction = ?, autoplay_pronunciation = ?, updated_at = ? WHERE user_id = ?
    `).run(dailyNewLimit, dailyReviewLimit, defaultDirection, autoplayPronunciation ? 1 : 0, nowIso(), user.id)
    return this.preferences(user)
  }

  addCards(user: AuthUser, deckId: number, input: { lexemeIds: number[]; songId?: number; directions: StudyDirection[] }) {
    const deck = this.database.prepare('SELECT id FROM study_deck WHERE id = ? AND user_id = ?').get(deckId, user.id)
    assertApp(deck, 404, 'deck_not_found', '词库不存在')
    const sourceLyricId = input.songId ? this.currentLyricId(user, input.songId) : undefined
    if (input.songId) assertApp(sourceLyricId, 404, 'lyrics_not_found', '请先为歌曲添加歌词')
    const directions = input.directions.filter((value) => value === 'ja_zh' || value === 'zh_ja')
    assertApp(directions.length > 0, 400, 'direction_required', '请选择背诵方向')
    const lexemeIds = [...new Set(input.lexemeIds)]
    assertApp(lexemeIds.length > 0, 400, 'lexeme_required', '请至少选择一个词语')
    for (const lexemeId of lexemeIds) {
      assertApp(Number.isInteger(lexemeId) && lexemeId > 0, 404, 'lexeme_not_found', '词条不存在')
      this.assertLexemeAccessible(user, lexemeId)
      if (sourceLyricId) {
        const occurrence = this.database.prepare(`
          SELECT 1 FROM lyric_token lt JOIN lyric_line ll ON ll.id = lt.line_id
          WHERE lt.lexeme_id = ? AND ll.lyric_id = ? LIMIT 1
        `).get(lexemeId, sourceLyricId)
        assertApp(occurrence, 400, 'lexeme_not_in_song', '所选词语不属于当前歌词')
      }
    }
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO study_card(user_id, deck_id, lexeme_id, source_song_id, source_line_id, direction)
      VALUES (?, ?, ?, ?, (
        SELECT min(lt.line_id) FROM lyric_token lt
        JOIN lyric_line ll ON ll.id = lt.line_id JOIN lyric l ON l.id = ll.lyric_id
        WHERE lt.lexeme_id = ? AND (? IS NULL OR l.id = ?)
          AND (l.visibility = 'shared' OR l.uploaded_by = ?)
      ), ?)
    `)
    let added = 0
    for (const lexemeId of lexemeIds) for (const direction of directions) {
      added += Number(insert.run(
        user.id, deckId, lexemeId, input.songId ?? null, lexemeId,
        sourceLyricId ?? null, sourceLyricId ?? null, user.id, direction,
      ).changes)
    }
    return { added, deckId }
  }

  addCardsToDecks(user: AuthUser, deckIds: number[], input: { lexemeIds: number[]; songId?: number; directions: StudyDirection[] }) {
    const uniqueDeckIds = [...new Set(deckIds)]
    assertApp(uniqueDeckIds.length > 0, 400, 'deck_required', '请至少选择一个词库')
    for (const deckId of uniqueDeckIds) {
      const deck = Number.isInteger(deckId) && deckId > 0
        ? this.database.prepare('SELECT id FROM study_deck WHERE id = ? AND user_id = ?').get(deckId, user.id)
        : undefined
      assertApp(deck, 404, 'deck_not_found', '词库不存在')
    }

    this.database.exec('BEGIN IMMEDIATE')
    try {
      let added = 0
      for (const deckId of uniqueDeckIds) added += this.addCards(user, deckId, input).added
      this.database.exec('COMMIT')
      return { added, deckIds: uniqueDeckIds }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  listCards(user: AuthUser, deckId: number, page: number, pageSize: number) {
    this.requireDeck(user, deckId)
    page = Math.max(1, Math.floor(page) || 1)
    pageSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 50))
    const total = this.database.prepare('SELECT count(*) AS count FROM study_card WHERE user_id = ? AND deck_id = ?').get(user.id, deckId) as { count: number }
    const rows = this.database.prepare(`
      SELECT c.*, lx.lemma,
        coalesce(ulo.writing, lx.writing) AS writing,
        coalesce(ulo.reading, lx.reading) AS reading,
        coalesce(ulo.reading_katakana, lx.reading_katakana) AS reading_katakana,
        coalesce(ulo.romaji, lx.romaji) AS romaji,
        coalesce(ulo.part_of_speech, lx.part_of_speech) AS part_of_speech,
        coalesce(ulo.meaning_zh, lx.meaning_zh) AS meaning_zh,
        coalesce(ulo.meaning_en, lx.meaning_en) AS meaning_en,
        coalesce(ulo.example_ja, lx.example_ja) AS example_ja,
        coalesce(ulo.example_zh, lx.example_zh) AS example_zh,
        CASE WHEN ulo.user_id IS NOT NULL THEN 'resolved' ELSE lx.resolution_status END AS resolution_status
      FROM study_card c JOIN lexeme lx ON lx.id = c.lexeme_id
      LEFT JOIN user_lexeme_override ulo ON ulo.lexeme_id = lx.id AND ulo.user_id = ?
      WHERE c.user_id = ? AND c.deck_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?
    `).all(user.id, user.id, deckId, pageSize, (page - 1) * pageSize) as unknown as CardRow[]
    return { data: rows.map((row) => this.serializeCard(user, row)), pagination: { page, pageSize, total: total.count } }
  }

  updateCard(user: AuthUser, cardId: number, input: { state?: string; deckId?: number }) {
    const card = this.database.prepare('SELECT * FROM study_card WHERE id = ? AND user_id = ?').get(cardId, user.id) as Record<string, unknown> | undefined
    assertApp(card, 404, 'card_not_found', '学习卡片不存在')
    const state = input.state === undefined ? String(card.state) : input.state
    assertApp(['new', 'learning', 'review', 'suspended'].includes(state), 400, 'invalid_card_state', '学习卡片状态无效')
    const targetDeckId = input.deckId ?? Number(card.deck_id)
    this.requireDeck(user, targetDeckId)
    const duplicate = this.database.prepare(`
      SELECT id FROM study_card WHERE user_id = ? AND deck_id = ? AND lexeme_id = ? AND direction = ? AND id <> ?
    `).get(user.id, targetDeckId, card.lexeme_id as number, card.direction as string, cardId)
    assertApp(!duplicate, 409, 'card_already_in_deck', '目标词库中已经有这张卡片')
    this.database.prepare('UPDATE study_card SET deck_id = ?, state = ?, updated_at = ? WHERE id = ?').run(targetDeckId, state, nowIso(), cardId)
    const updated = this.database.prepare(`
      SELECT c.*, lx.lemma,
        coalesce(ulo.writing, lx.writing) AS writing,
        coalesce(ulo.reading, lx.reading) AS reading,
        coalesce(ulo.reading_katakana, lx.reading_katakana) AS reading_katakana,
        coalesce(ulo.romaji, lx.romaji) AS romaji,
        coalesce(ulo.part_of_speech, lx.part_of_speech) AS part_of_speech,
        coalesce(ulo.meaning_zh, lx.meaning_zh) AS meaning_zh,
        coalesce(ulo.meaning_en, lx.meaning_en) AS meaning_en,
        coalesce(ulo.example_ja, lx.example_ja) AS example_ja,
        coalesce(ulo.example_zh, lx.example_zh) AS example_zh,
        CASE WHEN ulo.user_id IS NOT NULL THEN 'resolved' ELSE lx.resolution_status END AS resolution_status
      FROM study_card c JOIN lexeme lx ON lx.id = c.lexeme_id
      LEFT JOIN user_lexeme_override ulo ON ulo.lexeme_id = lx.id AND ulo.user_id = ?
      WHERE c.id = ? AND c.user_id = ?
    `).get(user.id, cardId, user.id) as unknown as CardRow
    return this.serializeCard(user, updated)
  }

  deleteCard(user: AuthUser, cardId: number): void {
    const result = this.database.prepare('DELETE FROM study_card WHERE id = ? AND user_id = ?').run(cardId, user.id)
    assertApp(result.changes > 0, 404, 'card_not_found', '学习卡片不存在')
  }

  reviewHistory(user: AuthUser, days: number) {
    days = Math.min(365, Math.max(7, Math.floor(days) || 30))
    const timeZone = user.timezone || 'UTC'
    const reference = new Date()
    const firstDay = zonedDayRange(timeZone, reference, -(days - 1))
    const lastDay = zonedDayRange(timeZone, reference)
    const rows = this.database.prepare(`
      SELECT grade, reviewed_at, was_new FROM review_log
      WHERE user_id = ? AND datetime(reviewed_at) >= datetime(?) AND datetime(reviewed_at) < datetime(?) ORDER BY datetime(reviewed_at)
    `).all(user.id, firstDay.start.toISOString(), lastDay.end.toISOString()) as Array<{ grade: number; reviewed_at: string; was_new: number }>
    const dailyGroups = new Map<string, { reviews: number; newCards: number; gradeTotal: number }>()
    const gradeGroups = new Map<number, number>()
    for (const row of rows) {
      const day = zonedDateKey(new Date(row.reviewed_at), timeZone)
      const group = dailyGroups.get(day) ?? { reviews: 0, newCards: 0, gradeTotal: 0 }
      group.reviews += 1
      group.newCards += row.was_new ? 1 : 0
      group.gradeTotal += row.grade
      dailyGroups.set(day, group)
      gradeGroups.set(row.grade, (gradeGroups.get(row.grade) ?? 0) + 1)
    }
    return {
      days,
      daily: [...dailyGroups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, group]) => ({
        day,
        reviews: group.reviews,
        newCards: group.newCards,
        averageGrade: Math.round(group.gradeTotal / group.reviews * 100) / 100,
      })),
      grades: [...gradeGroups.entries()].sort(([left], [right]) => left - right).map(([grade, count]) => ({ grade, count })),
    }
  }

  today(user: AuthUser, direction?: StudyDirection) {
    const preference = this.preferences(user)
    const filters = ["c.user_id = ?", "c.state <> 'suspended'"]
    const params: Array<string | number> = [user.id]
    if (direction) { filters.push('c.direction = ?'); params.push(direction) }
    const counts = this.database.prepare(`
      SELECT count(*) AS total,
        sum(CASE WHEN datetime(c.due_at) <= datetime(?) THEN 1 ELSE 0 END) AS due,
        sum(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) AS new_count,
        sum(CASE WHEN c.repetitions >= 3 THEN 1 ELSE 0 END) AS mastered
      FROM study_card c WHERE ${filters.join(' AND ')}
    `).get(nowIso(), ...params) as { total: number; due: number | null; new_count: number | null; mastered: number | null }
    const reviewedToday = this.todayUsage(user)
    return {
      total: counts.total, due: counts.due ?? 0, new: counts.new_count ?? 0, reviewedToday: reviewedToday.count,
      mastered: counts.mastered ?? 0, masteryPercent: counts.total ? Math.round((counts.mastered ?? 0) / counts.total * 100) : 0,
      streakDays: this.streakDays(user.id, user.timezone || 'UTC'),
      dailyNewLimit: preference.dailyNewLimit, dailyReviewLimit: preference.dailyReviewLimit,
    }
  }

  nextCard(user: AuthUser, direction?: StudyDirection) {
    const preference = this.preferences(user)
    const selectedDirection = direction ?? preference.defaultDirection
    const reviewedToday = this.todayUsage(user)
    if (reviewedToday.count >= preference.dailyReviewLimit) return null
    const row = this.database.prepare(`
      SELECT c.*, lx.lemma,
        coalesce(ulo.writing, lx.writing) AS writing,
        coalesce(ulo.reading, lx.reading) AS reading,
        coalesce(ulo.reading_katakana, lx.reading_katakana) AS reading_katakana,
        coalesce(ulo.romaji, lx.romaji) AS romaji,
        coalesce(ulo.part_of_speech, lx.part_of_speech) AS part_of_speech,
        coalesce(ulo.meaning_zh, lx.meaning_zh) AS meaning_zh,
        coalesce(ulo.meaning_en, lx.meaning_en) AS meaning_en,
        coalesce(ulo.example_ja, lx.example_ja) AS example_ja,
        coalesce(ulo.example_zh, lx.example_zh) AS example_zh,
        CASE WHEN ulo.user_id IS NOT NULL THEN 'resolved' ELSE lx.resolution_status END AS resolution_status
      FROM study_card c JOIN lexeme lx ON lx.id = c.lexeme_id
      LEFT JOIN user_lexeme_override ulo ON ulo.lexeme_id = lx.id AND ulo.user_id = ?
      WHERE c.user_id = ? AND c.state <> 'suspended' AND datetime(c.due_at) <= datetime(?)
        AND c.direction = ? AND (c.state <> 'new' OR ? < ?)
      ORDER BY CASE c.state WHEN 'learning' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, datetime(c.due_at) LIMIT 1
    `).get(user.id, user.id, nowIso(), selectedDirection, reviewedToday.new_count, preference.dailyNewLimit) as unknown as CardRow | undefined
    return row ? this.serializeCard(user, row) : null
  }

  review(user: AuthUser, cardId: number, grade: number) {
    assertApp(Number.isInteger(grade) && grade >= 1 && grade <= 3, 400, 'invalid_grade', '评分必须是忘记、模糊或认识')
    const row = this.database.prepare(`
      SELECT c.*, lx.lemma,
        coalesce(ulo.writing, lx.writing) AS writing,
        coalesce(ulo.reading, lx.reading) AS reading,
        coalesce(ulo.reading_katakana, lx.reading_katakana) AS reading_katakana,
        coalesce(ulo.romaji, lx.romaji) AS romaji,
        coalesce(ulo.part_of_speech, lx.part_of_speech) AS part_of_speech,
        coalesce(ulo.meaning_zh, lx.meaning_zh) AS meaning_zh,
        coalesce(ulo.meaning_en, lx.meaning_en) AS meaning_en,
        coalesce(ulo.example_ja, lx.example_ja) AS example_ja,
        coalesce(ulo.example_zh, lx.example_zh) AS example_zh,
        CASE WHEN ulo.user_id IS NOT NULL THEN 'resolved' ELSE lx.resolution_status END AS resolution_status
      FROM study_card c JOIN lexeme lx ON lx.id = c.lexeme_id
      LEFT JOIN user_lexeme_override ulo ON ulo.lexeme_id = lx.id AND ulo.user_id = ?
      WHERE c.id = ? AND c.user_id = ?
    `).get(user.id, cardId, user.id) as unknown as CardRow | undefined
    assertApp(row, 404, 'card_not_found', '学习卡片不存在')
    assertApp(row.state !== 'suspended', 409, 'card_suspended', '暂停的学习卡不能复习')
    assertApp(Date.parse(row.due_at) <= Date.now(), 409, 'card_not_due', '该学习卡尚未到复习时间')
    const preference = this.preferences(user)
    const reviewedToday = this.todayUsage(user)
    assertApp(reviewedToday.count < preference.dailyReviewLimit, 429, 'daily_review_limit', '今天的复习数量已达到上限')
    assertApp(row.state !== 'new' || reviewedToday.new_count < preference.dailyNewLimit, 429, 'daily_new_limit', '今天的新词数量已达到上限')
    const before = row.due_at
    const scheduled = this.schedule(row, grade)
    const now = nowIso()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE study_card SET state = ?, due_at = ?, stability = ?, difficulty = ?, repetitions = ?, lapses = ?,
          fsrs_state = ?, scheduled_days = ?, learning_steps = ?, last_reviewed_at = ?, updated_at = ? WHERE id = ?
      `).run(scheduled.state, scheduled.dueAt, scheduled.stability, scheduled.difficulty, scheduled.repetitions,
        scheduled.lapses, scheduled.fsrsState, scheduled.scheduledDays, scheduled.learningSteps, now, now, row.id)
      const elapsedDays = row.last_reviewed_at ? Math.max(0, (Date.now() - Date.parse(row.last_reviewed_at)) / 86_400_000) : 0
      this.database.prepare(`
        INSERT INTO review_log(card_id, user_id, grade, reviewed_at, elapsed_days, scheduled_days, due_before, due_after, was_new)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(row.id, user.id, grade, now, elapsedDays, scheduled.scheduledDays, before, scheduled.dueAt, row.state === 'new' ? 1 : 0)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { nextDueAt: scheduled.dueAt, today: this.today(user, row.direction) }
  }

  grammarPath(user: AuthUser) {
    const rows = this.database.prepare('SELECT * FROM grammar_lesson_progress WHERE user_id = ?').all(user.id) as unknown as GrammarProgressRow[]
    const catalogIds = new Set(grammarCatalog.map((lesson) => lesson.id))
    const activeRows = rows.filter((row) => catalogIds.has(row.lesson_id))
    const progress = new Map(activeRows.map((row) => [row.lesson_id, row]))
    const now = Date.now()
    const lessons = grammarCatalog.map((lesson) => {
      const row = progress.get(lesson.id)
      const prerequisite = lesson.prerequisiteId ? progress.get(lesson.prerequisiteId) : undefined
      return {
        ...lesson,
        locked: Boolean(lesson.prerequisiteId && !prerequisite?.completed_at),
        status: row?.status ?? 'new',
        dueAt: row?.due_at,
        completedAt: row?.completed_at ?? undefined,
        repetitions: row?.repetitions ?? 0,
      }
    })
    return {
      lessons,
      summary: {
        total: lessons.length,
        completed: lessons.filter((lesson) => Boolean(lesson.completedAt)).length,
        due: activeRows.filter((row) => Boolean(row.completed_at) && Date.parse(row.due_at) <= now).length,
      },
    }
  }

  completeGrammarLesson(user: AuthUser, lessonId: string) {
    const lesson = findGrammarLesson(lessonId)
    assertApp(lesson, 404, 'grammar_lesson_not_found', '语法课程不存在')
    if (lesson.prerequisiteId) {
      const prerequisite = this.database.prepare(`
        SELECT completed_at FROM grammar_lesson_progress WHERE user_id = ? AND lesson_id = ?
      `).get(user.id, lesson.prerequisiteId) as { completed_at: string | null } | undefined
      assertApp(prerequisite?.completed_at, 409, 'grammar_prerequisite_incomplete', '请先完成上一课')
    }
    const now = nowIso()
    this.database.prepare(`
      INSERT INTO grammar_lesson_progress(user_id, lesson_id, status, due_at, started_at, completed_at, updated_at)
      VALUES (?, ?, 'learning', ?, ?, ?, ?)
      ON CONFLICT(user_id, lesson_id) DO UPDATE SET
        completed_at = coalesce(grammar_lesson_progress.completed_at, excluded.completed_at),
        started_at = coalesce(grammar_lesson_progress.started_at, excluded.started_at),
        due_at = CASE WHEN grammar_lesson_progress.repetitions = 0 THEN excluded.due_at ELSE grammar_lesson_progress.due_at END,
        updated_at = excluded.updated_at
    `).run(user.id, lesson.id, now, now, now, now)
    return this.grammarPath(user).lessons.find((item) => item.id === lesson.id)
  }

  nextGrammarReview(user: AuthUser) {
    const rows = this.database.prepare(`
      SELECT * FROM grammar_lesson_progress
      WHERE user_id = ? AND completed_at IS NOT NULL AND datetime(due_at) <= datetime(?)
      ORDER BY CASE status WHEN 'learning' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, datetime(due_at), lesson_id
    `).all(user.id, nowIso()) as unknown as GrammarProgressRow[]
    const row = rows.find((item) => Boolean(findGrammarLesson(item.lesson_id)))
    if (!row) return null
    const lesson = findGrammarLesson(row.lesson_id)
    if (!lesson) return null
    return {
      lessonId: lesson.id,
      state: row.status,
      dueAt: row.due_at,
      front: lesson.reviewPrompt,
      answer: {
        title: lesson.title,
        pattern: lesson.pattern,
        summary: lesson.summary,
        explanation: lesson.explanation,
        reviewAnswer: lesson.reviewAnswer,
        examples: lesson.examples,
      },
      repetitions: row.repetitions,
      lapses: row.lapses,
    }
  }

  reviewGrammar(user: AuthUser, lessonId: string, grade: number) {
    assertApp(Number.isInteger(grade) && grade >= 1 && grade <= 3, 400, 'invalid_grade', '评分必须是忘记、模糊或认识')
    const lesson = findGrammarLesson(lessonId)
    assertApp(lesson, 404, 'grammar_lesson_not_found', '语法课程不存在')
    const row = this.database.prepare(`
      SELECT * FROM grammar_lesson_progress WHERE user_id = ? AND lesson_id = ?
    `).get(user.id, lessonId) as unknown as GrammarProgressRow | undefined
    assertApp(row?.completed_at, 404, 'grammar_progress_not_found', '请先完成本课')
    assertApp(Date.parse(row.due_at) <= Date.now(), 409, 'grammar_not_due', '本课尚未到复习时间')
    const scheduled = this.scheduleGrammar(row, grade)
    const now = nowIso()
    const status = scheduled.state === 'review' && scheduled.repetitions >= 3 ? 'mastered' : scheduled.state
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE grammar_lesson_progress SET status = ?, due_at = ?, stability = ?, difficulty = ?, repetitions = ?,
          lapses = ?, fsrs_state = ?, scheduled_days = ?, learning_steps = ?, last_reviewed_at = ?, updated_at = ?
        WHERE user_id = ? AND lesson_id = ?
      `).run(status, scheduled.dueAt, scheduled.stability, scheduled.difficulty, scheduled.repetitions,
        scheduled.lapses, scheduled.fsrsState, scheduled.scheduledDays, scheduled.learningSteps, now, now, user.id, lessonId)
      this.database.prepare(`
        INSERT INTO grammar_review_log(user_id, lesson_id, grade, reviewed_at, due_before, due_after, scheduled_days)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(user.id, lessonId, grade, now, row.due_at, scheduled.dueAt, scheduled.scheduledDays)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { nextDueAt: scheduled.dueAt, path: this.grammarPath(user).summary }
  }

  private findOrCreateLexeme(token: AnalyzedStudyToken, exampleJa: string, exampleZh: string | undefined, dictionaryVersion: string | undefined): number {
    const existing = this.database.prepare(`
      SELECT id, source FROM lexeme
      WHERE language_code = 'ja' AND lemma = ? AND writing = ? AND (coalesce(reading, '') = ? OR coalesce(reading, '') = '')
      ORDER BY CASE WHEN coalesce(reading, '') = ? THEN 0 ELSE 1 END LIMIT 1
    `).get(token.lemma, token.writing, token.reading, token.reading) as { id: number; source: string } | undefined
    if (!existing) {
      return Number(this.database.prepare(`
        INSERT INTO lexeme(
          language_code, lemma, writing, reading, reading_katakana, romaji, part_of_speech,
          meaning_zh, example_ja, example_zh, source, dictionary_source, dictionary_entry_id,
          selected_sense_index, dictionary_version, resolution_status
        ) VALUES ('ja', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(token.lemma, token.writing, token.reading || null, token.readingKatakana || null, token.romaji || null,
        token.partOfSpeech || null, token.meaningZh || null, exampleJa, exampleZh ?? null, token.source,
        token.dictionarySource ?? null, token.dictionaryEntryId ?? null, token.selectedSenseIndex ?? null,
        dictionaryVersion ?? null, token.resolutionStatus).lastInsertRowid)
    }
    if (existing.source !== 'manual') {
      this.database.prepare(`
        UPDATE lexeme SET reading = ?, reading_katakana = ?, romaji = ?, part_of_speech = ?, meaning_zh = ?,
          example_ja = ?, example_zh = ?, source = ?, dictionary_source = ?, dictionary_entry_id = ?,
          selected_sense_index = ?, dictionary_version = ?, resolution_status = ?, updated_at = ?
        WHERE id = ?
      `).run(token.reading || null, token.readingKatakana || null, token.romaji || null, token.partOfSpeech || null,
        token.meaningZh || null, exampleJa, exampleZh ?? null, token.source, token.dictionarySource ?? null,
        token.dictionaryEntryId ?? null, token.selectedSenseIndex ?? null, dictionaryVersion ?? null,
        token.resolutionStatus, nowIso(), existing.id)
    }
    return existing.id
  }

  private buildJlptCoverage(entryIds: string[], wordCount?: number) {
    const uniqueEntryIds = [...new Set(entryIds.filter(Boolean))]
    const mapped = this.analyzer.jlptLevels(uniqueEntryIds)
    const reference = this.analyzer.jlptReference()
    const levels = jlptTargetLevels.map((level) => {
      const total = reference.totals[level] ?? 0
      const covered = [...mapped.values()].filter((value) => value === level).length
      return {
        level,
        covered,
        total,
        remaining: Math.max(0, total - covered),
        percent: total > 0 ? Math.round(covered / total * 1000) / 10 : 0,
      }
    })
    const targetTotal = levels.reduce((sum, level) => sum + level.total, 0)
    const targetCovered = levels.reduce((sum, level) => sum + level.covered, 0)
    return {
      available: reference.available,
      levels,
      target: {
        level: 'N2' as const,
        covered: targetCovered,
        total: targetTotal,
        remaining: Math.max(0, targetTotal - targetCovered),
        percent: targetTotal > 0 ? Math.round(targetCovered / targetTotal * 1000) / 10 : 0,
      },
      classified: targetCovered,
      ...(wordCount === undefined ? {} : { wordCount, unclassified: Math.max(0, wordCount - targetCovered) }),
      reference: {
        source: reference.source,
        license: reference.license,
        attribution: reference.attribution,
        official: false,
      },
    }
  }

  private currentLyricId(user: AuthUser, songId: number): number | undefined {
    const lyric = this.songs.currentLyrics(user, songId)
    if (!('id' in lyric)) return undefined
    const lyricId = Number(lyric.id)
    return Number.isInteger(lyricId) && lyricId > 0 ? lyricId : undefined
  }

  private ensureDefaultDeck(userId: number): number {
    const row = this.database.prepare('SELECT id FROM study_deck WHERE user_id = ? AND is_default = 1').get(userId) as { id: number } | undefined
    if (row) return row.id
    return Number(this.database.prepare(`INSERT INTO study_deck(user_id, name, description, is_default) VALUES (?, '歌曲生词', '从歌词中选取的学习词汇', 1)`).run(userId).lastInsertRowid)
  }

  private serializeCard(user: AuthUser, row: CardRow) {
    const source = row.source_line_id ? this.database.prepare(`
      SELECT ll.line_index, coalesce(lt.start_ms, ll.start_ms) AS start_ms, ll.original_text, ll.translated_text
      FROM lyric_line ll JOIN lyric l ON l.id = ll.lyric_id
      LEFT JOIN lyric_token lt ON lt.line_id = ll.id AND lt.lexeme_id = ?
      WHERE ll.id = ? AND (l.visibility = 'shared' OR l.uploaded_by = ?)
      ORDER BY lt.token_index LIMIT 1
    `).get(row.lexeme_id, row.source_line_id, user.id) as Record<string, unknown> | undefined : undefined
    let sourceVisible = true
    if (row.source_song_id) {
      try { this.songs.assertVisible(user, row.source_song_id) } catch { sourceVisible = false }
    }
    const sourceTokens = source && sourceVisible ? this.database.prepare(`
      SELECT lt.id AS token_id, lt.surface, lt.start_offset, lt.end_offset, lt.reading_katakana AS surface_reading_katakana,
        coalesce(ulo.reading, lx.reading) AS reading,
        coalesce(ulo.romaji, lx.romaji) AS romaji,
        coalesce(ulo.part_of_speech, lx.part_of_speech) AS part_of_speech,
        coalesce(ulo.meaning_zh, lx.meaning_zh) AS meaning_zh
      FROM lyric_token lt JOIN lexeme lx ON lx.id = lt.lexeme_id
      LEFT JOIN user_lexeme_override ulo ON ulo.lexeme_id = lx.id AND ulo.user_id = ?
      WHERE lt.line_id = ? ORDER BY lt.token_index
    `).all(user.id, row.source_line_id) as Array<Record<string, unknown>> : []
    const front = row.direction === 'ja_zh' ? row.writing : row.meaning_zh || '待补充中文释义'
    return {
      id: row.id, deckId: row.deck_id, direction: row.direction, state: row.state, dueAt: row.due_at,
      front,
      answer: {
        writing: row.writing, lemma: row.lemma, reading: row.reading || undefined,
        readingKatakana: row.reading_katakana || hiraganaToKatakana(row.reading), romaji: row.romaji || undefined,
        meaningZh: row.meaning_zh || undefined, meaningEn: row.meaning_en || undefined,
        partOfSpeech: row.part_of_speech || undefined, resolutionStatus: row.resolution_status,
        exampleJa: row.example_ja || source?.original_text || undefined,
        exampleZh: row.example_zh || source?.translated_text || undefined,
      },
      source: source && sourceVisible ? {
        songId: row.source_song_id ?? undefined, lineId: row.source_line_id,
        lineIndex: source.line_index, startMs: source.start_ms ?? undefined, text: source.original_text,
        translatedText: source.translated_text ?? undefined,
        tokens: sourceTokens.map((token) => {
          const surfaceReading = katakanaToHiragana(token.surface_reading_katakana)
          return {
            tokenId: Number(token.token_id), surface: String(token.surface),
            startOffset: Number(token.start_offset), endOffset: Number(token.end_offset),
            reading: surfaceReading ?? token.reading ?? undefined,
            romaji: surfaceReading ? toRomaji(surfaceReading) : token.romaji ?? undefined,
            partOfSpeech: token.part_of_speech ?? undefined, meaningZh: token.meaning_zh ?? undefined,
          }
        }),
      } : undefined,
      repetitions: row.repetitions, lapses: row.lapses,
    }
  }

  private schedule(row: CardRow, grade: number) {
    const now = new Date()
    const schedulerState = Number.isInteger(row.fsrs_state)
      ? row.fsrs_state as State
      : row.state === 'new' ? State.New : row.state === 'review' ? State.Review : State.Learning
    const card: Card = {
      due: new Date(row.due_at),
      stability: schedulerState === State.New ? 0 : row.stability,
      difficulty: schedulerState === State.New ? 0 : row.difficulty,
      elapsed_days: row.last_reviewed_at ? Math.max(0, (now.getTime() - Date.parse(row.last_reviewed_at)) / 86_400_000) : 0,
      scheduled_days: row.scheduled_days || 0,
      learning_steps: row.learning_steps || 0,
      reps: row.repetitions,
      lapses: row.lapses,
      state: schedulerState,
      ...(row.last_reviewed_at ? { last_review: new Date(row.last_reviewed_at) } : {}),
    }
    const result = reviewScheduler.next(card, now, grade as Rating.Again | Rating.Hard | Rating.Good)
    const state: CardRow['state'] = result.card.state === State.Review ? 'review' : 'learning'
    return {
      stability: result.card.stability,
      difficulty: result.card.difficulty,
      lapses: result.card.lapses,
      repetitions: result.card.reps,
      fsrsState: result.card.state,
      scheduledDays: result.card.scheduled_days,
      learningSteps: result.card.learning_steps,
      state,
      dueAt: result.card.due.toISOString(),
    }
  }

  private scheduleGrammar(row: GrammarProgressRow, grade: number) {
    const now = new Date()
    const schedulerState = Number.isInteger(row.fsrs_state) ? row.fsrs_state as State : State.New
    const card: Card = {
      due: new Date(row.due_at),
      stability: schedulerState === State.New ? 0 : row.stability,
      difficulty: schedulerState === State.New ? 0 : row.difficulty,
      elapsed_days: row.last_reviewed_at ? Math.max(0, (now.getTime() - Date.parse(row.last_reviewed_at)) / 86_400_000) : 0,
      scheduled_days: row.scheduled_days || 0,
      learning_steps: row.learning_steps || 0,
      reps: row.repetitions,
      lapses: row.lapses,
      state: schedulerState,
      ...(row.last_reviewed_at ? { last_review: new Date(row.last_reviewed_at) } : {}),
    }
    const result = reviewScheduler.next(card, now, grade as Rating.Again | Rating.Hard | Rating.Good)
    return {
      stability: result.card.stability,
      difficulty: result.card.difficulty,
      lapses: result.card.lapses,
      repetitions: result.card.reps,
      fsrsState: result.card.state,
      scheduledDays: result.card.scheduled_days,
      learningSteps: result.card.learning_steps,
      state: result.card.state === State.Review ? 'review' as const : 'learning' as const,
      dueAt: result.card.due.toISOString(),
    }
  }

  private todayUsage(user: AuthUser): { count: number; new_count: number } {
    const day = zonedDayRange(user.timezone || 'UTC')
    return this.database.prepare(`
      SELECT count(*) AS count, coalesce(sum(was_new), 0) AS new_count FROM review_log
      WHERE user_id = ? AND datetime(reviewed_at) >= datetime(?) AND datetime(reviewed_at) < datetime(?)
    `).get(user.id, day.start.toISOString(), day.end.toISOString()) as { count: number; new_count: number }
  }

  private streakDays(userId: number, timeZone: string): number {
    const rows = this.database.prepare(`
      SELECT reviewed_at FROM review_log WHERE user_id = ? ORDER BY reviewed_at DESC
    `).all(userId) as Array<{ reviewed_at: string }>
    const reviewedDays = new Set(rows.map((row) => zonedDateKey(new Date(row.reviewed_at), timeZone)))
    if (reviewedDays.size === 0) return 0
    const reference = new Date()
    let offset = reviewedDays.has(zonedDayRange(timeZone, reference).key) ? 0 : -1
    if (!reviewedDays.has(zonedDayRange(timeZone, reference, offset).key)) return 0
    let streak = 0
    while (reviewedDays.has(zonedDayRange(timeZone, reference, offset).key)) {
      streak += 1
      offset -= 1
    }
    return streak
  }

  private requireDeck(user: AuthUser, deckId: number) {
    const deck = this.database.prepare('SELECT * FROM study_deck WHERE id = ? AND user_id = ?').get(deckId, user.id) as Record<string, unknown> | undefined
    assertApp(deck, 404, 'deck_not_found', '词库不存在')
    return deck
  }

  private effectiveLexeme(userId: number, lexemeId: number) {
    const row = this.database.prepare(`
      SELECT lx.id, lx.lemma,
        coalesce(ulo.writing, lx.writing) AS writing,
        coalesce(ulo.reading, lx.reading) AS reading,
        coalesce(ulo.reading_katakana, lx.reading_katakana) AS reading_katakana,
        coalesce(ulo.romaji, lx.romaji) AS romaji,
        coalesce(ulo.part_of_speech, lx.part_of_speech) AS part_of_speech,
        coalesce(ulo.meaning_zh, lx.meaning_zh) AS meaning_zh,
        coalesce(ulo.meaning_en, lx.meaning_en) AS meaning_en,
        coalesce(ulo.example_ja, lx.example_ja) AS example_ja,
        coalesce(ulo.example_zh, lx.example_zh) AS example_zh
      FROM lexeme lx LEFT JOIN user_lexeme_override ulo ON ulo.lexeme_id = lx.id AND ulo.user_id = ?
      WHERE lx.id = ?
    `).get(userId, lexemeId) as Record<string, unknown>
    return {
      id: Number(row.id), lemma: row.lemma, writing: row.writing, reading: row.reading ?? undefined,
      readingKatakana: row.reading_katakana ?? hiraganaToKatakana(row.reading), romaji: row.romaji ?? undefined,
      partOfSpeech: row.part_of_speech ?? undefined, meaningZh: row.meaning_zh ?? undefined,
      meaningEn: row.meaning_en ?? undefined, exampleJa: row.example_ja ?? undefined, exampleZh: row.example_zh ?? undefined,
    }
  }

  private assertLexemeAccessible(user: AuthUser, lexemeId: number): void {
    const ownedCard = this.database.prepare('SELECT 1 FROM study_card WHERE user_id = ? AND lexeme_id = ? LIMIT 1').get(user.id, lexemeId)
    if (ownedCard) return
    const isModerator = user.role === 'owner' || user.role === 'admin'
    const songRows = this.database.prepare(`
      SELECT DISTINCT l.song_id FROM lyric_token lt JOIN lyric_line ll ON ll.id = lt.line_id
      JOIN lyric l ON l.id = ll.lyric_id
      JOIN song s ON s.id = l.song_id
      WHERE lt.lexeme_id = ? AND l.is_current = 1
        AND (
          l.visibility = 'shared'
          OR l.uploaded_by = ?
          OR (? = 1 AND l.review_requested_at IS NOT NULL)
          OR (? = 1 AND s.visibility = 'private' AND s.review_status <> 'approved')
        )
    `).all(lexemeId, user.id, isModerator ? 1 : 0, isModerator ? 1 : 0) as Array<{ song_id: number }>
    for (const row of songRows) {
      try { this.songs.assertVisible(user, row.song_id); return } catch { /* Keep looking for an accessible occurrence. */ }
    }
    assertApp(false, 404, 'lexeme_not_found', '词条不存在')
  }
}
