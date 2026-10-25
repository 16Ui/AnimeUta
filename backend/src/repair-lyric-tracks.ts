import { loadConfig } from './config.js'
import { openDatabase } from './db.js'
import { normalizeLyricTracks, type ParsedLyricLine } from './lyrics.js'

interface TrackRow {
  id: number
  song_id: number
  line_index: number
  original_text: string
  translated_text: string
  romaji_text: string | null
}

const apply = process.argv.includes('--apply')
const config = loadConfig()
const database = openDatabase(config.databasePath)

try {
  const rows = database.prepare(`
    SELECT ll.id, l.song_id, ll.line_index, ll.original_text, ll.translated_text, ll.romaji_text
    FROM lyric_line ll
    JOIN lyric l ON l.id = ll.lyric_id
    WHERE ll.translated_text IS NOT NULL
      AND TRIM(ll.translated_text) <> ''
    ORDER BY l.song_id, ll.line_index
  `).all() as unknown as TrackRow[]

  const repairs = rows.flatMap((row) => {
    const line: ParsedLyricLine = {
      lineIndex: row.line_index,
      originalText: row.original_text,
      translatedText: row.translated_text,
      ...(row.romaji_text ? { romajiText: row.romaji_text } : {}),
    }
    const normalized = normalizeLyricTracks(line)
    if (normalized.translatedText === line.translatedText && normalized.romajiText === line.romajiText) return []
    return [{ row, normalized }]
  })

  const songCount = new Set(repairs.map(({ row }) => row.song_id)).size
  const linesBySong = Object.fromEntries([...new Set(repairs.map(({ row }) => row.song_id))].map((songId) => [
    songId,
    repairs.filter(({ row }) => row.song_id === songId).length,
  ]))
  console.log(JSON.stringify({ apply, candidateLines: repairs.length, affectedSongs: songCount, linesBySong }, null, 2))
  console.log(repairs.slice(0, 8).map(({ row, normalized }) => ({
    songId: row.song_id,
    lineIndex: row.line_index,
    original: row.original_text,
    removedTranslation: row.translated_text,
    romaji: normalized.romajiText,
  })))

  if (apply && repairs.length > 0) {
    const update = database.prepare(`
      UPDATE lyric_line
      SET translated_text = NULL, romaji_text = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const { row, normalized } of repairs) update.run(normalized.romajiText ?? row.romaji_text, row.id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
} finally {
  database.close()
}
