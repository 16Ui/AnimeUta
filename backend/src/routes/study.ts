import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../auth.js'
import type { StudyService } from '../study.js'

export async function registerStudyRoutes(app: FastifyInstance, options: { auth: AuthService; study: StudyService }): Promise<void> {
  const { auth, study } = options

  app.get<{ Params: { id: string } }>('/api/v1/songs/:id/study/words', async (request) => ({
    data: study.songWords(auth.authenticate(request), Number(request.params.id)),
  }))
  app.post<{ Params: { id: string } }>('/api/v1/songs/:id/study/tokenize', async (request) => ({
    data: await study.tokenizeSong(auth.authenticate(request), Number(request.params.id)),
  }))
  app.get('/api/v1/study/decks', async (request) => ({ data: study.listDecks(auth.authenticate(request)) }))
  app.get('/api/v1/study/preferences', async (request) => ({ data: study.preferences(auth.authenticate(request)) }))
  app.patch('/api/v1/study/preferences', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: study.updatePreferences(user, {
      ...(body.dailyNewLimit !== undefined ? { dailyNewLimit: Number(body.dailyNewLimit) } : {}),
      ...(body.dailyReviewLimit !== undefined ? { dailyReviewLimit: Number(body.dailyReviewLimit) } : {}),
      ...(body.defaultDirection === 'ja_zh' || body.defaultDirection === 'zh_ja' ? { defaultDirection: body.defaultDirection } : {}),
      ...(body.autoplayPronunciation !== undefined ? { autoplayPronunciation: Boolean(body.autoplayPronunciation) } : {}),
    }) }
  })
  app.post('/api/v1/study/decks', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: study.createDeck(user, {
      name: String(body.name ?? ''),
      ...(body.description !== undefined ? { description: String(body.description) } : {}),
      ...(body.sourceSongId !== undefined ? { sourceSongId: Number(body.sourceSongId) } : {}),
    }) }
  })
  app.patch<{ Params: { id: string } }>('/api/v1/study/decks/:id', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: study.updateDeck(user, Number(request.params.id), {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.description !== undefined ? { description: String(body.description) } : {}),
    }) }
  })
  app.delete<{ Params: { id: string } }>('/api/v1/study/decks/:id', async (request) => {
    study.deleteDeck(auth.authenticate(request), Number(request.params.id))
    return { data: null }
  })
  app.patch('/api/v1/study/decks/reorder', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    study.reorderDecks(user, Array.isArray(body.deckIds) ? body.deckIds.map(Number) : [])
    return { data: null }
  })
  app.patch<{ Params: { id: string } }>('/api/v1/study/lexemes/:id', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: study.updateLexeme(user, Number(request.params.id), {
      ...(body.writing !== undefined ? { writing: String(body.writing) } : {}),
      ...(body.reading !== undefined ? { reading: String(body.reading) } : {}),
      ...(body.readingKatakana !== undefined ? { readingKatakana: String(body.readingKatakana) } : {}),
      ...(body.romaji !== undefined ? { romaji: String(body.romaji) } : {}),
      ...(body.partOfSpeech !== undefined ? { partOfSpeech: String(body.partOfSpeech) } : {}),
      ...(body.meaningZh !== undefined ? { meaningZh: String(body.meaningZh) } : {}),
      ...(body.meaningEn !== undefined ? { meaningEn: String(body.meaningEn) } : {}),
      ...(body.exampleJa !== undefined ? { exampleJa: String(body.exampleJa) } : {}),
      ...(body.exampleZh !== undefined ? { exampleZh: String(body.exampleZh) } : {}),
    }) }
  })
  app.post<{ Params: { id: string } }>('/api/v1/study/decks/:id/cards', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: study.addCards(user, Number(request.params.id), {
      lexemeIds: Array.isArray(body.lexemeIds) ? body.lexemeIds.map(Number) : [],
      ...(body.songId !== undefined ? { songId: Number(body.songId) } : {}),
      directions: Array.isArray(body.directions) ? body.directions.filter((item): item is 'ja_zh' | 'zh_ja' => item === 'ja_zh' || item === 'zh_ja') : [],
    }) }
  })
  app.post('/api/v1/study/cards', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: study.addCardsToDecks(
      user,
      Array.isArray(body.deckIds) ? body.deckIds.map(Number) : [],
      {
        lexemeIds: Array.isArray(body.lexemeIds) ? body.lexemeIds.map(Number) : [],
        ...(body.songId !== undefined ? { songId: Number(body.songId) } : {}),
        directions: Array.isArray(body.directions) ? body.directions.filter((item): item is 'ja_zh' | 'zh_ja' => item === 'ja_zh' || item === 'zh_ja') : [],
      },
    ) }
  })
  app.get<{ Params: { id: string } }>('/api/v1/study/decks/:id/cards', async (request) => {
    const query = request.query as Record<string, unknown>
    return study.listCards(auth.authenticate(request), Number(request.params.id), Number(query.page ?? 1), Number(query.pageSize ?? 50))
  })
  app.patch<{ Params: { id: string } }>('/api/v1/study/cards/:id', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: study.updateCard(user, Number(request.params.id), {
      ...(body.state !== undefined ? { state: String(body.state) } : {}),
      ...(body.deckId !== undefined ? { deckId: Number(body.deckId) } : {}),
    }) }
  })
  app.delete<{ Params: { id: string } }>('/api/v1/study/cards/:id', async (request) => {
    study.deleteCard(auth.authenticate(request), Number(request.params.id))
    return { data: null }
  })
  app.get('/api/v1/study/today', async (request) => {
    const user = auth.authenticate(request)
    const query = request.query as Record<string, unknown>
    const direction = query.direction === 'ja_zh' || query.direction === 'zh_ja' ? query.direction : undefined
    return { data: study.today(user, direction) }
  })
  app.get('/api/v1/study/review/next', async (request) => {
    const user = auth.authenticate(request)
    const query = request.query as Record<string, unknown>
    const direction = query.direction === 'ja_zh' || query.direction === 'zh_ja' ? query.direction : undefined
    return { data: study.nextCard(user, direction) }
  })
  app.post('/api/v1/study/reviews', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: study.review(user, Number(body.cardId), Number(body.grade)) }
  })
  app.get('/api/v1/study/reviews/history', async (request) => {
    const query = request.query as Record<string, unknown>
    return { data: study.reviewHistory(auth.authenticate(request), Number(query.days ?? 30)) }
  })
  app.get('/api/v1/study/grammar/path', async (request) => ({
    data: study.grammarPath(auth.authenticate(request)),
  }))
  app.get('/api/v1/study/jlpt/coverage', async (request) => ({
    data: study.jlptCoverage(auth.authenticate(request)),
  }))
  app.post<{ Params: { lessonId: string } }>('/api/v1/study/grammar/lessons/:lessonId/complete', async (request) => ({
    data: study.completeGrammarLesson(auth.authenticate(request), request.params.lessonId),
  }))
  app.get('/api/v1/study/grammar/review/next', async (request) => ({
    data: study.nextGrammarReview(auth.authenticate(request)),
  }))
  app.post('/api/v1/study/grammar/reviews', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: study.reviewGrammar(user, String(body.lessonId ?? ''), Number(body.grade)) }
  })
}
