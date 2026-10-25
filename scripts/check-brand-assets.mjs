import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')

function pngDimensions(relativePath) {
  const path = resolve(projectRoot, relativePath)
  const file = readFileSync(path)
  if (file.length < 24 || file.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${relativePath} is not a valid PNG.`)
  }
  return [file.readUInt32BE(16), file.readUInt32BE(20)]
}

function expectPng(relativePath, width, height = width) {
  const [actualWidth, actualHeight] = pngDimensions(relativePath)
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(`${relativePath} is ${actualWidth}x${actualHeight}; expected ${width}x${height}.`)
  }
}

expectPng('frontend/public/animeuta-icon-32.png', 32)
expectPng('frontend/src-tauri/icons/32x32.png', 32)
expectPng('frontend/src-tauri/icons/128x128.png', 128)
expectPng('frontend/src-tauri/icons/128x128@2x.png', 256)
expectPng('frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024)
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  expectPng(`frontend/ios/App/App/Assets.xcassets/Splash.imageset/${name}`, 2732)
}

const densities = {
  mdpi: [48, 108],
  hdpi: [72, 162],
  xhdpi: [96, 216],
  xxhdpi: [144, 324],
  xxxhdpi: [192, 432],
}
for (const [density, [launcherSize, foregroundSize]] of Object.entries(densities)) {
  const root = `frontend/android/app/src/main/res/mipmap-${density}`
  expectPng(`${root}/ic_launcher.png`, launcherSize)
  expectPng(`${root}/ic_launcher_round.png`, launcherSize)
  expectPng(`${root}/ic_launcher_foreground.png`, foregroundSize)
}

const androidSplash = {
  'drawable/splash.png': [480, 320],
  'drawable-land-mdpi/splash.png': [480, 320],
  'drawable-land-hdpi/splash.png': [800, 480],
  'drawable-land-xhdpi/splash.png': [1280, 720],
  'drawable-land-xxhdpi/splash.png': [1600, 960],
  'drawable-land-xxxhdpi/splash.png': [1920, 1280],
  'drawable-port-mdpi/splash.png': [320, 480],
  'drawable-port-hdpi/splash.png': [480, 800],
  'drawable-port-xhdpi/splash.png': [720, 1280],
  'drawable-port-xxhdpi/splash.png': [960, 1600],
  'drawable-port-xxxhdpi/splash.png': [1280, 1920],
}
for (const [path, [width, height]] of Object.entries(androidSplash)) {
  expectPng(`frontend/android/app/src/main/res/${path}`, width, height)
}

const adaptiveBackground = readFileSync(
  resolve(projectRoot, 'frontend/android/app/src/main/res/values/ic_launcher_background.xml'),
  'utf8',
)
if (!adaptiveBackground.includes('#111116')) throw new Error('Android adaptive icon background is not branded.')

console.log('Brand asset audit passed: Web, Tauri desktop, Android and iOS assets are complete.')
