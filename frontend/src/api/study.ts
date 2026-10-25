import { http } from './http'
import type { ApiResponse } from '../types/auth'
import type { GrammarLesson, GrammarPath, GrammarReviewCard, JlptCoverage, ReviewCard, ReviewHistory, SongWordsResponse, StudyCard, StudyCardListResponse, StudyDeck, StudyDirection, StudyPreference, StudyToday, StudyWord } from '../types/study'

export async function getSongWords(songId: number): Promise<SongWordsResponse> {
  return (await http.get<ApiResponse<SongWordsResponse>>(`/api/v1/songs/${songId}/study/words`)).data.data
}

export async function tokenizeSong(songId: number): Promise<SongWordsResponse> {
  return (await http.post<ApiResponse<SongWordsResponse>>(`/api/v1/songs/${songId}/study/tokenize`, {})).data.data
}

export async function listStudyDecks(): Promise<StudyDeck[]> {
  return (await http.get<ApiResponse<StudyDeck[]>>('/api/v1/study/decks')).data.data
}

export async function createStudyDeck(name: string): Promise<StudyDeck> {
  return (await http.post<ApiResponse<StudyDeck>>('/api/v1/study/decks', { name })).data.data
}

export async function updateStudyDeck(deckId: number, payload: { name?: string; description?: string }): Promise<StudyDeck> {
  return (await http.patch<ApiResponse<StudyDeck>>(`/api/v1/study/decks/${deckId}`, payload)).data.data
}

export async function deleteStudyDeck(deckId: number): Promise<void> {
  await http.delete(`/api/v1/study/decks/${deckId}`)
}

export async function reorderStudyDecks(deckIds: number[]): Promise<void> {
  await http.patch('/api/v1/study/decks/reorder', { deckIds })
}

export async function updateStudyLexeme(lexemeId: number, payload: { writing?: string; reading?: string; readingKatakana?: string; romaji?: string; partOfSpeech?: string; meaningZh?: string; meaningEn?: string; exampleJa?: string; exampleZh?: string }): Promise<StudyWord> {
  return (await http.patch<ApiResponse<StudyWord>>(`/api/v1/study/lexemes/${lexemeId}`, payload)).data.data
}

export async function getStudyPreferences(): Promise<StudyPreference> {
  return (await http.get<ApiResponse<StudyPreference>>('/api/v1/study/preferences')).data.data
}

export async function updateStudyPreferences(preferences: StudyPreference): Promise<StudyPreference> {
  return (await http.patch<ApiResponse<StudyPreference>>('/api/v1/study/preferences', preferences)).data.data
}

export async function addStudyCards(deckId: number, payload: { lexemeIds: number[]; songId: number; directions: StudyDirection[] }): Promise<{ added: number }> {
  return (await http.post<ApiResponse<{ added: number }>>(`/api/v1/study/decks/${deckId}/cards`, payload)).data.data
}

export async function addStudyCardsToDecks(payload: { deckIds: number[]; lexemeIds: number[]; songId: number; directions: StudyDirection[] }): Promise<{ added: number; deckIds: number[] }> {
  return (await http.post<ApiResponse<{ added: number; deckIds: number[] }>>('/api/v1/study/cards', payload)).data.data
}

export async function listStudyCards(deckId: number): Promise<StudyCardListResponse> {
  return (await http.get<StudyCardListResponse>(`/api/v1/study/decks/${deckId}/cards`)).data
}

export async function updateStudyCard(cardId: number, payload: { state?: StudyCard['state']; deckId?: number }): Promise<StudyCard> {
  return (await http.patch<ApiResponse<StudyCard>>(`/api/v1/study/cards/${cardId}`, payload)).data.data
}

export async function deleteStudyCard(cardId: number): Promise<void> {
  await http.delete(`/api/v1/study/cards/${cardId}`)
}

export async function getReviewHistory(days = 30): Promise<ReviewHistory> {
  return (await http.get<ApiResponse<ReviewHistory>>('/api/v1/study/reviews/history', { params: { days } })).data.data
}

export async function getStudyToday(direction: StudyDirection): Promise<StudyToday> {
  return (await http.get<ApiResponse<StudyToday>>('/api/v1/study/today', { params: { direction } })).data.data
}

export async function getNextReviewCard(direction: StudyDirection): Promise<ReviewCard | null> {
  return (await http.get<ApiResponse<ReviewCard | null>>('/api/v1/study/review/next', { params: { direction } })).data.data
}

export async function submitReview(cardId: number, grade: 1 | 2 | 3): Promise<void> {
  await http.post('/api/v1/study/reviews', { cardId, grade })
}

export async function getGrammarPath(): Promise<GrammarPath> {
  return (await http.get<ApiResponse<GrammarPath>>('/api/v1/study/grammar/path')).data.data
}

export async function getJlptCoverage(): Promise<JlptCoverage> {
  return (await http.get<ApiResponse<JlptCoverage>>('/api/v1/study/jlpt/coverage')).data.data
}

export async function completeGrammarLesson(lessonId: string): Promise<GrammarLesson> {
  return (await http.post<ApiResponse<GrammarLesson>>(`/api/v1/study/grammar/lessons/${lessonId}/complete`, {})).data.data
}

export async function getNextGrammarReview(): Promise<GrammarReviewCard | null> {
  return (await http.get<ApiResponse<GrammarReviewCard | null>>('/api/v1/study/grammar/review/next')).data.data
}

export async function submitGrammarReview(lessonId: string, grade: 1 | 2 | 3): Promise<void> {
  await http.post('/api/v1/study/grammar/reviews', { lessonId, grade })
}
