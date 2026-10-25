import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthUser } from './auth.js'
import { openDatabase, runMigrations, type SqliteDatabase } from './db.js'
import type { JapaneseStudyAnalyzer, JlptLevel } from './japanese-study.js'
import type { SongService } from './songs.js'
import { StudyService } from './study.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function songs(database: SqliteDatabase): SongService {
  return {
    currentLyrics: (_user: AuthUser, songId: number) => {
      const row = database.prepare('SELECT id FROM lyric WHERE song_id = ? AND is_current = 1').get(songId) as { id: number } | undefined
      return row ? { id: row.id, songId, lines: [] } : { songId, sourceType: 'none', lines: [] }
    },
  } as unknown as SongService
}

describe('JLPT song vocabulary coverage', () => {
  it('marks song words and excludes N1 from the cumulative N2 target', () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-jlpt-'))
    directories.push(directory)
    const database = openDatabase(join(directory, 'test.sqlite'))
    try {
      runMigrations(database)
      const user: AuthUser = { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN' }
      database.prepare("INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, ?, 'hash', 'salt', 'Owner', 'owner')").run(user.email)
      database.prepare("INSERT INTO song(id, title_ja, language_code, submitted_by, review_status, visibility) VALUES (1, '光の歌', 'ja', 1, 'approved', 'shared')").run()
      database.prepare("INSERT INTO lyric(id, song_id, original_text, review_status, visibility, is_current, uploaded_by) VALUES (1, 1, '光 未来 幻', 'approved', 'shared', 1, 1)").run()
      database.prepare("INSERT INTO lyric_line(id, lyric_id, line_index, original_text) VALUES (1, 1, 0, '光 未来 幻')").run()
      const insertLexeme = database.prepare("INSERT INTO lexeme(language_code, lemma, writing, dictionary_source, dictionary_entry_id, resolution_status) VALUES ('ja', ?, ?, 'tomoshi', ?, 'resolved')")
      const ids = [
        Number(insertLexeme.run('光', '光', 'n5-word').lastInsertRowid),
        Number(insertLexeme.run('未来', '未来', 'n3-word').lastInsertRowid),
        Number(insertLexeme.run('幻', '幻', 'n1-word').lastInsertRowid),
      ]
      const insertToken = database.prepare('INSERT INTO lyric_token(line_id, lexeme_id, token_index, surface) VALUES (1, ?, ?, ?)')
      insertToken.run(ids[0], 0, '光')
      insertToken.run(ids[1], 1, '未来')
      insertToken.run(ids[2], 2, '幻')
      const levels = new Map<string, JlptLevel>([['n5-word', 'N5'], ['n3-word', 'N3'], ['n1-word', 'N1']])
      const analyzer = {
        close: () => undefined,
        jlptLevels: (entryIds: string[]) => new Map(entryIds.flatMap((id) => levels.has(id) ? [[id, levels.get(id)!] as const] : [])),
        jlptReference: () => ({
          available: true,
          totals: { N5: 10, N4: 20, N3: 30, N2: 40, N1: 50 },
          source: 'fixture', license: 'CC-BY-SA-4.0', attribution: 'fixture',
        }),
      } as unknown as JapaneseStudyAnalyzer
      const study = new StudyService(database, songs(database), analyzer)

      const song = study.songWords(user, 1)
      expect(song.words.map((word) => word.jlptLevel)).toEqual(['N5', 'N3', 'N1'])
      expect(song.coverage).toMatchObject({ classified: 2, wordCount: 3, unclassified: 1, target: { covered: 2, total: 100, remaining: 98 } })
      expect(study.jlptCoverage(user)).toMatchObject({
        classified: 2,
        target: { covered: 2, total: 100, remaining: 98 },
        songs: { total: 1, analyzed: 1 },
      })
    } finally {
      database.close()
    }
  })
})
