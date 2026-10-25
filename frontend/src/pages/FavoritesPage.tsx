import { useCallback, useEffect, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Heart, HeartOff, Play } from 'lucide-react'
import { queryClient } from '../lib/query-client'
import { formatRelativeTime } from '../lib/format'
import { listAllFavoriteSongs, removeFavoriteSong } from '../api/favorites'
import { getApiErrorMessage, getApiErrorStatus } from '../api/error'
import { usePlayerStore } from '../store/usePlayerStore'
import { useAuthStore } from '../store/useAuthStore'
import { SongRow } from '../components/music/SongRow'
import { BulkSongs } from '../components/music/BulkSongs'

export default function FavoritesPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const token = useAuthStore((state) => state.token)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const playFromQueue = usePlayerStore((state) => state.playFromQueue)
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)

  const redirectToLogin = useCallback(() => {
    clearAuth()
    navigate('/login', {
      replace: true,
      state: { from: `${location.pathname}${location.search}` },
    })
  }, [clearAuth, location.pathname, location.search, navigate])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['favorite-songs', 'all', token],
    queryFn: () => listAllFavoriteSongs(token as string),
    enabled: Boolean(token),
  })

  const shouldRedirectUnauthorized = isError && getApiErrorStatus(error) === 401

  useEffect(() => {
    if (shouldRedirectUnauthorized) {
      redirectToLogin()
    }
  }, [redirectToLogin, shouldRedirectUnauthorized])

  const removeMutation = useMutation({
    mutationFn: (songId: number) => removeFavoriteSong(token as string, songId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['favorite-songs', token] })
    },
    onError: (mutationError) => {
      if (getApiErrorStatus(mutationError) === 401) {
        redirectToLogin()
      }
    },
  })

  const songs = useMemo(() => data ?? [], [data])
  const queue = useMemo(
    () =>
      songs.map((song) => ({
        id: song.id,
        title: song.displayTitle,
        artist: song.primaryArtistName ?? t('common.unknownArtist'),
        coverUrl: song.coverUrl,
        audioUrl: song.audioSourceUri,
        durationSeconds: song.durationSeconds,
      })),
    [songs, t],
  )

  if (shouldRedirectUnauthorized) {
    return null
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">{t('nav.favorites')}</h2>
        <p className="text-gray-400">{t('song.favorite.loading')}</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">{t('nav.favorites')}</h2>
        <p className="text-red-400">{getApiErrorMessage(error, t('song.favorite.loadFailed'))}</p>
      </div>
    )
  }

  return (
    <div className="content-page space-y-6">
      <header className="page-heading flex items-end justify-between gap-4">
        <div><h2>{t('nav.favorites')}</h2><p>{t('song.favorite.hint')}</p></div>
        {songs.length > 0 && <button type="button" onClick={() => playFromQueue(queue, 0, { type: 'favorites', name: t('nav.favorites') })} className="primary-button"><Play size={16} fill="currentColor" />{t('common.play')}</button>}
      </header>

      {songs.length === 0 && <div className="empty-state"><Heart size={38} /><p>{t('song.favorite.empty')}</p></div>}

      <BulkSongs songs={songs} favorites>
      <ul className="song-list overflow-hidden border-y border-white/[0.06]">
        {songs.map((song) => (
          <li key={song.id}>
            <SongRow
              song={song}
              onPlay={() => playFromQueue(queue, queue.findIndex((item) => item.id === song.id), { type: 'favorites', name: t('nav.favorites') })}
              onPlayNext={() => playNextInQueue(queue.find((item) => item.id === song.id)!)}
              onAddToQueue={() => addToQueue(queue.find((item) => item.id === song.id)!)}
              meta={song.favoritedAt ? <span>{t('song.favorite.addedAt', { time: formatRelativeTime(song.favoritedAt, i18n.language) })}</span> : null}
              actions={
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-gray-300 transition hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(song.id)}
                  aria-label={t('song.favorite.remove')}
                >
                  <HeartOff size={16} />
                </button>
              }
            />
          </li>
        ))}
      </ul>
      </BulkSongs>

      {removeMutation.isError && (
        <p className="text-red-400">{getApiErrorMessage(removeMutation.error, t('song.favorite.removeFailed'))}</p>
      )}
    </div>
  )
}
