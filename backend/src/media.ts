import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import type { AppConfig } from './config.js'
import type { SqliteDatabase } from './db.js'
import { assertApp } from './errors.js'
import { createOpaqueToken } from './security.js'
import { resolveAudioPath } from './audio-storage.js'

export interface SavedUpload {
  relativePath: string
  absolutePath: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  checksum: string
}

export const audioExtensions = new Set(['.mp3', '.flac', '.m4a', '.mp4', '.wav', '.ogg', '.opus', '.aac'])
export const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
export const lyricExtensions = new Set(['.lrc', '.srt', '.txt'])
export const mimeByExtension: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aac': 'audio/aac',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.lrc': 'text/plain', '.srt': 'application/x-subrip', '.txt': 'text/plain', '.zip': 'application/zip',
}

const imageResponseKeys = new Set(['avatarUrl', 'coverUrl', 'imageUrl', 'songCoverUrl'])

export function normalizeImageUri(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  try {
    const url = new URL(trimmed, 'http://animeuta.local')
    const match = url.pathname.match(/^\/(?:api\/v1\/)?media\/images\/([^/]+)$/)
    if (!match) return trimmed
    const name = decodeURIComponent(match[1]!)
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') return trimmed
    return `/media/images/${name}`
  } catch {
    return trimmed
  }
}

