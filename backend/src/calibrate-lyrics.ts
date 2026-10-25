import type { DatabaseSync } from 'node:sqlite'
import { loadConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'
import { JapaneseStudyAnalyzer, TomoshiDictionary } from './japanese-study.js'
import { detectLyricsLanguage, normalizeParallelLyrics, type ParsedLyricLine } from './lyrics.js'
import { MediaService } from './media.js'
import { SongService } from './songs.js'
import { StudyService } from './study.js'
import type { AuthUser } from './auth.js'

try { process.loadEnvFile() } catch { /* Local calibration works without an env file. */ }

interface LyricRow {
  id: number
  lyric_id: number
  line_index: number
  start_ms: number | null
  end_ms: number | null
  original_text: string
  translated_text: string | null
  romaji_text: string | null
  ruby_json: string
}

interface LyricRecord {
  lyric_id: number
  song_id: number
  title: string
  language_code: string
  artist: string | null
}

function owner(database: DatabaseSync): AuthUser {
  const row = database.prepare(`
    SELECT id, email, display_name, role, preferred_language, timezone
    FROM app_user WHERE role = 'owner' ORDER BY id LIMIT 1
  `).get() as Record<string, unknown> | undefined
  if (!row) throw new Error('Create an owner account before calibrating lyrics.')
  return {
    id: Number(row.id), email: String(row.email), displayName: String(row.display_name), role: 'owner',
    preferredLanguage: String(row.preferred_language ?? 'zh-CN'), timezone: String(row.timezone ?? 'Asia/Shanghai'),
  }
}

function asParsed(row: LyricRow): ParsedLyricLine {
  return {
    lineIndex: row.line_index,
    ...(row.start_ms !== null ? { startMs: row.start_ms } : {}),
    ...(row.end_ms !== null ? { endMs: row.end_ms } : {}),
    originalText: row.original_text,
    ...(row.translated_text ? { translatedText: row.translated_text } : {}),
    ...(row.romaji_text ? { romajiText: row.romaji_text } : {}),
  }
}

function sameStoredShape(rows: LyricRow[], lines: ParsedLyricLine[]): boolean {
  return rows.length === lines.length && rows.every((row, index) => {
    const line = lines[index]!
    return row.original_text === line.originalText && row.line_index === line.lineIndex
  })
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const config = loadConfig()
  const database = openDatabase(config.databasePath)
  runMigrations(database)
  const analyzer = new JapaneseStudyAnalyzer(new TomoshiDictionary(config.dictionaryPath))
  const media = new MediaService(database, config)
  const songs = new SongService(database, config, media)
  const study = new StudyService(database, songs, analyzer)
  const user = owner(database)

  const lyrics = database.prepare(`
    SELECT l.id AS lyric_id, l.song_id, s.title_ja AS title, s.language_code,
      group_concat(DISTINCT coalesce(a.name_ja, a.name_en, a.name_romaji, a.name_zh)) AS artist
    FROM lyric l
    JOIN song s ON s.id = l.song_id
    LEFT JOIN song_artist sa ON sa.song_id = s.id
    LEFT JOIN artist a ON a.id = sa.artist_id
    WHERE l.is_current = 1
    GROUP BY l.id, l.song_id, s.title_ja, s.language_code
    ORDER BY l.song_id
  `).all() as unknown as LyricRecord[]

  let mergedLines = 0
  let rebuiltLyrics = 0
  let languageChanges = 0
  let translationsCleared = 0
  let romajiCleared = 0
  const retokenize: number[] = []

  for (const record of lyrics) {
    const rows = database.prepare(`
      SELECT id, lyric_id, line_index, start_ms, end_ms, original_text, translated_text, romaji_text, ruby_json
      FROM lyric_line WHERE lyric_id = ? ORDER BY line_index
    `).all(record.lyric_id) as unknown as LyricRow[]
    if (rows.length === 0) continue

    let normalized = normalizeParallelLyrics(rows.map(asParsed))
    const language = detectLyricsLanguage(normalized, record.title, record.artist ?? '')
    mergedLines += rows.length - normalized.length
    if (language !== record.language_code) languageChanges += 1

    if (language === 'zh') {
      normalized = normalized.map((line) => {
        if (line.translatedText) translationsCleared += 1
        if (line.romajiText) romajiCleared += 1
        const { translatedText: _translatedText, romajiText: _romajiText, ...source } = line
        return source
      })
    } else if (language === 'en') {
      normalized = normalized.map((line) => {
        if (line.romajiText) romajiCleared += 1
        const { romajiText: _romajiText, ...source } = line
        return source
      })
    }

    const annotations = language === 'ja'
      ? await analyzer.annotateLines(normalized.map((line) => ({ lineIndex: line.lineIndex, text: line.originalText })))
      : []
    const readingByIndex = new Map(annotations.map((annotation) => [annotation.lineIndex, annotation]))
    const prepared = normalized.map((line) => {
      const reading = readingByIndex.get(line.lineIndex)
      const { romajiText: _romajiText, ...source } = line
      return {
        ...source,
        ...(language === 'ja' && reading?.romaji ? { romajiText: reading.romaji } : {}),
        ruby: language === 'ja' ? (reading?.ruby ?? [{ text: line.originalText }]) : [],
      }
    })

    if (!apply) continue
    const preserveIds = sameStoredShape(rows, prepared)
    database.exec('BEGIN IMMEDIATE')
    try {
      if (preserveIds) {
        const update = database.prepare(`
          UPDATE lyric_line SET start_ms = ?, end_ms = ?, translated_text = ?, romaji_text = ?, ruby_json = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        for (const [index, line] of prepared.entries()) {
          update.run(line.startMs ?? null, line.endMs ?? null, line.translatedText ?? null, line.romajiText ?? null, JSON.stringify(line.ruby), rows[index]!.id)
        }
      } else {
        rebuiltLyrics += 1
        database.prepare('DELETE FROM lyric_line WHERE lyric_id = ?').run(record.lyric_id)
        const insert = database.prepare(`
          INSERT INTO lyric_line(lyric_id, line_index, start_ms, end_ms, original_text, translated_text, ruby_json, romaji_text)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const line of prepared) {
          insert.run(record.lyric_id, line.lineIndex, line.startMs ?? null, line.endMs ?? null, line.originalText, line.translatedText ?? null, JSON.stringify(line.ruby), line.romajiText ?? null)
        }
        if (language === 'ja') retokenize.push(record.song_id)
      }
      database.prepare('UPDATE lyric SET original_text = ?, language_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(prepared.map((line) => line.originalText).join('\n'), language, record.lyric_id)
      database.prepare('UPDATE song SET language_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(language, record.song_id)
      if (language !== 'ja') {
        database.prepare('DELETE FROM lyric_token WHERE line_id IN (SELECT id FROM lyric_line WHERE lyric_id = ?)').run(record.lyric_id)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  if (apply) {
    for (const [index, songId] of [...new Set(retokenize)].entries()) {
      await study.tokenizeSong(user, songId)
      if ((index + 1) % 25 === 0 || index + 1 === retokenize.length) console.log(`Retokenized ${index + 1}/${retokenize.length}`)
    }
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', lyrics: lyrics.length, mergedLines, rebuiltLyrics, languageChanges, translationsCleared, romajiCleared, retokenizedSongs: new Set(retokenize).size }, null, 2))
  analyzer.close()
  database.close()
}

await run()
