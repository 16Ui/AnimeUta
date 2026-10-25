import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const distRoot = resolve(projectRoot, 'frontend', 'dist')
const packageJson = readFileSync(resolve(projectRoot, 'frontend', 'package.json'), 'utf8')
const indexHtml = readFileSync(resolve(distRoot, 'index.html'), 'utf8')
const distFiles = readdirSync(distRoot)

const failures = []
if (packageJson.includes('vite-plugin-pwa')) failures.push('vite-plugin-pwa is still installed')
if (indexHtml.includes('rel="manifest"')) failures.push('the generated page still links a web app manifest')
if (existsSync(resolve(distRoot, 'manifest.webmanifest'))) failures.push('manifest.webmanifest was generated')
if (existsSync(resolve(distRoot, 'sw.js'))) failures.push('sw.js was generated')
if (distFiles.some((name) => /^workbox-.*\.js$/.test(name))) failures.push('a Workbox runtime was generated')

if (failures.length > 0) {
  console.error(`Web build audit failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('Web build audit passed: no PWA manifest, service worker, or Workbox runtime was generated.')
