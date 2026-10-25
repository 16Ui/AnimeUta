import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join, parse } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import type { AppConfig } from './config.js'
import { AppError, assertApp } from './errors.js'
import { audioExtensions, imageExtensions, lyricExtensions, mimeByExtension, type SavedUpload } from './media.js'

interface BundleEntry {
  fileName: string
  baseName: string
  extension: string
  stem: string
  sizeBytes: number
}

export interface ExtractedSongBundle {
  audio: SavedUpload
  cover?: SavedUpload
  lyrics?: SavedUpload
}

const maxEntryCount = 100
const maxLyricsBytes = 5 * 1024 * 1024

function normalizedStem(fileName: string): string {
  return parse(basename(fileName)).name.trim().toLocaleLowerCase()
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true, decodeStrings: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error('无法读取 ZIP 文件'))
      else resolve(zipFile)
    })
  })
}

function assertSafeEntry(entry: Entry): void {
  const normalized = entry.fileName.replace(/\\/g, '/')
  const segments = normalized.split('/')
  assertApp(
    !normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized) && !segments.includes('..'),
    400,
    'bundle_unsafe_path',
    'ZIP 包含不安全的文件路径',
  )
  assertApp((entry.generalPurposeBitFlag & 0x1) === 0, 400, 'encrypted_bundle', '不支持加密 ZIP 文件')
}

async function listEntries(path: string, maxTotalBytes: number): Promise<BundleEntry[]> {
  const zip = await openZip(path)
  assertApp(zip.entryCount <= maxEntryCount, 400, 'bundle_too_many_files', `ZIP 中最多允许 ${maxEntryCount} 个文件`)
  return new Promise((resolve, reject) => {
    const entries: BundleEntry[] = []
    let totalBytes = 0
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      zip.close()
      reject(error)
    }
    zip.on('entry', (entry: Entry) => {
      try {
        assertSafeEntry(entry)
      } catch (error) {
        fail(error)
        return
      }
      if (/\/$/.test(entry.fileName)) {
        zip.readEntry()
        return
      }
      const extension = extname(entry.fileName).toLowerCase()
      if (!audioExtensions.has(extension) && !imageExtensions.has(extension) && !lyricExtensions.has(extension)) {
        fail(new AppError(400, 'unsupported_bundle_entry', `ZIP 中包含不支持的文件：${basename(entry.fileName)}`))
        return
      }
      totalBytes += entry.uncompressedSize
      if (totalBytes > maxTotalBytes) {
        fail(new AppError(413, 'bundle_too_large', 'ZIP 解压后的文件总量超过允许大小'))
        return
      }
      entries.push({
        fileName: entry.fileName,
        baseName: basename(entry.fileName),
        extension,
        stem: normalizedStem(entry.fileName),
        sizeBytes: entry.uncompressedSize,
      })
      zip.readEntry()
    })
    zip.once('end', () => {
      if (settled) return
      settled = true
      resolve(entries)
    })
    zip.once('error', (error) => {
      if (/invalid relative path|absolute path/i.test(error.message)) {
        fail(new AppError(400, 'bundle_unsafe_path', 'ZIP 包含不安全的文件路径'))
        return
      }
      fail(error)
    })
    zip.readEntry()
  })
}

function chooseFiles(entries: BundleEntry[], bundleName: string): { audio: BundleEntry; cover?: BundleEntry; lyrics?: BundleEntry } {
  const bundleStem = normalizedStem(bundleName)
  const audio = entries
    .filter((entry) => audioExtensions.has(entry.extension))
    .sort((left, right) => Number(right.stem === bundleStem) - Number(left.stem === bundleStem) || right.sizeBytes - left.sizeBytes)[0]
  assertApp(audio, 400, 'bundle_audio_missing', 'ZIP 中没有找到支持的音频文件')
  const lyrics = entries
    .filter((entry) => lyricExtensions.has(entry.extension))
    .sort((left, right) => Number(right.stem === audio.stem) - Number(left.stem === audio.stem) || left.baseName.localeCompare(right.baseName))[0]
  const commonCoverNames = new Set(['cover', 'folder', 'front', 'album'])
  const cover = entries
    .filter((entry) => imageExtensions.has(entry.extension))
    .sort((left, right) => {
      const leftScore = Number(left.stem === audio.stem) * 2 + Number(commonCoverNames.has(left.stem))
      const rightScore = Number(right.stem === audio.stem) * 2 + Number(commonCoverNames.has(right.stem))
      return rightScore - leftScore || right.sizeBytes - left.sizeBytes
    })[0]
  return { audio, ...(cover ? { cover } : {}), ...(lyrics ? { lyrics } : {}) }
}

