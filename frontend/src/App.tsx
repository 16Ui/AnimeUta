import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { queryClient } from './lib/query-client'
import { router } from './router'
import DesktopLyricsPage from './pages/DesktopLyricsPage'
import DesktopTitlebar from './components/layout/DesktopTitlebar'
import { isTauriRuntime } from './lib/desktopLyrics'
import { ClientUpdate } from './components/ClientUpdate'

function App() {
  const isDesktopLyricsWindow = new URLSearchParams(window.location.search).get('window') === 'desktop-lyrics'
  const desktopApp = isTauriRuntime()
  return (
    <QueryClientProvider client={queryClient}>
      {isDesktopLyricsWindow ? <DesktopLyricsPage /> : (
        <div className={desktopApp ? 'tauri-app-root' : undefined}>
          {desktopApp && <DesktopTitlebar />}
          <RouterProvider router={router} />
          <ClientUpdate automatic />
        </div>
      )}
    </QueryClientProvider>
  )
}

export default App
