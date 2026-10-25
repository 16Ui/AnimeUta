import { createHash } from 'node:crypto'
const origin = 'https://server.example.invalid'
const response = await fetch(`${origin}/updates.json`, { headers: { Origin: 'https://localhost' }, signal: AbortSignal.timeout(20000) })
if (!response.ok || response.headers.get('access-control-allow-origin') !== '*') throw new Error('Manifest or CORS failed')
const manifest = await response.json()
for (const [platform, file] of [['windows', 'AnimeUta-Setup.exe'], ['android', 'AnimeUta.apk']]) {
  const download = await fetch(`${origin}/downloads/${platform}/${file}`, { signal: AbortSignal.timeout(180000) })
  if (!download.ok || !download.headers.get('content-disposition')?.includes('attachment')) throw new Error(`${platform}: download headers failed`)
  const bytes = Buffer.from(await download.arrayBuffer())
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (bytes.length !== manifest[platform].size || hash !== manifest[platform].sha256) throw new Error(`${platform}: integrity failed`)
  console.log(`PASS ${platform} ${manifest[platform].version}: HTTPS, size and SHA256`)
}
console.log('CLIENT_RELEASE_OK')
