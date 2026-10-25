import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthUser } from './auth.js'
import { openDatabase, runMigrations, type SqliteDatabase } from './db.js'
import type { SongService } from './songs.js'
import { StudyService } from './study.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createStudy() {
  const directory = mkdtempSync(join(tmpdir(), 'animeuta-grammar-'))
  directories.push(directory)
  const database = openDatabase(join(directory, 'test.sqlite'))
  runMigrations(database)
  const user: AuthUser = { id: 1, email: 'learner@example.com', role: 'user', displayName: 'Learner', preferredLanguage: 'zh-CN', timezone: 'Asia/Shanghai' }
  database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, ?, 'hash', 'salt', 'Learner', 'user')`).run(user.email)
  const songs = { assertVisible: () => undefined, currentLyrics: () => ({ sourceType: 'none', lines: [] }) } as unknown as SongService
  return { database, user, study: new StudyService(database, songs) }
}

describe('grammar learning path', () => {
  it('unlocks lessons in order and adds completed lessons to todays review', () => {
    const { database, user, study } = createStudy()
    try {
      const initial = study.grammarPath(user)
      expect(initial.summary).toMatchObject({ total: 226, completed: 0, due: 0 })
      expect(new Set(initial.lessons.map((lesson) => lesson.stage))).toEqual(new Set(['入门基础', '动词体系', '句子扩展', 'N4 核心', '歌词表达', '长句解析', 'N3 扩展', 'N2 扩展']))
      expect(Object.fromEntries([...new Set(initial.lessons.map((lesson) => lesson.stage))].map((stage) => [stage, initial.lessons.filter((lesson) => lesson.stage === stage).length]))).toEqual({
        '入门基础': 12, '动词体系': 17, '句子扩展': 14, 'N4 核心': 19, '歌词表达': 16, '长句解析': 8,
        'N3 扩展': 70, 'N2 扩展': 70,
      })
      expect(initial.lessons[0]).toMatchObject({ id: 'noun-desu', locked: false })
      expect(initial.lessons[1]).toMatchObject({ id: 'particle-no', locked: true })
      expect(() => study.completeGrammarLesson(user, 'particle-no')).toThrowError(expect.objectContaining({ code: 'grammar_prerequisite_incomplete' }))

      study.completeGrammarLesson(user, 'noun-desu')
      const after = study.grammarPath(user)
      expect(after.summary).toMatchObject({ completed: 1, due: 1 })
      expect(after.lessons[1]).toMatchObject({ locked: false })
      expect(study.nextGrammarReview(user)).toMatchObject({ lessonId: 'noun-desu', state: 'learning' })
    } finally {
      database.close()
    }
  })

  it('schedules grammar with the same three-response FSRS policy as vocabulary', () => {
    const { database, user, study } = createStudy()
    try {
      study.completeGrammarLesson(user, 'noun-desu')
      const before = Date.now()
      const result = study.reviewGrammar(user, 'noun-desu', 3)
      const delayMinutes = (Date.parse(result.nextDueAt) - before) / 60_000
      expect(delayMinutes).toBeGreaterThanOrEqual(59.9)
      expect(delayMinutes).toBeLessThan(60.2)
      expect(study.nextGrammarReview(user)).toBeNull()
      const stored = database.prepare(`SELECT repetitions, status FROM grammar_lesson_progress WHERE user_id = 1 AND lesson_id = 'noun-desu'`).get() as Record<string, unknown>
      expect(stored).toMatchObject({ repetitions: 1, status: 'learning' })
      expect(() => study.reviewGrammar(user, 'noun-desu', 3)).toThrowError(expect.objectContaining({ code: 'grammar_not_due' }))
    } finally {
      database.close()
    }
  })
})
