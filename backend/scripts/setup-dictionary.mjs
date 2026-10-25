import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { Decompress } from 'fzstd'

const release = 'v2026-09-02'
const url = `https://github.com/tomoshi-app/tomoshi-dict-data/releases/download/${release}/tomoshi-dict-open.db.zst`
const compressedSha256 = '7153dfd7a8e42e2d920308370eac90cf9f2e4b4cfe67fb9a86e9aa1c89494073'
const databaseSha256 = '8b19c7d65a7d7d6df9afc58832b17b22fd349724e5d06d2acf3bb9a6c4b0ed9d'
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(backendRoot, 'data/dictionaries/tomoshi-dict-open.db')
const archive = `${target}.download.zst`

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

class ZstdDecompressStream extends Transform {
  #decompressor = new Decompress((data) => this.push(data))

  _transform(chunk, _encoding, callback) {
    try {
      this.#decompressor.push(chunk, false)
      callback()
    } catch (error) {
      callback(error)
    }
  }

  _flush(callback) {
    try {
      this.#decompressor.push(new Uint8Array(), true)
      callback()
    } catch (error) {
      callback(error)
    }
  }
}

mkdirSync(dirname(target), { recursive: true })
if (existsSync(target) && await sha256(target) === databaseSha256) {
  console.log(`Tomoshi dictionary ${release} is ready: ${target}`)
  process.exit(0)
}

rmSync(archive, { force: true })
console.log(`Downloading Tomoshi dictionary ${release}...`)
const response = await fetch(url, { redirect: 'follow' })
if (!response.ok || !response.body) throw new Error(`Dictionary download failed: HTTP ${response.status}`)
await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
if (await sha256(archive) !== compressedSha256) {
  rmSync(archive, { force: true })
  throw new Error('Compressed dictionary SHA-256 mismatch')
}

console.log('Decompressing dictionary...')
await pipeline(createReadStream(archive), new ZstdDecompressStream(), createWriteStream(target))
rmSync(archive, { force: true })
if (await sha256(target) !== databaseSha256) {
  rmSync(target, { force: true })
  throw new Error('Dictionary SHA-256 mismatch')
}
console.log(`Tomoshi dictionary ${release} is ready: ${target}`)
