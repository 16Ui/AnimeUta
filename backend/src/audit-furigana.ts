import { loadConfig } from './config.js'
import { openDatabase } from './db.js'

try { process.loadEnvFile() } catch { /* The audit also works with default local paths. */ }

interface LineRow {
  song_id: number
  title: string
  line_index: number
  original_text: string
  ruby_json: string
}

interface RubySegment {
  text?: string
  ruby?: string
}

const hanPattern = /[\p{Script=Han}々〆ヵヶ]+/gu
const kanaPattern = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const creditPattern = /^(?:作词|作詞|作曲|编曲|編曲|制作人|演唱|歌手|lyricist|lyrics|composer|arranger|producer)\s*[:：]/iu

const config = loadConfig()
const database = openDatabase(config.databasePath)
const rows = database.prepare(`
  SELECT s.id AS song_id, coalesce(s.title_zh, s.title_ja, s.title_en, s.title_romaji, 'Untitled') AS title,
    ll.line_index, ll.original_text, ll.ruby_json
  FROM lyric_line ll
  JOIN lyric l ON l.id = ll.lyric_id
  JOIN song s ON s.id = l.song_id
  WHERE l.is_current = 1 AND l.language_code = 'ja'
  ORDER BY s.id, ll.line_index
`).all() as unknown as LineRow[]

const unresolved: Array<{ songId: number; title: string; lineIndex: number; text: string; fragments: string[] }> = []
for (const row of rows) {
  if (creditPattern.test(row.original_text.trim())) continue
  if (!kanaPattern.test(row.original_text) || /[（(]\s*ﾟ∀ﾟ\s*[）)]?o彡/u.test(row.original_text)) continue
  let segments: RubySegment[]
  try {
    segments = JSON.parse(row.ruby_json || '[]') as RubySegment[]
  } catch {
    segments = [{ text: row.original_text }]
  }
  const fragments = [...new Set(segments
    .filter((segment) => !segment.ruby)
    .flatMap((segment) => [...(segment.text ?? '').matchAll(hanPattern)].map((match) => match[0])))]
  if (fragments.length) unresolved.push({ songId: row.song_id, title: row.title, lineIndex: row.line_index, text: row.original_text, fragments })
}

const fragmentCounts = new Map<string, number>()
for (const item of unresolved) {
  for (const fragment of item.fragments) fragmentCounts.set(fragment, (fragmentCounts.get(fragment) ?? 0) + 1)
}

console.log(JSON.stringify({
  japaneseLines: rows.length,
  unresolvedLines: unresolved.length,
  unresolvedFragments: unresolved.reduce((count, item) => count + item.fragments.length, 0),
  frequentFragments: [...fragmentCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 250)
    .map(([text, count]) => ({ text, count })),
  samples: unresolved.slice(0, 100),
}, null, 2))
database.close()
