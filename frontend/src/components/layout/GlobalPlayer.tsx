import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePlayerStore } from '../../store/usePlayerStore'
import { ListMusic, ListOrdered, Loader2, Pause, Play, Repeat, Repeat1, RotateCcw, Shuffle, SkipBack, SkipForward, Subtitles, Trash2, Volume2, VolumeX, Lock, Unlock, LocateFixed } from 'lucide-react'
import { http, resolveMediaUrl } from '../../api/http'
import { createPlayHistory } from '../../api/history'
import { isTauriRuntime, publishDesktopLyricsSnapshot, toggleDesktopLyricsWindow, desktopLyricsLockKey, changeDesktopLyricsLock, restoreDesktopLyricsBounds, subscribeDesktopLyricsCommands } from '../../lib/desktopLyrics'
import { validSentenceRange, playbackRates, type SentenceRange } from '../../lib/lyricPlayback'
import { useAuthStore } from '../../store/useAuthStore'
import { Dialog } from '../ui/Dialog'
import { getSongDetail } from '../../api/music'
import { mediaLinkExpired, toMediaVolume } from '../../lib/playerMedia'
import { QueueArtwork } from '../music/QueueArtwork'

interface PlaybackSnapshot {
  token: string
  songId: number
  position: number
  duration: number
  playlistId: number | null
  sessionId: number
}

