import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpenCheck, Check, Heart, ListPlus, Play, Library } from 'lucide-react'
import { addFavoriteSong, listFavoriteSongs, removeFavoriteSong } from '../api/favorites'
import { getApiErrorMessage, getApiErrorStatus } from '../api/error'
import { resolveMediaUrl } from '../api/http'
import { listPlayHistory } from '../api/history'
import { listSongs } from '../api/music'
import { addPlaylistSong, listPlaylists } from '../api/playlists'
import { CreatePlaylistInline } from '../components/music/CreatePlaylistInline'
import { getStudyToday } from '../api/study'
import { SongRow } from '../components/music/SongRow'
import { BulkSongs } from '../components/music/BulkSongs'
import { LibrarySearch } from '../components/music/LibrarySearch'
import { Pagination } from '../components/navigation/Pagination'
import { queryClient } from '../lib/query-client'
import { useAuthStore } from '../store/useAuthStore'
import { usePlayerStore } from '../store/usePlayerStore'
import type { SongListItem } from '../types/music'

function SongCover({ song, className = '' }: { song: SongListItem; className?: string }) {
  if (song.coverUrl) {
    return <img src={resolveMediaUrl(song.coverUrl)} alt={song.displayTitle} className={`object-cover ${className}`} />
  }
  return (
    <div className={`flex items-center justify-center bg-[#252531] text-xl font-black text-[#ff3b5f] ${className}`}>
      AU
    </div>
  )
}

