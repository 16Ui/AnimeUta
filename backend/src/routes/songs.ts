import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../auth.js'
import { extractSongBundle } from '../bundle.js'
import type { AppConfig } from '../config.js'
import { assertApp } from '../errors.js'
import { audioExtensions, imageExtensions, type MediaService, type SavedUpload } from '../media.js'
import type { SongService } from '../songs.js'

interface SongRoutesOptions {
  auth: AuthService
  config: AppConfig
  media: MediaService
  songs: SongService
}

interface SubmissionParts {
  fields: Record<string, string>
  audio?: SavedUpload
  cover?: SavedUpload
  lyricsFile?: SavedUpload
  bundle?: SavedUpload
}

async function readSubmissionParts(request: Parameters<AuthService['authenticate']>[0], media: MediaService): Promise<SubmissionParts> {
  const fields: Record<string, string> = {}
  let audio: SavedUpload | undefined
  let cover: SavedUpload | undefined
  let lyricsFile: SavedUpload | undefined
  let bundle: SavedUpload | undefined
  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value ?? '')
        continue
      }
      const extension = extname(part.filename).toLowerCase()
      if (part.fieldname === 'bundle' || part.fieldname === 'file' && extension === '.zip') {
        bundle = await media.saveMultipartFile(part, 'bundles')
      } else if (part.fieldname === 'audio' || part.fieldname === 'file' && (part.mimetype.startsWith('audio/') || audioExtensions.has(extension))) {
        audio = await media.saveMultipartFile(part, 'audio')
      } else if (part.fieldname === 'cover' || part.mimetype.startsWith('image/') || part.fieldname === 'file' && imageExtensions.has(extension)) {
        cover = await media.saveMultipartFile(part, 'images')
      } else if (part.fieldname === 'lyrics_file' || part.fieldname === 'file') {
        lyricsFile = await media.saveMultipartFile(part, 'lyrics')
      } else {
        part.file.resume()
      }
    }
  } catch (error) {
    for (const upload of [audio, cover, lyricsFile, bundle]) media.removeSavedUpload(upload)
    throw error
  }
  return { fields, ...(audio ? { audio } : {}), ...(cover ? { cover } : {}), ...(lyricsFile ? { lyricsFile } : {}), ...(bundle ? { bundle } : {}) }
}

function cleanupSubmission(parts: SubmissionParts, media: MediaService): void {
  for (const upload of [parts.audio, parts.cover, parts.lyricsFile, parts.bundle]) media.removeSavedUpload(upload)
}

async function expandBundle(parts: SubmissionParts, config: AppConfig, media: MediaService): Promise<SubmissionParts> {
  if (!parts.bundle) return parts
  if (parts.audio || parts.cover || parts.lyricsFile) {
    cleanupSubmission(parts, media)
    assertApp(false, 400, 'mixed_bundle_upload', '使用 ZIP 导入时请不要同时选择单独文件')
  }
  const extracted = await extractSongBundle(parts.bundle, config)
  return {
    fields: parts.fields,
    audio: extracted.audio,
    ...(extracted.cover ? { cover: extracted.cover } : {}),
    ...(extracted.lyrics ? { lyricsFile: extracted.lyrics } : {}),
  }
}