async function extractEntry(zipPath: string, selected: BundleEntry, kind: 'audio' | 'images' | 'lyrics', config: AppConfig): Promise<SavedUpload> {
  const limit = kind === 'audio' ? config.maxAudioBytes : kind === 'images' ? config.maxImageBytes : maxLyricsBytes
  assertApp(selected.sizeBytes <= limit, 413, 'bundle_entry_too_large', `${selected.baseName} 解压后超过允许大小`)
  const zip = await openZip(zipPath)
  return new Promise((resolve, reject) => {
    let settled = false
    const finishError = (error: unknown) => {
      if (settled) return
      settled = true
      zip.close()
      reject(error)
    }
    zip.on('entry', (entry: Entry) => {
      if (entry.fileName !== selected.fileName) {
        zip.readEntry()
        return
      }
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
        finishError(new AppError(400, 'encrypted_bundle', '不支持加密 ZIP 文件'))
        return
      }
      zip.openReadStream(entry, async (error, stream) => {
        if (error || !stream) {
          finishError(error ?? new Error('无法读取 ZIP 条目'))
          return
        }
        const name = `${Date.now()}-${randomBytes(10).toString('base64url')}${selected.extension}`
        const relativePath = `${kind}/${name}`
        const absolutePath = join(config.mediaRoot, kind, name)
        mkdirSync(join(config.mediaRoot, kind), { recursive: true })
        const hash = createHash('sha256')
        stream.on('data', (chunk: Buffer) => hash.update(chunk))
        try {
          await pipeline(stream, createWriteStream(absolutePath, { flags: 'wx' }))
          const sizeBytes = statSync(absolutePath).size
          assertApp(sizeBytes <= limit, 413, 'bundle_entry_too_large', `${selected.baseName} 解压后超过允许大小`)
          if (settled) return
          settled = true
          zip.close()
          resolve({
            relativePath,
            absolutePath,
            originalFilename: selected.baseName,
            mimeType: mimeByExtension[selected.extension] || 'application/octet-stream',
            sizeBytes,
            checksum: hash.digest('hex'),
          })
        } catch (pipelineError) {
          if (existsSync(absolutePath)) unlinkSync(absolutePath)
          finishError(pipelineError)
        }
      })
    })
    zip.once('error', finishError)
    zip.once('end', () => finishError(new AppError(400, 'bundle_entry_missing', `ZIP 中找不到 ${selected.baseName}`)))
    zip.readEntry()
  })
}

export async function extractSongBundle(bundle: SavedUpload, config: AppConfig): Promise<ExtractedSongBundle> {
  const extracted: SavedUpload[] = []
  try {
    const maxTotalBytes = config.maxAudioBytes + config.maxImageBytes + maxLyricsBytes
    const entries = await listEntries(bundle.absolutePath, maxTotalBytes)
    const selected = chooseFiles(entries, bundle.originalFilename)
    const totalSize = selected.audio.sizeBytes + (selected.cover?.sizeBytes ?? 0) + (selected.lyrics?.sizeBytes ?? 0)
    assertApp(totalSize <= maxTotalBytes, 413, 'bundle_too_large', 'ZIP 解压后的文件总量超过允许大小')
    const audio = await extractEntry(bundle.absolutePath, selected.audio, 'audio', config)
    extracted.push(audio)
    const cover = selected.cover ? await extractEntry(bundle.absolutePath, selected.cover, 'images', config) : undefined
    if (cover) extracted.push(cover)
    const lyrics = selected.lyrics ? await extractEntry(bundle.absolutePath, selected.lyrics, 'lyrics', config) : undefined
    if (lyrics) extracted.push(lyrics)
    return { audio, ...(cover ? { cover } : {}), ...(lyrics ? { lyrics } : {}) }
  } catch (error) {
    for (const file of extracted) if (existsSync(file.absolutePath)) unlinkSync(file.absolutePath)
    if (error instanceof AppError) throw error
    throw new AppError(400, 'invalid_bundle', 'ZIP 文件损坏或格式不受支持')
  } finally {
    if (existsSync(bundle.absolutePath)) unlinkSync(bundle.absolutePath)
  }
}