export default function HomePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const currentSong = usePlayerStore((state) => state.currentSong)
  const playNow = usePlayerStore((state) => state.playNow)
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const resumeQueue = usePlayerStore((state) => state.resumeQueue)
  const token = useAuthStore((state) => state.token)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const [playlistMenuSongId, setPlaylistMenuSongId] = useState<number | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const libraryPage = Math.max(1, Math.min(100000, Math.floor(Number(searchParams.get('page')) || 1)))
  const setLibraryPage = useCallback((page: number) => setSearchParams((previous) => {
    const params = new URLSearchParams(previous)
    if (page === 1) params.delete('page'); else params.set('page', String(page))
    return params
  }, { replace: true }), [setSearchParams])
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const playlistMenuRef = useRef<HTMLDivElement | null>(null)
  const libraryRef = useRef<HTMLElement | null>(null)
  const libraryPageSize = 12

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['songs', 'home', libraryPage, libraryPageSize],
    queryFn: () => listSongs({ page: libraryPage, pageSize: libraryPageSize }),
    placeholderData: keepPreviousData,
  })

  const historyQuery = useQuery({
    queryKey: ['play-history', 'home', token],
    queryFn: () => listPlayHistory(token as string, { page: 1, pageSize: 1 }),
    enabled: Boolean(token),
  })

  const favoritesQuery = useQuery({
    queryKey: ['favorite-songs', token],
    queryFn: () => listFavoriteSongs(token as string, { page: 1, pageSize: 200 }),
    enabled: Boolean(token),
  })

  const playlistsQuery = useQuery({
    queryKey: ['playlists', token],
    queryFn: () => listPlaylists(token as string),
    enabled: Boolean(token),
  })

  const songs = useMemo(() => data?.data ?? [], [data])
  const favoriteSongIds = useMemo(() => new Set((favoritesQuery.data?.data ?? []).map((song) => song.id)), [favoritesQuery.data])
  const playlists = useMemo(() => playlistsQuery.data ?? [], [playlistsQuery.data])
  const studyTodayQuery = useQuery({
    queryKey: ['study-today', 'ja_zh', 'home'],
    queryFn: () => getStudyToday('ja_zh'),
    enabled: Boolean(token),
  })
  const recentSong = historyQuery.data?.data[0]?.song
  const restoredSong: SongListItem | undefined = currentSong ? {
    id: currentSong.id,
    displayTitle: currentSong.title,
    primaryArtistName: currentSong.artist,
    coverUrl: currentSong.coverUrl,
    audioSourceUri: currentSong.audioUrl,
    durationSeconds: currentSong.durationSeconds,
  } : undefined
  const leadSong = restoredSong ?? recentSong ?? songs[0]

  const toPlayerSong = (song: SongListItem) => ({
    id: song.id,
    title: song.displayTitle,
    artist: song.primaryArtistName ?? t('common.unknownArtist'),
    coverUrl: song.coverUrl,
    audioUrl: resolveMediaUrl(song.audioSourceUri),
    durationSeconds: song.durationSeconds,
  })

  const playSong = (song: SongListItem) => playNow(toPlayerSong(song))

  const requireLogin = () => {
    clearAuth()
    navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
  }

  const favoriteMutation = useMutation({
    mutationFn: ({ songId, favorite }: { songId: number; favorite: boolean }) =>
      favorite ? removeFavoriteSong(token as string, songId) : addFavoriteSong(token as string, songId),
    onSuccess: async (_, variables) => {
      setFeedback({ type: 'success', message: t(variables.favorite ? 'song.favorite.removed' : 'song.favorite.added') })
      await queryClient.invalidateQueries({ queryKey: ['favorite-songs', token] })
    },
    onError: (mutationError) => {
      if (getApiErrorStatus(mutationError) === 401) {
        requireLogin()
        return
      }
      setFeedback({ type: 'error', message: getApiErrorMessage(mutationError, t('song.favorite.operationFailed')) })
    },
  })

  const playlistMutation = useMutation({
    mutationFn: ({ playlistId, songId }: { playlistId: number; songId: number }) =>
      addPlaylistSong(token as string, playlistId, { song_id: songId }),
    onSuccess: async (_, variables) => {
      const playlist = playlists.find((item) => item.id === variables.playlistId)
      setFeedback({ type: 'success', message: t('playlists.songAdded', { name: playlist?.name ?? t('playlists.title') }) })
      setPlaylistMenuSongId(null)
      await queryClient.invalidateQueries({ queryKey: ['playlists', token] })
      await queryClient.invalidateQueries({ queryKey: ['playlist-detail', variables.playlistId] })
    },
    onError: (mutationError) => {
      if (getApiErrorStatus(mutationError) === 401) {
        requireLogin()
        return
      }
      setFeedback({ type: 'error', message: getApiErrorMessage(mutationError, t('playlists.operationFailed')) })
    },
  })

  useEffect(() => {
    if (playlistMenuSongId === null) return
    const close = (event: PointerEvent) => {
      if (!playlistMenuRef.current?.contains(event.target as Node)) setPlaylistMenuSongId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlaylistMenuSongId(null)
    }
    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [playlistMenuSongId])

  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), 3_000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  useEffect(() => {
    if (!data?.pagination) return
    const pageCount = Math.max(1, Math.ceil(data.pagination.total / data.pagination.page_size))
    if (libraryPage > pageCount) setLibraryPage(pageCount)
  }, [data?.pagination, libraryPage, setLibraryPage])

  const changeLibraryPage = (page: number) => {
    setLibraryPage(page)
    setPlaylistMenuSongId(null)
    window.requestAnimationFrame(() => libraryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className={`content-page home-page ${searchParams.get('q')?.trim() ? 'is-searching' : ''}`}>
      {!searchParams.get('q')?.trim() && <header className="page-heading">
        <div>
          <h2>{t('home.libraryTitle')}</h2>
        </div>
      </header>}
      <LibrarySearch />
      {!searchParams.get('q')?.trim() && <>

      <section className="home-overview grid gap-4 border-b border-white/[0.065] pb-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(270px,0.8fr)]">
        {leadSong ? (
          <div className="home-now-playing grid min-w-0 grid-cols-[88px_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[144px_minmax(0,1fr)] sm:gap-6">
            <SongCover song={leadSong} className="aspect-square w-full rounded-md" />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-[#ff6b85]">{t(currentSong || recentSong ? 'home.continueListening' : 'home.startLearning')}</p>
              <h3 className="mt-1 truncate text-lg font-semibold sm:text-xl">{leadSong.displayTitle}</h3>
              <p className="mt-1 truncate text-sm text-zinc-400 sm:mt-2">{leadSong.primaryArtistName ?? t('common.unknownArtist')}</p>
              {leadSong.primaryWorkTitle && <p className="mt-1 hidden truncate text-sm text-zinc-600 sm:block">{leadSong.primaryWorkTitle}</p>}
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={!leadSong.audioSourceUri} onClick={() => currentSong ? resumeQueue() : playSong(leadSong)} className="primary-button">
                  <Play size={16} fill="currentColor" />
                  {t('common.play')}
                </button>
                <Link className="secondary-button min-w-0 truncate" to={leadSong.id<0?'/online':`/song/${leadSong.id}`}>
                  {t('common.viewDetail')}
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-44 flex-col items-start justify-center">
            <h3 className="text-xl font-semibold">{t('home.emptyTitle')}</h3>
            <p className="mt-2 max-w-lg text-sm text-zinc-500">{t('home.emptyHint')}</p>
            <Link className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#ff6b85] hover:text-[#ff91a4]" to="/online">
              <Library size={16} />
              {t('home.chooseFromLibrary')}
            </Link>
          </div>
        )}

        <div className="home-study-summary border-t border-white/[0.08] pt-4 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BookOpenCheck size={18} className="text-[#ff6b85]" />
              <h3 className="font-semibold">{t('home.studyToday')}</h3>
            </div>
            <Link className="text-sm text-zinc-500 hover:text-white" to="/study">{t('home.startReview')}</Link>
          </div>
          <div className="study-summary-stats mt-3 grid grid-cols-3 gap-3">
            <div><p className="text-2xl font-semibold">{studyTodayQuery.data?.due ?? 0}</p><p className="mt-1 text-xs text-zinc-500">{t('study.due')}</p></div>
            <div><p className="text-2xl font-semibold">{studyTodayQuery.data?.new ?? 0}</p><p className="mt-1 text-xs text-zinc-500">{t('home.newCards')}</p></div>
            <div><p className="text-2xl font-semibold">{studyTodayQuery.data?.streakDays ?? 0}</p><p className="mt-1 text-xs text-zinc-500">{t('home.streakDays')}</p></div>
          </div>
          <div className="study-summary-progress mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-[#ff3b5f]" style={{ width: `${studyTodayQuery.data?.masteryPercent ?? 0}%` }} />
          </div>
          <p className="study-summary-progress mt-2 text-xs text-zinc-500">{t('home.mastery', { value: studyTodayQuery.data?.masteryPercent ?? 0 })}</p>
        </div>
      </section>

      <section aria-label="公共歌单" className="space-y-4">
        <div className="flex items-center justify-between"><h3 className="section-title">公共歌单</h3><Link to="/playlists" className="text-sm text-zinc-400">全部歌单</Link></div>
        {playlistsQuery.isLoading&&<p className="text-sm text-zinc-500">加载中…</p>}
        {playlistsQuery.isError&&<button type="button" onClick={()=>void playlistsQuery.refetch()}>歌单加载失败，重试</button>}
        <div className="cover-shelf public-playlist-shelf">
        {playlists.filter(p=>p.visibility==='public').map(playlist => <article key={playlist.id} className="cover-shelf-item">
          <div className="cover-shelf-art">
            <Link to={`/playlists/${playlist.id}`} aria-label={playlist.name}>{playlist.coverUrl?<img src={resolveMediaUrl(playlist.coverUrl)} alt="" className="h-full w-full object-cover"/>:<span className="grid h-full w-full place-items-center bg-zinc-800"><ListPlus size={36}/></span>}</Link>
          </div>
          <Link to={`/playlists/${playlist.id}`} className="cover-shelf-title" title={playlist.name}>{playlist.name}</Link>
          <p>{playlist.songCount} 首歌曲</p>
        </article>)}
        </div>
        {!playlistsQuery.isLoading&&!playlistsQuery.isError&&!playlists.some(p=>p.visibility==='public')&&<p className="text-sm text-zinc-500">暂无公共歌单</p>}
        <CreatePlaylistInline onCreated={()=>{}}/>
      </section>

      <section ref={libraryRef} className="scroll-mt-20 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="section-title">{t('home.songLibrary')}</h3>
            {feedback && <p role="status" className={`mt-1 text-xs ${feedback.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{feedback.message}</p>}
          </div>
          <Link className="inline-flex h-9 items-center gap-2 rounded-md bg-white/[0.07] px-3 text-sm font-medium text-zinc-200 hover:bg-white/[0.11]" to="/online">
            <Library size={15} />
            {t('home.chooseFromLibrary')}
          </Link>
        </div>
        {isLoading && <p className="text-gray-400">{t('song.loadingSongs')}</p>}
        {isError && <p className="text-red-400">{t('song.loadSongsFailed', { message: getApiErrorMessage(error, t('common.unknown')) })}</p>}
        {!isLoading && !isError && songs.length === 0 && <p className="text-gray-400">{t('song.noSongs')}</p>}

        <BulkSongs songs={songs} scope={`library:${libraryPage}`}>
        <div className="song-list border-y border-white/[0.06]">
          {songs.map((song) => (
            <SongRow
              key={song.id}
              song={song}
              onPlay={() => playSong(song)}
              onPlayNext={() => playNextInQueue(toPlayerSong(song))}
              onAddToQueue={() => addToQueue(toPlayerSong(song))}
              actions={<>
                <button
                  type="button"
                  title={t(favoriteSongIds.has(song.id) ? 'song.favorite.remove' : 'song.favorite.add')}
                  aria-label={t(favoriteSongIds.has(song.id) ? 'song.favorite.remove' : 'song.favorite.add')}
                  disabled={favoriteMutation.isPending && favoriteMutation.variables?.songId === song.id}
                  onClick={() => {
                    if (!token) { requireLogin(); return }
                    favoriteMutation.mutate({ songId: song.id, favorite: favoriteSongIds.has(song.id) })
                  }}
                  className={`grid h-9 w-9 place-items-center rounded-md transition disabled:opacity-40 ${favoriteSongIds.has(song.id) ? 'bg-[#ff3b5f]/15 text-[#ff6680]' : 'text-zinc-500 hover:bg-white/[0.08] hover:text-white'}`}
                >
                  <Heart size={17} fill={favoriteSongIds.has(song.id) ? 'currentColor' : 'none'} />
                </button>
                <div ref={playlistMenuSongId === song.id ? playlistMenuRef : undefined} className="relative">
                  <button
                    type="button"
                    title={t('playlists.addSong')}
                    aria-label={t('playlists.addSong')}
                    aria-haspopup="menu"
                    aria-expanded={playlistMenuSongId === song.id}
                    onClick={() => {
                      if (!token) { requireLogin(); return }
                      setPlaylistMenuSongId((current) => current === song.id ? null : song.id)
                    }}
                    className={`grid h-9 w-9 place-items-center rounded-md transition ${playlistMenuSongId === song.id ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:bg-white/[0.08] hover:text-white'}`}
                  >
                    <ListPlus size={18} />
                  </button>
                  {playlistMenuSongId === song.id && <div role="menu" className="absolute bottom-11 right-0 z-40 w-64 overflow-hidden rounded-md border border-white/[0.1] bg-[#1b1b22] p-2 text-left shadow-2xl shadow-black/50 sm:bottom-auto sm:top-11">
                    <p className="px-2 py-1.5 text-xs font-semibold text-zinc-500">{t('playlists.choosePlaylist')}</p>
                    <CreatePlaylistInline disabled={playlistMutation.isPending} onCreated={p=>playlistMutation.mutate({playlistId:p.id,songId:song.id})}/>
                    {playlistsQuery.isLoading && <p className="px-2 py-3 text-sm text-zinc-500">{t('playlists.loading')}</p>}
                    <div className="max-h-56 overflow-y-auto">
                      {playlists.map((playlist) => <button key={playlist.id} type="button" role="menuitem" disabled={playlistMutation.isPending} onClick={() => playlistMutation.mutate({ playlistId: playlist.id, songId: song.id })} className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-sm text-zinc-200 hover:bg-white/[0.07] disabled:opacity-40"><span className="truncate">{playlist.name}</span>{playlistMutation.isPending && playlistMutation.variables?.playlistId === playlist.id ? <span className="h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-white" /> : <Check size={14} className="opacity-0" />}</button>)}
                    </div>
                  </div>}
                </div>
              </>}
            />
          ))}
        </div>
        </BulkSongs>
        {data?.pagination && (
          <Pagination
            page={data.pagination.page}
            pageSize={data.pagination.page_size}
            total={data.pagination.total}
            onPageChange={changeLibraryPage}
          />
        )}
      </section>
      </>}
    </div>
  )
}
