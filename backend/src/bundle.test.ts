import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ZipFile } from 'yazl'
import { extractSongBundle } from './bundle.js'
import type { AppConfig } from './config.js'
import type { SavedUpload } from './media.js'

const directories: string[] = []

function config(directory: string): AppConfig {
  return {
    host: '127.0.0.1', port: 0, databasePath: join(directory, 'db.sqlite'), mediaRoot: join(directory, 'media'),
    appOrigins: [], registrationMode: 'invite', friendShareReview: true, bootstrapAdminName: 'Owner', accessTokenTtlMinutes: 30,
    refreshTokenTtlDays: 30, maxAudioBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    mediaSigningSecret: 'test', llmBaseUrl: 'http://127.0.0.1', llmModel: 'test',
    transcriptionModel: 'test', aiDailyLimit: 20,
  }
}

async function writeZip(path: string): Promise<void> {
  const zip = new ZipFile()
  zip.addBuffer(Buffer.from('small-audio'), 'disc/other.mp3')
  zip.addBuffer(Buffer.from('larger-audio-file'), 'disc/song.mp3')
  zip.addBuffer(Buffer.from('[00:01.00]歌'), 'disc/song.lrc')
  zip.addBuffer(Buffer.from('image'), 'disc/cover.jpg')
  zip.end()
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(path)
    output.once('close', resolve)
    output.once('error', reject)
    zip.outputStream.once('error', reject).pipe(output)
  })
}

async function writeCustomZip(path: string, entries: Array<{ name: string; content: Buffer }>): Promise<void> {
  const zip = new ZipFile()
  for (const entry of entries) zip.addBuffer(entry.content, entry.name)
  zip.end()
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(path)
    output.once('close', resolve)
    output.once('error', reject)
    zip.outputStream.once('error', reject).pipe(output)
  })
}

function bundleUpload(path: string): SavedUpload {
  return {
    relativePath: `bundles/${path.split(/[\\/]/).at(-1)}`,
    absolutePath: path,
    originalFilename: 'song.zip',
    mimeType: 'application/zip',
    sizeBytes: statSync(path).size,
    checksum: 'test',
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('song ZIP import', () => {
  it('extracts the primary audio and its matching lyric and cover', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-bundle-'))
    directories.push(directory)
    const path = join(directory, 'song.zip')
    await writeZip(path)
    const extracted = await extractSongBundle(bundleUpload(path), config(directory))

    expect(extracted.audio.originalFilename).toBe('song.mp3')
    expect(extracted.lyrics?.originalFilename).toBe('song.lrc')
    expect(extracted.cover?.originalFilename).toBe('cover.jpg')
    expect(existsSync(extracted.audio.absolutePath)).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  it('rejects unsupported files anywhere in the archive', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-bundle-type-'))
    directories.push(directory)
    const path = join(directory, 'song.zip')
    await writeCustomZip(path, [
      { name: 'song.mp3', content: Buffer.from('audio') },
      { name: 'run.exe', content: Buffer.from('program') },
    ])

    await expect(extractSongBundle(bundleUpload(path), config(directory)))
      .rejects.toMatchObject({ code: 'unsupported_bundle_entry' })
    expect(existsSync(path)).toBe(false)
  })

  it('rejects path traversal entries instead of silently renaming them', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-bundle-path-'))
    directories.push(directory)
    const path = join(directory, 'song.zip')
    await writeCustomZip(path, [{ name: 'aa/song.mp3', content: Buffer.from('audio') }])
    const archive = readFileSync(path)
    const safeName = Buffer.from('aa/song.mp3')
    const unsafeName = Buffer.from('../song.mp3')
    for (let offset = archive.indexOf(safeName); offset >= 0; offset = archive.indexOf(safeName, offset + unsafeName.length)) {
      unsafeName.copy(archive, offset)
    }
    writeFileSync(path, archive)

    await expect(extractSongBundle(bundleUpload(path), config(directory)))
      .rejects.toMatchObject({ code: 'bundle_unsafe_path' })
    expect(existsSync(path)).toBe(false)
  })

  it('limits the uncompressed size of the whole archive', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-bundle-size-'))
    directories.push(directory)
    const path = join(directory, 'song.zip')
    await writeCustomZip(path, [
      { name: 'song.mp3', content: Buffer.from('audio') },
      { name: 'song.txt', content: Buffer.alloc(5 * 1024 * 1024 + 64) },
    ])
    const appConfig = { ...config(directory), maxAudioBytes: 16, maxImageBytes: 16 }

    await expect(extractSongBundle(bundleUpload(path), appConfig))
      .rejects.toMatchObject({ code: 'bundle_too_large' })
    expect(existsSync(path)).toBe(false)
  })
})
