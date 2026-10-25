import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import SongDetailPage from '../src/pages/SongDetailPage'
import { http } from '../src/api/http'
import { usePlayerStore } from '../src/store/usePlayerStore'
import '../src/i18n'
import '../src/index.css'
import '../src/ui-polish.css'
// Keep all requests pending locally, without contacting the production service.
http.defaults.adapter=()=>new Promise(()=>{})
usePlayerStore.setState({currentSong:{id:502,title:'Blue Star (Mark Redito Remix)',artist:'初音ミク / P*Light',coverUrl:`${location.origin}/animeuta-icon-192.png`,audioUrl:''}})
ReactDOM.createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/song/502']}><Routes><Route path="/song/:id" element={<SongDetailPage/>}/></Routes></MemoryRouter></QueryClientProvider>)
