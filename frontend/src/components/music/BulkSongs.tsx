import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckSquare, Heart, HeartOff, ListPlus, Trash2, X } from 'lucide-react'
import { addFavoriteSong, removeFavoriteSong } from '../../api/favorites'
import { addPlaylistSong, listPlaylists, removePlaylistSong } from '../../api/playlists'
import { CreatePlaylistInline } from './CreatePlaylistInline'
import { getApiErrorStatus } from '../../api/error'
import { backendBaseUrl } from '../../api/http'
import { useAuthStore } from '../../store/useAuthStore'
import { usePlayerStore } from '../../store/usePlayerStore'
import { queryClient } from '../../lib/query-client'
import { Dialog } from '../ui/Dialog'
import type { SongRowSong } from './SongRow'

const Selection = createContext<{ selected: Set<number>; toggle(id: number): void; busy: boolean } | null>(null)
export const useSongSelection = () => useContext(Selection)

export function BulkSongs({ songs, children, removeFromPlaylist, favorites = false, scope = '' }: { songs: SongRowSong[]; children: ReactNode; removeFromPlaylist?: number; favorites?: boolean; scope?: string }) {
  const token = useAuthStore(state => state.token)
  const userId = useAuthStore(state => state.currentUser?.id)
  const [active, setActive] = useState(false)
  const [selected, setSelected] = useState(new Set<number>())
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [message, setMessage] = useState('')
  const [playlist, setPlaylist] = useState('')
  const [confirm, setConfirm] = useState<'unfavorite' | 'remove' | null>(null)
  const identity = `${backendBaseUrl}:${userId}:${scope}`
  const identityRef = useRef(identity)
  identityRef.current = identity
  const ids = songs.map(s => s.id).join(',')
  useEffect(() => { setSelected(new Set()); setActive(false); setMessage('') }, [identity])
  useEffect(() => { setSelected(previous => new Set([...previous].filter(id => songs.some(song => song.id === id)))) }, [ids])
  const playlists = useQuery({ queryKey: ['playlists', token], queryFn: () => listPlaylists(token!), enabled: active && !!token })
  const toggle = (id: number) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const run = async (action: 'favorite' | 'unfavorite' | 'playlist' | 'queue' | 'remove') => {
    if (!token || running.current) return
    const items = songs.filter(s => selected.has(s.id))
    if (!items.length) return
    running.current = true; setBusy(true); setMessage(''); setConfirm(null)
    let completed = 0
    const failed = new Set<number>()
    try {
      for (let index = 0; index < items.length; index++) {
        const song = items[index]
        if (identityRef.current !== identity || useAuthStore.getState().currentUser?.id !== userId) break
        try {
          if (action === 'favorite') await addFavoriteSong(token, song.id)
          if (action === 'unfavorite') await removeFavoriteSong(token, song.id)
          if (action === 'playlist') await addPlaylistSong(token, Number(playlist), { song_id: song.id })
          if (action === 'remove' && removeFromPlaylist) await removePlaylistSong(token, removeFromPlaylist, song.id)
          if (action === 'queue') {
            if (!song.audioSourceUri) throw new Error('missing audio')
            usePlayerStore.getState().addToQueue({ id: song.id, title: song.displayTitle, artist: song.primaryArtistName ?? '', audioUrl: song.audioSourceUri, coverUrl: song.coverUrl, durationSeconds: song.durationSeconds })
          }
          completed++
        } catch (error) {
          failed.add(song.id)
          if (getApiErrorStatus(error) === 401) { items.slice(index + 1).forEach(item => failed.add(item.id)); break }
        }
        setMessage(`已处理 ${index + 1} / ${items.length}`)
      }
      if (identityRef.current === identity) {
        setSelected(failed)
        setMessage(`成功 ${completed} 首${failed.size ? `，未完成 ${failed.size} 首，已保留勾选，可重试` : ''}`)
      }
      await queryClient.invalidateQueries({ queryKey: ['favorite-songs'] })
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
      await queryClient.invalidateQueries({ queryKey: ['playlist-detail'] })
    } finally { running.current = false; setBusy(false) }
  }
  return <Selection.Provider value={active ? { selected, toggle, busy } : null}>
    <div className={`bulk-toolbar flex flex-wrap items-center gap-2 border-b border-white/10 py-3 text-sm ${active ? 'is-selecting' : ''}`}>
      <button type="button" className="secondary-button" disabled={busy || !songs.length} onClick={() => { setActive(!active); setSelected(new Set()); setMessage('') }}>{active ? <X size={16} /> : <CheckSquare size={16} />}{active ? '取消选择' : '批量操作'}</button>
      {active && <><label className="flex items-center gap-2 px-2"><input type="checkbox" disabled={busy} checked={songs.length > 0 && songs.every(s => selected.has(s.id))} onChange={e => setSelected(e.target.checked ? new Set(songs.map(s => s.id)) : new Set())} />全选当前列表</label><span className="text-zinc-400">已选 {selected.size}</span>
        <button type="button" className="icon-button" title="加入播放队列" aria-label="批量加入播放队列" disabled={busy || !selected.size} onClick={() => void run('queue')}><ListPlus size={18} /></button>
        <button type="button" className="icon-button" title="收藏所选歌曲" aria-label="批量收藏" disabled={busy || !selected.size} onClick={() => void run('favorite')}><Heart size={18} /></button>
        {favorites && <button type="button" className="icon-button" title="取消收藏" aria-label="批量取消收藏" disabled={busy || !selected.size} onClick={() => setConfirm('unfavorite')}><HeartOff size={18} /></button>}
        <select aria-label="目标歌单" disabled={busy || playlists.isLoading} value={playlist} onChange={e => setPlaylist(e.target.value)} className="h-9 max-w-44 rounded border border-white/15 bg-[#25252c] px-2"><option value="">选择歌单</option>{playlists.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <CreatePlaylistInline disabled={busy} onCreated={p=>setPlaylist(String(p.id))}/>
        <button type="button" className="secondary-button" disabled={busy || !selected.size || !playlist} onClick={() => void run('playlist')}><ListPlus size={16} />加入歌单</button>
        {removeFromPlaylist && <button type="button" className="icon-button" title="从此歌单移除" aria-label="批量移出歌单" disabled={busy || !selected.size} onClick={() => setConfirm('remove')}><Trash2 size={18} /></button>}
        {playlists.isError && <button type="button" className="text-red-300" onClick={() => void playlists.refetch()}>歌单加载失败，重试</button>}
      </>}
      {message && <p role="status" className="w-full text-xs text-zinc-400">{message}</p>}
    </div>
    {children}
    <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'remove' ? '移出歌单' : '取消收藏'}><div className="space-y-4 p-5"><p>确定对选中的 {selected.size} 首歌曲执行此操作？不会删除音乐文件。</p><button type="button" className="primary-button" onClick={() => confirm && void run(confirm)}>确认</button></div></Dialog>
  </Selection.Provider>
}
