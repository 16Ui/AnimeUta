import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { parseFile } from 'music-metadata'
import type { AuthUser } from './auth.js'
import { loadConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'
import { JapaneseStudyAnalyzer, TomoshiDictionary } from './japanese-study.js'
import { MediaService, audioExtensions, mimeByExtension, type SavedUpload } from './media.js'
import { detectLyricsLanguage, normalizeParallelLyrics, parseLyrics } from './lyrics.js'
import { SongService } from './songs.js'
import { StudyService } from './study.js'
import { externalAudioUri } from './audio-storage.js'

try { process.loadEnvFile() } catch { /* Environment variables are optional for local imports. */ }

const sourceArgument = process.argv.find((argument) => argument.startsWith('--source='))?.slice('--source='.length)
if (!sourceArgument) throw new Error('Use --source=<music-directory> to select a library directory.')

const sourceRoot = resolve(sourceArgument)
if (!existsSync(sourceRoot)) throw new Error(`Music directory does not exist: ${sourceRoot}`)

const dryRun = process.argv.includes('--dry-run')
const copyAudio = process.argv.includes('--copy-audio')
const projectRoot = resolve(process.cwd(), '..')
const reportRoot = join(projectRoot, 'reports', 'imports')
const config = loadConfig()
const database = openDatabase(config.databasePath)
runMigrations(database)
const media = new MediaService(database, config)
const songs = new SongService(database, config, media)
const study = new StudyService(database, songs, new JapaneseStudyAnalyzer(new TomoshiDictionary(config.dictionaryPath)))

interface ImportReportItem {
  source: string
  status: 'imported' | 'duplicate' | 'failed' | 'scanned'
  checksum?: string
  songId?: number
  title?: string
  artist?: string
  languageCode?: string
  durationSeconds?: number
  lyricLines?: number
  translatedLines?: number
  romajiLines?: number
  correctedCharacters?: number
  resolvedWords?: number
  unresolvedWords?: number
  error?: string
}

function visit(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return visit(path)
    return entry.isFile() && audioExtensions.has(extname(entry.name).toLowerCase()) ? [path] : []
  })
}

function filenameFallback(path: string): { title: string; artist?: string } {
  const stem = basename(path, extname(path)).trim()
  const separator = stem.lastIndexOf(' - ')
  if (separator <= 0) return { title: stem }
  return { title: stem.slice(0, separator).trim(), artist: stem.slice(separator + 3).trim() }
}

function detectLanguage(title: string, artist: string | undefined, lyricText: string): string {
  const lines = lyricText ? normalizeParallelLyrics(parseLyrics(lyricText)) : []
  return detectLyricsLanguage(lines, title, artist ?? '')
}

const japaneseCharacterMap: Record<string, string> = {
  '强': '強', '终': '終', '时': '時', '场': '場', '纺': '紡', '确': '確', '绿': '緑',
  '鸟': '鳥', '经': '経', '权': '権', '组': '組', '乐': '楽', '颂': '頌', '梦': '夢', '爱': '愛',
}

function normalizeJapaneseText(value: string): { text: string; corrections: number } {
  let corrections = 0
  const text = [...value].map((character) => {
    const replacement = japaneseCharacterMap[character]
    if (!replacement) return character
    corrections += 1
    return replacement
  }).join('')
  return { text, corrections }
}

