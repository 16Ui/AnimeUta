import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getWorkDetail } from '../api/content'
import { getApiErrorMessage } from '../api/error'
import { resolveMediaUrl } from '../api/http'
import { SongRow } from '../components/music/SongRow'
import { usePlayerStore } from '../store/usePlayerStore'

export default function WorkDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const workId = Number(id)
  const playFromQueue = usePlayerStore((state) => state.playFromQueue)
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['work-detail', workId],
    queryFn: () => getWorkDetail(workId),
    enabled: Number.isFinite(workId) && workId > 0,
  })
  const songs = useMemo(() => data?.songs ?? [], [data])
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

  if (!Number.isFinite(workId) || workId <= 0) {
    return <p className="p-6 text-red-400">{t('content.invalidWorkId')}</p>
  }

  if (isLoading) {
    return <p className="p-6 text-gray-400">{t('content.loadingWork')}</p>
  }

  if (isError || !data) {
    return (
      <p className="p-6 text-red-400">
        {t('content.loadWorkFailed', { message: getApiErrorMessage(error, t('common.unknown')) })}
      </p>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <section className="flex items-start gap-4">
        {data.coverUrl && (
          <img src={resolveMediaUrl(data.coverUrl)} alt={data.displayTitle} className="w-28 h-36 rounded object-cover bg-gray-800" />
        )}
        <div className="min-w-0">
          <h2 className="text-2xl font-bold">{data.displayTitle}</h2>
          <p className="text-gray-400">{data.titleRomaji ?? data.titleEn ?? data.workType ?? t('content.work')}</p>
          <p className="text-sm text-gray-500">
            {[data.workType, data.seasonLabel, data.releaseDate].filter(Boolean).join(' / ') || t('common.noMetadata')}
          </p>
          {data.aliases.length > 0 && <p className="mt-2 text-xs text-zinc-500">{t('content.aliases')}: {data.aliases.join(' / ')}</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">{t('content.songs')}</h3>
        {songs.length === 0 && <p className="text-gray-400">{t('content.noSongsLinked')}</p>}
        <ul className="space-y-2">
          {songs.map((song, index) => (
            <li key={song.id}>
              <SongRow
                song={song}
                eyebrow={<span>{String(index + 1).padStart(2, '0')}</span>}
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
