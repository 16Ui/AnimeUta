import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthUser } from './auth.js'
import { openDatabase, runMigrations, type SqliteDatabase } from './db.js'
import type { SongService } from './songs.js'
import { StudyService } from './study.js'

const directories: string[] = []

function songService(database: SqliteDatabase): SongService {
  return {
    assertVisible: () => undefined,
    currentLyrics: (user: AuthUser, songId: number) => {
      const isModerator = user.role === 'owner' || user.role === 'admin'
      const row = database.prepare(`
        SELECT id FROM lyric
        WHERE song_id = ? AND is_current = 1
          AND (visibility = 'shared' OR uploaded_by = ? OR ? = 1)
        ORDER BY CASE WHEN uploaded_by = ? AND visibility = 'private' THEN 0 ELSE 1 END, created_at DESC LIMIT 1
      `).get(songId, user.id, isModerator ? 1 : 0, user.id) as { id: number } | undefined
      return row ? { id: row.id, songId, lines: [] } : { songId, sourceType: 'none', lines: [] }
    },
  } as unknown as SongService
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('study service', () => {
  it('tokenizes timed lyrics, creates both directions, and schedules a review', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-study-'))
    directories.push(directory)
    const database = openDatabase(join(directory, 'test.sqlite'))
    try {
      runMigrations(database)
      const user: AuthUser = { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN', timezone: 'Asia/Shanghai' }
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, ?, 'hash', 'salt', 'Owner', 'owner')`).run(user.email)
      database.prepare(`INSERT INTO song(id, title_ja, submitted_by, review_status, visibility) VALUES (1, '光の歌', 1, 'approved', 'shared')`).run()
      database.prepare(`INSERT INTO lyric(id, song_id, original_text, review_status, visibility) VALUES (1, 1, '君の中で', 'approved', 'shared')`).run()
      database.prepare(`INSERT INTO lyric_line(id, lyric_id, line_index, start_ms, end_ms, original_text) VALUES (1, 1, 0, 1000, 5000, '君の中で')`).run()
      const study = new StudyService(database, songService(database))

      const words = await study.tokenizeSong(user, 1)
      expect(words.words.length).toBeGreaterThan(0)
      expect(words.words[0]?.occurrences[0]?.startMs).toBeGreaterThanOrEqual(1000)
      const deck = study.listDecks(user)[0]!
      const secondDeck = study.createDeck(user, { name: '歌词重点' })!
      const selected = words.words.slice(0, 2).map((word) => Number(word.id))
      expect(() => study.addCardsToDecks(user, [Number(deck.id), 999], { lexemeIds: selected, songId: 1, directions: ['ja_zh'] }))
        .toThrowError(expect.objectContaining({ code: 'deck_not_found' }))
      expect(database.prepare('SELECT count(*) AS count FROM study_card').get()).toMatchObject({ count: 0 })
      expect(study.addCardsToDecks(user, [Number(deck.id), Number(secondDeck.id)], { lexemeIds: selected, songId: 1, directions: ['ja_zh', 'zh_ja'] }).added)
        .toBe(selected.length * 4)

      const card = study.nextCard(user, 'ja_zh')!
      expect(card.source.songId).toBe(1)
      expect(card.source.startMs).toBeGreaterThanOrEqual(1000)
      expect(card.source.tokens.length).toBeGreaterThan(0)
      expect(card.source.tokens[0]).toEqual(expect.objectContaining({
        tokenId: expect.any(Number), surface: expect.any(String), startOffset: expect.any(Number), endOffset: expect.any(Number),
      }))
      study.updatePreferences(user, { dailyNewLimit: 1, dailyReviewLimit: 2 })
      const reviewed = study.review(user, Number(card.id), 1)
      expect(reviewed.today.reviewedToday).toBe(1)
      expect(study.reviewHistory(user, 30).daily).toHaveLength(1)
      const stored = database.prepare('SELECT repetitions, lapses, state FROM study_card WHERE id = ?').get(card.id) as Record<string, unknown>
      expect(stored).toMatchObject({ repetitions: 1, lapses: 0, state: 'learning' })
      expect(() => study.review(user, Number(card.id), 3)).toThrowError(expect.objectContaining({ code: 'card_not_due' }))
      const anotherNewCard = database.prepare("SELECT id FROM study_card WHERE id <> ? AND state = 'new' ORDER BY id LIMIT 1").get(card.id) as { id: number }
      expect(() => study.review(user, anotherNewCard.id, 3)).toThrowError(expect.objectContaining({ code: 'daily_new_limit' }))
      study.updatePreferences(user, { dailyNewLimit: 20, dailyReviewLimit: 1 })
      expect(() => study.review(user, anotherNewCard.id, 3)).toThrowError(expect.objectContaining({ code: 'daily_review_limit' }))
      database.prepare("UPDATE study_card SET state = 'suspended' WHERE id = ?").run(anotherNewCard.id)
      expect(() => study.review(user, anotherNewCard.id, 3)).toThrowError(expect.objectContaining({ code: 'card_suspended' }))
    } finally {
      database.close()
    }
  })

  it('uses the three-response FSRS learning steps before long-term review', () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-study-fsrs-'))
    directories.push(directory)
    const database = openDatabase(join(directory, 'test.sqlite'))
    try {
      runMigrations(database)
      const user: AuthUser = { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN', timezone: 'UTC' }
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, ?, 'hash', 'salt', 'Owner', 'owner')`).run(user.email)
      const deckId = Number(database.prepare(`INSERT INTO study_deck(user_id, name, is_default) VALUES (1, 'FSRS', 1)`).run().lastInsertRowid)
      const lexemeId = Number(database.prepare(`INSERT INTO lexeme(language_code, lemma, writing) VALUES ('ja', '音楽', '音楽')`).run().lastInsertRowid)
      const insert = database.prepare(`INSERT INTO study_card(user_id, deck_id, lexeme_id, direction) VALUES (1, ?, ?, 'ja_zh')`)
      const cardIds = [insert.run(deckId, lexemeId).lastInsertRowid]
      database.prepare(`INSERT INTO lexeme(language_code, lemma, writing) VALUES ('ja', '未来', '未来')`).run()
      cardIds.push(insert.run(deckId, lexemeId + 1).lastInsertRowid)
      database.prepare(`INSERT INTO lexeme(language_code, lemma, writing) VALUES ('ja', '言葉', '言葉')`).run()
      cardIds.push(insert.run(deckId, lexemeId + 2).lastInsertRowid)
      const study = new StudyService(database, songService(database))
      const before = Date.now()

      study.review(user, Number(cardIds[0]), 1)
      study.review(user, Number(cardIds[1]), 2)
      study.review(user, Number(cardIds[2]), 3)

      const cards = database.prepare('SELECT id, due_at, fsrs_state, learning_steps FROM study_card ORDER BY id').all() as Array<Record<string, unknown>>
      const minutes = cards.map((card) => (Date.parse(String(card.due_at)) - before) / 60_000)
      expect(minutes[0]).toBeGreaterThanOrEqual(9.9)
      expect(minutes[0]).toBeLessThan(10.2)
      expect(minutes[1]).toBeGreaterThanOrEqual(34.9)
      expect(minutes[1]).toBeLessThan(35.2)
      expect(minutes[2]).toBeGreaterThanOrEqual(59.9)
      expect(minutes[2]).toBeLessThan(60.2)
      expect(cards.every((card) => card.fsrs_state === 1)).toBe(true)
    } finally {
      database.close()
    }
  })

  it('excludes lyric credits and only tokenizes the original lyric track', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-study-credits-'))
    directories.push(directory)
    const database = openDatabase(join(directory, 'test.sqlite'))
    try {
      runMigrations(database)
      const user: AuthUser = { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN' }
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, ?, 'hash', 'salt', 'Owner', 'owner')`).run(user.email)
      database.prepare(`INSERT INTO song(id, title_ja, submitted_by, review_status, visibility) VALUES (1, '光の歌', 1, 'approved', 'shared')`).run()
      database.prepare(`INSERT INTO lyric(id, song_id, original_text, review_status, visibility) VALUES (1, 1, '作词: Test\n君の中で', 'approved', 'shared')`).run()
      database.prepare(`
        INSERT INTO lyric_line(id, lyric_id, line_index, original_text, translated_text)
        VALUES (1, 1, 0, '作词: Test', NULL), (2, 1, 1, '君の中で', '在你的心中')
      `).run()
      const study = new StudyService(database, songService(database))

      const result = await study.tokenizeSong(user, 1)
      expect(result.words.length).toBeGreaterThan(0)
      expect(result.words.every((word) => word.occurrences.every((occurrence) => occurrence.lineId === 2))).toBe(true)
      expect(result.words.some((word) => ['作', '词', '在', '心中'].includes(String(word.writing)))).toBe(false)
      expect(database.prepare('SELECT count(*) AS count FROM lyric_token WHERE line_id = 1').get()).toMatchObject({ count: 0 })
    } finally {
      database.close()
    }
  })

  it('keeps personal word corrections isolated and manages decks and cards', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-study-'))
    directories.push(directory)
    const database = openDatabase(join(directory, 'test.sqlite'))
    try {
      runMigrations(database)
      const user: AuthUser = { id: 2, email: 'friend@example.com', role: 'user', displayName: 'Friend', preferredLanguage: 'zh-CN', timezone: 'Asia/Shanghai' }
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, 'owner@example.com', 'hash', 'salt', 'Owner', 'owner')`).run()
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (2, ?, 'hash', 'salt', 'Friend', 'user')`).run(user.email)
      database.prepare(`INSERT INTO song(id, title_ja, submitted_by, review_status, visibility) VALUES (1, '光の歌', 1, 'approved', 'shared')`).run()
      database.prepare(`INSERT INTO lyric(id, song_id, original_text, review_status, visibility) VALUES (1, 1, '音楽', 'approved', 'shared')`).run()
      database.prepare(`INSERT INTO lyric_line(id, lyric_id, line_index, start_ms, end_ms, original_text) VALUES (1, 1, 0, 1000, 3000, '音楽')`).run()
      const study = new StudyService(database, songService(database))
      const lexemeId = Number((await study.tokenizeSong(user, 1)).words[0]!.id)

      expect(study.updateLexeme(user, lexemeId, {
        reading: 'おんがく', readingKatakana: 'オンガク', romaji: 'ongaku', partOfSpeech: '名词', meaningZh: '音乐',
        exampleJa: '音楽を聞く。', exampleZh: '听音乐。',
      })).toMatchObject({
        reading: 'おんがく', readingKatakana: 'オンガク', romaji: 'ongaku', partOfSpeech: '名词', meaningZh: '音乐',
        exampleJa: '音楽を聞く。', exampleZh: '听音乐。',
      })
      expect((database.prepare('SELECT meaning_zh FROM lexeme WHERE id = ?').get(lexemeId) as { meaning_zh: string | null }).meaning_zh).toBeNull()
      expect(study.songWords(user, 1).words[0]).toMatchObject({
        meaningZh: '音乐', readingKatakana: 'オンガク', romaji: 'ongaku', resolutionStatus: 'resolved',
      })

      const defaultDeck = study.listDecks(user)[0]!
      const customDeck = study.createDeck(user, { name: 'JLPT' })!
      expect(study.updateDeck(user, Number(customDeck.id), { name: 'JLPT N3', description: '歌词词汇' })).toMatchObject({ name: 'JLPT N3' })
      study.reorderDecks(user, [Number(defaultDeck.id), Number(customDeck.id)])
      study.addCards(user, Number(defaultDeck.id), { lexemeIds: [lexemeId], songId: 1, directions: ['ja_zh'] })
      const card = study.listCards(user, Number(defaultDeck.id), 1, 20).data[0]!
      expect(card.answer).toMatchObject({
        reading: 'おんがく', readingKatakana: 'オンガク', romaji: 'ongaku', partOfSpeech: '名词', meaningZh: '音乐',
        exampleJa: '音楽を聞く。', exampleZh: '听音乐。',
      })
      expect(study.updateCard(user, Number(card.id), { deckId: Number(customDeck.id), state: 'suspended' })).toMatchObject({ deckId: customDeck.id, state: 'suspended' })
      study.deleteCard(user, Number(card.id))
      study.deleteDeck(user, Number(customDeck.id))
      expect(study.listDecks(user)).toHaveLength(1)
    } finally {
      database.close()
    }
  })

  it('keeps private lyric words and source lines isolated between users', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-study-private-'))
    directories.push(directory)
    const database = openDatabase(join(directory, 'test.sqlite'))
    try {
      runMigrations(database)
      const owner: AuthUser = { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN' }
      const friend: AuthUser = { id: 2, email: 'friend@example.com', role: 'user', displayName: 'Friend', preferredLanguage: 'zh-CN' }
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, ?, 'hash', 'salt', 'Owner', 'owner')`).run(owner.email)
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (2, ?, 'hash', 'salt', 'Friend', 'user')`).run(friend.email)
      database.prepare(`INSERT INTO song(id, title_ja, submitted_by, review_status, visibility) VALUES (1, '共有曲', 1, 'approved', 'shared')`).run()
      database.prepare(`INSERT INTO lyric(id, song_id, original_text, review_status, visibility, is_current, uploaded_by) VALUES (1, 1, '共有音楽', 'approved', 'shared', 1, 1)`).run()
      database.prepare(`INSERT INTO lyric_line(id, lyric_id, line_index, start_ms, end_ms, original_text) VALUES (1, 1, 0, 1000, 3000, '共有音楽')`).run()
      const study = new StudyService(database, songService(database))

      await study.tokenizeSong(friend, 1)
      database.prepare(`INSERT INTO lyric(id, song_id, original_text, review_status, visibility, is_current, uploaded_by) VALUES (2, 1, '秘密語彙', 'pending', 'private', 1, 1)`).run()
      database.prepare(`INSERT INTO lyric_line(id, lyric_id, line_index, start_ms, end_ms, original_text) VALUES (2, 2, 0, 4000, 6000, '秘密語彙')`).run()
      await study.tokenizeSong(owner, 1)

      const privateLexeme = database.prepare(`
        SELECT lt.lexeme_id FROM lyric_token lt WHERE lt.line_id = 2 ORDER BY lt.token_index LIMIT 1
      `).get() as { lexeme_id: number }
      expect(study.songWords(friend, 1).words.flatMap((word) => word.occurrences).every((occurrence) => occurrence.lineId !== 2)).toBe(true)
      const deck = study.listDecks(friend)[0]!
      expect(() => study.addCards(friend, Number(deck.id), { lexemeIds: [privateLexeme.lexeme_id], songId: 1, directions: ['ja_zh'] }))
        .toThrowError(expect.objectContaining({ code: 'lexeme_not_found' }))

      const dirtyCardId = Number(database.prepare(`
        INSERT INTO study_card(user_id, deck_id, lexeme_id, source_song_id, source_line_id, direction)
        VALUES (2, ?, ?, 1, 2, 'ja_zh')
      `).run(deck.id, privateLexeme.lexeme_id).lastInsertRowid)
      const dirtyCard = study.listCards(friend, Number(deck.id), 1, 20).data.find((card) => card.id === dirtyCardId)
      expect(dirtyCard?.source).toBeUndefined()

      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (3, 'third@example.com', 'hash', 'salt', 'Third', 'user')`).run()
      database.prepare(`INSERT INTO lyric(id, song_id, original_text, review_status, visibility, is_current, uploaded_by) VALUES (3, 1, '友人秘密', 'pending', 'private', 1, 3)`).run()
      database.prepare(`INSERT INTO lyric_line(id, lyric_id, line_index, start_ms, end_ms, original_text) VALUES (3, 3, 0, 7000, 9000, '友人秘密')`).run()
      const hiddenLexemeId = Number(database.prepare(`INSERT INTO lexeme(language_code, lemma, writing) VALUES ('ja', '友人秘密', '友人秘密')`).run().lastInsertRowid)
      database.prepare(`INSERT INTO lyric_token(line_id, lexeme_id, token_index, surface) VALUES (3, ?, 0, '友人秘密')`).run(hiddenLexemeId)
      const ownerDeck = study.listDecks(owner)[0]!
      const ownerDirtyCardId = Number(database.prepare(`
        INSERT INTO study_card(user_id, deck_id, lexeme_id, source_song_id, source_line_id, direction)
        VALUES (1, ?, ?, 1, 3, 'ja_zh')
      `).run(ownerDeck.id, hiddenLexemeId).lastInsertRowid)
      const ownerDirtyCard = study.listCards(owner, Number(ownerDeck.id), 1, 20).data.find((card) => card.id === ownerDirtyCardId)
      expect(ownerDirtyCard?.source).toBeUndefined()
    } finally {
      database.close()
    }
  })

  it('compares SQLite and ISO due timestamps chronologically', () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-study-time-'))
    directories.push(directory)
    const database = openDatabase(join(directory, 'test.sqlite'))
    try {
      runMigrations(database)
      const user: AuthUser = { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN', timezone: 'UTC' }
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, ?, 'hash', 'salt', 'Owner', 'owner')`).run(user.email)
      const deckId = Number(database.prepare(`INSERT INTO study_deck(user_id, name, is_default) VALUES (1, 'Due dates', 1)`).run().lastInsertRowid)
      const lexemeId = Number(database.prepare(`INSERT INTO lexeme(language_code, lemma, writing) VALUES ('ja', '未来', '未来')`).run().lastInsertRowid)
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
      const cardId = Number(database.prepare(`
        INSERT INTO study_card(user_id, deck_id, lexeme_id, direction, due_at) VALUES (1, ?, ?, 'ja_zh', ?)
      `).run(deckId, lexemeId, future).lastInsertRowid)
      const study = new StudyService(database, songService(database))

      expect(study.listDecks(user)[0]?.dueCount).toBe(0)
      expect(study.nextCard(user, 'ja_zh')).toBeNull()

      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
      database.prepare('UPDATE study_card SET due_at = ? WHERE id = ?').run(past, cardId)
      expect(study.listDecks(user)[0]?.dueCount).toBe(1)
      expect(study.nextCard(user, 'ja_zh')?.id).toBe(cardId)
    } finally {
      database.close()
    }
  })
})