export default function GlobalPlayer({ immersive = false }: { immersive?: boolean }) {
  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const loadedSourceRef = useRef<{ songId: number; sessionId: number } | null>(null)
  const pendingPositionRef = useRef<number | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [mobileVolumeOpen, setMobileVolumeOpen] = useState(false)
  const [desktopLyricsVisible, setDesktopLyricsVisible] = useState(false)
  const [desktopLyricsLocked, setDesktopLyricsLocked] = useState(() => localStorage.getItem(desktopLyricsLockKey) === 'true')
  useEffect(() => {
    const read = () => setDesktopLyricsLocked(localStorage.getItem(desktopLyricsLockKey) === 'true')
    window.addEventListener('storage', read)
    window.addEventListener(desktopLyricsLockKey, read)
    return () => { window.removeEventListener('storage', read); window.removeEventListener(desktopLyricsLockKey, read) }
  }, [])
  const [playbackError, setPlaybackError] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [sentenceLoop, setSentenceLoop] = useState<SentenceRange | null>(null)
  const loopRef = useRef<SentenceRange | null>(null)
  const updateLoop = (range: SentenceRange | null) => { loopRef.current = range; setSentenceLoop(range) }
  const lastAudibleVolumeRef = useRef(0.3)
  const activePlaybackRef = useRef<PlaybackSnapshot | null>(null)
  const isDesktopApp = useMemo(() => isTauriRuntime(), [])
  const token = useAuthStore((state) => state.token)
  const {
    currentSong,
    queue,
    queueSource,
    playbackSessionId,
    currentIndex,
    repeatMode,
    isPlaying,
    setIsPlaying,
    togglePlay,
    playFromQueue,
    removeFromQueue,
    playNext,
    playPrevious,
    cycleRepeatMode,
    volume,
    setVolume,
    currentTime,
    duration,
    setCurrentTime,
    setDuration,
    seekTime,
    seekRequestId,
    seekTo,
  } = usePlayerStore()
  const volumePercent = Math.round(volume * 100)
  const playerAccent = immersive ? 'var(--song-player-accent, #ff3b5f)' : '#ff3b5f'
  const queuePlaylistId = queueSource?.type === 'playlist' ? queueSource.playlistId : null

  useEffect(() => { updateLoop(null) }, [currentSong?.id, playbackSessionId, token])
  useEffect(() => { updateLoop(null) }, [seekRequestId])
  useEffect(() => {
    if (audioRef.current) { audioRef.current.playbackRate = playbackRate; audioRef.current.preservesPitch = true }
  }, [playbackRate, currentSong?.id])
  useEffect(() => subscribeDesktopLyricsCommands(command => {
    const state = usePlayerStore.getState()
    if (!useAuthStore.getState().token || state.currentSong?.id !== command.songId || state.playbackSessionId !== command.sessionId) return
    if (command.action === 'toggle') state.togglePlay()
    else if (command.action === 'next') state.playNext()
    else if (command.action === 'previous') state.playPrevious()
    else if (command.action === 'rate' && playbackRates.some(rate => rate === command.rate)) setPlaybackRate(command.rate!)
    else if (command.action === 'loop' && loopRef.current) updateLoop(null)
    else if ((command.action === 'loop' || command.action === 'replay') && validSentenceRange(command.range, state.duration)) {
      updateLoop(command.action === 'loop' ? command.range : null)
      const audio = audioRef.current
      if (!audio) return
      if (audio.readyState === 0) pendingPositionRef.current = command.range.start
      else audio.currentTime = command.range.start
      state.setCurrentTime(command.range.start)
      state.setIsPlaying(true)
    }
  }), [])

  const refreshCurrentMedia = useCallback(async () => {
    const snapshot = usePlayerStore.getState()
    if (!snapshot.currentSong) return false
    if (snapshot.currentSong.onlinePreview) {
      const {data}=await http.post('/api/v1/online/preview',snapshot.currentSong.onlinePreview,{timeout:60000})
      let applied=false
      usePlayerStore.setState(state=>{
        if(state.currentSong?.id!==snapshot.currentSong?.id||state.playbackSessionId!==snapshot.playbackSessionId)return state
        applied=true
        return {currentSong:data.data,queue:state.queue.map(item=>item.id===data.data.id?data.data:item)}
      })
      return applied
    }
    const data = await getSongDetail(snapshot.currentSong.id)
    let applied = false
    usePlayerStore.setState((state) => {
      if (state.currentSong?.id !== data.id || state.playbackSessionId !== snapshot.playbackSessionId) return state
      const song = { ...state.currentSong, title: data.displayTitle, artist: data.artists.map((artist) => artist.displayName).join(' / ') || state.currentSong.artist, coverUrl: data.coverUrl, audioUrl: data.audioSourceUri, durationSeconds: data.durationSeconds }
      applied = true
      return { currentSong: song, queue: state.queue.map((item) => item.id === song.id ? song : item) }
    })
    return applied
  }, [])

  useEffect(() => {
    const song = usePlayerStore.getState().currentSong
    if (!token || !song || (!mediaLinkExpired(song.audioUrl) && !mediaLinkExpired(song.coverUrl))) return
    let cancelled = false
    setBuffering(true)
    void refreshCurrentMedia().catch(() => {
      if (!cancelled) { setPlaybackError(true); setIsPlaying(false) }
    }).finally(() => { if (!cancelled) setBuffering(false) })
    return () => { cancelled = true }
  }, [currentSong?.id, playbackSessionId, isPlaying, token, refreshCurrentMedia, setIsPlaying])

  const submitPlaybackHistory = useCallback((snapshot: PlaybackSnapshot | null, started = false) => {
    if (!snapshot || snapshot.songId < 0) return
    const completionRate = snapshot.duration > 0
      ? Math.min(Math.max(snapshot.position / snapshot.duration, 0), 1)
      : undefined
    void createPlayHistory(snapshot.token, {
      song_id: snapshot.songId,
      played_at: new Date().toISOString(),
      last_position_seconds: snapshot.position,
      playlist_id: snapshot.playlistId,
      play_started: started,
      ...(completionRate === undefined ? {} : { completion_rate: completionRate }),
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    const previous = activePlaybackRef.current
    const playlistId = queuePlaylistId
    const changed = previous?.token !== token || previous?.songId !== currentSong?.id || previous?.playlistId !== playlistId || previous?.sessionId !== playbackSessionId

    if (changed && previous) submitPlaybackHistory(previous)
    if (!token || !currentSong?.audioUrl) {
      activePlaybackRef.current = null
      return
    }
    if (!changed && previous) return
    if (!isPlaying) { activePlaybackRef.current = null; return }

    const snapshot: PlaybackSnapshot = {
      token,
      songId: currentSong.id,
      position: 0,
      duration: currentSong.durationSeconds ?? 0,
      playlistId,
      sessionId: playbackSessionId,
    }
    activePlaybackRef.current = snapshot
    submitPlaybackHistory(snapshot, true)
  }, [currentSong?.audioUrl, currentSong?.durationSeconds, currentSong?.id, playbackSessionId, queuePlaylistId, isPlaying, submitPlaybackHistory, token])

  useEffect(() => {
    if (isPlaying) return
    submitPlaybackHistory(activePlaybackRef.current)
  }, [isPlaying, submitPlaybackHistory])

  useEffect(() => {
    if (!token || !currentSong?.audioUrl) return
    const timer = window.setInterval(() => {
      if (usePlayerStore.getState().isPlaying) submitPlaybackHistory(activePlaybackRef.current)
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [currentSong?.audioUrl, currentSong?.id, submitPlaybackHistory, token])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') submitPlaybackHistory(activePlaybackRef.current)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [submitPlaybackHistory])

  useEffect(() => {
    if (!isDesktopApp) return
    const publish = () => publishDesktopLyricsSnapshot({
      song: currentSong && !currentSong.onlinePreview ? { id: currentSong.id, title: currentSong.title, artist: currentSong.artist } : null,
      currentTime,
      isPlaying,
      duration, playbackSessionId, playbackRate, sentenceLoop,
    })
    publish()
    const heartbeat = window.setInterval(publish, 2000)
    return () => window.clearInterval(heartbeat)
  }, [currentSong, currentTime, isDesktopApp, isPlaying, duration, playbackSessionId, playbackRate, sentenceLoop])

  useEffect(() => {
    if (volume > 0) lastAudibleVolumeRef.current = volume
  }, [volume])

  const toggleMute = () => {
    setVolume(volume > 0 ? 0 : lastAudibleVolumeRef.current)
  }

  useEffect(() => {
    if (!audioRef.current) {
      return
    }
    audioRef.current.volume = toMediaVolume(volume)
  }, [volume])

  useEffect(() => {
    setPlaybackError(false)
    setBuffering(false)
    if (!audioRef.current) {
      return
    }

    if (!currentSong?.audioUrl) {
      audioRef.current.pause()
      loadedSourceRef.current = null
      pendingPositionRef.current = null
      return
    }

    if (mediaLinkExpired(currentSong.audioUrl)) { audioRef.current.pause(); return }

    const samePlayback = loadedSourceRef.current?.songId === currentSong.id && loadedSourceRef.current?.sessionId === playbackSessionId
    const position = samePlayback ? usePlayerStore.getState().currentTime : 0
    pendingPositionRef.current = position > 0 ? position : null
    loadedSourceRef.current = { songId: currentSong.id, sessionId: playbackSessionId }
    audioRef.current.src = resolveMediaUrl(currentSong.audioUrl) ?? currentSong.audioUrl
    setCurrentTime(position)
    setDuration(usePlayerStore.getState().currentSong?.durationSeconds ?? 0)
  }, [currentSong?.id, currentSong?.audioUrl, playbackSessionId, setCurrentTime, setDuration])

  useEffect(() => {
    if (!audioRef.current || !currentSong?.audioUrl || mediaLinkExpired(currentSong.audioUrl)) {
      return
    }

    if (isPlaying) {
      const requestedSongId = currentSong.id
      const requestedSessionId = usePlayerStore.getState().playbackSessionId
      void audioRef.current.play().catch((error: DOMException) => {
        if (error.name === 'AbortError') return
        const state = usePlayerStore.getState()
        if (state.currentSong?.id !== requestedSongId || state.playbackSessionId !== requestedSessionId) return
        setBuffering(false)
        setPlaybackError(error.name !== 'NotAllowedError')
        setIsPlaying(false)
      })
      return
    }

    audioRef.current.pause()
  }, [currentSong, isPlaying, setIsPlaying])

  useEffect(() => {
    if (!audioRef.current || seekRequestId === 0) {
      return
    }
    if (audioRef.current.readyState === 0) { pendingPositionRef.current = seekTime; return }
    pendingPositionRef.current = null
    audioRef.current.currentTime = seekTime
  }, [seekRequestId, seekTime])

  const handleEnded = () => {
    if (loopRef.current && audioRef.current) {
      audioRef.current.currentTime = loopRef.current.start
      void audioRef.current.play().catch(() => setIsPlaying(false))
      return
    }
    if (repeatMode === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0
      setCurrentTime(0)
      if (activePlaybackRef.current) {
        activePlaybackRef.current.position = 0
        submitPlaybackHistory(activePlaybackRef.current, true)
      }
      void audioRef.current.play().catch(() => setIsPlaying(false))
      return
    }
    playNext()
  }

  const songUnavailable = useMemo(() => !currentSong?.audioUrl, [currentSong])
  const knownDuration = duration > 0 ? duration : currentSong?.durationSeconds ?? 0
  const progressPercent = knownDuration > 0 ? Math.min((currentTime / knownDuration) * 100, 100) : 0
  const currentProgress = knownDuration > 0 ? Math.min(currentTime, knownDuration) : 0
  const repeatLabel = repeatMode === 'one'
    ? t('player.repeatOne')
    : repeatMode === 'all'
      ? t('player.repeatAll')
      : repeatMode === 'shuffle'
        ? t('player.shuffle')
        : t('player.repeatOff')
  const PlaybackModeIcon = repeatMode === 'one' ? Repeat1 : repeatMode === 'all' ? Repeat : repeatMode === 'shuffle' ? Shuffle : ListOrdered
  const queueSourceLabel = queueSource?.type === 'playlist'
    ? t('player.queueSource.playlist', { name: queueSource.name })
    : queueSource?.type === 'favorites'
      ? t('player.queueSource.favorites')
      : queueSource?.type === 'search'
        ? t('player.queueSource.search', { name: queueSource.name })
        : queueSource?.type === 'single'
          ? t('player.queueSource.single')
          : queueSource?.type === 'collection'
            ? t('player.queueSource.collection', { name: queueSource.name })
            : t('player.queueSource.custom')

  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentSong) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.title,
      artist: currentSong.artist,
      album: 'AnimeUta',
      artwork: currentSong.coverUrl ? [{ src: resolveMediaUrl(currentSong.coverUrl) ?? currentSong.coverUrl }] : [],
    })
    const actions: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => setIsPlaying(true), pause: () => setIsPlaying(false),
      previoustrack: playPrevious, nexttrack: playNext,
      seekto: (details) => { if (details.seekTime != null) seekTo(details.seekTime) },
      seekbackward: (details) => seekTo(Math.max(0, usePlayerStore.getState().currentTime - (details.seekOffset ?? 10))),
      seekforward: (details) => { const state = usePlayerStore.getState(); seekTo(Math.min(state.duration || Number.POSITIVE_INFINITY, state.currentTime + (details.seekOffset ?? 10))) },
    }
    for (const [action, handler] of Object.entries(actions)) {
      try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler) } catch { /* Older WebViews support only a subset of media actions. */ }
    }
    return () => {
      for (const action of Object.keys(actions)) {
        try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, null) } catch { /* Unsupported action. */ }
      }
    }
  }, [currentSong, playNext, playPrevious, seekTo, setIsPlaying])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    if (knownDuration > 0 && currentTime >= 0 && currentTime <= knownDuration) {
      try {
        navigator.mediaSession.setPositionState({ duration: knownDuration, playbackRate, position: currentTime })
      } catch {
        // Media Session support varies between browsers and WebViews.
      }
    }
  }, [currentTime, isPlaying, knownDuration, playbackRate])

  const formatTime = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) {
      return '00:00'
    }
    const minutes = Math.floor(value / 60)
    const seconds = Math.floor(value % 60)
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  const syncDurationFromAudio = (audio: HTMLAudioElement) => {
    const loadedDuration = audio.duration
    if (Number.isFinite(loadedDuration) && loadedDuration > 0) {
      setDuration(loadedDuration)
      if (activePlaybackRef.current) activePlaybackRef.current.duration = loadedDuration
      return
    }
    if (currentSong?.durationSeconds && currentSong.durationSeconds > 0) {
      setDuration(currentSong.durationSeconds)
      if (activePlaybackRef.current) activePlaybackRef.current.duration = currentSong.durationSeconds
    }
  }

  if (!currentSong) {
    return null
  }

  const retryPlayback = async () => {
    const audio = audioRef.current
    if (!audio) return
    setPlaybackError(false)
    setBuffering(true)
    const requestedSession = usePlayerStore.getState().playbackSessionId
    const requestedSong = usePlayerStore.getState().currentSong?.id
    try {
      const refreshed = await refreshCurrentMedia()
      if (!refreshed) return
      const song = usePlayerStore.getState().currentSong
      if (!song?.audioUrl) throw new Error('audio_missing')
      pendingPositionRef.current = usePlayerStore.getState().currentTime
      audio.src = resolveMediaUrl(song.audioUrl) ?? song.audioUrl
      audio.load()
      setIsPlaying(true)
    } catch {
      const state = usePlayerStore.getState()
      if (state.currentSong?.id !== requestedSong || state.playbackSessionId !== requestedSession) return
      setBuffering(false); setIsPlaying(false); setPlaybackError(true)
    }
  }
  const progress = (id: string) => (
    <div className="player-progress">
      <span>{formatTime(currentProgress)}</span>
      <input id={id} type="range" min="0" max={Math.max(knownDuration, 0)} step="0.1"
        value={currentProgress} disabled={songUnavailable || knownDuration <= 0}
        aria-label={t('player.progress')} aria-valuetext={`${formatTime(currentProgress)} / ${formatTime(knownDuration)}`}
        onChange={(event) => seekTo(Number(event.target.value))} className="media-slider"
        style={{ '--range-progress': `${progressPercent}%`, '--range-accent': playerAccent } as React.CSSProperties} />
      <span>{formatTime(knownDuration)}</span>
    </div>
  )
  const playButton = (large = false) => (
    <button type="button" onClick={playbackError ? retryPlayback : togglePlay} disabled={songUnavailable}
      className={`player-main-button icon-button rounded-full text-white ${large ? 'player-large-play' : ''}`}
      style={{ backgroundColor: playerAccent }}
      aria-label={playbackError ? t('ux.retry') : isPlaying ? t('player.pause') : t('player.play')}
      title={playbackError ? t('ux.retry') : isPlaying ? t('player.pause') : t('player.play')}>
      {playbackError ? <RotateCcw size={22} /> : buffering && isPlaying ? <Loader2 size={24} className="animate-spin" aria-label={t('ux.buffering')} /> : isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
    </button>
  )
  const queueButton = <button type="button" className="icon-button" onClick={() => setQueueOpen(true)} aria-label={t('player.queue')} title={t('player.queue')} aria-haspopup="dialog"><ListMusic size={22} /></button>
  const modeButton = <button type="button" className="icon-button" onClick={cycleRepeatMode} aria-label={repeatLabel} title={repeatLabel} style={repeatMode !== 'off' ? { color: playerAccent } : undefined}><PlaybackModeIcon size={21} /></button>
  const volumeButton = <button type="button" className="icon-button" onClick={() => setMobileVolumeOpen(true)} aria-label={`${t('player.volume')}: ${volumePercent}%`} title={t('player.volume')} aria-haspopup="dialog">{volume ? <Volume2 size={21} /> : <VolumeX size={21} />}</button>
  const skip = (previous: boolean) => <button type="button" className="icon-button" onClick={previous ? playPrevious : playNext}
    disabled={queue.length <= 1 && repeatMode !== 'all' && repeatMode !== 'shuffle'} aria-label={t(previous ? 'player.previous' : 'player.next')} title={t(previous ? 'player.previous' : 'player.next')}>
    {previous ? <SkipBack size={23} fill="currentColor" /> : <SkipForward size={23} fill="currentColor" />}</button>
  const volumeControl = (id: string) => <div className="player-volume-control">
    <button type="button" className="icon-button" onClick={toggleMute} aria-label={volume ? t('player.mute') : t('player.unmute')} title={volume ? t('player.mute') : t('player.unmute')}>{volume ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
    <input id={id} type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))}
      aria-label={t('player.volume')} aria-valuetext={`${volumePercent}%`} className="media-slider"
      style={{ '--range-progress': `${volumePercent}%`, '--range-accent': playerAccent } as React.CSSProperties} />
    <output htmlFor={id} className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-300">{volumePercent}%</output>
  </div>

  return (
    <div className={`global-player fixed left-0 right-0 z-40 border-t border-white/[0.07] ${immersive ? 'song-player-global' : 'bg-[#19191f] md:left-[232px]'}`}>
      <Dialog open={queueOpen} onClose={() => setQueueOpen(false)} title={t('player.queue')} description={`${queueSourceLabel} · ${t('common.songsCount', { count: queue.length })}`} className="queue-dialog">
        <div className="p-2">
          {!queue.length && <p className="p-6 text-center text-sm text-zinc-400">{t('player.queueEmpty')}</p>}
          {queueOpen && queue.map((song, index) => (
            <div key={song.id} className={`flex min-w-0 items-center rounded-md ${index === currentIndex ? 'bg-[#ff3b5f]/15 text-[#ff8ca1]' : 'text-zinc-200 hover:bg-white/[0.06]'}`}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left" aria-current={index === currentIndex ? 'true' : undefined} onClick={() => playFromQueue(queue, index, queueSource)}>
                <QueueArtwork song={song} />
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{song.title}</span><span className="block truncate text-xs text-zinc-400">{song.artist}</span></span>
                {index === currentIndex && <span className="ml-auto shrink-0 text-xs">{t('ux.nowPlaying')}</span>}
              </button>
              <button type="button" className="icon-button shrink-0" onClick={() => removeFromQueue(song.id)} aria-label={`${t('player.removeFromQueue')}: ${song.title}`} title={t('player.removeFromQueue')}><Trash2 size={17} /></button>
            </div>
          ))}
        </div>
      </Dialog>
      <Dialog open={mobileVolumeOpen} onClose={() => setMobileVolumeOpen(false)} title={t('player.volume')}>
        <div className="p-5">{volumeControl('expanded-player-volume')}</div>
      </Dialog>
      <audio ref={audioRef} preload="metadata" playsInline
        onEnded={() => { submitPlaybackHistory(activePlaybackRef.current); handleEnded() }}
        onWaiting={() => setBuffering(true)} onPlaying={() => { setBuffering(false); setPlaybackError(false) }}
        onCanPlay={() => setBuffering(false)}
        onError={() => { setBuffering(false); setPlaybackError(true); setIsPlaying(false) }}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget
          audio.volume = toMediaVolume(volume)
          audio.playbackRate = playbackRate
          audio.preservesPitch = true
          syncDurationFromAudio(audio)
          if (pendingPositionRef.current != null) {
            audio.currentTime = Math.min(pendingPositionRef.current, Number.isFinite(audio.duration) ? audio.duration : pendingPositionRef.current)
            pendingPositionRef.current = null
          }
        }}
        onDurationChange={(event) => syncDurationFromAudio(event.currentTarget)}
        onTimeUpdate={(event) => {
          if (pendingPositionRef.current != null) return
          const audio = event.currentTarget
          if (loopRef.current && audio.currentTime >= loopRef.current.end) audio.currentTime = loopRef.current.start
          const position = audio.currentTime
          setCurrentTime(position)
          if (activePlaybackRef.current) activePlaybackRef.current.position = position
        }} />
      {playbackError && <div role="alert" className="player-error"><span>{t('ux.playbackFailed')}</span><button type="button" onClick={retryPlayback}>{t('ux.retry')}</button></div>}

      <div className={`mobile-player md:hidden ${immersive ? 'mobile-player-expanded' : 'mobile-player-mini'}`}>
        {immersive ? <>
          {progress('mobile-player-progress')}
          <div className="flex items-center justify-between gap-1">
            {modeButton}{skip(true)}{playButton(true)}{skip(false)}{queueButton}
          </div>
          <div className="flex items-center justify-between"><span className="truncate text-xs text-white/60">{repeatLabel}</span>{volumeButton}</div>
        </> : <>
          <Link className="flex min-w-0 flex-1 items-center gap-3" to={currentSong.onlinePreview?'/online':`/song/${currentSong.id}`} aria-label={`${t('ux.nowPlaying')}: ${currentSong.title}`}>
            {currentSong.coverUrl ? <img src={resolveMediaUrl(currentSong.coverUrl)} alt="" className="h-11 w-11 shrink-0 rounded object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded bg-white/5"><ListMusic size={20} /></span>}
            <span className="min-w-0"><strong className="block truncate text-sm font-medium">{currentSong.title}</strong><span className="block truncate text-xs text-zinc-400">{currentSong.artist}</span></span>
          </Link>
          {playButton()}{queueButton}
          <div className="mini-player-progress" aria-hidden="true"><span style={{ width: `${progressPercent}%`, backgroundColor: playerAccent }} /></div>
        </>}
      </div>

      <div className="desktop-player hidden md:grid">
        <Link className="flex min-w-0 items-center gap-3" to={currentSong.onlinePreview?'/online':`/song/${currentSong.id}`}>
          {currentSong.coverUrl ? <img src={resolveMediaUrl(currentSong.coverUrl)} alt="" className="h-12 w-12 shrink-0 rounded object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded bg-white/5"><ListMusic size={22} /></span>}
          <span className="min-w-0"><strong className="block truncate text-sm font-semibold">{currentSong.title}</strong><span className="block truncate text-xs text-zinc-400">{currentSong.artist}</span>{songUnavailable && <span className="text-xs text-amber-300">{t('player.noAudio')}</span>}</span>
        </Link>
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-center gap-3">{skip(true)}{playButton()}{skip(false)}</div>
          {progress('desktop-player-progress')}
        </div>
        <div className="desktop-player-tools">
          {modeButton}{queueButton}
          {isDesktopApp && <button type="button" className="icon-button" onClick={() => void toggleDesktopLyricsWindow().then(setDesktopLyricsVisible)} aria-label={t('player.desktopLyrics')} title={t(desktopLyricsVisible ? 'player.desktopLyricsClose' : 'player.desktopLyricsOpen')} aria-pressed={desktopLyricsVisible}><Subtitles size={20} /></button>}
          {isDesktopApp && <button type="button" className="icon-button" onClick={() => changeDesktopLyricsLock(!desktopLyricsLocked)} aria-label={t(desktopLyricsLocked ? 'player.desktopLyricsUnlock' : 'player.desktopLyricsLock')} title={t(desktopLyricsLocked ? 'player.desktopLyricsUnlock' : 'player.desktopLyricsLock')} aria-pressed={desktopLyricsLocked}>{desktopLyricsLocked ? <Lock size={17} /> : <Unlock size={17} />}</button>}
          {isDesktopApp && <button type="button" className="icon-button" onClick={() => void restoreDesktopLyricsBounds(true).then(() => setDesktopLyricsVisible(true)).catch(console.error)} aria-label="找回桌面歌词" title="找回桌面歌词"><LocateFixed size={17} /></button>}
          <div className="desktop-volume-inline">{volumeControl('desktop-player-volume')}</div>
          <div className="desktop-volume-compact">{volumeButton}</div>
        </div>
      </div>
    </div>
  )
}
