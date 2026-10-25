import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Disc3, ListPlus, ListStart, MoreHorizontal, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resolveMediaUrl } from '../../api/http'
import { formatDuration } from '../../lib/format'
import { Dialog } from '../ui/Dialog'
import { useSongSelection } from './BulkSongs'

export interface SongRowSong {
  id: number
  displayTitle: string
  durationSeconds?: number
  coverUrl?: string
  audioSourceUri?: string
  primaryArtistName?: string
  primaryWorkTitle?: string
}

interface SongRowProps {
  song: SongRowSong
  rank?: number
  eyebrow?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  menuActions?: ReactNode
  onPlay?: () => void
  onPlayNext?: () => void
  onAddToQueue?: () => void
}

export function SongRow({ song, rank, eyebrow, meta, actions, menuActions, onPlay, onPlayNext, onAddToQueue }: SongRowProps) {
  const { t } = useTranslation()
  const [actionsOpen, setActionsOpen] = useState(false)
  const selection = useSongSelection()
  const coverUrl = resolveMediaUrl(song.coverUrl)
  const canPlay = Boolean(song.audioSourceUri && onPlay)
  const hasLeadingContent = !!selection || rank != null || eyebrow != null

  return (
    <article style={selection ? { gridTemplateColumns: '24px 48px minmax(0, 1fr) auto' } : undefined} className={`song-row group grid min-h-[72px] items-center border-b border-white/[0.055] px-1 py-2 transition hover:bg-white/[0.045] sm:px-3 ${hasLeadingContent ? 'with-rank' : ''}`}>
      {hasLeadingContent && (
        <div className={`song-row-rank justify-center text-xs font-medium tabular-nums text-zinc-500 ${selection ? '!flex' : ''}`}>
          {selection ? <input type="checkbox" aria-label={`选择 ${song.displayTitle}`} disabled={selection.busy} checked={selection.selected.has(song.id)} onChange={() => selection.toggle(song.id)} className="h-4 w-4 accent-[#ff3b5f]" /> : rank ? <span className={rank <= 3 ? 'text-primary' : ''}>{String(rank).padStart(2, '0')}</span> : eyebrow}
        </div>
      )}

      <div className="relative h-12 w-12 overflow-hidden rounded bg-[#24242b] sm:h-[52px] sm:w-[52px]">
        {coverUrl ? (
          <img className="h-full w-full object-cover" src={coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950 text-gray-500">
            <Disc3 size={22} />
          </div>
        )}
        <button
          type="button"
          className="song-row-cover-play absolute inset-0 flex items-center justify-center bg-black/45 transition"
          disabled={!canPlay}
          onClick={onPlay}
          aria-label={t('song.playNamed', { title: song.displayTitle })}
          title={t('player.playNow')}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-black shadow-lg">
            <Play size={16} fill="currentColor" />
          </span>
        </button>
      </div>

      <div className="song-row-copy min-w-0">
        <Link className="song-row-title block truncate text-sm font-medium text-zinc-100 hover:text-[#ff6b85]" title={song.displayTitle} to={`/song/${song.id}`}>
          {song.displayTitle}
        </Link>
        <p className="mt-1 truncate text-xs text-zinc-500">
          {song.primaryArtistName ?? t('common.unknownArtist')}
          {song.primaryWorkTitle ? <span className="text-gray-600"> / {song.primaryWorkTitle}</span> : null}
        </p>
        {meta ? <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">{meta}</div> : null}
      </div>

      <div className="song-row-tools">
        <span className="song-row-duration text-xs tabular-nums text-zinc-400">
          {formatDuration(song.durationSeconds)}
        </span>
        <div className="flex items-center gap-1">
          {actions}
          {(onPlayNext || onAddToQueue || menuActions) && <button type="button" className="icon-button" onClick={() => setActionsOpen(true)} aria-label={`${t('ux.more')}: ${song.displayTitle}`} title={t('ux.more')} aria-haspopup="dialog"><MoreHorizontal size={20} /></button>}
        </div>
      </div>
      <Dialog open={actionsOpen} onClose={() => setActionsOpen(false)} title={song.displayTitle} description={`${song.primaryArtistName ?? t('common.unknownArtist')} · ${formatDuration(song.durationSeconds)}`}>
        <div className="song-action-menu py-2">
          {onPlay && <button type="button" disabled={!canPlay} onClick={() => { onPlay(); setActionsOpen(false) }}><Play size={20} />{t('player.playNow')}</button>}
          {onPlayNext && <button type="button" disabled={!song.audioSourceUri} onClick={() => { onPlayNext(); setActionsOpen(false) }}><ListStart size={20} />{t('player.playNextInQueue')}</button>}
          {onAddToQueue && <button type="button" disabled={!song.audioSourceUri} onClick={() => { onAddToQueue(); setActionsOpen(false) }}><ListPlus size={20} />{t('player.addToQueue')}</button>}
          {menuActions}
        </div>
      </Dialog>
    </article>
  )
}
