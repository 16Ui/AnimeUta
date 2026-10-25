import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DesktopLyricsPage from '../src/pages/DesktopLyricsPage'
import { publishDesktopLyricsSnapshot } from '../src/lib/desktopLyrics'
import '../src/i18n'
import '../src/index.css'
import { backendBaseUrl } from '../src/api/http'

document.documentElement.style.setProperty('background', new URLSearchParams(location.search).has('light') ? '#fff' : '#18181b', 'important')

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const params = new URLSearchParams(location.search)
if (params.has('narrow')) document.getElementById('root')!.style.width = '520px'
if (params.has('narrow')) {
  const style = document.createElement('style')
  style.textContent = 'main { width: 520px !important; }'
  document.head.appendChild(style)
}
client.setQueryData(['lyric-preferences', `${backendBaseUrl}:undefined`], {
  showFurigana: true, showRomaji: true, showTranslation: true, showNextLine: true, fontSize: params.has('long') ? 48 : 28,
  desktopBackground: new URLSearchParams(location.search).has('background'),
})
const lines = [
  { id: 1, startMs: 0, originalText: '空', translatedText: '天空' },
  { id: 2, startMs: 1000, originalText: 'いつかは風を切って知る', translatedText: '但它终能察觉掠过的风', romajiText: 'itsuka wa kaze wo kitte shiru' },
]
if (params.has('long')) {
  lines[0] = { id: 1, startMs: 0, originalText: 'いつかは風を切って知る、この歌を聴きながら遠い空の向こうまで歩いていこう', translatedText: '这是很长的一句中文翻译，用来验证桌面歌词不会被截断，而且能自动滚动显示完整内容。' }
}
if (!params.has('error')) client.setQueryData(['desktop-song-lyrics', 1], { languageCode: 'ja', timingOffsetMs: 0, lines })
publishDesktopLyricsSnapshot({ song: { id: 1, title: 'Layout test', artist: 'Test' }, currentTime: 0, isPlaying: false, duration: 20, playbackSessionId: 1 })
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><DesktopLyricsPage /></QueryClientProvider>)

// Alternate lyric lengths without touching the production playback queue.
setInterval(() => publishDesktopLyricsSnapshot({ song: { id: 1, title: 'Layout test', artist: 'Test' }, currentTime: params.has('long') ? 0 : Math.floor(Date.now() / 2000) % 2, isPlaying: false, duration: 20, playbackSessionId: 1 }), 1000)
