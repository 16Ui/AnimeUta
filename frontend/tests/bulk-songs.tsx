import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { BulkSongs } from '../src/components/music/BulkSongs'
import { SongRow } from '../src/components/music/SongRow'
import { queryClient } from '../src/lib/query-client'
import { useAuthStore } from '../src/store/useAuthStore'
import { http } from '../src/api/http'
import '../src/i18n'
import '../src/index.css'

useAuthStore.setState({ token: 'fixture-only', currentUser: { id: 987654 } as any })
let failOnce = true
http.defaults.adapter = async config => {
  if (config.method === 'post' && config.url?.includes('/2') && failOnce) { failOnce = false; throw new Error('Simulated failure') }
  const data = config.url === '/api/v1/me/playlists' ? [{ id: 1, name: '测试歌单' }] : null
  return { data: { data }, status: 200, statusText: 'OK', headers: {}, config }
}
const songs = [
  { id: 1, displayTitle: 'いつかは風を切って知る', primaryArtistName: '测试歌手', audioSourceUri: '/fixture.wav' },
  { id: 2, displayTitle: '長いタイトルの曲を選択してまとめて操作する', primaryArtistName: '初音ミク', audioSourceUri: '/fixture.wav' },
]
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><MemoryRouter><div style={{ width: new URLSearchParams(location.search).has('mobile') ? 390 : 1000, maxWidth: '100%', padding: 12 }}><BulkSongs songs={songs} favorites removeFromPlaylist={1}>{songs.map(song => <SongRow key={song.id} song={song} />)}</BulkSongs></div></MemoryRouter></QueryClientProvider>)
