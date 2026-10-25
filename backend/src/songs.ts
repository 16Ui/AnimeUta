import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { parseFile, type IAudioMetadata, type IPicture } from 'music-metadata'
import type { AuthUser } from './auth.js'
import type { AppConfig } from './config.js'
import type { SqliteDatabase } from './db.js'
import { nowIso } from './db.js'
import { assertApp } from './errors.js'
import { normalizeParallelLyrics, parseLyrics, parseRubyMarkup, type ParsedLyricLine } from './lyrics.js'
import { normalizeImageUri, type MediaService, type SavedUpload } from './media.js'

interface SongRow {
  id: number
  title_ja: string | null
  title_zh: string | null
  title_en: string | null
  title_romaji: string | null
  duration_seconds: number | null
  language_code: string
  release_date: string | null
  cover_url: string | null
  audio_source_type: string
  audio_source_uri: string | null
  submitted_by: number | null
  review_status: 'pending' | 'approved' | 'rejected' | 'needs_revision'
  visibility: 'private' | 'shared'
  review_note: string | null
  version_type: string | null
  publisher_id: number | null
  label_id: number | null
  version_group_id: number | null
  created_at: string
  updated_at: string
  primary_artist_name?: string | null
  primary_work_title?: string | null
}

export interface CreateSongInput {
  signal?: AbortSignal
  importSessionId?: number
  title?: string
  languageCode?: string
  artistName?: string | null
  albumTitle?: string | null
  workTitle?: string | null
  audio?: SavedUpload
  cover?: SavedUpload
  lyricsText?: string
  lyricsFilename?: string
  lyricsSourceRef?: string
}

export interface SongMetadataInput {
  songCoverUrl?: string
  artistName?: string
  artistAvatarUrl?: string
  workTitle?: string
  workCoverUrl?: string
  workRelationType?: string
  albumTitle?: string
  albumCoverUrl?: string
  publisherName?: string
  labelName?: string
  versionType?: string
  versionGroupTitle?: string
  songAliases: string[]
  artistAliases: string[]
  workAliases: string[]
  albumAliases: string[]
  creators: Array<{ name: string; role: string; creatorType?: string }>
  characters: Array<{ name: string; relationType?: string; voiceActorNames: string[] }>
}

export interface LyricLineUpdateInput {
  id: number
  originalText: string
  translatedText?: string | null
  romajiText?: string | null
  startMs?: number | null
  endMs?: number | null
}

function firstText(...values: Array<string | null | undefined>): string | undefined {
  return values.find((value) => value?.trim())?.trim()
}

function displaySongTitle(row: SongRow): string {
  return firstText(row.title_zh, row.title_ja, row.title_en, row.title_romaji) || `Song ${row.id}`
}

function imageExtension(picture: IPicture): string {
  if (picture.format.includes('png')) return '.png'
  if (picture.format.includes('webp')) return '.webp'
  if (picture.format.includes('gif')) return '.gif'
  return '.jpg'
}

function parseFilename(filename: string): { artist?: string; title: string } {
  const stem = basename(filename, extname(filename)).trim()
  const separator = stem.indexOf(' - ')
  if (separator < 0) return { title: stem }
  return { artist: stem.slice(0, separator).trim(), title: stem.slice(separator + 3).trim() }
}

export class SongService {
  private lyricAnalysisHandler?: (user: AuthUser, songId: number) => Promise<unknown>

  constructor(
    private readonly database: SqliteDatabase,
    private readonly config: AppConfig,
    private readonly media: MediaService,
  ) {}

  setLyricAnalysisHandler(handler: (user: AuthUser, songId: number) => Promise<unknown>): void {
    this.lyricAnalysisHandler = handler
  }

  private scheduleLyricAnalysis(user: AuthUser, songId: number): void {
    if (!this.lyricAnalysisHandler) return
    void this.lyricAnalysisHandler(user, songId).catch(() => undefined)
  }

  summary(user: AuthUser, songId: number) {
    this.getVisibleSong(user, songId)
    const row = this.database.prepare(`
      SELECT s.*,
        (SELECT coalesce(a.name_zh, a.name_ja, a.name_en, a.name_romaji)
         FROM song_artist sa JOIN artist a ON a.id = sa.artist_id
         WHERE sa.song_id = s.id ORDER BY sa.sort_order LIMIT 1) AS primary_artist_name,
        (SELECT coalesce(w.title_zh, w.title_ja, w.title_en, w.title_romaji)
         FROM song_work sw JOIN work w ON w.id = sw.work_id
         WHERE sw.song_id = s.id ORDER BY sw.sort_order LIMIT 1) AS primary_work_title
      FROM song s WHERE s.id = ?
    `).get(songId) as unknown as SongRow
    return this.serializeListRow(row)
  }

  assertVisible(user: AuthUser, songId: number): void {
    this.getVisibleSong(user, songId)
  }

  assertEditable(user: AuthUser, songId: number): void {
    const song = this.getVisibleSong(user, songId)
    const canEdit = user.role === 'owner' || user.role === 'admin' || song.submitted_by === user.id
    assertApp(canEdit, 403, 'forbidden', '不能修改其他用户的歌曲内容')
  }

  async inspectImport(user: AuthUser, input: CreateSongInput) {
    assertApp(input.audio, 400, 'audio_required', '请选择音频文件')
    const metadata = await parseFile(input.audio.absolutePath, { duration: true })
    const filenameParts = parseFilename(input.audio.originalFilename)
    let cover = input.cover
    if (!cover && metadata.common.picture?.[0]) cover = this.saveEmbeddedCoverAsUpload(metadata.common.picture[0])
    const lyricsTag = metadata.common.lyrics?.[0]
    const detected = {
      title: input.title?.trim() || metadata.common.title?.trim() || filenameParts.title,
      artist: metadata.common.artist?.trim() || filenameParts.artist,
      album: metadata.common.album?.trim(),
      work: metadata.common.work?.trim(),
      durationSeconds: metadata.format.duration ? Math.round(metadata.format.duration) : undefined,
      languageCode: input.languageCode?.trim() || lyricsTag?.language || 'ja',
      releaseDate: metadata.common.date,
      composers: metadata.common.composer ?? [],
      lyricists: metadata.common.lyricist ?? [],
      arrangers: metadata.common.arranger ?? [],
      coverUrl: cover ? this.media.storedImageUri(cover.relativePath) : undefined,
      hasLyrics: Boolean(input.lyricsText?.trim() || lyricsTag?.text?.trim() || lyricsTag?.syncText?.length),
    }
    const matchedFiles = {
      audio: input.audio,
      ...(cover ? { cover } : {}),
      ...(input.lyricsSourceRef ? { lyrics: {
        relativePath: input.lyricsSourceRef,
        absolutePath: join(this.config.mediaRoot, input.lyricsSourceRef),
        originalFilename: input.lyricsFilename || basename(input.lyricsSourceRef),
        mimeType: 'text/plain', sizeBytes: 0, checksum: '',
      } satisfies SavedUpload } : {}),
      ...(input.lyricsText ? { inlineLyrics: input.lyricsText } : {}),
    }
    const result = this.database.prepare(`
      INSERT INTO import_session(requested_by, status, detected_metadata_json, matched_files_json)
      VALUES (?, 'ready', ?, ?)
    `).run(user.id, JSON.stringify(detected), JSON.stringify(matchedFiles))
    return {
      id: Number(result.lastInsertRowid), status: 'ready', detectedMetadata: detected,
      matchedFiles: [
        { kind: 'audio', name: input.audio.originalFilename },
        ...(cover ? [{ kind: 'cover', name: cover.originalFilename }] : []),
        ...(input.lyricsFilename ? [{ kind: 'lyrics', name: input.lyricsFilename }] : []),
      ],
    }
  }

  async commitImport(user: AuthUser, importId: number, overrides: {
    title?: string
    languageCode?: string
    artistName?: string | null
    albumTitle?: string | null
    workTitle?: string | null
  }) {
    const claim = this.database.prepare(`
      UPDATE import_session SET status = 'processing', error_message = NULL, updated_at = ?
      WHERE id = ? AND requested_by = ? AND status = 'ready'
    `).run(nowIso(), importId, user.id)
    if (claim.changes === 0) {
      const exists = this.database.prepare('SELECT 1 FROM import_session WHERE id = ? AND requested_by = ?').get(importId, user.id)
      assertApp(exists, 404, 'import_not_found', '导入记录不存在')
      assertApp(false, 409, 'import_not_ready', '该导入记录当前不能提交')
    }
    const row = this.database.prepare('SELECT * FROM import_session WHERE id = ?').get(importId) as Record<string, unknown>
    try {
      const metadata = JSON.parse(String(row.detected_metadata_json)) as Record<string, unknown>
      const files = JSON.parse(String(row.matched_files_json)) as { audio: SavedUpload; cover?: SavedUpload; lyrics?: SavedUpload; inlineLyrics?: string }
      const lyricsText = files.inlineLyrics || (files.lyrics ? readFileSync(files.lyrics.absolutePath, 'utf8') : undefined)
      return await this.create(user, {
        importSessionId: importId,
        title: overrides.title?.trim() || String(metadata.title || ''),
        languageCode: overrides.languageCode?.trim() || String(metadata.languageCode || 'ja'),
        ...(overrides.artistName !== undefined ? { artistName: overrides.artistName } : {}),
        ...(overrides.albumTitle !== undefined ? { albumTitle: overrides.albumTitle } : {}),
        ...(overrides.workTitle !== undefined ? { workTitle: overrides.workTitle } : {}),
        audio: files.audio,
        ...(files.cover ? { cover: files.cover } : {}),
        ...(lyricsText ? { lyricsText } : {}),
        ...(files.lyrics ? { lyricsFilename: files.lyrics.originalFilename, lyricsSourceRef: files.lyrics.relativePath } : {}),
      })
    } catch (error) {
      this.database.prepare(`
        UPDATE import_session SET status = 'ready', error_message = ?, updated_at = ?
        WHERE id = ? AND requested_by = ? AND status = 'processing'
      `).run(error instanceof Error ? error.message : String(error), nowIso(), importId, user.id)
      throw error
    }
  }

