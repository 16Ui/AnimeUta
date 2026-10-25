import { Capacitor, registerPlugin } from '@capacitor/core'
import { isTauriRuntime } from './desktopLyrics'

export const releaseOrigin = 'https://server.example.invalid'
export type ClientPlatform = 'windows' | 'android'
export interface ClientRelease { version: string; notes: string; sha256: string; size: number }
export function newerVersion(candidate: string, current: string) {
  if (![candidate, current].every(v => /^\d+\.\d+\.\d+$/.test(v))) return false
  const a = candidate.split('.').map(Number), b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i] }
  return false
}
export async function currentClient(): Promise<{ platform: ClientPlatform; version: string } | null> {
  if (isTauriRuntime()) {
    const { getVersion } = await import('@tauri-apps/api/app')
    return { platform: 'windows', version: await getVersion() }
  }
  if (Capacitor.getPlatform() === 'android') {
    const { App } = await import('@capacitor/app')
    return { platform: 'android', version: (await App.getInfo()).version }
  }
  return null
}
export async function checkClientUpdate() {
  const client = await currentClient()
  if (!client) return { client, release: null }
  const response = await fetch(`${releaseOrigin}/updates.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error('更新服务暂时不可用，请稍后重试')
  const manifest = await response.json()
  const release = manifest[client.platform] as ClientRelease | undefined
  if (!release || !/^\d+\.\d+\.\d+$/.test(release.version) || !/^[a-f0-9]{64}$/.test(release.sha256) || !Number.isFinite(release.size) || release.size <= 0 || typeof release.notes !== 'string') throw new Error('更新信息不完整，请稍后重试')
  return { client, release: newerVersion(release.version, client.version) ? release : null }
}
export async function downloadClientUpdate() {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_release_download')
  } else if (Capacitor.getPlatform() === 'android') {
    await registerPlugin<{ openDownload(): Promise<void> }>('ClientUpdates').openDownload()
  }
}
