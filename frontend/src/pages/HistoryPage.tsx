import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Clock3 } from 'lucide-react'
import { listPlayHistory } from '../api/history'
import { getApiErrorMessage } from '../api/error'
import { formatDuration, formatRelativeTime } from '../lib/format'
import { useAuthStore } from '../store/useAuthStore'
import { usePlayerStore } from '../store/usePlayerStore'
import { SongRow } from '../components/music/SongRow'

export default function HistoryPage() {
  const { t, i18n } = useTranslation()
  const token = useAuthStore((state) => state.token)
  const playFromQueue = usePlayerStore((state) => state.playFromQueue)
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['play-history', token],
    queryFn: () => listPlayHistory(token as string, { page: 1, pageSize: 50 }),
    enabled: Boolean(token),
  })

  const history = useMemo(() => data?.data ?? [], [data])
  const queue = useMemo(
    () =>
      history.map((item) => ({
        id: item.song.id,
        title: item.song.displayTitle,
        artist: item.song.primaryArtistName ?? t('common.unknownArtist'),
        coverUrl: item.song.coverUrl,
        audioUrl: item.song.audioSourceUri,
        durationSeconds: item.song.durationSeconds,
      })),
    [history, t],
  )

  return (
    <div className="content-page space-y-6">
      <header className="page-heading"><h2>{t('history.title')}</h2></header>

      {isLoading && <p className="text-gray-400">{t('history.loading')}</p>}
      {isError && <p className="text-red-400">{getApiErrorMessage(error, t('history.loadFailed'))}</p>}
      {!isLoading && !isError && history.length === 0 && <div className="empty-state"><Clock3 size={38} /><p>{t('history.empty')}</p></div>}

      <ul className="song-list overflow-hidden border-y border-white/[0.06]">
        {history.map((item, index) => (
          <li key={item.id}>
            <SongRow
              song={item.song}
              onPlay={() => playFromQueue(queue, index, { type: 'collection', name: t('history.title') })}
              onPlayNext={() => playNextInQueue(queue[index])}
              onAddToQueue={() => addToQueue(queue[index])}
              meta={
                <>
                  {item.playedAt ? <span>{t('history.playedAt', { time: formatRelativeTime(item.playedAt, i18n.language) })}</span> : null}
                  {item.lastPositionSeconds !== undefined ? <span>{t('history.lastPosition', { duration: formatDuration(item.lastPositionSeconds) })}</span> : null}
                  {item.playlist ? <span>{t('history.playlist', { name: item.playlist.name })}</span> : null}
                </>
              }
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
