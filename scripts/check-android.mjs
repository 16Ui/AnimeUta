import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8')
const failures = []
const expect = (condition, message) => {
  if (!condition) failures.push(message)
}

const packageJson = JSON.parse(read('frontend/package.json'))
const mainManifest = read('frontend/android/app/src/main/AndroidManifest.xml')
const debugManifest = read('frontend/android/app/src/debug/AndroidManifest.xml')
const mainActivity = read('frontend/android/app/src/main/java/app/animeuta/mobile/MainActivity.java')
const variables = read('frontend/android/variables.gradle')
const nativeBridge = read('frontend/src/components/mobile/NativeAppBridge.tsx')
const styles = read('frontend/src/index.css')
const generatedConfig = JSON.parse(read('frontend/android/app/src/main/assets/capacitor.config.json'))

expect(packageJson.dependencies?.['@capacitor/app'], '@capacitor/app is not installed')
expect(packageJson.dependencies?.['@capacitor/keyboard'], '@capacitor/keyboard is not installed')
expect(mainManifest.includes('android:allowBackup="false"'), 'Android cloud backup must be disabled for private local data')
expect(mainManifest.includes('android:windowSoftInputMode="adjustResize"'), 'the main activity must resize for the soft keyboard')
expect(!mainManifest.includes('android:usesCleartextTraffic="true"'), 'the release manifest must not allow cleartext traffic')
expect(debugManifest.includes('android:usesCleartextTraffic="true"'), 'the debug manifest must allow local HTTP development')
expect(mainActivity.includes('ApplicationInfo.FLAG_DEBUGGABLE'), 'mixed-content access must be gated by the debuggable flag')
expect(variables.includes('minSdkVersion = 24'), 'Android minSdk must remain 24')
expect(variables.includes('targetSdkVersion = 36'), 'Android targetSdk must remain 36')
expect(nativeBridge.includes("App.addListener('backButton'"), 'the native Android back button bridge is missing')
expect(nativeBridge.includes('App.minimizeApp()'), 'the player-preserving root back action is missing')
expect(nativeBridge.includes("Keyboard.addListener('keyboardWillShow'"), 'the native keyboard visibility bridge is missing')
expect(styles.includes('--safe-area-inset-bottom'), 'the SystemBars safe-area fallback is missing')
expect(generatedConfig.server?.androidScheme === 'https', 'the Android WebView scheme must remain HTTPS')
expect(generatedConfig.plugins?.Keyboard?.resizeOnFullScreen === true, 'Keyboard.resizeOnFullScreen must be enabled')
expect(generatedConfig.plugins?.SystemBars?.insetsHandling === 'css', 'SystemBars must inject CSS safe-area insets')

if (failures.length > 0) {
  console.error(`Android audit failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('Android audit passed: plugins, back navigation, keyboard, safe areas, privacy and SDK targets are configured.')
