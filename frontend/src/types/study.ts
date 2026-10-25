export type StudyDirection = 'ja_zh' | 'zh_ja'
export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1'

export interface JlptCoverageLevel {
  level: Exclude<JlptLevel, 'N1'>
  covered: number
  total: number
  remaining: number
  percent: number
}

export interface JlptCoverage {
  available: boolean
  levels: JlptCoverageLevel[]
  target: { level: 'N2'; covered: number; total: number; remaining: number; percent: number }
  classified: number
  wordCount?: number
  unclassified?: number
  songs?: { total: number; analyzed: number }
  reference: { source: string; license: string; attribution: string; official: false }
}

export interface StudyWordOccurrence {
  tokenId: number
  lineId: number
  lineIndex: number
  surface: string
  startOffset?: number
  endOffset?: number
  startMs?: number
  endMs?: number
  lineText: string
  lineTranslatedText?: string
}

export interface StudyWord {
  id: number
  lemma: string
  writing: string
  reading?: string
  readingKatakana?: string
  romaji?: string
  partOfSpeech?: string
  meaningZh?: string
  meaningEn?: string
  exampleJa?: string
  exampleZh?: string
  jlptLevel?: JlptLevel
  resolutionStatus?: 'resolved' | 'ambiguous' | 'unresolved'
  occurrences: StudyWordOccurrence[]
}

export interface SongWordsResponse {
  songId: number
  words: StudyWord[]
  coverage?: JlptCoverage
  analysis?: {
    dictionaryAvailable: boolean
    dictionaryVersion?: string
    resolved: number
    llmResolved: number
    unresolved: number
    llmFallbackError?: string
  }
}

export interface StudyDeck {
  id: number
  name: string
  description?: string
  sourceSongId?: number
  isDefault: boolean
  cardCount: number
  dueCount: number
  sortOrder?: number
  createdAt?: string
  updatedAt?: string
}

export interface StudyToday {
  total: number
  due: number
  new: number
  reviewedToday: number
  mastered: number
  masteryPercent: number
  streakDays: number
  dailyNewLimit: number
  dailyReviewLimit: number
}

export interface StudyPreference {
  dailyNewLimit: number
  dailyReviewLimit: number
  defaultDirection: StudyDirection
  autoplayPronunciation: boolean
}

export interface ReviewCard {
  id: number
  deckId: number
  direction: StudyDirection
  state: string
  dueAt: string
  front: string
  answer: {
    writing: string
    lemma: string
    reading?: string
    readingKatakana?: string
    romaji?: string
    meaningZh?: string
    meaningEn?: string
    partOfSpeech?: string
    exampleJa?: string
    exampleZh?: string
    resolutionStatus?: 'resolved' | 'ambiguous' | 'unresolved'
  }
  source?: {
    songId?: number
    lineId: number
    lineIndex: number
    startMs?: number
    text: string
    translatedText?: string
    tokens?: Array<{
      tokenId: number
      surface: string
      startOffset: number
      endOffset: number
      reading?: string
      romaji?: string
      partOfSpeech?: string
      meaningZh?: string
    }>
  }
  repetitions: number
  lapses: number
}

export interface StudyCard extends ReviewCard {
  state: 'new' | 'learning' | 'review' | 'suspended'
}

export interface StudyCardListResponse {
  data: StudyCard[]
  pagination: { page: number; pageSize: number; total: number }
}

export interface ReviewHistory {
  days: number
  daily: Array<{ day: string; reviews: number; newCards: number; averageGrade: number }>
  grades: Array<{ grade: number; count: number }>
}

export interface GrammarExample {
  ja: string
  reading: string
  zh: string
}

export interface GrammarLesson {
  id: string
  order: number
  stage: '入门基础' | '动词体系' | '句子扩展' | 'N4 核心' | '歌词表达' | '长句解析' | 'N3 扩展' | 'N2 扩展'
  title: string
  pattern: string
  summary: string
  explanation: string
  prerequisiteId?: string
  examples: GrammarExample[]
  reviewPrompt: string
  reviewAnswer: string
  locked: boolean
  status: 'new' | 'learning' | 'review' | 'mastered'
  dueAt?: string
  completedAt?: string
  repetitions: number
}

export interface GrammarPath {
  lessons: GrammarLesson[]
  summary: { total: number; completed: number; due: number }
}

export interface GrammarReviewCard {
  lessonId: string
  state: 'learning' | 'review' | 'mastered'
  dueAt: string
  front: string
  answer: {
    title: string
    pattern: string
    summary: string
    explanation: string
    reviewAnswer: string
    examples: GrammarExample[]
  }
  repetitions: number
  lapses: number
}