export async function registerSongRoutes(app: FastifyInstance, options: SongRoutesOptions): Promise<void> {
  const { auth, config, media, songs } = options

  app.get('/api/v1/songs', async (request) => {
    const user = auth.authenticate(request)
    const query = request.query as Record<string, unknown>
    return songs.list(user, {
      page: Number(query.page ?? 1),
      pageSize: Number(query.page_size ?? 20),
      ...(query.keyword ? { keyword: String(query.keyword) } : {}),
    })
  })

  app.get<{ Params: { id: string } }>('/api/v1/songs/:id', async (request) => {
    const user = auth.authenticate(request)
    return { data: songs.detail(user, Number(request.params.id)) }
  })

  app.get<{ Params: { id: string }; Querystring: { expires?: string; signature?: string } }>('/api/v1/songs/:id/stream', async (request, reply) => {
    await media.streamSong(request, reply, Number(request.params.id), Number(request.query.expires), request.query.signature ?? '')
  })

  app.post('/api/v1/imports/inspect', async (request) => {
    const user = auth.authenticate(request)
    const parts = await expandBundle(await readSubmissionParts(request, media), config, media)
    try {
      const lyricsText = parts.fields.lyrics?.trim() || (parts.lyricsFile ? readFileSync(parts.lyricsFile.absolutePath, 'utf8') : undefined)
      return { data: await songs.inspectImport(user, {
        ...(parts.fields.title ? { title: parts.fields.title } : {}),
        ...(parts.fields.language_code ? { languageCode: parts.fields.language_code } : {}),
        ...(parts.audio ? { audio: parts.audio } : {}),
        ...(parts.cover ? { cover: parts.cover } : {}),
        ...(lyricsText ? { lyricsText } : {}),
        ...(parts.lyricsFile ? { lyricsFilename: parts.lyricsFile.originalFilename, lyricsSourceRef: parts.lyricsFile.relativePath } : {}),
      }) }
    } catch (error) {
      cleanupSubmission(parts, media)
      throw error
    }
  })

  app.post<{ Params: { id: string } }>('/api/v1/imports/:id/commit', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: await songs.commitImport(user, Number(request.params.id), {
      ...(body.title !== undefined ? { title: String(body.title) } : {}),
      ...(body.languageCode !== undefined ? { languageCode: String(body.languageCode) } : {}),
      ...(body.artistName !== undefined ? { artistName: String(body.artistName) } : {}),
      ...(body.albumTitle !== undefined ? { albumTitle: String(body.albumTitle) } : {}),
      ...(body.workTitle !== undefined ? { workTitle: String(body.workTitle) } : {}),
    }) }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/imports/:id', async (request) => ({
    data: songs.discardImport(auth.authenticate(request), Number(request.params.id)),
  }))

  app.post<{ Params: { id: string } }>('/api/v1/songs/:id/audio', async (request) => {
    const user = auth.authenticate(request)
    const parts = await readSubmissionParts(request, media)
    try {
      assertApp(parts.audio, 400, 'audio_required', '请选择音频文件')
      const data = await songs.replaceAudio(user, Number(request.params.id), parts.audio)
      for (const upload of [parts.cover, parts.lyricsFile, parts.bundle]) media.removeSavedUpload(upload)
      return { data }
    } catch (error) {
      cleanupSubmission(parts, media)
      throw error
    }
  })

  app.get<{ Params: { id: string } }>('/api/v1/songs/:id/lyrics', async (request) => {
    const user = auth.authenticate(request)
    return { data: songs.currentLyrics(user, Number(request.params.id)) }
  })

  app.post<{ Params: { id: string } }>('/api/v1/songs/:id/lyrics', async (request) => {
    const user = auth.authenticate(request)
    const parts = await readSubmissionParts(request, media)
    try {
      assertApp(parts.lyricsFile, 400, 'lyrics_file_required', '请选择歌词文件')
      const content = readFileSync(parts.lyricsFile.absolutePath, 'utf8')
      const data = songs.uploadLyrics(
        user,
        Number(request.params.id),
        content,
        parts.lyricsFile.originalFilename,
        parts.fields.language_code || 'ja',
        parts.lyricsFile.relativePath,
      )
      for (const upload of [parts.audio, parts.cover, parts.bundle]) media.removeSavedUpload(upload)
      return { data }
    } catch (error) {
      cleanupSubmission(parts, media)
      throw error
    }
  })

  app.get<{ Params: { id: string } }>('/api/v1/songs/:id/lyrics/versions', async (request) => {
    const user = auth.authenticate(request)
    return { data: songs.listLyricVersions(user, Number(request.params.id)) }
  })

  app.post<{ Params: { id: string } }>('/api/v1/lyrics/:id/share-request', async (request) => ({
    data: songs.requestLyricReview(auth.authenticate(request), Number(request.params.id)),
  }))

  app.patch<{ Params: { id: string } }>('/api/v1/lyrics/:id/review', async (request) => {
    const user = auth.requireRole(request, ['owner', 'admin'])
    const body = request.body as Record<string, unknown>
    return { data: songs.reviewLyrics(user, Number(request.params.id), String(body.status ?? ''), body.reviewNote ? String(body.reviewNote) : undefined) }
  })

  app.patch<{ Params: { id: string } }>('/api/v1/lyrics/:id/lines', async (request) => {
    const user = auth.requireRole(request, ['owner', 'admin'])
    const body = request.body as Record<string, unknown>
    const lines = Array.isArray(body.lines) ? body.lines.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const value = item as Record<string, unknown>
      return [{
        id: Number(value.id),
        originalText: String(value.originalText ?? ''),
        ...(value.translatedText !== undefined ? { translatedText: value.translatedText === null ? null : String(value.translatedText) } : {}),
        ...(value.romajiText !== undefined ? { romajiText: value.romajiText === null ? null : String(value.romajiText) } : {}),
        ...(value.startMs !== undefined ? { startMs: value.startMs === null || value.startMs === '' ? null : Number(value.startMs) } : {}),
        ...(value.endMs !== undefined ? { endMs: value.endMs === null || value.endMs === '' ? null : Number(value.endMs) } : {}),
      }]
    }) : []
    return { data: songs.updateLyricLines(user, Number(request.params.id), lines) }
  })

  app.patch<{ Params: { id: string } }>('/api/v1/lyrics/:id/timing-offset', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: songs.updateLyricTimingOffset(user, Number(request.params.id), Number(body.timingOffsetMs)) }
  })

  app.get<{ Params: { id: string } }>('/api/v1/lyrics/:id/annotations', async (request) => {
    const user = auth.authenticate(request)
    return { data: songs.listAnnotations(user, Number(request.params.id)) }
  })

  app.post<{ Params: { id: string } }>('/api/v1/lyrics/:id/annotations', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: songs.createAnnotation(user, Number(request.params.id), {
      body: String(body.body ?? ''),
      ...(body.category ? { category: String(body.category) } : {}),
      ...(body.lineId !== undefined ? { lineId: Number(body.lineId) } : {}),
      ...(body.visibility ? { visibility: String(body.visibility) } : {}),
    }) }
  })

  app.post<{ Params: { id: string } }>('/api/v1/annotations/:id/share-request', async (request) => ({
    data: songs.requestAnnotationReview(auth.authenticate(request), Number(request.params.id)),
  }))

  app.get('/api/v1/admin/song-submissions', async (request) => {
    auth.requireRole(request, ['owner', 'admin'])
    const query = request.query as Record<string, unknown>
    return { data: songs.listForReview(String(query.status ?? 'pending'), Number(query.limit ?? 50)) }
  })

  app.get('/api/v1/admin/lyric-submissions', async (request) => {
    const user = auth.requireRole(request, ['owner', 'admin'])
    const query = request.query as Record<string, unknown>
    return { data: songs.listLyricsForReview(user, String(query.status ?? 'pending'), Number(query.limit ?? 50)) }
  })

  app.get('/api/v1/admin/annotation-submissions', async (request) => {
    const user = auth.requireRole(request, ['owner', 'admin'])
    const query = request.query as Record<string, unknown>
    return { data: songs.listAnnotationsForReview(user, String(query.status ?? 'pending'), Number(query.limit ?? 50)) }
  })

  app.patch<{ Params: { id: string } }>('/api/v1/annotations/:id/review', async (request) => {
    const user = auth.requireRole(request, ['owner', 'admin'])
    const body = request.body as Record<string, unknown>
    return { data: songs.reviewAnnotation(user, Number(request.params.id), String(body.status ?? ''), body.reviewNote ? String(body.reviewNote) : undefined) }
  })

  app.post<{ Params: { id: string } }>('/api/v1/me/songs/:id/share-request', async (request) => ({
    data: songs.requestShare(auth.authenticate(request), Number(request.params.id)),
  }))

  app.patch<{ Params: { id: string } }>('/api/v1/admin/songs/:id/review', async (request) => {
    const user = auth.requireRole(request, ['owner', 'admin'])
    const body = request.body as Record<string, unknown>
    return { data: songs.review(user, Number(request.params.id), String(body.status ?? ''), body.reviewNote ? String(body.reviewNote) : undefined) }
  })

  app.patch<{ Params: { id: string } }>('/api/v1/admin/songs/:id/metadata', async (request) => {
    const user = auth.requireRole(request, ['owner', 'admin'])
    const body = request.body as Record<string, unknown>
    return { data: songs.updateMetadata(user, Number(request.params.id), {
      ...(body.songCoverUrl !== undefined ? { songCoverUrl: String(body.songCoverUrl) } : {}),
      ...(body.artistName !== undefined ? { artistName: String(body.artistName) } : {}),
      ...(body.artistAvatarUrl !== undefined ? { artistAvatarUrl: String(body.artistAvatarUrl) } : {}),
      ...(body.workTitle !== undefined ? { workTitle: String(body.workTitle) } : {}),
      ...(body.workCoverUrl !== undefined ? { workCoverUrl: String(body.workCoverUrl) } : {}),
      ...(body.workRelationType !== undefined ? { workRelationType: String(body.workRelationType) } : {}),
      ...(body.albumTitle !== undefined ? { albumTitle: String(body.albumTitle) } : {}),
      ...(body.albumCoverUrl !== undefined ? { albumCoverUrl: String(body.albumCoverUrl) } : {}),
      ...(body.publisherName !== undefined ? { publisherName: String(body.publisherName) } : {}),
      ...(body.labelName !== undefined ? { labelName: String(body.labelName) } : {}),
      ...(body.versionType !== undefined ? { versionType: String(body.versionType) } : {}),
      ...(body.versionGroupTitle !== undefined ? { versionGroupTitle: String(body.versionGroupTitle) } : {}),
      songAliases: Array.isArray(body.songAliases) ? body.songAliases.map(String) : [],
      artistAliases: Array.isArray(body.artistAliases) ? body.artistAliases.map(String) : [],
      workAliases: Array.isArray(body.workAliases) ? body.workAliases.map(String) : [],
      albumAliases: Array.isArray(body.albumAliases) ? body.albumAliases.map(String) : [],
      creators: Array.isArray(body.creators) ? body.creators.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const value = item as Record<string, unknown>
        return [{ name: String(value.name ?? ''), role: String(value.role ?? ''), ...(value.creatorType ? { creatorType: String(value.creatorType) } : {}) }]
      }) : [],
      characters: Array.isArray(body.characters) ? body.characters.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const value = item as Record<string, unknown>
        return [{ name: String(value.name ?? ''), ...(value.relationType ? { relationType: String(value.relationType) } : {}), voiceActorNames: Array.isArray(value.voiceActorNames) ? value.voiceActorNames.map(String) : [] }]
      }) : [],
    }) }
  })

  app.post('/api/v1/media/images', async (request) => {
    auth.authenticate(request)
    const parts = await readSubmissionParts(request, media)
    try {
      assertApp(parts.cover, 400, 'image_required', '请选择图片')
      const uri = media.storedImageUri(parts.cover.relativePath)
      for (const upload of [parts.audio, parts.lyricsFile, parts.bundle]) media.removeSavedUpload(upload)
      return { data: { uri } }
    } catch (error) {
      cleanupSubmission(parts, media)
      throw error
    }
  })

  app.get<{ Params: { name: string }; Querystring: { expires?: string; signature?: string } }>('/api/v1/media/images/:name', async (request, reply) => {
    await media.streamImage(reply, request.params.name, Number(request.query.expires), request.query.signature ?? '')
  })

  app.delete<{ Params: { id: string } }>('/api/v1/admin/songs/:id', async (request) => {
    const user = auth.requireRole(request, ['owner', 'admin'])
    songs.delete(user, Number(request.params.id))
    return { data: { ok: true } }
  })
}
