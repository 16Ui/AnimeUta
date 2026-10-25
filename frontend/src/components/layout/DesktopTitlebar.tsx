import { Maximize2, Minus, X } from 'lucide-react'
import { isTauriRuntime } from '../../lib/desktopLyrics'

async function withCurrentWindow(action: (window: Awaited<ReturnType<typeof import('@tauri-apps/api/window')['getCurrentWindow']>>) => Promise<void>) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await action(getCurrentWindow())
}

export default function DesktopTitlebar() {
  if (!isTauriRuntime()) return null

  return (
    <div
      className="desktop-titlebar pointer-events-none fixed inset-x-0 top-0 z-[100] flex h-9 select-none items-stretch"
    >
      <div
        className="pointer-events-auto absolute inset-y-0 left-0 right-[460px]"
        data-tauri-drag-region
        onDoubleClick={() => void withCurrentWindow((window) => window.toggleMaximize())}
      />
      <div className="pointer-events-auto ml-auto flex h-full items-stretch">
        <button type="button" className="desktop-window-button" aria-label="最小化" onClick={() => void withCurrentWindow((window) => window.minimize())}>
          <Minus size={14} strokeWidth={1.6} />
        </button>
        <button type="button" className="desktop-window-button" aria-label="最大化或还原" onClick={() => void withCurrentWindow((window) => window.toggleMaximize())}>
          <Maximize2 size={12} strokeWidth={1.5} />
        </button>
        <button type="button" className="desktop-window-button desktop-window-close" aria-label="关闭" onClick={() => void withCurrentWindow((window) => window.close())}>
          <X size={14} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  )
}
