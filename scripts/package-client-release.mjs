import { readFile, mkdir, copyFile, cp, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = JSON.parse(await readFile(resolve(root, 'frontend/src-tauri/tauri.conf.json'), 'utf8')).version
const gradle = await readFile(resolve(root, 'frontend/android/app/build.gradle'), 'utf8')
const android = gradle.match(/versionName "([\d.]+)"/)?.[1]
if (!android) throw new Error('Android version missing')
const output = resolve(root, '.runtime/client-release')
await mkdir(output, { recursive: true })
await cp(resolve(root, 'frontend/dist'), output, { recursive: true })
const manifest = {}
for (const [platform, version, input, name] of [
  ['windows', desktop, `.build-cache/tauri-target/release/bundle/nsis/AnimeUta_${desktop}_x64-setup.exe`, 'AnimeUta-Setup.exe'],
  ['android', android, 'frontend/android/app/build/outputs/apk/debug/app-debug.apk', 'AnimeUta.apk'],
]) {
  const source = resolve(root, input)
  const destination = resolve(output, 'downloads', platform, name)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
  manifest[platform] = { version, size: (await stat(source)).size, sha256: createHash('sha256').update(await readFile(source)).digest('hex'), notes: '优化歌曲加载过渡：保留封面、歌名与唱片布局，歌词淡色占位，减少主题色闪变；支持减少动画设置。' }
}
await writeFile(resolve(output, 'updates.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify(manifest, null, 2))
