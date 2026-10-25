import { fitLyricsBounds, type WindowBounds, type SentenceRange } from './lyricPlayback'

export interface DesktopLyricsSnapshot {
  song: {
    id: number
    title: string
    artist: string
  } | null
  currentTime: number
  isPlaying: boolean
  sentAt: number
  duration?: number
  playbackSessionId?: number
  playbackRate?: number
  sentenceLoop?: SentenceRange | null
}

export interface DesktopLyricsCommand {
  action: 'toggle' | 'previous' | 'next' | 'replay' | 'loop' | 'rate'
  songId: number
  sessionId?: number
  range?: SentenceRange
  rate?: number
}
const commandKey = 'animeuta-desktop-lyrics-command'
export function sendDesktopLyricsCommand(command: DesktopLyricsCommand) {
  localStorage.setItem(commandKey, JSON.stringify({ ...command, sentAt: Date.now(), id: crypto.randomUUID() }))
}
export function subscribeDesktopLyricsCommands(listener: (command: DesktopLyricsCommand) => void) {
  const receive = (event: StorageEvent) => {
    if (event.key !== commandKey || !event.newValue) return
    try {
      const value = JSON.parse(event.newValue)
      if (Math.abs(Date.now() - value.sentAt) < 5000 && Number.isInteger(value.songId)) listener(value)
    } catch { /* Ignore invalid or obsolete commands. */ }
  }
  window.addEventListener('storage', receive)
  return () => window.removeEventListener('storage', receive)
}

const boundsKey = 'animeuta-desktop-lyrics-bounds'
export async function restoreDesktopLyricsBounds(reset = false) {
  if (!isTauriRuntime()) return
  const { Window, availableMonitors, currentMonitor, PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/window')
  const win = await Window.getByLabel('desktop-lyrics')
  if (!win) return
  const monitors = await availableMonitors()
  const current = await currentMonitor()
  const screens = monitors.map(m => ({ ...m.workArea.position, ...m.workArea.size }))
  if (current) screens.unshift({ ...current.workArea.position, ...current.workArea.size })
  const size = await win.outerSize()
  const screen = screens[0]
  if (!screen) return
  let saved: WindowBounds = { ...size, x: screen.x + (screen.width - size.width) / 2, y: screen.y + screen.height - size.height - 40 }
  if (!reset) {
    try {
      const value = JSON.parse(localStorage.getItem(boundsKey) ?? 'null')
      if (value && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(value[k]))) saved = { ...value, height: size.height }
    } catch { /* Use current monitor when stored bounds are invalid. */ }
  }
  const fitted = fitLyricsBounds(saved, screens)
  await win.setSize(new PhysicalSize(fitted.width, fitted.height))
  await win.setPosition(new PhysicalPosition(fitted.x, fitted.y))
  if (reset) await win.show()
}

export function watchDesktopLyricsBounds(): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const cleanups: (() => void)[] = []
  void (async () => {
    if (!isTauriRuntime()) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const save = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { void (async () => {
        const position = await win.outerPosition()
        const size = await win.outerSize()
        if (!stopped) localStorage.setItem(boundsKey, JSON.stringify({ ...position, ...size }))
      })().catch(console.error) }, 250)
    }
    for (const subscribe of [() => win.onMoved(save), () => win.onResized(save)]) {
      const unlisten = await subscribe()
      if (stopped) unlisten(); else cleanups.push(unlisten)
    }
  })().catch(console.error)
  return () => { stopped = true; clearTimeout(timer); cleanups.forEach(fn => fn()) }
}

const storageKey = 'animeuta-desktop-lyrics-snapshot'
const channelName = 'animeuta-desktop-lyrics'
const timingStorageKey = 'animeuta-desktop-lyrics-timing'
const timingChannelName = 'animeuta-desktop-lyrics-timing'
let publisherChannel: BroadcastChannel | undefined
let timingPublisherChannel: BroadcastChannel | undefined

export interface DesktopLyricsTimingOffset {
  songId: number
  timingOffsetMs: number
  sentAt: number
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function publishDesktopLyricsSnapshot(snapshot: Omit<DesktopLyricsSnapshot, 'sentAt'>): void {
  if (typeof window === 'undefined') return
  const value: DesktopLyricsSnapshot = { ...snapshot, sentAt: Date.now() }
  localStorage.setItem(storageKey, JSON.stringify(value))
  if ('BroadcastChannel' in window) {
    publisherChannel ??= new BroadcastChannel(channelName)
    publisherChannel.postMessage(value)
  }
}

export function readDesktopLyricsSnapshot(): DesktopLyricsSnapshot | null {
  try {
    const value = localStorage.getItem(storageKey)
    return value ? JSON.parse(value) as DesktopLyricsSnapshot : null
  } catch {
    return null
  }
}

export function subscribeDesktopLyricsSnapshot(listener: (snapshot: DesktopLyricsSnapshot) => void): () => void {
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(channelName) : undefined
  const onMessage = (event: MessageEvent<DesktopLyricsSnapshot>) => listener(event.data)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey || !event.newValue) return
    try { listener(JSON.parse(event.newValue) as DesktopLyricsSnapshot) } catch { /* Ignore incomplete writes. */ }
  }
  channel?.addEventListener('message', onMessage)
  window.addEventListener('storage', onStorage)
  return () => {
    channel?.removeEventListener('message', onMessage)
    channel?.close()
    window.removeEventListener('storage', onStorage)
  }
}

