import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ListMusic, Play, Plus, Search, Trash2 } from 'lucide-react'
import { addPlaylistSong, deletePlaylist, getPlaylistDetail, removePlaylistSong, reorderPlaylistSongs, updatePlaylist } from '../api/playlists'
import { listSongs } from '../api/music'
import { getApiErrorMessage } from '../api/error'
import { resolveMediaUrl } from '../api/http'
import { formatRelativeTime } from '../lib/format'
import { queryClient } from '../lib/query-client'
import { useAuthStore } from '../store/useAuthStore'
import { usePlayerStore } from '../store/usePlayerStore'
import { SongRow } from '../components/music/SongRow'
import { BulkSongs } from '../components/music/BulkSongs'
import { EditPlaylistDialog } from '../components/music/EditPlaylistDialog'
import { Pencil } from 'lucide-react'

export default function PlaylistDetailPage({ playlistId: playlistIdProp, embedded = false, onDeleted }: { playlistId?: number; embedded?: boolean; onDeleted?: () => void }) {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const playlistId = Number(playlistIdProp ?? id)
  const token = useAuthStore((state) => state.token)
  const currentUser = useAuthStore((state) => state.currentUser)
  const playFromQueue = usePlayerStore((state) => state.playFromQueue)
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const [songSearch, setSongSearch] = useState('')
  const [editing,setEditing]=useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['playlist-detail', playlistId],
    queryFn: () => getPlaylistDetail(playlistId),
    enabled: Number.isFinite(playlistId) && playlistId > 0,
  })

  const songs = useMemo(() => data?.songs ?? [], [data])
  const isOwner = data?.userId === currentUser?.id
  const canAdd = isOwner || data?.visibility === 'public'
  const visibilityMutation = useMutation({
    mutationFn: (visibility:string) => updatePlaylist(token!,playlistId,{visibility}),
    onSuccess: async()=>{
      await queryClient.invalidateQueries({queryKey:['playlist-detail',playlistId]})
      await queryClient.invalidateQueries({queryKey:['playlists']})
    },
  })
  const searchQuery = useQuery({
    queryKey: ['playlist-song-search', songSearch],
    queryFn: () => listSongs({ keyword: songSearch.trim(), pageSize: 8 }),
    enabled: Boolean(canAdd && songSearch.trim()),
  })
  const existingIds = useMemo(() => new Set(songs.map((item) => item.song.id)), [songs])
  const searchResults = useMemo(() => (searchQuery.data?.data ?? []).filter((song) => !existingIds.has(song.id)), [existingIds, searchQuery.data])
  const queue = useMemo(
    () =>
      songs.map((item) => ({
        id: item.song.id,
        title: item.song.displayTitle,
        artist: item.song.primaryArtistName ?? t('common.unknownArtist'),
        coverUrl: item.song.coverUrl,
        audioUrl: item.song.audioSourceUri,
        durationSeconds: item.song.durationSeconds,
      })),
    [songs, t],
  )

  const addMutation = useMutation({
    mutationFn: (songId: number) => addPlaylistSong(token as string, playlistId, { song_id: songId }),
    onSuccess: async () => {
      setSongSearch('')
      await queryClient.invalidateQueries({ queryKey: ['playlist-detail', playlistId] })
      await queryClient.invalidateQueries({ queryKey: ['playlists', token] })
    },
  })

  const reorderMutation = useMutation({
    mutationFn: (songIds: number[]) => reorderPlaylistSongs(token as string, playlistId, { song_ids: songIds }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playlist-detail', playlistId] })
      await queryClient.invalidateQueries({ queryKey: ['playlists', token] })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (songId: number) => removePlaylistSong(token as string, playlistId, songId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playlist-detail', playlistId] })
      await queryClient.invalidateQueries({ queryKey: ['playlists', token] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deletePlaylist(token as string, playlistId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playlists', token] })
      if (onDeleted) onDeleted()
      else navigate('/playlists', { replace: true })
    },
  })

  const moveSong = (index: number, offset: number) => {
    const target = index + offset
    if (target < 0 || target >= songs.length) return
    const ids = songs.map((item) => item.song.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorderMutation.mutate(ids)
  }

  if (!Number.isFinite(playlistId) || playlistId <= 0) {
    return <p className="p-6 text-red-400">{t('playlists.invalidId')}</p>
  }

  if (isLoading) {
    return <p className="p-6 text-gray-400">{t('playlists.loadingDetail')}</p>
  }

  if (isError || !data) {
    return <p className="p-6 text-red-400">{getApiErrorMessage(error, t('playlists.loadFailed'))}</p>
  }

  return (
    <div className={`${embedded ? '' : 'content-page'} space-y-6`}>
      {editing&&<EditPlaylistDialog key={playlistId} playlist={data} onClose={()=>setEditing(false)}/>}
      {isOwner&&<button type="button" className="secondary-button" onClick={()=>setEditing(true)}><Pencil size={16}/>编辑歌单</button>}
      <div className="playlist-hero grid grid-cols-[72px_minmax(0,1fr)_44px] items-center gap-x-4 gap-y-4 sm:grid-cols-[128px_minmax(0,1fr)_44px]">
        <div className="grid h-[72px] w-[72px] shrink-0 place-items-center overflow-hidden rounded-md bg-[#24242b] shadow-[0_16px_35px_rgba(0,0,0,0.3)] sm:row-span-2 sm:h-32 sm:w-32">
          {data.coverUrl ? <img src={resolveMediaUrl(data.coverUrl)} alt="" className="h-full w-full object-cover" /> : <ListMusic size={34} className="text-zinc-600" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-[#ff6b85]">{t('playlists.title')}</p>
          <h2 className="mt-1 truncate text-2xl font-bold sm:text-3xl">{data.name}</h2>
          {data.description && <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{data.description}</p>}
        </div>
        {isOwner && <button type="button" title={t('common.delete')} aria-label={t('common.delete')} disabled={deleteMutation.isPending} className="icon-button col-start-3 row-start-1 text-zinc-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40" onClick={() => { if (window.confirm(t('playlists.deleteConfirm', { name: data.name }))) deleteMutation.mutate() }}><Trash2 size={18} /></button>}
        <div className="col-span-3 flex flex-wrap items-center gap-4 text-sm text-zinc-400 sm:col-span-2 sm:col-start-2"><span>{t('common.songsCount', { count: songs.length })}</span>{songs.length > 0 && <button type="button" onClick={() => playFromQueue(queue, 0, { type: 'playlist', playlistId: data.id, name: data.name })} className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-[#ff3b5f] px-5 font-semibold text-white hover:bg-[#ff5874]"><Play size={16} fill="currentColor" />{t('common.play')}</button>}</div>
      </div>

      {isOwner&&<label className="flex items-center gap-3 text-sm text-zinc-400">公共歌单<input type="checkbox" checked={data.visibility==='public'} disabled={visibilityMutation.isPending} onChange={e=>visibilityMutation.mutate(e.target.checked?'public':'private')}/></label>}
      {visibilityMutation.isError&&<p role="alert" className="text-red-400">{getApiErrorMessage(visibilityMutation.error,'无法更改可见范围')}</p>}
      {canAdd && (
        <div className="relative max-w-xl">
          <Search size={17} className="pointer-events-none absolute left-3 top-3 text-zinc-500" />
          <input className="account-input h-10 pl-10" value={songSearch} onChange={(event) => setSongSearch(event.target.value)} placeholder={t('playlists.searchToAdd')} />
          {songSearch.trim() && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-white/10 bg-[#202027] shadow-xl">
              {searchQuery.isLoading && <p className="px-3 py-4 text-sm text-zinc-500">{t('common.loading')}</p>}
              {!searchQuery.isLoading && searchResults.length === 0 && <p className="px-3 py-4 text-sm text-zinc-500">{t('playlists.noSearchResults')}</p>}
              {searchResults.map((song) => (
                <button key={song.id} type="button" disabled={addMutation.isPending} onClick={() => addMutation.mutate(song.id)} className="flex w-full items-center gap-3 border-t border-white/[0.06] px-3 py-2 text-left first:border-t-0 hover:bg-white/[0.06] disabled:opacity-40">
                  <span className="min-w-0 flex-1 truncate text-sm text-white">{song.displayTitle}</span>
                  <span className="truncate text-xs text-zinc-500">{song.primaryArtistName ?? t('common.unknownArtist')}</span>
                  <Plus size={15} className="shrink-0 text-[#ff607d]" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {(addMutation.isError || removeMutation.isError || reorderMutation.isError || deleteMutation.isError) && (
        <p className="text-red-400">
          {getApiErrorMessage(addMutation.error ?? removeMutation.error ?? reorderMutation.error ?? deleteMutation.error, t('playlists.operationFailed'))}
        </p>
      )}

      {songs.length === 0 && <p className="text-gray-400">{t('playlists.emptySongs')}</p>}

      <BulkSongs songs={songs.map(item => item.song)} scope={`playlist:${playlistId}`} removeFromPlaylist={isOwner ? playlistId : undefined}>
      <ul className="song-list overflow-hidden border-y border-white/[0.06]">
        {songs.map((item, index) => (
          <li key={item.song.id}>
            <SongRow
              song={item.song}
              eyebrow={<span>#{item.position}</span>}
              onPlay={() => playFromQueue(queue, queue.findIndex((song) => song.id === item.song.id), { type: 'playlist', playlistId: data.id, name: data.name })}
              onPlayNext={() => playNextInQueue(queue.find((song) => song.id === item.song.id)!)}
              onAddToQueue={() => addToQueue(queue.find((song) => song.id === item.song.id)!)}
              meta={item.addedAt ? <span>{t('playlists.addedAt', { time: formatRelativeTime(item.addedAt, i18n.language) })}</span> : null}
              menuActions={isOwner ? <div className="border-t border-white/10 pt-2">
                <button type="button" disabled={index === 0 || reorderMutation.isPending} onClick={() => moveSong(index, -1)}><ArrowUp size={20} />{t('playlists.moveUp')}</button>
                <button type="button" disabled={index === songs.length - 1 || reorderMutation.isPending} onClick={() => moveSong(index, 1)}><ArrowDown size={20} />{t('playlists.moveDown')}</button>
                <button type="button" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate(item.song.id)}><Trash2 size={20} />{t('playlists.removeSong')}</button>
              </div> : null}
            />
          </li>
        ))}
      </ul>
      </BulkSongs>
    </div>
  )
}