  discardImport(user: AuthUser, importId: number): { ok: true } {
    const row = this.database.prepare('SELECT status, matched_files_json FROM import_session WHERE id = ? AND requested_by = ?').get(importId, user.id) as { status: string; matched_files_json: string } | undefined
    assertApp(row, 404, 'import_not_found', '导入记录不存在')
    if (row.status === 'ready') {
      this.removeImportFiles(row.matched_files_json)
      this.database.prepare("UPDATE import_session SET status = 'abandoned', updated_at = ? WHERE id = ?").run(nowIso(), importId)
    }
    return { ok: true }
  }

  recoverInterruptedImports(): number {
    return Number(this.database.prepare(`
      UPDATE import_session SET status = 'ready', error_message = NULL, updated_at = ?
      WHERE status = 'processing'
    `).run(nowIso()).changes)
  }

  cleanupAbandonedImports(): number {
    const rows = this.database.prepare(`
      SELECT id, matched_files_json FROM import_session
      WHERE status = 'ready' AND datetime(created_at) < datetime('now', '-1 day')
    `).all() as Array<{ id: number; matched_files_json: string }>
    for (const row of rows) {
      this.removeImportFiles(row.matched_files_json)
      this.database.prepare("UPDATE import_session SET status = 'abandoned', updated_at = ? WHERE id = ?").run(nowIso(), row.id)
    }
    return rows.length
  }

  list(user: AuthUser, input: { page: number; pageSize: number; keyword?: string }) {
    const page = Math.max(1, input.page)
    const pageSize = Math.min(100, Math.max(1, input.pageSize))
    const conditions = ["(s.review_status = 'approved' AND s.visibility = 'shared') OR s.submitted_by = ?"]
    const parameters: Array<string | number> = [user.id]
    if (input.keyword?.trim()) {
      conditions.push(`(
        s.title_ja LIKE ? OR s.title_zh LIKE ? OR s.title_en LIKE ? OR s.title_romaji LIKE ?
        OR EXISTS (SELECT 1 FROM song_alias sa WHERE sa.song_id = s.id AND sa.alias_text LIKE ?)
      )`)
      const pattern = `%${input.keyword.trim()}%`
      parameters.push(pattern, pattern, pattern, pattern, pattern)
    }
    const where = conditions.map((condition) => `(${condition})`).join(' AND ')
    const count = this.database.prepare(`SELECT count(*) AS count FROM song s WHERE ${where}`).get(...parameters) as { count: number }
    const rows = this.database.prepare(`
      SELECT s.*,
        (SELECT coalesce(a.name_zh, a.name_ja, a.name_en, a.name_romaji)
         FROM song_artist sa JOIN artist a ON a.id = sa.artist_id
         WHERE sa.song_id = s.id ORDER BY sa.sort_order LIMIT 1) AS primary_artist_name,
        (SELECT coalesce(w.title_zh, w.title_ja, w.title_en, w.title_romaji)
         FROM song_work sw JOIN work w ON w.id = sw.work_id
         WHERE sw.song_id = s.id ORDER BY sw.sort_order LIMIT 1) AS primary_work_title
      FROM song s WHERE ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?
    `).all(...parameters, pageSize, (page - 1) * pageSize) as unknown as SongRow[]
    return {
      data: rows.map((row) => this.serializeListRow(row)),
      pagination: { page, page_size: pageSize, total: count.count },
    }
  }

  detail(user: AuthUser, songId: number) {
    const row = this.getVisibleSong(user, songId)
    const artists = this.database.prepare(`
      SELECT a.*, sa.artist_role, sa.sort_order FROM song_artist sa JOIN artist a ON a.id = sa.artist_id
      WHERE sa.song_id = ? ORDER BY sa.sort_order
    `).all(songId) as Array<Record<string, unknown>>
    const works = this.database.prepare(`
      SELECT w.*, sw.relation_type, sw.sort_order FROM song_work sw JOIN work w ON w.id = sw.work_id
      WHERE sw.song_id = ? ORDER BY sw.sort_order
    `).all(songId) as Array<Record<string, unknown>>
    const albums = this.database.prepare(`
      SELECT a.*, als.disc_no, als.track_no FROM album_song als JOIN album a ON a.id = als.album_id
      WHERE als.song_id = ? ORDER BY als.disc_no, als.track_no
    `).all(songId) as Array<Record<string, unknown>>
    const creators = this.database.prepare(`
      SELECT c.*, sc.role, sc.sort_order FROM song_creator sc JOIN creator c ON c.id = sc.creator_id
      WHERE sc.song_id = ? ORDER BY sc.sort_order
    `).all(songId) as Array<Record<string, unknown>>
    const characters = this.database.prepare(`
      SELECT c.*, sc.relation_type, sc.sort_order FROM song_character sc JOIN acg_character c ON c.id = sc.character_id
      WHERE sc.song_id = ? ORDER BY sc.sort_order
    `).all(songId) as Array<Record<string, unknown>>
    const songAliases = this.database.prepare('SELECT alias_text FROM song_alias WHERE song_id = ? ORDER BY alias_text').all(songId) as Array<{ alias_text: string }>
    const primaryArtistName = artists[0]
      ? firstText(artists[0].name_zh as string, artists[0].name_ja as string, artists[0].name_en as string, artists[0].name_romaji as string)
      : undefined
    const primaryWorkTitle = works[0]
      ? firstText(works[0].title_zh as string, works[0].title_ja as string, works[0].title_en as string, works[0].title_romaji as string)
      : undefined
    return {
      ...this.serializeListRow(row),
      ...(primaryArtistName ? { primaryArtistName } : {}),
      ...(primaryWorkTitle ? { primaryWorkTitle } : {}),
      submittedBy: row.submitted_by ?? undefined,
      reviewStatus: row.review_status,
      visibility: row.visibility === 'shared' ? 'public' : 'private',
      reviewNote: row.review_note ?? undefined,
      versionType: row.version_type ?? undefined,
      aliases: songAliases.map((item) => item.alias_text),
      artists: artists.map((item) => ({
        id: item.id, nameJa: item.name_ja ?? undefined, nameZh: item.name_zh ?? undefined,
        nameEn: item.name_en ?? undefined, nameRomaji: item.name_romaji ?? undefined,
        displayName: firstText(item.name_zh as string, item.name_ja as string, item.name_en as string, item.name_romaji as string),
        avatarUrl: item.avatar_url ?? undefined,
        aliases: (this.database.prepare('SELECT alias_text FROM artist_alias WHERE artist_id = ? ORDER BY alias_text').all(item.id as number) as Array<{ alias_text: string }>).map((alias) => alias.alias_text),
      })),
      works: works.map((item) => ({
        id: item.id, titleJa: item.title_ja ?? undefined, titleZh: item.title_zh ?? undefined,
        titleEn: item.title_en ?? undefined, titleRomaji: item.title_romaji ?? undefined,
        displayTitle: firstText(item.title_zh as string, item.title_ja as string, item.title_en as string, item.title_romaji as string),
        coverUrl: item.cover_url ?? undefined, relationType: item.relation_type,
        aliases: (this.database.prepare('SELECT alias_text FROM work_alias WHERE work_id = ? ORDER BY alias_text').all(item.id as number) as Array<{ alias_text: string }>).map((alias) => alias.alias_text),
      })),
      albums: albums.map((item) => ({
        id: item.id, titleJa: item.title_ja ?? undefined, titleZh: item.title_zh ?? undefined,
        titleEn: item.title_en ?? undefined, titleRomaji: item.title_romaji ?? undefined,
        displayTitle: firstText(item.title_zh as string, item.title_ja as string, item.title_en as string, item.title_romaji as string),
        coverUrl: item.cover_url ?? undefined,
        aliases: (this.database.prepare('SELECT alias_text FROM album_alias WHERE album_id = ? ORDER BY alias_text').all(item.id as number) as Array<{ alias_text: string }>).map((alias) => alias.alias_text),
      })),
      creators: creators.map((item) => ({
        id: item.id, name: item.name, nameJa: item.name_ja ?? undefined, nameZh: item.name_zh ?? undefined,
        nameEn: item.name_en ?? undefined, nameRomaji: item.name_romaji ?? undefined,
        creatorType: item.creator_type ?? undefined, imageUrl: item.image_url ?? undefined,
        aliases: this.entityAliases('creator_alias', 'creator_id', Number(item.id)),
        role: item.role, sortOrder: item.sort_order,
      })),
      characters: characters.map((item) => ({
        id: item.id, workId: item.work_id ?? undefined, name: item.name, nameJa: item.name_ja ?? undefined,
        nameZh: item.name_zh ?? undefined, nameEn: item.name_en ?? undefined, nameRomaji: item.name_romaji ?? undefined,
        description: item.description ?? undefined, imageUrl: item.image_url ?? undefined,
        aliases: this.entityAliases('character_alias', 'character_id', Number(item.id)),
        relationType: item.relation_type, sortOrder: item.sort_order,
        voiceActors: this.voiceActors(Number(item.id)),
      })),
      ...(row.publisher_id ? { publisher: this.publisher(row.publisher_id) } : {}),
      ...(row.label_id ? { label: this.label(row.label_id) } : {}),
      ...(row.version_group_id ? { versionGroup: this.versionGroup(user, row.version_group_id) } : {}),
    }
  }