export function publishDesktopLyricsTimingOffset(songId: number, timingOffsetMs: number): void {
  if (typeof window === 'undefined') return
  const value: DesktopLyricsTimingOffset = { songId, timingOffsetMs, sentAt: Date.now() }
  localStorage.setItem(timingStorageKey, JSON.stringify(value))
  if ('BroadcastChannel' in window) {
    timingPublisherChannel ??= new BroadcastChannel(timingChannelName)
    timingPublisherChannel.postMessage(value)
  }
}

export function subscribeDesktopLyricsTimingOffset(listener: (value: DesktopLyricsTimingOffset) => void): () => void {
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(timingChannelName) : undefined
  const onMessage = (event: MessageEvent<DesktopLyricsTimingOffset>) => listener(event.data)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== timingStorageKey || !event.newValue) return
    try { listener(JSON.parse(event.newValue) as DesktopLyricsTimingOffset) } catch { /* Ignore incomplete writes. */ }
  }
  channel?.addEventListener('message', onMessage)
  window.addEventListener('storage', onStorage)
  return () => {
    channel?.removeEventListener('message', onMessage)
    channel?.close()
    window.removeEventListener('storage', onStorage)
  }
}

export async function toggleDesktopLyricsWindow(): Promise<boolean> {
  if (!isTauriRuntime()) return false
  const { Window } = await import('@tauri-apps/api/window')
  const lyricsWindow = await Window.getByLabel('desktop-lyrics')
  if (!lyricsWindow) return false
  const visible = await lyricsWindow.isVisible()
  if (visible) await lyricsWindow.hide()
  else { await restoreDesktopLyricsBounds(); await lyricsWindow.show() }
  return !visible
}

export async function hideDesktopLyricsWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().hide()
}

export async function dragDesktopLyricsWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().startDragging()
}

export async function setDesktopLyricsWindowLocked(locked: boolean): Promise<void> {
  if (!isTauriRuntime()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setResizable(!locked)
}

export const desktopLyricsLockKey = 'animeuta-desktop-lyrics-locked'
export function changeDesktopLyricsLock(locked: boolean) {
  localStorage.setItem(desktopLyricsLockKey, String(locked))
  window.dispatchEvent(new Event(desktopLyricsLockKey))
}

// Transparent pixels in a native window still receive clicks. Hit-test the
// visible content in screen coordinates even while the window ignores input.
export function desktopLyricsPointerState(locked: boolean, lyricHit: boolean, controlHit: boolean) {
  return { hovered: lyricHit || controlHit, ignore: locked ? !controlHit : !(lyricHit || controlHit) }
}

export function watchDesktopLyricsHitArea(isLocked: () => boolean, onHover: (hovered: boolean) => void): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  let ignored: boolean | undefined
  const tick = async () => {
    try {
      if (!isTauriRuntime() || stopped) return
      const { getCurrentWindow, cursorPosition } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const cursor = await cursorPosition()
      const origin = await win.outerPosition()
      const scale = await win.scaleFactor()
      const x = (cursor.x - origin.x) / scale
      const y = (cursor.y - origin.y) / scale
      const containsCursor = (element: Element) => {
        const rect = element.getBoundingClientRect()
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      }
      const hit = [...document.querySelectorAll('[data-lyrics-hit]')].some(containsCursor)
      const controlHit = [...document.querySelectorAll('[data-lyrics-controls]')].some(containsCursor)
      // Locked lyrics pass through, but the fixed toolbar must remain reachable.
      const { hovered, ignore } = desktopLyricsPointerState(isLocked(), hit, controlHit)
      if (!stopped) onHover(hovered)
      if (!stopped && ignored !== ignore) {
        await win.setIgnoreCursorEvents(ignore)
        ignored = ignore
      }
    } catch (error) { console.warn('Desktop lyrics hit test failed', error) }
    finally { if (!stopped) timer = setTimeout(tick, 100) }
  }
  void tick()
  return () => { stopped = true; clearTimeout(timer) }
}
