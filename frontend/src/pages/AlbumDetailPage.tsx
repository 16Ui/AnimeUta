import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getAlbumDetail } from '../api/content'
import { getApiErrorMessage } from '../api/error'
import { resolveMediaUrl } from '../api/http'
import { SongRow } from '../components/music/SongRow'
import { usePlayerStore } from '../store/usePlayerStore'

export default function AlbumDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const albumId = Number(id)
  const playFromQueue = usePlayerStore((state) => state.playFromQueue)
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['album-detail', albumId],
    queryFn: () => getAlbumDetail(albumId),
    enabled: Number.isFinite(albumId) && albumId > 0,
  })
  const tracks = useMemo(() => data?.tracks ?? [], [data])
  const queue = useMemo(
    () =>
      tracks.map((track) => ({
        id: track.song.id,
        title: track.song.displayTitle,
        artist: track.song.primaryArtistName ?? t('common.unknownArtist'),
        coverUrl: track.song.coverUrl,
        audioUrl: track.song.audioSourceUri,
        durationSeconds: track.song.durationSeconds,
      })),
    [tracks, t],
  )

  if (!Number.isFinite(albumId) || albumId <= 0) {
    return <p className="p-6 text-red-400">{t('content.invalidAlbumId')}</p>
  }

  if (isLoading) {
    return <p className="p-6 text-gray-400">{t('content.loadingAlbum')}</p>
  }

  if (isError || !data) {
    return (
      <p className="p-6 text-red-400">
        {t('content.loadAlbumFailed', { message: getApiErrorMessage(error, t('common.unknown')) })}
      </p>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <section className="flex items-start gap-4">
        {data.coverUrl && (
          <img src={resolveMediaUrl(data.coverUrl)} alt={data.displayTitle} className="w-28 h-28 rounded object-cover bg-gray-800" />
        )}
        <div className="min-w-0">
          <h2 className="text-2xl font-bold">{data.displayTitle}</h2>
          <p className="text-gray-400">{data.titleRomaji ?? data.titleEn ?? data.albumType ?? t('content.album')}</p>
          <p className="text-sm text-gray-500">
            {[data.albumType, data.catalogNo, data.releaseDate].filter(Boolean).join(' / ') || t('common.noMetadata')}
          </p>
          {data.aliases.length > 0 && <p className="mt-2 text-xs text-zinc-500">{t('content.aliases')}: {data.aliases.join(' / ')}</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">{t('content.tracks')}</h3>
        {tracks.length === 0 && <p className="text-gray-400">{t('content.noTracksLinked')}</p>}
        <ul className="space-y-2">
          {tracks.map((track, index) => (
            <li key={`${track.discNo}-${track.trackNo}-${track.song.id}`}>
              <SongRow
                song={track.song}
                eyebrow={<span>{track.discNo}-{track.trackNo}</span>}
                onPlay={() => playFromQueue(queue, index, { type: 'collection', name: data.displayTitle })}
                onPlayNext={() => playNextInQueue(queue[index])}
                onAddToQueue={() => addToQueue(queue[index])}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