  async create(user: AuthUser, input: CreateSongInput, publishToSharedLibrary = false) {
    assertApp(input.audio || input.title?.trim(), 400, 'song_title_required', '请选择音频或填写歌曲标题')
    let metadata: IAudioMetadata | undefined
    if (input.audio) metadata = await parseFile(input.audio.absolutePath, { duration: true })
    const filenameParts = parseFilename(input.audio?.originalFilename ?? input.title ?? 'Untitled')
    const title = input.title?.trim() || metadata?.common.title?.trim() || filenameParts.title
    assertApp(title, 400, 'song_title_required', '无法识别歌曲标题，请手动填写')
    const artistName = input.artistName !== undefined ? input.artistName?.trim() : metadata?.common.artist?.trim() || filenameParts.artist
    const albumTitle = input.albumTitle !== undefined ? input.albumTitle?.trim() : metadata?.common.album?.trim()
    const workTitle = input.workTitle !== undefined ? input.workTitle?.trim() : metadata?.common.work?.trim()
    const durationSeconds = metadata?.format.duration ? Math.round(metadata.format.duration) : null
    const isModerator = user.role === 'owner' || user.role === 'admin'
    const publishShared = isModerator || publishToSharedLibrary
    let coverUrl = input.cover ? this.media.storedImageUri(input.cover.relativePath) : undefined
    if (!coverUrl && metadata?.common.picture?.[0]) coverUrl = this.saveEmbeddedCover(metadata.common.picture[0])
    const embeddedLyrics = metadata?.common.lyrics?.[0]
    const lyricsText = input.lyricsText?.trim() || embeddedLyrics?.text?.trim()
    const embeddedLines = embeddedLyrics?.syncText?.length
      ? normalizeParallelLyrics(embeddedLyrics.syncText.map((line, lineIndex) => ({
          lineIndex,
          ...(line.timestamp !== undefined ? { startMs: line.timestamp } : {}),
          originalText: line.text,
        })))
      : undefined
    const sourceMetadata = metadata ? {
      title: metadata.common.title, artist: metadata.common.artist, album: metadata.common.album,
      work: metadata.common.work, composer: metadata.common.composer, lyricist: metadata.common.lyricist,
      arranger: metadata.common.arranger, year: metadata.common.year, originalFilename: input.audio?.originalFilename,
    } : {}

    input.signal?.throwIfAborted()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = this.database.prepare(`
        INSERT INTO song(
          title_ja, duration_seconds, language_code, release_date, cover_url, audio_source_uri,
          audio_mime_type, audio_size_bytes, audio_checksum, submitted_by, review_status, visibility, source_metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        title, durationSeconds, input.languageCode?.trim() || embeddedLyrics?.language || 'ja',
        metadata?.common.date ?? null, coverUrl ?? null, input.audio?.relativePath ?? null,
        input.audio?.mimeType ?? null, input.audio?.sizeBytes ?? null, input.audio?.checksum ?? null,
        user.id, 'approved', publishShared ? 'shared' : 'private', JSON.stringify(sourceMetadata),
      )
      const songId = Number(result.lastInsertRowid)
      if (artistName) this.linkArtist(songId, artistName)
      if (albumTitle) this.linkAlbum(songId, albumTitle, metadata?.common.track.no ?? 1, coverUrl)
      if (workTitle) this.linkWork(songId, workTitle, coverUrl)
      this.linkCreators(songId, metadata)
      if (lyricsText || embeddedLines?.length) {
        const lines = embeddedLines?.length ? embeddedLines : parseLyrics(lyricsText!, input.lyricsFilename)
        this.createLyric(songId, user, lyricsText || lines.map((line) => line.originalText).join('\n'), lines, input.lyricsSourceRef, publishShared, input.languageCode?.trim() || embeddedLyrics?.language || 'ja')
      }
      if (input.importSessionId !== undefined) {
        const committed = this.database.prepare(`
          UPDATE import_session SET status = 'committed', error_message = NULL, updated_at = ?
          WHERE id = ? AND requested_by = ? AND status = 'processing'
        `).run(nowIso(), input.importSessionId, user.id)
        assertApp(committed.changes === 1, 409, 'import_not_ready', '该导入记录当前不能提交')
      }
      this.database.exec('COMMIT')
      if (lyricsText || embeddedLines?.length) this.scheduleLyricAnalysis(user, songId)
      return { song: this.detail(user, songId), ...(lyricsText || embeddedLines?.length ? { lyric: this.currentLyrics(user, songId) } : {}) }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  currentLyrics(user: AuthUser, songId: number) {
    const song = this.getVisibleSong(user, songId)
    const isModerator = user.role === 'owner' || user.role === 'admin'
    const includePrivateReviewDraft = isModerator && song.visibility === 'private' && song.review_status !== 'approved'
    const lyric = this.database.prepare(`
      SELECT * FROM lyric
      WHERE song_id = ? AND is_current = 1
        AND (visibility = 'shared' OR uploaded_by = ? OR ? = 1)
      ORDER BY CASE
        WHEN uploaded_by = ? AND visibility = 'private' THEN 0
        WHEN visibility = 'shared' THEN 1
        ELSE 2
      END, created_at DESC LIMIT 1
    `).get(songId, user.id, includePrivateReviewDraft ? 1 : 0, user.id) as Record<string, unknown> | undefined
    if (!lyric) return { songId, sourceType: 'none', lines: [] }
    return this.serializeLyric(lyric)
  }

  async replaceAudio(user: AuthUser, songId: number, audio: SavedUpload) {
    const row = this.getVisibleSong(user, songId)
    assertApp(user.role === 'owner' || user.role === 'admin' || row.submitted_by === user.id, 403, 'forbidden', '不能修改其他用户的歌曲')
    const metadata = await parseFile(audio.absolutePath, { duration: true })
    const durationSeconds = metadata.format.duration ? Math.round(metadata.format.duration) : null
    this.database.prepare(`
      UPDATE song SET audio_source_uri = ?, audio_mime_type = ?, audio_size_bytes = ?, audio_checksum = ?,
        duration_seconds = coalesce(?, duration_seconds), updated_at = ? WHERE id = ?
    `).run(audio.relativePath, audio.mimeType, audio.sizeBytes, audio.checksum, durationSeconds, nowIso(), songId)
    if (row.audio_source_uri) this.removeMedia(row.audio_source_uri)
    return {
      audioSourceType: 'personal_library',
      audioSourceUri: this.media.createStreamUrl(songId),
      ...(durationSeconds !== null ? { durationSeconds } : {}),
    }
  }

  uploadLyrics(user: AuthUser, songId: number, content: string, filename: string, languageCode: string, sourceRef?: string) {
    this.getVisibleSong(user, songId)
    const lines = parseLyrics(content, filename)
    assertApp(lines.length > 0, 400, 'lyrics_empty', '歌词文件中没有可识别的文本')
    const approved = user.role === 'owner' || user.role === 'admin'
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.createLyric(songId, user, content, lines, sourceRef, approved, languageCode)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    this.scheduleLyricAnalysis(user, songId)
    return this.currentLyrics(user, songId)
  }

  listLyricVersions(user: AuthUser, songId: number) {
    const song = this.getVisibleSong(user, songId)
    const isModerator = user.role === 'owner' || user.role === 'admin'
    const includeSongReviewDrafts = isModerator && song.visibility === 'private' && song.review_status !== 'approved'
    const rows = this.database.prepare(`
      SELECT l.*, (SELECT count(*) FROM lyric_line ll WHERE ll.lyric_id = l.id) AS line_count
      FROM lyric l
      WHERE l.song_id = ? AND (
        l.visibility = 'shared' OR l.uploaded_by = ?
        OR (? = 1 AND l.review_requested_at IS NOT NULL)
        OR ? = 1
      )
      ORDER BY l.created_at DESC
    `).all(songId, user.id, isModerator ? 1 : 0, includeSongReviewDrafts ? 1 : 0) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id, songId: row.song_id, languageCode: row.language_code, sourceType: row.source_type,
      reviewStatus: row.review_status, visibility: row.visibility === 'shared' ? 'public' : 'private',
      isCurrent: Boolean(row.is_current), versionLabel: row.version_label ?? undefined,
      sourceRef: row.source_ref ?? undefined, reviewNote: row.review_note ?? undefined,
      uploadedBy: row.uploaded_by ?? undefined, reviewedBy: row.reviewed_by ?? undefined,
      reviewedAt: row.reviewed_at ?? undefined, reviewRequestedAt: row.review_requested_at ?? undefined,
      lineCount: row.line_count, createdAt: row.created_at,
    }))
  }

  requestLyricReview(user: AuthUser, lyricId: number) {
    const lyric = this.getVisibleLyric(user, lyricId)
    assertApp(lyric.uploaded_by === user.id, 404, 'lyric_not_found', '歌词不存在')
    assertApp(lyric.visibility === 'private', 409, 'review_request_unavailable', '共享歌词不需要重复提交审核')
    const song = this.getVisibleSong(user, lyric.song_id)
    assertApp(song.review_status === 'approved' && song.visibility === 'shared', 409, 'review_request_unavailable', '只有共享歌曲的私人歌词可以单独提交审核')
    const now = nowIso()
    this.database.prepare(`
      UPDATE lyric SET review_status = 'pending', review_requested_at = ?, review_note = NULL,
        reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?
    `).run(now, now, lyricId)
    return this.listLyricVersions(user, lyric.song_id).find((item) => item.id === lyricId)
  }

  reviewLyrics(user: AuthUser, lyricId: number, status: string, reviewNote?: string) {
    assertApp(['approved', 'rejected', 'needs_revision', 'pending'].includes(status), 400, 'invalid_review_status', '审核状态无效')
    const lyric = this.database.prepare(`
      SELECT l.*, s.review_status AS song_review_status, s.visibility AS song_visibility
      FROM lyric l JOIN song s ON s.id = l.song_id WHERE l.id = ?
    `).get(lyricId) as Record<string, unknown> | undefined
    assertApp(lyric, 404, 'lyric_not_found', '歌词不存在')
    this.getVisibleSong(user, Number(lyric.song_id))
    assertApp(lyric.review_requested_at && lyric.song_review_status === 'approved' && lyric.song_visibility === 'shared', 404, 'lyric_not_found', '歌词不存在')
    const now = nowIso()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (status === 'approved') this.database.prepare("UPDATE lyric SET is_current = 0 WHERE song_id = ? AND visibility = 'shared'").run(Number(lyric.song_id))
      this.database.prepare(`
        UPDATE lyric SET review_status = ?, visibility = ?, is_current = 1, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(status, status === 'approved' ? 'shared' : 'private', reviewNote?.trim() || null, user.id, now, now, lyricId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.listLyricVersions(user, Number(lyric.song_id)).find((item) => item.id === lyricId)
  }

  listLyricsForReview(user: AuthUser, status: string, limit: number) {
    assertApp(['pending', 'approved', 'rejected', 'needs_revision'].includes(status), 400, 'invalid_review_status', '审核状态无效')
    const rows = this.database.prepare(`
      SELECT l.*, s.cover_url, s.title_ja, s.title_zh, s.title_en, s.title_romaji,
        u.email AS uploader_email, coalesce(u.display_name, u.email) AS uploader_name,
        (SELECT count(*) FROM lyric_line ll WHERE ll.lyric_id = l.id) AS line_count
      FROM lyric l
      JOIN song s ON s.id = l.song_id
      LEFT JOIN app_user u ON u.id = l.uploaded_by
      WHERE l.review_status = ?
        AND l.review_requested_at IS NOT NULL
        AND ((s.review_status = 'approved' AND s.visibility = 'shared')
          OR (s.visibility = 'private' AND s.review_status <> 'approved')
          OR s.submitted_by = ?)
      ORDER BY l.created_at DESC LIMIT ?
    `).all(status, user.id, Math.min(100, Math.max(1, limit))) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id, songId: row.song_id,
      songTitle: firstText(row.title_zh as string, row.title_ja as string, row.title_en as string, row.title_romaji as string),
      songCoverUrl: row.cover_url ?? undefined, languageCode: row.language_code, sourceType: row.source_type,
      reviewStatus: row.review_status, visibility: row.visibility === 'shared' ? 'public' : 'private',
      isCurrent: Boolean(row.is_current), versionLabel: row.version_label ?? undefined,
      reviewNote: row.review_note ?? undefined, uploadedBy: row.uploaded_by ?? undefined,
      uploaderName: row.uploader_name ?? undefined, uploaderEmail: row.uploader_email ?? undefined,
      lineCount: Number(row.line_count), createdAt: row.created_at,
    }))
  }

  updateLyricLines(user: AuthUser, lyricId: number, updates: LyricLineUpdateInput[]) {
    const lyric = this.database.prepare('SELECT * FROM lyric WHERE id = ?').get(lyricId) as Record<string, unknown> | undefined
    assertApp(lyric, 404, 'lyric_not_found', '歌词不存在')
    this.getVisibleSong(user, Number(lyric.song_id))
    assertApp(updates.length > 0 && updates.length <= 2000, 400, 'invalid_lyric_lines', '请选择需要修改的歌词行')
    const seen = new Set<number>()
    const currentLine = this.database.prepare('SELECT original_text, ruby_json FROM lyric_line WHERE id = ? AND lyric_id = ?')
    const update = this.database.prepare(`
      UPDATE lyric_line SET original_text = ?, ruby_json = ?, translated_text = ?, romaji_text = ?, start_ms = ?, end_ms = ?, updated_at = ?
      WHERE id = ? AND lyric_id = ?
    `)
    let shouldReanalyze = false
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const line of updates) {
        assertApp(Number.isInteger(line.id) && !seen.has(line.id), 400, 'invalid_lyric_line', '歌词行编号无效或重复')
        seen.add(line.id)
        assertApp(line.originalText.trim().length > 0, 400, 'lyric_line_empty', '歌词原文不能为空')
        const current = currentLine.get(line.id, lyricId) as { original_text: string; ruby_json: string } | undefined
        assertApp(current, 400, 'invalid_lyric_line', '歌词行不属于当前歌词')
        const parsedOriginal = parseRubyMarkup(line.originalText)
        const originalChanged = parsedOriginal.text !== current.original_text
        if (originalChanged) shouldReanalyze = true
        const rubyJson = parsedOriginal.segments.length > 0
          ? JSON.stringify(parsedOriginal.segments)
          : originalChanged ? '[]' : current.ruby_json
        const startMs = line.startMs ?? null
        const endMs = line.endMs ?? null
        assertApp(startMs === null || Number.isInteger(startMs) && startMs >= 0, 400, 'invalid_lyric_time', '歌词开始时间无效')
        assertApp(endMs === null || Number.isInteger(endMs) && endMs >= 0, 400, 'invalid_lyric_time', '歌词结束时间无效')
        assertApp(startMs === null || endMs === null || endMs >= startMs, 400, 'invalid_lyric_time', '歌词结束时间不能早于开始时间')
        const result = update.run(
          parsedOriginal.text, rubyJson, line.translatedText?.trim() || null, line.romajiText?.trim() || null,
          startMs, endMs, nowIso(), line.id, lyricId,
        )
        assertApp(result.changes > 0, 404, 'lyric_line_not_found', `歌词行 ${line.id} 不存在`)
        if (originalChanged) this.database.prepare('DELETE FROM lyric_token WHERE line_id = ?').run(line.id)
      }
      const source = this.database.prepare('SELECT original_text FROM lyric_line WHERE lyric_id = ? ORDER BY line_index').all(lyricId) as Array<{ original_text: string }>
      this.database.prepare('UPDATE lyric SET original_text = ?, updated_at = ? WHERE id = ?').run(source.map((line) => line.original_text).join('\n'), nowIso(), lyricId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    if (shouldReanalyze) this.scheduleLyricAnalysis(user, Number(lyric.song_id))
    const updated = this.database.prepare('SELECT * FROM lyric WHERE id = ?').get(lyricId) as Record<string, unknown>
    return this.serializeLyric(updated)
  }

  updateLyricTimingOffset(user: AuthUser, lyricId: number, timingOffsetMs: number) {
    const lyric = this.database.prepare('SELECT * FROM lyric WHERE id = ?').get(lyricId) as Record<string, unknown> | undefined
    assertApp(lyric, 404, 'lyric_not_found', '歌词不存在')
    this.getVisibleSong(user, Number(lyric.song_id))
    const canEdit = user.role === 'owner' || user.role === 'admin' || Number(lyric.uploaded_by) === user.id
    assertApp(canEdit, 403, 'forbidden', '不能调整其他用户的歌词时间轴')
    assertApp(Number.isInteger(timingOffsetMs) && timingOffsetMs >= -30_000 && timingOffsetMs <= 30_000, 400, 'invalid_lyric_offset', '歌词偏移量必须在正负 30 秒以内')
    this.database.prepare('UPDATE lyric SET timing_offset_ms = ?, updated_at = ? WHERE id = ?').run(timingOffsetMs, nowIso(), lyricId)
    const updated = this.database.prepare('SELECT * FROM lyric WHERE id = ?').get(lyricId) as Record<string, unknown>
    return this.serializeLyric(updated)
  }

  listAnnotations(user: AuthUser, lyricId: number) {
    this.getVisibleLyric(user, lyricId)
    const rows = this.database.prepare(`
      SELECT * FROM lyric_annotation
      WHERE lyric_id = ? AND ((review_status = 'approved' AND visibility = 'shared') OR created_by = ?)
      ORDER BY created_at
    `).all(lyricId, user.id) as Array<Record<string, unknown>>
    return rows.map((row) => this.serializeAnnotation(row))
  }

  createAnnotation(user: AuthUser, lyricId: number, input: { body: string; category?: string; lineId?: number; visibility?: string }) {
    const lyric = this.getVisibleLyric(user, lyricId)
    const song = this.getVisibleSong(user, lyric.song_id)
    const category = input.category || 'note'
    assertApp(['note', 'grammar', 'vocabulary', 'translation', 'timing', 'culture'].includes(category), 400, 'invalid_annotation_category', '批注类型无效')
    assertApp(input.body.trim(), 400, 'annotation_empty', '批注内容不能为空')
    if (input.lineId !== undefined) {
      const line = this.database.prepare('SELECT id FROM lyric_line WHERE id = ? AND lyric_id = ?').get(input.lineId, lyricId)
      assertApp(line, 400, 'invalid_annotation_line', '歌词行不属于当前歌词')
    }
    const isModerator = user.role === 'owner' || user.role === 'admin'
    const wantsShared = input.visibility === 'public'
    const canRequestShared = lyric.visibility === 'shared' && song.review_status === 'approved' && song.visibility === 'shared'
    assertApp(!wantsShared || canRequestShared, 409, 'review_request_unavailable', '请先共享歌曲和歌词，再申请共享批注')
    const pendingReview = wantsShared && !isModerator && canRequestShared
    const visibility = wantsShared && isModerator ? 'shared' : 'private'
    const result = this.database.prepare(`
      INSERT INTO lyric_annotation(lyric_id, line_id, category, body, visibility, annotation_scope, created_by, review_status, review_requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lyricId, input.lineId ?? null, category, input.body.trim(), visibility,
      isModerator ? 'admin_review' : 'learning', user.id, pendingReview ? 'pending' : 'approved',
      pendingReview ? nowIso() : null,
    )
    const row = this.database.prepare('SELECT * FROM lyric_annotation WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<string, unknown>
    return this.serializeAnnotation(row)
  }

  listAnnotationsForReview(user: AuthUser, status: string, limit: number) {
    assertApp(['pending', 'approved', 'rejected', 'needs_revision'].includes(status), 400, 'invalid_review_status', '审核状态无效')
    const rows = this.database.prepare(`
      SELECT a.*, l.song_id, ll.line_index, s.cover_url, s.title_ja, s.title_zh, s.title_en, s.title_romaji,
        u.email AS creator_email, coalesce(u.display_name, u.email) AS creator_name
      FROM lyric_annotation a
      JOIN lyric l ON l.id = a.lyric_id
      JOIN song s ON s.id = l.song_id
      LEFT JOIN lyric_line ll ON ll.id = a.line_id
      LEFT JOIN app_user u ON u.id = a.created_by
      WHERE a.review_status = ?
        AND a.review_requested_at IS NOT NULL
        AND (a.visibility = 'shared' OR a.review_status <> 'approved' OR a.created_by = ?)
        AND ((s.review_status = 'approved' AND s.visibility = 'shared')
          OR (s.visibility = 'private' AND s.review_status <> 'approved')
          OR s.submitted_by = ?)
      ORDER BY a.created_at DESC LIMIT ?
    `).all(status, user.id, user.id, Math.min(100, Math.max(1, limit))) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      ...this.serializeAnnotation(row), songId: row.song_id,
      songTitle: firstText(row.title_zh as string, row.title_ja as string, row.title_en as string, row.title_romaji as string),
      songCoverUrl: row.cover_url ?? undefined, lineIndex: row.line_index ?? undefined,
      creatorName: row.creator_name ?? undefined, creatorEmail: row.creator_email ?? undefined,
    }))
  }

  reviewAnnotation(user: AuthUser, annotationId: number, status: string, reviewNote?: string) {
    assertApp(['approved', 'rejected', 'needs_revision', 'pending'].includes(status), 400, 'invalid_review_status', '审核状态无效')
    const annotation = this.database.prepare(`
      SELECT a.*, l.song_id, l.visibility AS lyric_visibility
      FROM lyric_annotation a JOIN lyric l ON l.id = a.lyric_id WHERE a.id = ?
    `).get(annotationId) as Record<string, unknown> | undefined
    assertApp(annotation, 404, 'annotation_not_found', '批注不存在')
    const song = this.getVisibleSong(user, Number(annotation.song_id))
    assertApp(annotation.review_requested_at && annotation.lyric_visibility === 'shared' && song.review_status === 'approved' && song.visibility === 'shared', 404, 'annotation_not_found', '批注不存在')
    const now = nowIso()
    this.database.prepare(`
      UPDATE lyric_annotation SET review_status = ?, visibility = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, status === 'approved' ? 'shared' : 'private', reviewNote?.trim() || null, user.id, now, now, annotationId)
    const row = this.database.prepare('SELECT * FROM lyric_annotation WHERE id = ?').get(annotationId) as Record<string, unknown>
    return this.serializeAnnotation(row)
  }

  requestAnnotationReview(user: AuthUser, annotationId: number) {
    const annotation = this.database.prepare(`
      SELECT a.*, l.song_id, l.visibility AS lyric_visibility
      FROM lyric_annotation a JOIN lyric l ON l.id = a.lyric_id WHERE a.id = ?
    `).get(annotationId) as Record<string, unknown> | undefined
    assertApp(annotation && annotation.created_by === user.id, 404, 'annotation_not_found', '批注不存在')
    this.getVisibleLyric(user, Number(annotation.lyric_id))
    const song = this.getVisibleSong(user, Number(annotation.song_id))
    assertApp(annotation.visibility === 'private' && annotation.lyric_visibility === 'shared' && song.review_status === 'approved' && song.visibility === 'shared', 409, 'review_request_unavailable', '该批注当前不能提交审核')
    const now = nowIso()
    this.database.prepare(`
      UPDATE lyric_annotation SET review_status = 'pending', review_requested_at = ?, review_note = NULL,
        reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?
    `).run(now, now, annotationId)
    const row = this.database.prepare('SELECT * FROM lyric_annotation WHERE id = ?').get(annotationId) as Record<string, unknown>
    return this.serializeAnnotation(row)
  }

  review(user: AuthUser, songId: number, status: string, reviewNote?: string) {
    assertApp(['approved', 'rejected', 'needs_revision', 'pending'].includes(status), 400, 'invalid_review_status', '审核状态无效')
    const song = this.getVisibleSong(user, songId)
    const visibility = status === 'approved' ? 'shared' : 'private'
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = this.database.prepare(`
        UPDATE song SET review_status = ?, visibility = ?, review_note = ?, updated_at = ? WHERE id = ?
      `).run(status, visibility, reviewNote?.trim() || null, nowIso(), songId)
      assertApp(result.changes > 0, 404, 'song_not_found', '歌曲不存在')
      if (status === 'approved' && song.submitted_by !== null) this.publishCurrentLyrics(songId, song.submitted_by, user.id)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.detail(user, songId)
  }

  requestShare(user: AuthUser, songId: number) {
    const song = this.getVisibleSong(user, songId)
    assertApp(song.submitted_by === user.id || user.role === 'owner' || user.role === 'admin', 403, 'forbidden', '只能共享自己导入的歌曲')
    const needsReview = user.role === 'user' && this.config.friendShareReview
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE song SET review_status = ?, visibility = ?, review_note = NULL, updated_at = ? WHERE id = ?
      `).run(needsReview ? 'pending' : 'approved', needsReview ? 'private' : 'shared', nowIso(), songId)
      if (!needsReview) this.publishCurrentLyrics(songId, user.id, user.id)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { song: this.detail(user, songId), reviewRequired: needsReview }
  }

  updateMetadata(user: AuthUser, songId: number, input: SongMetadataInput) {
    this.getVisibleSong(user, songId)
    const workTitle = input.workTitle?.trim()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.replaceAliases('song_alias', 'song_id', songId, input.songAliases)
      if (input.songCoverUrl !== undefined) this.database.prepare('UPDATE song SET cover_url = ?, updated_at = ? WHERE id = ?').run(normalizeImageUri(input.songCoverUrl) || null, nowIso(), songId)
      if (input.artistName?.trim()) {
        const name = input.artistName.trim()
        let artist = this.database.prepare(`SELECT id FROM artist WHERE name_ja = ? OR name_zh = ? OR name_en = ? OR name_romaji = ? LIMIT 1`).get(name, name, name, name) as { id: number } | undefined
        if (!artist) artist = { id: Number(this.database.prepare('INSERT INTO artist(name_ja, avatar_url) VALUES (?, ?)').run(name, input.artistAvatarUrl ? normalizeImageUri(input.artistAvatarUrl) || null : null).lastInsertRowid) }
        else if (input.artistAvatarUrl !== undefined) this.database.prepare('UPDATE artist SET avatar_url = ?, updated_at = ? WHERE id = ?').run(normalizeImageUri(input.artistAvatarUrl) || null, nowIso(), artist.id)
        this.database.prepare("DELETE FROM song_artist WHERE song_id = ? AND artist_role = 'primary'").run(songId)
        this.database.prepare("INSERT INTO song_artist(song_id, artist_id, artist_role) VALUES (?, ?, 'primary')").run(songId, artist.id)
        this.replaceAliases('artist_alias', 'artist_id', artist.id, input.artistAliases)
      }
      let workId: number | undefined
      if (workTitle) {
        let work = this.database.prepare(`SELECT id FROM work WHERE title_ja = ? OR title_zh = ? OR title_en = ? OR title_romaji = ? LIMIT 1`).get(workTitle, workTitle, workTitle, workTitle) as { id: number } | undefined
        if (!work) work = { id: Number(this.database.prepare('INSERT INTO work(title_ja, cover_url) VALUES (?, ?)').run(workTitle, input.workCoverUrl ? normalizeImageUri(input.workCoverUrl) || null : null).lastInsertRowid) }
        else if (input.workCoverUrl !== undefined) this.database.prepare('UPDATE work SET cover_url = ?, updated_at = ? WHERE id = ?').run(normalizeImageUri(input.workCoverUrl) || null, nowIso(), work.id)
        workId = work.id
        this.database.prepare('DELETE FROM song_work WHERE song_id = ?').run(songId)
        this.database.prepare('INSERT INTO song_work(song_id, work_id, relation_type) VALUES (?, ?, ?)').run(songId, work.id, input.workRelationType?.trim() || 'theme_song')
        this.replaceAliases('work_alias', 'work_id', work.id, input.workAliases)
      }
      if (input.albumTitle?.trim()) {
        const title = input.albumTitle.trim()
        let album = this.database.prepare(`SELECT id FROM album WHERE title_ja = ? OR title_zh = ? OR title_en = ? OR title_romaji = ? LIMIT 1`).get(title, title, title, title) as { id: number } | undefined
        if (!album) album = { id: Number(this.database.prepare('INSERT INTO album(title_ja, cover_url) VALUES (?, ?)').run(title, input.albumCoverUrl ? normalizeImageUri(input.albumCoverUrl) || null : null).lastInsertRowid) }
        else if (input.albumCoverUrl !== undefined) this.database.prepare('UPDATE album SET cover_url = ?, updated_at = ? WHERE id = ?').run(normalizeImageUri(input.albumCoverUrl) || null, nowIso(), album.id)
        this.database.prepare('DELETE FROM album_song WHERE song_id = ?').run(songId)
        this.database.prepare('INSERT INTO album_song(album_id, song_id) VALUES (?, ?)').run(album.id, songId)
        this.replaceAliases('album_alias', 'album_id', album.id, input.albumAliases)
      }
      let publisherId: number | undefined
      if (input.publisherName?.trim()) {
        const name = input.publisherName.trim()
        let publisher = this.database.prepare('SELECT id FROM publisher WHERE name = ?').get(name) as { id: number } | undefined
        if (!publisher) publisher = { id: Number(this.database.prepare('INSERT INTO publisher(name) VALUES (?)').run(name).lastInsertRowid) }
        publisherId = publisher.id
        this.database.prepare('UPDATE song SET publisher_id = ? WHERE id = ?').run(publisher.id, songId)
      }
      if (input.labelName?.trim()) {
        const name = input.labelName.trim()
        let label = this.database.prepare('SELECT id FROM label WHERE name = ?').get(name) as { id: number } | undefined
        if (!label) label = { id: Number(this.database.prepare('INSERT INTO label(name, publisher_id) VALUES (?, ?)').run(name, publisherId ?? null).lastInsertRowid) }
        this.database.prepare('UPDATE song SET label_id = ? WHERE id = ?').run(label.id, songId)
      }
      if (input.versionType) assertApp(['full', 'tv_size', 'instrumental', 'cover', 'live', 'ost', 'variation'].includes(input.versionType), 400, 'invalid_version_type', '歌曲版本类型无效')
      if (input.versionGroupTitle?.trim()) {
        const title = input.versionGroupTitle.trim()
        let group = this.database.prepare('SELECT id FROM song_version_group WHERE group_title = ?').get(title) as { id: number } | undefined
        if (!group) group = { id: Number(this.database.prepare('INSERT INTO song_version_group(group_title, work_id, canonical_song_id) VALUES (?, ?, ?)').run(title, workId ?? null, songId).lastInsertRowid) }
        this.database.prepare('UPDATE song SET version_group_id = ?, version_type = ?, updated_at = ? WHERE id = ?').run(group.id, input.versionType || 'full', nowIso(), songId)
      } else if (input.versionType) {
        this.database.prepare('UPDATE song SET version_type = ?, updated_at = ? WHERE id = ?').run(input.versionType, nowIso(), songId)
      }
      this.database.prepare('DELETE FROM song_creator WHERE song_id = ?').run(songId)
      input.creators.forEach((entry, index) => {
        const name = entry.name.trim()
        if (!name || !entry.role.trim()) return
        let creator = this.database.prepare('SELECT id FROM creator WHERE name = ?').get(name) as { id: number } | undefined
        if (!creator) creator = { id: Number(this.database.prepare('INSERT INTO creator(name, creator_type) VALUES (?, ?)').run(name, entry.creatorType?.trim() || entry.role.trim()).lastInsertRowid) }
        this.database.prepare('INSERT INTO song_creator(song_id, creator_id, role, sort_order) VALUES (?, ?, ?, ?)').run(songId, creator.id, entry.role.trim(), index)
      })
      this.database.prepare('DELETE FROM song_character WHERE song_id = ?').run(songId)
      input.characters.forEach((entry, index) => {
        const name = entry.name.trim()
        if (!name) return
        let character = this.database.prepare('SELECT id FROM acg_character WHERE name = ? AND coalesce(work_id, 0) = coalesce(?, 0) LIMIT 1').get(name, workId ?? null) as { id: number } | undefined
        if (!character) character = { id: Number(this.database.prepare('INSERT INTO acg_character(name, work_id) VALUES (?, ?)').run(name, workId ?? null).lastInsertRowid) }
        this.database.prepare('INSERT INTO song_character(song_id, character_id, relation_type, sort_order) VALUES (?, ?, ?, ?)').run(songId, character.id, entry.relationType?.trim() || 'character_song', index)
        entry.voiceActorNames.forEach((rawName, actorIndex) => {
          const actorName = rawName.trim()
          if (!actorName) return
          let actor = this.database.prepare('SELECT id FROM voice_actor WHERE name = ?').get(actorName) as { id: number } | undefined
          if (!actor) actor = { id: Number(this.database.prepare('INSERT INTO voice_actor(name) VALUES (?)').run(actorName).lastInsertRowid) }
          this.database.prepare('INSERT OR REPLACE INTO character_voice_actor(character_id, voice_actor_id, sort_order) VALUES (?, ?, ?)').run(character!.id, actor.id, actorIndex)
        })
      })
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.detail(user, songId)
  }

  listForReview(status: string, limit: number) {
    const visibility = status === 'approved' ? 'shared' : 'private'
    const rows = this.database.prepare(`
      SELECT s.*, u.display_name AS submitter_name, u.email AS submitter_email
      FROM song s LEFT JOIN app_user u ON u.id = s.submitted_by
      WHERE s.review_status = ? AND s.visibility = ? ORDER BY s.created_at DESC LIMIT ?
    `).all(status, visibility, Math.min(100, Math.max(1, limit))) as unknown as Array<SongRow & {
      submitter_name: string | null
      submitter_email: string | null
    }>
    return rows.map((row) => ({
      id: row.id, displayTitle: displaySongTitle(row), languageCode: row.language_code,
      coverUrl: row.cover_url ?? undefined,
      audioSourceType: row.audio_source_type, audioSourceUri: row.audio_source_uri ? this.media.createStreamUrl(row.id) : undefined,
      submittedBy: row.submitted_by ?? undefined, reviewStatus: row.review_status,
      submittedByName: row.submitter_name ?? undefined, submittedByEmail: row.submitter_email ?? undefined,
      visibility: row.visibility === 'shared' ? 'public' : 'private', reviewNote: row.review_note ?? undefined,
      createdAt: row.created_at,
    }))
  }

  delete(user: AuthUser, songId: number): void {
    this.getVisibleSong(user, songId)
    const row = this.database.prepare('SELECT audio_source_uri, cover_url FROM song WHERE id = ?').get(songId) as { audio_source_uri: string | null; cover_url: string | null } | undefined
    assertApp(row, 404, 'song_not_found', '歌曲不存在')
    const lyricSources = this.database.prepare(`SELECT source_ref FROM lyric WHERE song_id = ? AND source_ref IS NOT NULL`).all(songId) as Array<{ source_ref: string }>
    const imageUrls = new Set<string>([row.cover_url, ...this.relatedImageUrls(songId)].filter((value): value is string => Boolean(value)))
    this.database.prepare('DELETE FROM song WHERE id = ?').run(songId)
    const privatePaths = new Set<string>([row.audio_source_uri, ...lyricSources.map((item) => item.source_ref)].filter((value): value is string => Boolean(value)))
    for (const path of privatePaths) if (!this.privateMediaReferenced(path)) this.removeMedia(path)
    for (const url of imageUrls) {
      if (url.startsWith('/media/images/') && !this.imageReferenced(url)) this.removeMedia(`images/${url.slice('/media/images/'.length)}`)
    }
  }

  private serializeListRow(row: SongRow) {
    return {
      id: row.id, titleJa: row.title_ja ?? undefined, titleZh: row.title_zh ?? undefined,
      titleEn: row.title_en ?? undefined, titleRomaji: row.title_romaji ?? undefined,
      displayTitle: displaySongTitle(row), durationSeconds: row.duration_seconds ?? undefined,
      languageCode: row.language_code, releaseDate: row.release_date ?? undefined, coverUrl: row.cover_url ?? undefined,
      audioSourceType: row.audio_source_uri ? 'personal_library' : undefined,
      audioSourceUri: row.audio_source_uri ? this.media.createStreamUrl(row.id) : undefined,
      primaryArtistName: row.primary_artist_name ?? undefined, primaryWorkTitle: row.primary_work_title ?? undefined,
    }
  }

  private getVisibleSong(user: AuthUser, songId: number): SongRow {
    const row = this.database.prepare('SELECT * FROM song WHERE id = ?').get(songId) as unknown as SongRow | undefined
    assertApp(row, 404, 'song_not_found', '歌曲不存在')
    const isModerator = user.role === 'owner' || user.role === 'admin'
    const isShareReview = isModerator && row.visibility === 'private' && row.review_status !== 'approved'
    const visible = row.submitted_by === user.id || (row.review_status === 'approved' && row.visibility === 'shared') || isShareReview
    assertApp(visible, 404, 'song_not_found', '歌曲不存在')
    return row
  }

  private getVisibleLyric(user: AuthUser, lyricId: number): Record<string, unknown> & { song_id: number } {
    const lyric = this.database.prepare('SELECT * FROM lyric WHERE id = ?').get(lyricId) as (Record<string, unknown> & { song_id: number }) | undefined
    assertApp(lyric, 404, 'lyric_not_found', '歌词不存在')
    const song = this.getVisibleSong(user, lyric.song_id)
    const isModerator = user.role === 'owner' || user.role === 'admin'
    const isSongReview = isModerator && song.visibility === 'private' && song.review_status !== 'approved'
    const isContentReview = isModerator && Boolean(lyric.review_requested_at)
    const visible = lyric.visibility === 'shared' || lyric.uploaded_by === user.id || isSongReview || isContentReview
    assertApp(visible, 404, 'lyric_not_found', '歌词不存在')
    return lyric
  }

  private saveEmbeddedCover(picture: IPicture): string {
    const extension = imageExtension(picture)
    const name = `${Date.now()}-${createHash('sha256').update(picture.data).digest('hex').slice(0, 20)}${extension}`
    mkdirSync(join(this.config.mediaRoot, 'images'), { recursive: true })
    writeFileSync(join(this.config.mediaRoot, 'images', name), picture.data, { flag: 'wx' })
    return `/media/images/${name}`
  }

  private saveEmbeddedCoverAsUpload(picture: IPicture): SavedUpload {
    const extension = imageExtension(picture)
    const checksum = createHash('sha256').update(picture.data).digest('hex')
    const name = `${Date.now()}-${checksum.slice(0, 20)}${extension}`
    const relativePath = `images/${name}`
    const absolutePath = join(this.config.mediaRoot, relativePath)
    mkdirSync(join(this.config.mediaRoot, 'images'), { recursive: true })
    writeFileSync(absolutePath, picture.data)
    return {
      relativePath, absolutePath, originalFilename: `embedded-cover${extension}`,
      mimeType: picture.format, sizeBytes: picture.data.byteLength, checksum,
    }
  }

  private linkArtist(songId: number, name: string): void {
    let row = this.database.prepare(`SELECT id FROM artist WHERE name_ja = ? OR name_zh = ? OR name_en = ? OR name_romaji = ? LIMIT 1`).get(name, name, name, name) as { id: number } | undefined
    if (!row) {
      const result = this.database.prepare('INSERT INTO artist(name_ja) VALUES (?)').run(name)
      row = { id: Number(result.lastInsertRowid) }
    }
    this.database.prepare('INSERT OR IGNORE INTO song_artist(song_id, artist_id) VALUES (?, ?)').run(songId, row.id)
  }

  private linkAlbum(songId: number, title: string, trackNo: number, coverUrl?: string): void {
    let row = this.database.prepare(`SELECT id FROM album WHERE title_ja = ? OR title_zh = ? OR title_en = ? OR title_romaji = ? LIMIT 1`).get(title, title, title, title) as { id: number } | undefined
    if (!row) row = { id: Number(this.database.prepare('INSERT INTO album(title_ja, cover_url) VALUES (?, ?)').run(title, coverUrl ?? null).lastInsertRowid) }
    this.database.prepare('INSERT OR IGNORE INTO album_song(album_id, song_id, track_no) VALUES (?, ?, ?)').run(row.id, songId, trackNo || 1)
  }

  private linkWork(songId: number, title: string, coverUrl?: string): void {
    let row = this.database.prepare(`SELECT id FROM work WHERE title_ja = ? OR title_zh = ? OR title_en = ? OR title_romaji = ? LIMIT 1`).get(title, title, title, title) as { id: number } | undefined
    if (!row) row = { id: Number(this.database.prepare('INSERT INTO work(title_ja, cover_url) VALUES (?, ?)').run(title, coverUrl ?? null).lastInsertRowid) }
    this.database.prepare('INSERT OR IGNORE INTO song_work(song_id, work_id) VALUES (?, ?)').run(songId, row.id)
  }

  private linkCreators(songId: number, metadata?: IAudioMetadata): void {
    const groups: Array<{ names: string[] | undefined; role: string }> = [
      { names: metadata?.common.lyricist, role: 'lyricist' },
      { names: metadata?.common.composer, role: 'composer' },
      { names: metadata?.common.arranger, role: 'arranger' },
    ]
    let sortOrder = 0
    for (const group of groups) for (const rawName of group.names ?? []) {
      const name = rawName.trim()
      if (!name) continue
      let creator = this.database.prepare('SELECT id FROM creator WHERE name = ?').get(name) as { id: number } | undefined
      if (!creator) creator = { id: Number(this.database.prepare('INSERT INTO creator(name, creator_type) VALUES (?, ?)').run(name, group.role).lastInsertRowid) }
      this.database.prepare('INSERT OR IGNORE INTO song_creator(song_id, creator_id, role, sort_order) VALUES (?, ?, ?, ?)').run(songId, creator.id, group.role, sortOrder++)
    }
  }

  private replaceAliases(table: 'song_alias' | 'artist_alias' | 'work_alias' | 'album_alias', foreignKey: 'song_id' | 'artist_id' | 'work_id' | 'album_id', entityId: number, aliases: string[]): void {
    this.database.prepare(`DELETE FROM ${table} WHERE ${foreignKey} = ?`).run(entityId)
    const insert = this.database.prepare(`INSERT OR IGNORE INTO ${table}(${foreignKey}, alias_text, alias_type) VALUES (?, ?, 'alternate')`)
    for (const alias of new Set(aliases.map((value) => value.trim()).filter(Boolean))) insert.run(entityId, alias)
  }

  private createLyric(songId: number, user: AuthUser, originalText: string, lines: ParsedLyricLine[], sourceRef: string | undefined, approved: boolean, languageCode = 'ja'): void {
    if (approved) this.database.prepare("UPDATE lyric SET is_current = 0 WHERE song_id = ? AND visibility = 'shared'").run(songId)
    else this.database.prepare("UPDATE lyric SET is_current = 0 WHERE song_id = ? AND uploaded_by = ? AND visibility = 'private'").run(songId, user.id)
    const result = this.database.prepare(`
      INSERT INTO lyric(song_id, language_code, source_type, original_text, review_status, visibility, source_ref, uploaded_by)
      VALUES (?, ?, 'user_upload', ?, ?, ?, ?, ?)
    `).run(songId, languageCode, originalText, approved ? 'approved' : 'pending', approved ? 'shared' : 'private', sourceRef ?? null, user.id)
    const lyricId = Number(result.lastInsertRowid)
    const statement = this.database.prepare(`
      INSERT INTO lyric_line(lyric_id, line_index, start_ms, end_ms, original_text, translated_text, romaji_text, ruby_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const line of lines) {
      const parsedOriginal = parseRubyMarkup(line.originalText)
      statement.run(
        lyricId,
        line.lineIndex,
        line.startMs ?? null,
        line.endMs ?? null,
        parsedOriginal.text,
        line.translatedText ?? null,
        line.romajiText ?? null,
        JSON.stringify(parsedOriginal.segments),
      )
    }
  }

  private publishCurrentLyrics(songId: number, uploaderId: number, reviewerId: number): void {
    const target = this.database.prepare(`
      SELECT id FROM lyric
      WHERE song_id = ? AND uploaded_by = ? AND is_current = 1
      ORDER BY created_at DESC LIMIT 1
    `).get(songId, uploaderId) as { id: number } | undefined
    if (!target) return
    const now = nowIso()
    this.database.prepare("UPDATE lyric SET is_current = 0 WHERE song_id = ? AND visibility = 'shared' AND id <> ?").run(songId, target.id)
    this.database.prepare(`
      UPDATE lyric SET review_status = 'approved', visibility = 'shared', is_current = 1,
        reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?
    `).run(reviewerId, now, now, target.id)
  }

  private serializeLyric(lyric: Record<string, unknown>) {
    const lines = this.database.prepare('SELECT * FROM lyric_line WHERE lyric_id = ? ORDER BY line_index').all(lyric.id as number) as Array<Record<string, unknown>>
    return {
      id: lyric.id, songId: lyric.song_id, languageCode: lyric.language_code, sourceType: lyric.source_type,
      reviewStatus: lyric.review_status, visibility: lyric.visibility === 'shared' ? 'public' : 'private',
      isCurrent: Boolean(lyric.is_current), versionLabel: lyric.version_label ?? undefined,
      sourceRef: lyric.source_ref ?? undefined, reviewNote: lyric.review_note ?? undefined,
      uploadedBy: lyric.uploaded_by ?? undefined, reviewedBy: lyric.reviewed_by ?? undefined,
      reviewedAt: lyric.reviewed_at ?? undefined, reviewRequestedAt: lyric.review_requested_at ?? undefined,
      timingOffsetMs: Number(lyric.timing_offset_ms ?? 0),
      createdAt: lyric.created_at,
      lines: lines.map((line) => ({
        id: line.id, lineIndex: line.line_index, startMs: line.start_ms ?? undefined,
        endMs: line.end_ms ?? undefined, originalText: line.original_text,
        translatedText: line.translated_text ?? undefined,
        romajiText: line.romaji_text ?? undefined,
        originalRuby: JSON.parse(String(line.ruby_json || '[]')),
      })),
    }
  }

  private voiceActors(characterId: number) {
    const rows = this.database.prepare(`
      SELECT va.* FROM character_voice_actor cva JOIN voice_actor va ON va.id = cva.voice_actor_id
      WHERE cva.character_id = ? ORDER BY cva.sort_order
    `).all(characterId) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id, name: row.name, nameJa: row.name_ja ?? undefined, nameZh: row.name_zh ?? undefined,
      nameEn: row.name_en ?? undefined, nameRomaji: row.name_romaji ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      aliases: this.entityAliases('voice_actor_alias', 'voice_actor_id', Number(row.id)),
    }))
  }

  private entityAliases(table: string, foreignKey: string, id: number): string[] {
    const rows = this.database.prepare(`SELECT alias_text FROM ${table} WHERE ${foreignKey} = ? ORDER BY alias_text`).all(id) as Array<{ alias_text: string }>
    return rows.map((row) => row.alias_text)
  }

  private serializeAnnotation(row: Record<string, unknown>) {
    return {
      id: row.id, lyricId: row.lyric_id, lineId: row.line_id ?? undefined, category: row.category,
      body: row.body, visibility: row.visibility === 'shared' ? 'public' : 'private',
      annotationScope: row.annotation_scope, createdBy: row.created_by ?? undefined,
      reviewStatus: row.review_status, reviewNote: row.review_note ?? undefined,
      reviewedBy: row.reviewed_by ?? undefined, reviewedAt: row.reviewed_at ?? undefined,
      reviewRequestedAt: row.review_requested_at ?? undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }

  private publisher(id: number) {
    const row = this.database.prepare('SELECT * FROM publisher WHERE id = ?').get(id) as Record<string, unknown>
    return {
      id: row.id, name: row.name, nameJa: row.name_ja ?? undefined, nameZh: row.name_zh ?? undefined,
      nameEn: row.name_en ?? undefined, nameRomaji: row.name_romaji ?? undefined,
      websiteUrl: row.website_url ?? undefined, imageUrl: row.image_url ?? undefined,
      aliases: this.entityAliases('publisher_alias', 'publisher_id', id),
    }
  }

  private label(id: number) {
    const row = this.database.prepare('SELECT * FROM label WHERE id = ?').get(id) as Record<string, unknown>
    return {
      id: row.id, publisherId: row.publisher_id ?? undefined, name: row.name, nameJa: row.name_ja ?? undefined,
      nameZh: row.name_zh ?? undefined, nameEn: row.name_en ?? undefined, nameRomaji: row.name_romaji ?? undefined,
      imageUrl: row.image_url ?? undefined, aliases: this.entityAliases('label_alias', 'label_id', id),
    }
  }

  private versionGroup(user: AuthUser, id: number) {
    const row = this.database.prepare('SELECT * FROM song_version_group WHERE id = ?').get(id) as Record<string, unknown>
    const rows = this.database.prepare('SELECT * FROM song WHERE version_group_id = ? ORDER BY created_at').all(id) as unknown as SongRow[]
    const versions = rows.filter((song) => {
      try { this.getVisibleSong(user, song.id); return true } catch { return false }
    })
    const canonicalSongId = versions.some((song) => song.id === row.canonical_song_id) ? row.canonical_song_id as number : undefined
    return {
      id: row.id, groupTitle: row.group_title, workId: row.work_id ?? undefined,
      canonicalSongId, description: row.description ?? undefined, imageUrl: row.image_url ?? undefined,
      aliases: this.entityAliases('version_group_alias', 'version_group_id', id),
      versions: versions.map((song) => ({ id: song.id, displayTitle: displaySongTitle(song), versionType: song.version_type ?? undefined, durationSeconds: song.duration_seconds ?? undefined, audioSourceUri: song.audio_source_uri ? this.media.createStreamUrl(song.id) : undefined })),
    }
  }

  private removeMedia(relativePath: string): void {
    if (relativePath.startsWith('file:')) return
    try { unlinkSync(join(this.config.mediaRoot, relativePath)) } catch { /* Missing files do not block database cleanup. */ }
  }

  private relatedImageUrls(songId: number): string[] {
    const rows = this.database.prepare(`
      SELECT a.avatar_url AS url FROM song_artist sa JOIN artist a ON a.id = sa.artist_id WHERE sa.song_id = ?
      UNION SELECT w.cover_url FROM song_work sw JOIN work w ON w.id = sw.work_id WHERE sw.song_id = ?
      UNION SELECT a.cover_url FROM album_song als JOIN album a ON a.id = als.album_id WHERE als.song_id = ?
      UNION SELECT c.image_url FROM song_character sc JOIN acg_character c ON c.id = sc.character_id WHERE sc.song_id = ?
      UNION SELECT va.avatar_url FROM song_character sc
        JOIN character_voice_actor cva ON cva.character_id = sc.character_id
        JOIN voice_actor va ON va.id = cva.voice_actor_id WHERE sc.song_id = ?
      UNION SELECT c.image_url FROM song_creator sc JOIN creator c ON c.id = sc.creator_id WHERE sc.song_id = ?
      UNION SELECT p.image_url FROM song s JOIN publisher p ON p.id = s.publisher_id WHERE s.id = ?
      UNION SELECT l.image_url FROM song s JOIN label l ON l.id = s.label_id WHERE s.id = ?
      UNION SELECT vg.image_url FROM song s JOIN song_version_group vg ON vg.id = s.version_group_id WHERE s.id = ?
    `).all(songId, songId, songId, songId, songId, songId, songId, songId, songId) as Array<{ url: string | null }>
    return rows.flatMap((row) => row.url ? [row.url] : [])
  }

  private privateMediaReferenced(relativePath: string): boolean {
    return Boolean(this.database.prepare(`
      SELECT 1 FROM song WHERE audio_source_uri = ?
      UNION ALL SELECT 1 FROM lyric WHERE source_ref = ?
      LIMIT 1
    `).get(relativePath, relativePath))
  }

  private imageReferenced(url: string): boolean {
    return Boolean(this.database.prepare(`
      SELECT 1 FROM song WHERE cover_url = ?
      UNION ALL SELECT 1 FROM artist a WHERE a.avatar_url = ? AND EXISTS (SELECT 1 FROM song_artist sa WHERE sa.artist_id = a.id)
      UNION ALL SELECT 1 FROM work w WHERE w.cover_url = ? AND EXISTS (SELECT 1 FROM song_work sw WHERE sw.work_id = w.id)
      UNION ALL SELECT 1 FROM album a WHERE a.cover_url = ? AND EXISTS (SELECT 1 FROM album_song als WHERE als.album_id = a.id)
      UNION ALL SELECT 1 FROM acg_character c WHERE c.image_url = ? AND EXISTS (SELECT 1 FROM song_character sc WHERE sc.character_id = c.id)
      UNION ALL SELECT 1 FROM voice_actor va WHERE va.avatar_url = ? AND EXISTS (
        SELECT 1 FROM character_voice_actor cva JOIN song_character sc ON sc.character_id = cva.character_id WHERE cva.voice_actor_id = va.id
      )
      UNION ALL SELECT 1 FROM creator c WHERE c.image_url = ? AND EXISTS (SELECT 1 FROM song_creator sc WHERE sc.creator_id = c.id)
      UNION ALL SELECT 1 FROM publisher p WHERE p.image_url = ? AND EXISTS (SELECT 1 FROM song s WHERE s.publisher_id = p.id)
      UNION ALL SELECT 1 FROM label l WHERE l.image_url = ? AND EXISTS (SELECT 1 FROM song s WHERE s.label_id = l.id)
      UNION ALL SELECT 1 FROM song_version_group vg WHERE vg.image_url = ? AND EXISTS (SELECT 1 FROM song s WHERE s.version_group_id = vg.id)
      UNION ALL SELECT 1 FROM app_user WHERE avatar_url = ?
      UNION ALL SELECT 1 FROM playlist WHERE cover_url = ?
      LIMIT 1
    `).get(url, url, url, url, url, url, url, url, url, url, url, url))
  }

  private removeImportFiles(serialized: string): void {
    try {
      const files = JSON.parse(serialized) as { audio?: SavedUpload; cover?: SavedUpload; lyrics?: SavedUpload }
      const paths = new Set([files.audio?.relativePath, files.cover?.relativePath, files.lyrics?.relativePath].filter((value): value is string => Boolean(value)))
      for (const path of paths) this.removeMedia(path)
    } catch {
      // A malformed abandoned record must not stop startup cleanup.
    }
  }
}
