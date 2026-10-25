import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface BackupFileRecord {
  path: string
  sizeBytes: number
  sha256: string
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

export async function inventoryFiles(root: string): Promise<BackupFileRecord[]> {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(absolutePath)
      else if (entry.isFile()) files.push(absolutePath)
    }
  }
  visit(root)
  files.sort((left, right) => left.localeCompare(right))
  return Promise.all(files.map(async (absolutePath) => ({
    path: relative(root, absolutePath).split(sep).join('/'),
    sizeBytes: statSync(absolutePath).size,
    sha256: await sha256File(absolutePath),
  })))
}

export function resolveManifestPath(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes('\\')) throw new Error(`Unsafe backup file path: ${path}`)
  const absoluteRoot = resolve(root)
  const absolutePath = resolve(absoluteRoot, path)
  const rootPrefix = `${absoluteRoot}${sep}`.toLowerCase()
  if (!absolutePath.toLowerCase().startsWith(rootPrefix)) throw new Error(`Unsafe backup file path: ${path}`)
  return absolutePath
}

export function assertDatabaseIntegrity(path: string): void {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const row = database.prepare('PRAGMA integrity_check').get() as { integrity_check?: unknown }
    if (row.integrity_check !== 'ok') throw new Error(`SQLite integrity check failed: ${String(row.integrity_check)}`)
  } finally {
    database.close()
  }
}

export function referencedMediaFiles(path: string): string[] {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const references = new Set<string>()
    const columns = [
      ['app_user', 'avatar_url'], ['artist', 'avatar_url'], ['work', 'cover_url'], ['album', 'cover_url'],
      ['acg_character', 'image_url'], ['voice_actor', 'avatar_url'], ['publisher', 'image_url'], ['label', 'image_url'],
      ['creator', 'image_url'], ['song_version_group', 'image_url'], ['song', 'cover_url'], ['song', 'audio_source_uri'],
      ['lyric', 'source_ref'], ['playlist', 'cover_url'],
    ] as const
    for (const [table, column] of columns) {
      const rows = database.prepare(`SELECT ${column} AS path FROM ${table} WHERE ${column} IS NOT NULL`).all() as Array<{ path: string }>
      for (const row of rows) {
        const value = row.path.replace(/\\/g, '/')
        const localPath = value.startsWith('/media/images/') ? `images/${value.slice('/media/images/'.length)}` : value
        if (localPath.startsWith('audio/') || localPath.startsWith('lyrics/') || localPath.startsWith('images/')) references.add(localPath)
      }
    }
    return [...references].sort((left, right) => left.localeCompare(right))
  } finally {
    database.close()
  }
}

export function referencedExternalAudio(path: string): Array<{ songId: number; uri: string; sha256: string | null; sizeBytes: number | null }> {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = database.prepare("SELECT id, audio_source_uri, audio_checksum, audio_size_bytes FROM song WHERE audio_source_uri LIKE 'file:%'").all() as Array<{ id: number; audio_source_uri: string; audio_checksum: string | null; audio_size_bytes: number | null }>
    return rows.map((row) => ({ songId: row.id, uri: row.audio_source_uri, sha256: row.audio_checksum, sizeBytes: row.audio_size_bytes }))
  } finally { database.close() }
}