export class MediaService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly config: AppConfig,
  ) {}

  async saveMultipartFile(part: MultipartFile, kind: 'audio' | 'images' | 'lyrics' | 'bundles'): Promise<SavedUpload> {
    const originalExtension = extname(part.filename).toLowerCase()
    if (kind === 'audio') assertApp(audioExtensions.has(originalExtension), 400, 'unsupported_audio', '仅支持 MP3、FLAC、M4A、WAV、OGG、Opus 或 AAC 音频')
    if (kind === 'images') assertApp(imageExtensions.has(originalExtension), 400, 'unsupported_image', '仅支持 JPG、PNG、WebP 或 GIF 图片')
    if (kind === 'lyrics') assertApp(lyricExtensions.has(originalExtension), 400, 'unsupported_lyrics', '仅支持 LRC、SRT 或 TXT 歌词')
    if (kind === 'bundles') assertApp(originalExtension === '.zip', 400, 'unsupported_bundle', '仅支持 ZIP 导入包')
    const extension = originalExtension || (kind === 'lyrics' ? '.txt' : '')
    const name = `${Date.now()}-${createOpaqueToken(10)}${extension}`
    const relativePath = `${kind}/${name}`
    const absolutePath = join(this.config.mediaRoot, kind, name)
    mkdirSync(join(this.config.mediaRoot, kind), { recursive: true })
    const hash = createHash('sha256')
    const limit = kind === 'images' ? this.config.maxImageBytes : kind === 'lyrics' ? 5 * 1024 * 1024 : this.config.maxAudioBytes
    try {
      part.file.on('data', (chunk: Buffer) => hash.update(chunk))
      await pipeline(part.file, createWriteStream(absolutePath, { flags: 'wx' }))
      assertApp(!part.file.truncated, 413, 'file_too_large', '文件超过允许大小')
      const sizeBytes = statSync(absolutePath).size
      assertApp(sizeBytes <= limit, 413, 'file_too_large', '文件超过允许大小')
      return {
        relativePath,
        absolutePath,
        originalFilename: part.filename,
        mimeType: part.mimetype && part.mimetype !== 'application/octet-stream' ? part.mimetype : mimeByExtension[originalExtension] || 'application/octet-stream',
        sizeBytes,
        checksum: hash.digest('hex'),
      }
    } catch (error) {
      if (existsSync(absolutePath)) unlinkSync(absolutePath)
      throw error
    }
  }

  storedImageUri(relativePath: string): string {
    return `/media/images/${relativePath.replace(/^images[\\/]/, '')}`
  }

  createImageUrl(storedUri: string): string {
    const normalized = normalizeImageUri(storedUri)
    if (!normalized.startsWith('/media/images/')) return normalized
    const name = normalized.slice('/media/images/'.length)
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') return normalized
    const expires = Math.floor(Date.now() / 1000) + 60 * 60
    const signature = this.sign(`image:${name}:${expires}`)
    return `/api/v1/media/images/${encodeURIComponent(name)}?expires=${expires}&signature=${signature}`
  }

  signImageFields(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.signImageFields(item))
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      imageResponseKeys.has(key) && typeof item === 'string'
        ? this.createImageUrl(item)
        : this.signImageFields(item),
    ]))
  }

  removeSavedUpload(upload: SavedUpload | undefined): void {
    if (!upload || upload.relativePath.startsWith('file:')) return
    try {
      if (existsSync(upload.absolutePath)) unlinkSync(upload.absolutePath)
    } catch {
      // Cleanup is best-effort and must not hide the original request error.
    }
  }

  createStreamUrl(songId: number): string {
    const expires = Math.floor(Date.now() / 1000) + 60 * 60
    const signature = this.sign(`${songId}:${expires}`)
    return `/api/v1/songs/${songId}/stream?expires=${expires}&signature=${signature}`
  }

  async streamSong(request: FastifyRequest, reply: FastifyReply, songId: number, expires: number, signature: string): Promise<void> {
    assertApp(expires > Math.floor(Date.now() / 1000), 401, 'media_link_expired', '播放链接已过期，请刷新页面')
    const expected = this.sign(`${songId}:${expires}`)
    const expectedBuffer = Buffer.from(expected)
    const actualBuffer = Buffer.from(signature)
    assertApp(expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer), 401, 'media_link_invalid', '播放链接无效')
    const row = this.database.prepare('SELECT audio_source_uri, audio_mime_type FROM song WHERE id = ?').get(songId) as { audio_source_uri: string | null; audio_mime_type: string | null } | undefined
    assertApp(row?.audio_source_uri, 404, 'audio_not_found', '歌曲暂时没有可播放音频')
    const absolutePath = resolveAudioPath(row.audio_source_uri, this.config)
    assertApp(existsSync(absolutePath), 404, 'audio_file_missing', '音频文件不存在，请重新导入')
    const size = statSync(absolutePath).size
    const range = request.headers.range
    reply.header('Accept-Ranges', 'bytes').header('Content-Type', row.audio_mime_type || 'audio/mpeg')
    if (!range) {
      reply.header('Content-Length', size)
      await reply.send(createReadStream(absolutePath))
      return
    }
    const match = range.match(/^bytes=(\d*)-(\d*)$/)
    assertApp(match, 416, 'invalid_range', '无效的音频范围')
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    assertApp(start >= 0 && start <= end && end < size, 416, 'invalid_range', '无效的音频范围')
    reply.status(206)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Content-Length', end - start + 1)
    await reply.send(createReadStream(absolutePath, { start, end }))
  }

  async streamImage(reply: FastifyReply, name: string, expires: number, signature: string): Promise<void> {
    assertApp(/^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..', 404, 'not_found', '图片不存在')
    assertApp(expires > Math.floor(Date.now() / 1000), 401, 'media_link_expired', '图片链接已过期，请刷新页面')
    const expected = this.sign(`image:${name}:${expires}`)
    const expectedBuffer = Buffer.from(expected)
    const actualBuffer = Buffer.from(signature)
    assertApp(expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer), 401, 'media_link_invalid', '图片链接无效')
    const absolutePath = join(this.config.mediaRoot, 'images', name)
    assertApp(existsSync(absolutePath), 404, 'not_found', '图片不存在')
    const size = statSync(absolutePath).size
    const remainingSeconds = Math.max(0, expires - Math.floor(Date.now() / 1000))
    reply.header('Content-Type', mimeByExtension[extname(name).toLowerCase()] || 'application/octet-stream')
      .header('Content-Length', size)
      .header('Cache-Control', `private, max-age=${remainingSeconds}`)
    await reply.send(createReadStream(absolutePath))
  }

  private sign(value: string): string {
    return createHmac('sha256', this.config.mediaSigningSecret).update(value).digest('base64url')
  }
}