async function checksum(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function owner(): AuthUser {
  const row = database.prepare(`
    SELECT id, email, display_name, role, preferred_language, timezone
    FROM app_user WHERE role = 'owner' ORDER BY id LIMIT 1
  `).get() as Record<string, unknown> | undefined
  if (!row) throw new Error('Create an owner account before importing a library.')
  return {
    id: Number(row.id), email: String(row.email), displayName: String(row.display_name), role: 'owner',
    preferredLanguage: String(row.preferred_language ?? 'zh-CN'), timezone: String(row.timezone ?? 'Asia/Shanghai'),
  }
}

function calibrateLyricText(songId: number, languageCode: string): number {
  if (languageCode !== 'ja') return 0
  const rows = database.prepare(`
    SELECT ll.id, ll.original_text
    FROM lyric_line ll JOIN lyric l ON l.id = ll.lyric_id
    WHERE l.song_id = ? AND l.is_current = 1
  `).all(songId) as Array<{ id: number; original_text: string }>
  const update = database.prepare('UPDATE lyric_line SET original_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
  let corrections = 0
  for (const row of rows) {
    const normalized = normalizeJapaneseText(row.original_text)
    corrections += normalized.corrections
    if (normalized.text !== row.original_text) update.run(normalized.text, row.id)
  }
  if (corrections > 0) {
    const lyric = database.prepare('SELECT id FROM lyric WHERE song_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1').get(songId) as { id: number } | undefined
    if (lyric) {
      const text = (database.prepare('SELECT original_text FROM lyric_line WHERE lyric_id = ? ORDER BY line_index').all(lyric.id) as Array<{ original_text: string }>).map((line) => line.original_text).join('\n')
      database.prepare('UPDATE lyric SET original_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(text, lyric.id)
    }
  }
  return corrections
}

async function calibrateSong(songId: number, title: string, languageCode: string, user: AuthUser): Promise<Partial<ImportReportItem>> {
  const normalizedTitle = languageCode === 'ja' ? normalizeJapaneseText(title).text : title
  database.prepare('UPDATE song SET title_ja = ?, language_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(normalizedTitle, languageCode, songId)
  const correctedCharacters = calibrateLyricText(songId, languageCode)
  const lyric = database.prepare('SELECT id FROM lyric WHERE song_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1').get(songId) as { id: number } | undefined
  let resolvedWords = 0
  let unresolvedWords = 0
  if (lyric && languageCode === 'ja') {
    const sourceLines = database.prepare('SELECT line_index, original_text FROM lyric_line WHERE lyric_id = ? ORDER BY line_index').all(lyric.id) as Array<{ line_index: number; original_text: string }>
    const annotations = await study.annotateLines(sourceLines.map((line) => ({ lineIndex: line.line_index, text: line.original_text })))
    const update = database.prepare(`
      UPDATE lyric_line
      SET ruby_json = CASE WHEN ruby_json IS NULL OR ruby_json = '' THEN ? ELSE ruby_json END,
          romaji_text = CASE WHEN romaji_text IS NULL OR romaji_text = '' THEN ? ELSE romaji_text END,
          updated_at = CURRENT_TIMESTAMP
      WHERE lyric_id = ? AND line_index = ?
    `)
    for (const annotation of annotations) update.run(JSON.stringify(annotation.ruby), annotation.romaji || null, lyric.id, annotation.lineIndex)
    const analysis = (await study.tokenizeSong(user, songId)).analysis
    resolvedWords = analysis.resolved
    unresolvedWords = analysis.unresolved
  }
  const counts = lyric ? database.prepare(`
    SELECT count(*) AS lyric_lines,
      sum(CASE WHEN translated_text IS NOT NULL AND translated_text <> '' THEN 1 ELSE 0 END) AS translated_lines,
      sum(CASE WHEN romaji_text IS NOT NULL AND romaji_text <> '' THEN 1 ELSE 0 END) AS romaji_lines
    FROM lyric_line WHERE lyric_id = ?
  `).get(lyric.id) as { lyric_lines: number; translated_lines: number; romaji_lines: number } : undefined
  return {
    title: normalizedTitle, correctedCharacters, lyricLines: counts?.lyric_lines ?? 0,
    translatedLines: counts?.translated_lines ?? 0, romajiLines: counts?.romaji_lines ?? 0,
    resolvedWords, unresolvedWords,
  }
}

async function run(): Promise<void> {
  mkdirSync(reportRoot, { recursive: true })
  mkdirSync(join(config.mediaRoot, 'audio'), { recursive: true })
  const user = owner()
  const paths = visit(sourceRoot).sort((left, right) => left.localeCompare(right, 'ja'))
  const existingByChecksum = new Map((database.prepare('SELECT id, audio_checksum FROM song WHERE audio_checksum IS NOT NULL').all() as Array<{ id: number; audio_checksum: string }>).map((row) => [row.audio_checksum, row.id]))
  const report: ImportReportItem[] = []

  for (const [index, path] of paths.entries()) {
    const relativeSource = path.slice(sourceRoot.length + 1)
    let copiedPath: string | undefined
    try {
      const metadata = await parseFile(path, { duration: true })
      const fallback = filenameFallback(path)
      const title = metadata.common.title?.trim() || fallback.title
      const artist = metadata.common.artist?.trim() || fallback.artist
      const lyricText = metadata.common.lyrics?.[0]?.text?.trim() || metadata.common.lyrics?.[0]?.syncText?.map((line) => line.text).join('\n') || ''
      const languageCode = detectLanguage(title, artist, lyricText)
      const digest = await checksum(path)
      const base: ImportReportItem = {
        source: relativeSource, status: dryRun ? 'scanned' : 'imported', checksum: digest, title,
        ...(artist ? { artist } : {}), languageCode,
        ...(metadata.format.duration ? { durationSeconds: Math.round(metadata.format.duration) } : {}),
      }
      const existingSongId = existingByChecksum.get(digest)
      if (existingSongId) {
        const calibration = dryRun ? {} : await calibrateSong(existingSongId, title, languageCode, user)
        report.push({ ...base, ...calibration, songId: existingSongId, status: 'duplicate' })
        console.log(`[${index + 1}/${paths.length}] duplicate ${relativeSource}`)
        continue
      }
      if (dryRun) {
        report.push(base)
        console.log(`[${index + 1}/${paths.length}] scan ${relativeSource}`)
        continue
      }

      const extension = extname(path).toLowerCase()
      const storedName = `${Date.now()}-${randomBytes(10).toString('base64url')}${extension}`
      const relativePath = `audio/${storedName}`
      if (copyAudio) {
        copiedPath = join(config.mediaRoot, relativePath)
        copyFileSync(path, copiedPath)
      }
      const audio: SavedUpload = {
        relativePath: copyAudio ? relativePath : externalAudioUri(path, config), absolutePath: copiedPath ?? path, originalFilename: basename(path),
        mimeType: mimeByExtension[extension] ?? 'application/octet-stream', sizeBytes: statSync(path).size, checksum: digest,
      }
      const normalizedTitle = languageCode === 'ja' ? normalizeJapaneseText(title).text : title
      const created = await songs.create(user, { audio, title: normalizedTitle, ...(artist ? { artistName: artist } : {}), languageCode })
      const songId = Number(created.song.id)
      const calibration = await calibrateSong(songId, normalizedTitle, languageCode, user)
      report.push({
        ...base, ...calibration, songId,
      })
      existingByChecksum.set(digest, songId)
      console.log(`[${index + 1}/${paths.length}] imported #${songId} ${title}`)
    } catch (error) {
      if (copiedPath) rmSync(copiedPath, { force: true })
      const message = error instanceof Error ? error.message : String(error)
      report.push({ source: relativeSource, status: 'failed', error: message })
      console.error(`[${index + 1}/${paths.length}] failed ${relativeSource}: ${message}`)
    }
  }

  const summary = {
    sourceRoot, dryRun, createdAt: new Date().toISOString(), total: paths.length,
    imported: report.filter((item) => item.status === 'imported').length,
    duplicates: report.filter((item) => item.status === 'duplicate').length,
    failed: report.filter((item) => item.status === 'failed').length,
    withLyrics: report.filter((item) => (item.lyricLines ?? 0) > 0).length,
    withTranslation: report.filter((item) => (item.translatedLines ?? 0) > 0).length,
    withRomaji: report.filter((item) => (item.romajiLines ?? 0) > 0).length,
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = join(reportRoot, `vocaloid-library-${timestamp}.json`)
  writeFileSync(reportPath, JSON.stringify({ summary, items: report }, null, 2), 'utf8')
  console.log(JSON.stringify({ summary, reportPath }, null, 2))
}

try {
  await run()
} finally {
  study.close()
  database.close()
}
