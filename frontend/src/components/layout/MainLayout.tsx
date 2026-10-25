import { Outlet, useLocation } from 'react-router-dom'
import GlobalPlayer from './GlobalPlayer'
import Navbar from './Navbar'
import NativeAppBridge from '../mobile/NativeAppBridge'
import { isTauriRuntime } from '../../lib/desktopLyrics'
import { usePlayerStore } from '../../store/usePlayerStore'

export default function MainLayout() {
  const desktopApp = isTauriRuntime()
  const location = useLocation()
  const isSongPlayer = /^\/song\/\d+(?:\/|$)/.test(location.pathname)
  const hasPlayer = usePlayerStore((state) => Boolean(state.currentSong))
  return (
    <div className={`app-shell min-h-screen overflow-x-hidden bg-[#101014] text-white ${desktopApp ? 'tauri-shell' : ''} ${isSongPlayer ? 'song-route' : ''} ${hasPlayer ? 'has-player' : ''}`}>
      <NativeAppBridge />
      {!isSongPlayer && <Navbar />}
      <main className={`app-main min-h-screen ${isSongPlayer ? 'song-player-main' : 'md:pb-32 md:pl-[232px]'}`}>
        <div className={isSongPlayer ? 'song-player-outlet' : 'page-outlet mx-auto max-w-[1600px] px-4 py-5 md:px-7 lg:px-9'}>
          <Outlet />
        </div>
      </main>
      <GlobalPlayer immersive={isSongPlayer} />
    </div>
  )
}
