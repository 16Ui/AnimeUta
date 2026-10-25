import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, FileText, Heart, Languages, ListPlus, ListRestart, ListStart, Loader2, Mic2, Minus, MoreHorizontal, Play, Plus, RotateCcw, Sparkles, Tags, Type, Upload, Wand2, X } from 'lucide-react'
import { resolveMediaUrl } from '../api/http'
import {
  createLyricProcessingJob,
  getSongDetail,
  getSongLyrics,
  listLyricProcessingJobs,
  requestSongShare,
  retryLyricProcessingJob,
  updateLyricTimingOffset,
  uploadSongAudio,
  uploadSongLyrics,
} from '../api/music'
import { addFavoriteSong, listFavoriteSongs, removeFavoriteSong } from '../api/favorites'
import { addPlaylistSong, listPlaylists } from '../api/playlists'
import { CreatePlaylistInline } from '../components/music/CreatePlaylistInline'
import { addStudyCardsToDecks, getSongWords, getStudyPreferences, listStudyDecks } from '../api/study'
import { getApiErrorMessage, getApiErrorStatus } from '../api/error'
import { queryClient } from '../lib/query-client'
import { languageLabel } from '../lib/language'
import { formatDateTime } from '../lib/format'
import { defaultArtworkPalette, extractArtworkPalette } from '../lib/artworkPalette'
import { publishDesktopLyricsTimingOffset } from '../lib/desktopLyrics'
import { useLyricPreferences } from '../lib/useLyricPreferences'
import { usePlayerStore } from '../store/usePlayerStore'
import { useAuthStore } from '../store/useAuthStore'
import type { LyricJobStatus, LyricJobType, LyricRubySegment } from '../types/music'
import type { StudyWord } from '../types/study'
import SongVocabularyPanel from '../components/study/SongVocabularyPanel'
import LyricLineEditor from '../components/music/LyricLineEditor'
import { Dialog } from '../components/ui/Dialog'

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) {
    return ''
  }
  const totalSeconds = Math.round(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const restSeconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
}

function isLyricCreditLine(text: string) {
  return /^\s*(?:作[词詞](?:[・/]作曲)?|作曲|[编編]曲|制作(?:人)?|演唱|歌手|原唱|填[词詞]|[谱譜]曲|lyrics?|lyricist|composer|arranger|producer)\s*[:：]/iu.test(text)
}

function isHiddenLyricLine(text: string) {
  const value = text.trim()
  if (!value) return true
  if (value.startsWith('[') && value.includes(':') && value.endsWith(']')) return true
  return (value.startsWith('{') || value.startsWith('"{"')) &&
    ['作词', '作詞', '作曲', '编曲', '編曲', '制作人'].some((keyword) => value.includes(keyword))
}

function isMissingTrackPlaceholder(value: string, track: 'translation' | 'romaji') {
  const compact = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s.…。!！?？_\-/\\[\]()（）:：]+/gu, '')
  if (!compact) return true

  const placeholders = track === 'translation'
    ? [
        '暂无翻译', '暂无中文翻译', '无翻译', '待翻译', '等待翻译', '未翻译', '翻译待补', '翻译待生成',
        'notranslation', 'translationpending', 'translationunavailable', '翻訳なし', '翻訳待ち', '訳なし',
      ]
    : [
        '暂无罗马音', '暂无羅馬音', '暂无音译', '无罗马音', '待补罗马音', '等待罗马音', '罗马音待生成',
        'noromaji', 'romajipending', 'romajiunavailable', 'ローマ字なし', 'ローマ字待ち',
      ]
  return placeholders.includes(compact)
}

function hasJapaneseScript(text: string) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text)
}

function visibleTranslation(languageCode: string | undefined, originalText: string, translatedText?: string) {
  const translation = translatedText?.trim()
  if (!translation || languageCode === 'zh' || translation === originalText.trim() || isMissingTrackPlaceholder(translation, 'translation')) return undefined
  return translation
}

function visibleRomaji(originalText: string, romajiText?: string) {
  const romaji = romajiText?.trim()
  if (!romaji || !hasJapaneseScript(originalText) || romaji.toLocaleLowerCase() === originalText.trim().toLocaleLowerCase() || isMissingTrackPlaceholder(romaji, 'romaji')) return undefined
  return romaji
}

function DistributedRuby({ text, reading }: { text: string; reading: string }) {
  return (
    <ruby lang="ja" className="lyric-ruby">
      {text}
      <rt className="lyric-ruby-reading">{reading}</rt>
    </ruby>
  )
}

function RubyLyricText({ segments, fallback, showRuby = true }: { segments?: LyricRubySegment[]; fallback: string; showRuby?: boolean }) {
  if (!showRuby) {
    return <>{fallback}</>
  }
  if (!segments || segments.length === 0) {
    return <>{fallback}</>
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.ruby ? (
          <DistributedRuby key={`${segment.text}-${index}`} text={segment.text} reading={segment.ruby} />
        ) : (
          <span key={`${segment.text}-${index}`}>{segment.text}</span>
        ),
      )}
    </>
  )
}

interface LyricWordOccurrence {
  word: StudyWord
  startOffset: number
  endOffset: number
}

function RubyLyricSlice({
  segments,
  fallback,
  start,
  end,
  showRuby,
}: {
  segments?: LyricRubySegment[]
  fallback: string
  start: number
  end: number
  showRuby: boolean
}) {
  const slicedFallback = fallback.slice(start, end)
  if (!showRuby || !segments?.length) return <>{slicedFallback}</>

  let cursor = 0
  let reading = ''
  let hasRuby = false
  segments.forEach((segment) => {
    const segmentStart = cursor
    const segmentEnd = cursor + segment.text.length
    cursor = segmentEnd
    const overlapStart = Math.max(start, segmentStart)
    const overlapEnd = Math.min(end, segmentEnd)
    if (overlapStart >= overlapEnd) return
    const text = segment.text.slice(overlapStart - segmentStart, overlapEnd - segmentStart)
    const completeSegment = overlapStart === segmentStart && overlapEnd === segmentEnd
    if (segment.ruby && completeSegment) {
      reading += segment.ruby
      hasRuby = true
    } else {
      reading += text
    }
  })
  return hasRuby && reading ? <DistributedRuby text={slicedFallback} reading={reading} /> : <>{slicedFallback}</>
}

function InteractiveLyricText({
  text,
  segments,
  occurrences,
  showFurigana,
  onSelectWord,
}: {
  text: string
  segments?: LyricRubySegment[]
  occurrences: LyricWordOccurrence[]
  showFurigana: boolean
  onSelectWord: (wordId: number) => void
}) {
  if (occurrences.length === 0) {
    return <RubyLyricText segments={segments} fallback={text} showRuby={showFurigana} />
  }

  const nodes: ReactNode[] = []
  let cursor = 0
  occurrences.forEach(({ word, startOffset, endOffset }, index) => {
    const start = Math.max(cursor, Math.min(text.length, startOffset))
    const end = Math.max(start, Math.min(text.length, endOffset))
    if (start > cursor) {
      nodes.push(<span key={`gap-${cursor}`}><RubyLyricSlice segments={segments} fallback={text} start={cursor} end={start} showRuby={showFurigana} /></span>)
    }
    if (end > start) {
      nodes.push(
        <button
          key={`${word.id}-${start}-${index}`}
          type="button"
          className="inline rounded-sm text-inherit outline-none transition hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:ring-1 focus-visible:ring-[#ff8ca1]/70"
          aria-label={`${word.writing}${word.reading ? ` ${word.reading}` : ''}`}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onSelectWord(word.id)
          }}
        >
          <RubyLyricSlice segments={segments} fallback={text} start={start} end={end} showRuby={showFurigana} />
        </button>,
      )
      cursor = end
    }
  })
  if (cursor < text.length) {
    nodes.push(<span key={`tail-${cursor}`}><RubyLyricSlice segments={segments} fallback={text} start={cursor} end={text.length} showRuby={showFurigana} /></span>)
  }
  return <>{nodes}</>
}

function RecordArtwork({ coverUrl, title, isPlaying }: { coverUrl?: string; title: string; isPlaying: boolean }) {
  return (
    <div className="relative mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center sm:max-w-[370px] lg:max-w-[460px] xl:max-w-[500px]">
      <div
        aria-hidden="true"
        className={`absolute right-[5%] top-[5%] z-20 hidden h-12 w-12 origin-center transition-transform duration-700 ease-out sm:block ${
          isPlaying ? 'rotate-[-5deg]' : 'rotate-0'
        }`}
      >
        <div className="absolute inset-0 rounded-full border border-white/15 bg-[#202027] shadow-[0_8px_24px_rgba(0,0,0,0.35)]" />
        <div className="absolute inset-[7px] rounded-full border border-black/60 bg-gradient-to-br from-zinc-300 via-zinc-500 to-zinc-700" />
        <div className="absolute left-1/2 top-[37px] h-[104px] w-[4px] origin-top -translate-x-1/2 rotate-[18deg] rounded-full bg-gradient-to-r from-zinc-500 via-zinc-200 to-zinc-500 shadow-[0_3px_8px_rgba(0,0,0,0.4)]">
          <div className="absolute -bottom-[5px] left-1/2 h-4 w-7 -translate-x-1/2 rotate-[5deg] rounded-[3px] border border-white/10 bg-[#24242b] shadow-lg shadow-black/40">
            <div className="absolute bottom-[-5px] left-[6px] h-[6px] w-[2px] rounded-full bg-[#ff3b5f]" />
          </div>
        </div>
      </div>
      <div
        className={`relative h-[82%] w-[82%] rounded-full border border-white/[0.06] bg-[radial-gradient(circle_at_34%_28%,#34343a_0%,#18181d_32%,#0a0a0d_72%)] shadow-[0_22px_60px_rgba(0,0,0,0.34)] ${
          isPlaying ? 'animate-[spin_18s_linear_infinite]' : ''
        }`}
      >
        <div className="absolute inset-[6%] rounded-full border border-white/[0.06]" />
        <div className="absolute inset-[12%] rounded-full border border-white/[0.04]" />
        <div className="absolute inset-[14%] overflow-hidden rounded-full border-[4px] border-[#e8e8ea] bg-[#151515] shadow-[0_0_0_5px_rgba(0,0,0,0.5),0_8px_24px_rgba(0,0,0,0.32)]">
          {coverUrl ? (
            <img src={resolveMediaUrl(coverUrl)} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#2a1d22] text-4xl font-black text-[#ff3b5f]">
              AU
            </div>
          )}
          <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/50 bg-zinc-200 shadow-sm" />
        </div>
      </div>
    </div>
  )
}

function audioSourceTypeLabel(t: ReturnType<typeof useTranslation>['t'], value?: string) {
  if (!value) {
    return t('song.audioSource.unknown')
  }
  return t(`song.audioSource.${value}`, { defaultValue: t('song.audioSource.unknown') })
}

function lyricJobStatusClass(status: LyricJobStatus) {
  switch (status) {
    case 'succeeded':
      return 'border-green-500/40 bg-green-500/10 text-green-300'
    case 'failed':
      return 'border-red-500/40 bg-red-500/10 text-red-300'
    case 'processing':
      return 'border-primary/40 bg-primary/10 text-primary'
    default:
      return 'border-gray-700 bg-gray-800 text-gray-300'
  }
}

function versionTypeLabel(t: ReturnType<typeof useTranslation>['t'], value?: string) {
  if (!value) {
    return t('common.unknown')
  }
  return t(`song.versionTypes.${value}`, { defaultValue: t('common.unknown') })
}

type SongToolPanel = 'details' | 'content' | 'ai' | 'study'

export default function SongDetailPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const lyricItemRefs = useRef<Record<number, HTMLLIElement | null>>({})
  const lyricListRef = useRef<HTMLOListElement | null>(null)
  const lyricFollowTimerRef = useRef<number | null>(null)
  const lyricLongPressTimerRef = useRef<number | null>(null)
  const lyricLongPressTriggeredRef = useRef(false)
  const lyricLongPressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const playlistMenuRef = useRef<HTMLDivElement | null>(null)
  const sourceJumpRef = useRef('')

  const songId = Number(id)
  const [lyricFollowPaused, setLyricFollowPaused] = useState(false)
  const [activeToolPanel, setActiveToolPanel] = useState<SongToolPanel | null>(null)
  const [studyLineId, setStudyLineId] = useState<number | undefined>()
  const [mobilePlayerView, setMobilePlayerView] = useState<'artwork' | 'lyrics'>('artwork')
  const [songActionsOpen, setSongActionsOpen] = useState(false)
  const { preferences: lyricPreferences, update: updateLyricPreferences, error: lyricPreferenceError } = useLyricPreferences()
  const { fontSize: lyricFontSize, showFurigana, showRomaji } = lyricPreferences
  const [timingPanelOpen, setTimingPanelOpen] = useState(false)
  const [selectedWordId, setSelectedWordId] = useState<number | null>(null)
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false)
  const [playlistFeedback, setPlaylistFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const changeLyricFontSize = (step: number) => {
    updateLyricPreferences({ fontSize: Math.min(48, Math.max(18, lyricFontSize + step)) })
  }

  const toggleFurigana = () => {
    updateLyricPreferences({ showFurigana: !showFurigana })
  }

  const toggleRomaji = () => {
    updateLyricPreferences({ showRomaji: !showRomaji })
  }

  useEffect(() => {
    setSelectedWordId(null)
    setActiveToolPanel(null)
    setPlaylistMenuOpen(false)
    setPlaylistFeedback(null)
    setTimingPanelOpen(false)
  }, [songId])

  useEffect(() => {
    const closeSelection = (event: Event) => {
      if (!selectedWordId && !playlistMenuOpen && !timingPanelOpen) return
      event.preventDefault()
      setSelectedWordId(null)
      setPlaylistMenuOpen(false)
      setTimingPanelOpen(false)
    }
    window.addEventListener('animeuta:back', closeSelection)
    return () => window.removeEventListener('animeuta:back', closeSelection)
  }, [selectedWordId, playlistMenuOpen, timingPanelOpen])

  const currentSong = usePlayerStore((state) => state.currentSong)
  const previousPlayerSongIdRef = useRef<number | null>(currentSong?.id ?? null)
  const isPlaying = usePlayerStore((state) => state.isPlaying)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const duration = usePlayerStore((state) => state.duration)
  const seekTo = usePlayerStore((state) => state.seekTo)
  const playNow = usePlayerStore((state) => state.playNow)
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const token = useAuthStore((state) => state.token)
  const currentUser = useAuthStore((state) => state.currentUser)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner'
  const [artworkPalette, setArtworkPalette] = useState(defaultArtworkPalette)
  const pendingSong = usePlayerStore(state => state.currentSong?.id === songId ? state.currentSong : state.queue.find(song => song.id === songId))

  useEffect(() => {
    const previousPlayerSongId = previousPlayerSongIdRef.current
    const nextPlayerSongId = currentSong?.id ?? null
    previousPlayerSongIdRef.current = nextPlayerSongId
    if (nextPlayerSongId && previousPlayerSongId === songId && nextPlayerSongId !== songId) {
      navigate(nextPlayerSongId!<0?'/online':`/song/${nextPlayerSongId}`, { replace: true })
    }
  }, [currentSong?.id, navigate, songId])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['song-detail', songId],
    queryFn: () => getSongDetail(songId),
    enabled: Number.isFinite(songId) && songId > 0,
  })

  const favoritesQuery = useQuery({
    queryKey: ['favorite-songs', token],
    queryFn: () => listFavoriteSongs(token as string, { page: 1, pageSize: 100 }),
    enabled: Boolean(token),
  })

  const playlistsQuery = useQuery({
    queryKey: ['playlists', token],
    queryFn: () => listPlaylists(token as string),
    enabled: Boolean(token),
  })

  const playlists = useMemo(() => playlistsQuery.data ?? [], [playlistsQuery.data])

  const playlistMutation = useMutation({
    mutationFn: (playlistId: number) => addPlaylistSong(token as string, playlistId, { song_id: songId }),
    onSuccess: async (_, playlistId) => {
      const playlist = playlists.find((item) => item.id === playlistId)
      setPlaylistFeedback({ type: 'success', message: t('playlists.songAdded', { name: playlist?.name ?? t('playlists.title') }) })
      setPlaylistMenuOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['playlists', token] }),
        queryClient.invalidateQueries({ queryKey: ['playlist-detail', playlistId] }),
      ])
    },
    onError: (mutationError) => {
      if (getApiErrorStatus(mutationError) === 401) {
        clearAuth()
        navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
        return
      }
      setPlaylistFeedback({ type: 'error', message: getApiErrorMessage(mutationError, t('playlists.operationFailed')) })
    },
  })

  useEffect(() => {
    if (!playlistMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!playlistMenuRef.current?.contains(event.target as Node)) setPlaylistMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlaylistMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [playlistMenuOpen])

  useEffect(() => {
    if (!playlistFeedback) return
    const timer = window.setTimeout(() => setPlaylistFeedback(null), 3_000)
    return () => window.clearTimeout(timer)
  }, [playlistFeedback])

  useEffect(() => {
    const coverUrl = resolveMediaUrl(data?.coverUrl ?? pendingSong?.coverUrl)
    let active = true
    if (!coverUrl && !isLoading) setArtworkPalette(defaultArtworkPalette)
    if (coverUrl) {
      void extractArtworkPalette(coverUrl)
        .then((palette) => {
          if (active) setArtworkPalette(palette)
        })
        .catch(() => undefined)
    }
    return () => {
      active = false
    }
  }, [data?.coverUrl, pendingSong?.coverUrl, isLoading])

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('song-player-active')
    root.style.setProperty('--song-player-bg', artworkPalette.base)
    root.style.setProperty('--song-player-bg-deep', artworkPalette.deep)
    root.style.setProperty('--song-player-bg-soft', artworkPalette.soft)
    root.style.setProperty('--song-player-accent', artworkPalette.accent)
    return () => {
      root.classList.remove('song-player-active')
      root.style.removeProperty('--song-player-bg')
      root.style.removeProperty('--song-player-bg-deep')
      root.style.removeProperty('--song-player-bg-soft')
      root.style.removeProperty('--song-player-accent')
    }
  }, [artworkPalette])

  const lyricsQuery = useQuery({
    queryKey: ['song-lyrics', songId, token],
    queryFn: () => getSongLyrics(songId, token),
    enabled: Number.isFinite(songId) && songId > 0,
  })

  const songWordsQuery = useQuery({
    queryKey: ['song-study-words', songId],
    queryFn: () => getSongWords(songId),
    enabled: Boolean(token) && Number.isFinite(songId) && songId > 0,
  })

  const studyDecksQuery = useQuery({
    queryKey: ['study-decks'],
    queryFn: listStudyDecks,
    enabled: Boolean(token),
  })

  const studyPreferencesQuery = useQuery({
    queryKey: ['study-preferences'],
    queryFn: getStudyPreferences,
    enabled: Boolean(token),
  })

  const lyricJobsQuery = useQuery({
    queryKey: ['lyric-processing-jobs', songId],
    queryFn: () => listLyricProcessingJobs(songId),
    enabled: Number.isFinite(songId) && songId > 0,
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.status === 'pending' || job.status === 'processing') ? 1000 : false,
  })

  const shouldClearExpiredAuth = favoritesQuery.isError && getApiErrorStatus(favoritesQuery.error) === 401
  const canReplaceAudio = Boolean(
    token && data && (isAdmin || (data.submittedBy && currentUser?.id === data.submittedBy)),
  )

  useEffect(() => {
    if (shouldClearExpiredAuth) {
      clearAuth()
    }
  }, [clearAuth, shouldClearExpiredAuth])

  const addMutation = useMutation({
    mutationFn: () => addFavoriteSong(token as string, songId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['favorite-songs', token] })
    },
    onError: (mutationError) => {
      if (getApiErrorStatus(mutationError) === 401) {
        clearAuth()
        navigate('/login', {
          state: { from: `${location.pathname}${location.search}` },
        })
      }
    },
  })

  const removeMutation = useMutation({
    mutationFn: () => removeFavoriteSong(token as string, songId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['favorite-songs', token] })
    },
    onError: (mutationError) => {
      if (getApiErrorStatus(mutationError) === 401) {
        clearAuth()
        navigate('/login', {
          state: { from: `${location.pathname}${location.search}` },
        })
      }
    },
  })

  const quickAddStudyMutation = useMutation({
    mutationFn: async (lexemeId: number) => {
      const [decks, preferences] = await Promise.all([
        studyDecksQuery.data ? Promise.resolve(studyDecksQuery.data) : listStudyDecks(),
        studyPreferencesQuery.data ? Promise.resolve(studyPreferencesQuery.data) : getStudyPreferences(),
      ])
      const targetDeck = decks.find((deck) => deck.isDefault) ?? decks[0]
      if (!targetDeck) throw new Error(t('study.songWords.noDeck'))
      return addStudyCardsToDecks({
        deckIds: [targetDeck.id],
        lexemeIds: [lexemeId],
        songId,
        directions: [preferences.defaultDirection],
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['study-decks'] }),
        queryClient.invalidateQueries({ queryKey: ['study-today'] }),
        queryClient.invalidateQueries({ queryKey: ['study-next'] }),
        queryClient.invalidateQueries({ queryKey: ['study-cards'] }),
      ])
    },
  })

  const uploadAudioMutation = useMutation({
    mutationFn: (file: File) => uploadSongAudio(songId, file, token as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['song-detail', songId] })
    },
  })

  const uploadLyricsMutation = useMutation({
    mutationFn: (file: File) => uploadSongLyrics(songId, file, token as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['song-lyrics', songId] })
      await queryClient.invalidateQueries({ queryKey: ['lyric-versions', songId] })
    },
  })

  const shareMutation = useMutation({
    mutationFn: () => requestSongShare(songId, token as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['song-detail', songId] })
      await queryClient.invalidateQueries({ queryKey: ['admin-song-submissions'] })
    },
  })

  const createLyricJobMutation = useMutation({
    mutationFn: (jobType: LyricJobType) => createLyricProcessingJob(songId, jobType, token as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lyric-processing-jobs', songId] })
    },
  })

  const retryLyricJobMutation = useMutation({
    mutationFn: (jobId: number) => retryLyricProcessingJob(jobId, token as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lyric-processing-jobs', songId] })
    },
  })

  const timingOffsetMutation = useMutation({
    mutationFn: (timingOffsetMs: number) => updateLyricTimingOffset(lyricsQuery.data?.id as number, timingOffsetMs, token as string),
    onSuccess: (updatedLyrics) => {
      queryClient.setQueryData(['song-lyrics', songId, token], updatedLyrics)
      publishDesktopLyricsTimingOffset(songId, updatedLyrics.timingOffsetMs ?? 0)
    },
  })

  const favoriteSongIds = useMemo(
    () => new Set((favoritesQuery.data?.data ?? []).map((song) => song.id)),
    [favoritesQuery.data],
  )
  const isFavorited = favoriteSongIds.has(songId)
  const rawLyricLines = useMemo(() => lyricsQuery.data?.lines ?? [], [lyricsQuery.data])
  const lyricCreditLines = useMemo(
    () => Array.from(new Set(rawLyricLines
      .filter((line) => isLyricCreditLine(line.originalText))
      .map((line) => line.originalText.trim()))),
    [rawLyricLines],
  )
  const lyricLines = useMemo(
    () => rawLyricLines.filter((line) => !isHiddenLyricLine(line.originalText) && !isLyricCreditLine(line.originalText)),
    [rawLyricLines],
  )
  const studyWords = useMemo(() => songWordsQuery.data?.words ?? [], [songWordsQuery.data])
  const selectedWord = selectedWordId === null ? undefined : studyWords.find((word) => word.id === selectedWordId)
  const lyricWordOccurrences = useMemo(() => {
    const byLine = new Map<number, LyricWordOccurrence[]>()
    studyWords.forEach((word) => {
      word.occurrences.forEach((occurrence) => {
        if (!Number.isFinite(occurrence.startOffset) || !Number.isFinite(occurrence.endOffset)) return
        const items = byLine.get(occurrence.lineId) ?? []
        items.push({ word, startOffset: occurrence.startOffset as number, endOffset: occurrence.endOffset as number })
        byLine.set(occurrence.lineId, items)
      })
    })
    byLine.forEach((items) => items.sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset))
    return byLine
  }, [studyWords])
  const lyricJobs = useMemo(() => lyricJobsQuery.data ?? [], [lyricJobsQuery.data])
  const lyricJobsStatusKey = lyricJobs.map((job) => `${job.id}:${job.status}:${job.updatedAt ?? ''}`).join('|')
  const lyricJobPending = createLyricJobMutation.isPending
  const timingOffsetMs = lyricsQuery.data?.timingOffsetMs ?? 0
  const canAdjustLyricTiming = Boolean(token && lyricsQuery.data?.id && (isAdmin || lyricsQuery.data.uploadedBy === currentUser?.id))
  const isCurrentPlayerSong = currentSong?.id === songId
  const activeLyricIndex = useMemo(() => {
    if (!isCurrentPlayerSong || lyricLines.length === 0) {
      return -1
    }

    const currentMs = currentTime * 1000 - timingOffsetMs
    let activeIndex = -1

    for (let index = 0; index < lyricLines.length; index += 1) {
      const line = lyricLines[index]
      const startMs = line.startMs ?? 0
      const nextStartMs = lyricLines[index + 1]?.startMs
      const endMs = line.endMs ?? nextStartMs ?? Number.POSITIVE_INFINITY

      if (currentMs >= startMs && currentMs < endMs) {
        activeIndex = index
        break
      }
    }

    return activeIndex
  }, [currentTime, isCurrentPlayerSong, lyricLines, timingOffsetMs])

  const activeLyricLine = activeLyricIndex >= 0 ? lyricLines[activeLyricIndex] : null
  const pauseLyricFollow = () => {
    setLyricFollowPaused(true)
    if (lyricFollowTimerRef.current !== null) window.clearTimeout(lyricFollowTimerRef.current)
    lyricFollowTimerRef.current = window.setTimeout(() => {
      lyricFollowTimerRef.current = null
      setLyricFollowPaused(false)
    }, 5_000)
  }

  useEffect(() => () => {
    if (lyricFollowTimerRef.current !== null) window.clearTimeout(lyricFollowTimerRef.current)
    if (lyricLongPressTimerRef.current !== null) window.clearTimeout(lyricLongPressTimerRef.current)
  }, [])

  useEffect(() => {
    if (!lyricJobs.some((job) => job.status === 'succeeded')) {
      return
    }
    void queryClient.invalidateQueries({ queryKey: ['song-lyrics', songId] })
    void queryClient.invalidateQueries({ queryKey: ['lyric-versions', songId] })
  }, [lyricJobs, lyricJobsStatusKey, songId])

  useEffect(() => {
    if (lyricFollowPaused || !activeLyricLine || !lyricListRef.current) {
      return
    }

    const item = lyricItemRefs.current[activeLyricLine.id]
    if (!item) {
      return
    }
    const list = lyricListRef.current
    const targetTop = item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2
    list.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' })
  }, [activeLyricLine, lyricFollowPaused])

  useEffect(() => {
    if (!data) return
    const rawTime = new URLSearchParams(location.search).get('t')
    if (rawTime === null || rawTime.trim() === '') return
    const requestedTime = Number(rawTime)
    if (!Number.isFinite(requestedTime) || requestedTime < 0) return
    const jumpKey = `${songId}:${requestedTime}`
    if (sourceJumpRef.current === jumpKey) return
    sourceJumpRef.current = jumpKey
    if (currentSong?.id !== songId) {
      playNow({
        id: data.id,
        title: data.displayTitle,
        artist: data.artists[0]?.displayName ?? t('common.unknownArtist'),
        coverUrl: data.coverUrl,
        audioUrl: resolveMediaUrl(data.audioSourceUri),
        durationSeconds: data.durationSeconds,
      }, { type: 'single', name: data.displayTitle })
    }
    seekTo(data.durationSeconds ? Math.min(requestedTime, data.durationSeconds) : requestedTime)
  }, [currentSong?.id, data, location.search, playNow, seekTo, songId, t])

  if (!Number.isFinite(songId) || songId <= 0) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-2">{t('song.details')}</h2>
        <p className="text-red-400">{t('song.invalidId')}</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="song-player-page min-h-[100dvh] p-0">
        <section className="song-player-stage relative overflow-hidden text-white" aria-busy="true" aria-label={t('song.loading')}>
          <button type="button" className="song-player-back fixed left-4 top-4 z-[110] grid h-10 w-10 place-items-center rounded-full text-white/75 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 md:left-7" title={t('common.back')} aria-label={t('common.back')} onClick={()=>window.history.state?.idx>0?navigate(-1):navigate('/')}><ChevronDown size={26} strokeWidth={1.8}/></button>
          <div className="song-player-columns relative mx-auto grid w-full max-w-[1680px] items-center">
            <div className="hidden min-[900px]:block"><RecordArtwork coverUrl={pendingSong?.coverUrl} title={pendingSong?.title??''} isPlaying={false}/></div>
            <div className="song-player-content flex min-h-0 flex-col">
              <div className="song-player-heading space-y-2">
                {pendingSong?<><h2 className="line-clamp-2 text-xl font-semibold md:text-[28px]">{pendingSong.title}</h2><p className="text-sm text-white/55">{pendingSong.artist}</p></>:<div className="song-loading-placeholder space-y-3" aria-hidden="true"><div className="song-loading-line h-7 w-2/3"/><div className="song-loading-line h-4 w-1/3"/></div>}
              </div>
              <div className="song-loading-placeholder flex min-h-0 flex-1 flex-col justify-center gap-7 overflow-hidden py-8" aria-hidden="true">
                {[72,88,60,80].map((width,index)=><div key={width} className="space-y-3" style={{opacity:1-index*0.18}}><div className="song-loading-line h-5" style={{width:`${width}%`}}/><div className="song-loading-line h-3" style={{width:`${width*0.65}%`}}/></div>)}
              </div>
              <span role="status" className="sr-only">{t('song.loading')}</span>
            </div>
          </div>
        </section>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-2">{t('song.details')}</h2>
        <p className="text-red-400">
          {t('song.loadFailed', { message: getApiErrorMessage(error, t('common.unknown')) })}
        </p>
      </div>
    )
  }

  const primaryArtist = data.artists[0]?.displayName ?? t('common.unknownArtist')
  const structuredCreditLines = Array.from(
    data.creators.reduce((groups, creator) => {
      const names = groups.get(creator.role) ?? []
      if (!names.includes(creator.name)) names.push(creator.name)
      groups.set(creator.role, names)
      return groups
    }, new Map<string, string[]>()),
  ).map(([role, names]) => `${t(`song.creatorRoles.${role}`, { defaultValue: role })}: ${names.join(' / ')}`)
  const displayedCreditLines = lyricCreditLines.length > 0 ? lyricCreditLines : structuredCreditLines
  const favoriteMutationPending = addMutation.isPending || removeMutation.isPending
  const detailDuration = data.durationSeconds && data.durationSeconds > 0
    ? data.durationSeconds
    : isCurrentPlayerSong && duration > 0
      ? duration
      : undefined
  const detailDurationLabel = formatDuration(detailDuration)

  const handleToggleFavorite = () => {
    if (!token) {
      navigate('/login', {
        state: { from: `${location.pathname}${location.search}` },
      })
      return
    }

    if (isFavorited) {
      removeMutation.mutate()
      return
    }

    addMutation.mutate()
  }

  const playerSong = {
      id: data.id,
      title: data.displayTitle,
      artist: primaryArtist,
      coverUrl: data.coverUrl,
      audioUrl: resolveMediaUrl(data.audioSourceUri),
      durationSeconds: data.durationSeconds,
  }

  const handlePlaySong = () => playNow(playerSong, { type: 'single', name: data.displayTitle })

  const secondaryTools = [
    { id: 'details' as const, label: t('song.tools.details'), icon: Tags },
    { id: 'content' as const, label: t('song.tools.content'), icon: FileText },
    { id: 'ai' as const, label: t('song.tools.ai'), icon: Sparkles },
    { id: 'study' as const, label: t('song.tools.study'), icon: Languages },
  ]

  const toggleToolPanel = (panel: SongToolPanel) => {
    if (panel === 'study') setStudyLineId(undefined)
    setActiveToolPanel((currentPanel) => currentPanel === panel ? null : panel)
  }

  const cancelLyricLongPress = () => {
    if (lyricLongPressTimerRef.current !== null) {
      window.clearTimeout(lyricLongPressTimerRef.current)
      lyricLongPressTimerRef.current = null
    }
    lyricLongPressOriginRef.current = null
  }

  const startLyricLongPress = (lineId: number, event: ReactPointerEvent<HTMLLIElement>) => {
    cancelLyricLongPress()
    lyricLongPressTriggeredRef.current = false
    lyricLongPressOriginRef.current = { x: event.clientX, y: event.clientY }
    lyricLongPressTimerRef.current = window.setTimeout(() => {
      lyricLongPressTimerRef.current = null
      lyricLongPressOriginRef.current = null
      lyricLongPressTriggeredRef.current = true
      setStudyLineId(lineId)
      setActiveToolPanel('study')
    }, 550)
  }

  const moveLyricLongPress = (event: ReactPointerEvent<HTMLLIElement>) => {
    const origin = lyricLongPressOriginRef.current
    if (!origin) return
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancelLyricLongPress()
  }

  return (
    <div
      className="song-player-page min-h-[100dvh] p-0"
      style={{
        '--song-player-bg': artworkPalette.base,
        '--song-player-bg-deep': artworkPalette.deep,
        '--song-player-bg-soft': artworkPalette.soft,
        '--song-player-accent': artworkPalette.accent,
      } as CSSProperties}
    >
      <section className="song-player-stage relative overflow-hidden text-white">
        <button
          type="button"
          className="song-player-back fixed left-4 top-4 z-[110] grid h-10 w-10 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 md:left-7"
          title={t('common.back')}
          aria-label={t('common.back')}
          onClick={() => window.history.state?.idx > 0 ? navigate(-1) : navigate('/')}
        >
          <ChevronDown size={26} strokeWidth={1.8} />
        </button>
        <div className="song-player-columns relative mx-auto grid w-full max-w-[1680px] items-center">
          <div className="hidden min-[900px]:block">
            <RecordArtwork coverUrl={data.coverUrl} title={data.displayTitle} isPlaying={isCurrentPlayerSong && isPlaying} />
          </div>

          <div className="song-player-content flex min-h-0 flex-col">
            <div className="song-player-heading space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="line-clamp-2 text-xl font-semibold tracking-normal md:text-[28px]">{data.displayTitle}</h2>
                <dl className="mt-2 space-y-1 text-sm text-white/55">
                  <div className="flex min-w-0 items-start gap-2">
                    <dt className="shrink-0 text-white/35">{t('song.artist')}:</dt>
                    <dd className="min-w-0 break-words">
                      {data.artists.length > 0
                        ? data.artists.map((artist, index) => (
                            <span key={artist.id}>
                              {index > 0 && ' / '}
                              <Link className="transition-colors hover:text-white" to={`/artist/${artist.id}`}>
                                {artist.displayName}
                              </Link>
                            </span>
                          ))
                        : primaryArtist}
                    </dd>
                  </div>
                  {data.albums.length > 0 && (
                    <div className="flex min-w-0 items-start gap-2">
                      <dt className="shrink-0 text-white/35">{t('song.albums')}:</dt>
                      <dd className="min-w-0 break-words">
                        {data.albums.map((album, index) => (
                          <span key={album.id}>
                            {index > 0 && ' / '}
                            <Link className="transition-colors hover:text-white" to={`/album/${album.id}`}>
                              {album.displayTitle}
                            </Link>
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}
                  {data.works.length > 0 && (
                    <div className="flex min-w-0 items-start gap-2">
                      <dt className="shrink-0 text-white/35">{t('song.works')}:</dt>
                      <dd className="min-w-0 break-words">
                        {data.works.map((work, index) => (
                          <span key={work.id}>
                            {index > 0 && ' / '}
                            <Link className="transition-colors hover:text-white" to={`/work/${work.id}`}>
                              {work.displayTitle}
                            </Link>
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
                </div>
              </div>
              <div className="song-primary-actions flex items-center gap-1 pt-1">
                <button
                  type="button"
                  disabled={!data.audioSourceUri}
                  className="icon-button bg-white/10"
                  aria-label={t('player.playNow')}
                  title={t('player.playNow')}
                  onClick={handlePlaySong}
                >
                  <Play size={20} fill="currentColor" />
                </button>
                <button
                  type="button"
                  disabled={favoriteMutationPending}
                  className="icon-button"
                  aria-pressed={isFavorited}
                  aria-label={t(isFavorited ? 'song.favorite.remove' : 'song.favorite.add')}
                  title={t(isFavorited ? 'song.favorite.remove' : 'song.favorite.add')}
                  onClick={handleToggleFavorite}
                >
                  {favoriteMutationPending ? <Loader2 size={20} className="animate-spin" /> : <Heart size={21} fill={isFavorited ? 'currentColor' : 'none'} className={isFavorited ? 'text-[#ff8aa2]' : ''} />}
                </button>
                <div ref={playlistMenuRef} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={playlistMenuOpen}
                    className="icon-button"
                    aria-label={t('playlists.addSong')}
                    title={t('playlists.addSong')}
                    onClick={() => {
                      if (!token) {
                        navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
                        return
                      }
                      setPlaylistFeedback(null)
                      setPlaylistMenuOpen((current) => !current)
                    }}
                  >
                    <ListPlus size={21} aria-hidden="true" />
                  </button>
                  {playlistMenuOpen && (
                    <div role="menu" className="absolute left-0 top-12 z-50 w-64 overflow-hidden rounded-md border border-white/[0.12] bg-[#1b1b22] p-2 text-left shadow-2xl shadow-black/50">
                      <p className="px-2 py-1.5 text-xs font-semibold text-zinc-500">{t('playlists.choosePlaylist')}</p>
                      <CreatePlaylistInline disabled={playlistMutation.isPending} onCreated={p=>playlistMutation.mutate(p.id)}/>
                      {playlistsQuery.isLoading && <p className="px-2 py-3 text-sm text-zinc-500">{t('playlists.loading')}</p>}
                      {playlistsQuery.isError && <p className="px-2 py-3 text-sm text-red-300">{getApiErrorMessage(playlistsQuery.error, t('playlists.loadFailed'))}</p>}
                      <div className="max-h-56 overflow-y-auto">
                        {playlists.map((playlist) => (
                          <button
                            key={playlist.id}
                            type="button"
                            role="menuitem"
                            disabled={playlistMutation.isPending}
                            onClick={() => playlistMutation.mutate(playlist.id)}
                            className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-sm text-zinc-200 hover:bg-white/[0.07] disabled:opacity-40"
                          >
                            <span className="truncate">{playlist.name}</span>
                            {playlistMutation.isPending && playlistMutation.variables === playlist.id
                              ? <span className="h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-white" />
                              : <Check size={14} className="opacity-0" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button type="button" className="icon-button" aria-label={t('ux.more')} title={t('ux.more')} onClick={() => setSongActionsOpen(true)}><MoreHorizontal size={21} /></button>
                {token && currentUser?.id === data.submittedBy && data.visibility === 'private' && (
                  <button
                    type="button"
                    disabled={shareMutation.isPending || data.reviewStatus === 'pending'}
                    className="hidden rounded-md border border-white/20 px-3 py-2 text-xs disabled:opacity-40 min-[900px]:block"
                    onClick={() => shareMutation.mutate()}
                  >
                    {data.reviewStatus === 'pending'
                      ? t('song.share.pending', { defaultValue: '共享审核中' })
                      : shareMutation.isPending
                        ? t('common.saving')
                        : t('song.share.request', { defaultValue: '申请共享给好友' })}
                  </button>
                )}
              </div>
              <nav aria-label={t('song.tools.navigation')} className="song-secondary-actions flex max-w-full gap-1.5 overflow-x-auto [scrollbar-width:none]">
                {secondaryTools.map(({ id: panel, label, icon: Icon }) => {
                  const isActive = activeToolPanel === panel
                  return (
                    <button
                      key={panel}
                      type="button"
                      aria-expanded={isActive}
                      aria-controls={`song-tool-panel-${panel}`}
                      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${
                        isActive
                          ? 'border-white/25 bg-white/15 text-white'
                          : 'border-white/10 bg-black/10 text-white/55 hover:bg-white/10 hover:text-white'
                      }`}
                      onClick={() => toggleToolPanel(panel)}
                    >
                      <Icon size={14} aria-hidden="true" />
                      {label}
                    </button>
                  )
                })}
              </nav>
              {shareMutation.isSuccess && <p className="text-sm text-emerald-300">{shareMutation.data.reviewRequired ? t('song.share.requested', { defaultValue: '已提交共享审核' }) : t('song.share.shared', { defaultValue: '已加入共享曲库' })}</p>}
              {shareMutation.isError && <p className="text-sm text-red-300">{getApiErrorMessage(shareMutation.error, t('song.share.failed', { defaultValue: '共享申请失败' }))}</p>}
              {playlistFeedback && <p role="status" className={`text-sm ${playlistFeedback.type === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>{playlistFeedback.message}</p>}
              {!data.audioSourceUri && <p className="text-sm text-yellow-200">{t('song.noPlayable')}</p>}
            </div>

            <div className="mobile-player-view-switch min-[900px]:hidden" role="group" aria-label={t('ux.nowPlaying')}>
              <button type="button" aria-pressed={mobilePlayerView === 'artwork'} onClick={() => setMobilePlayerView('artwork')}>{t('ux.artwork')}</button>
              <button type="button" aria-pressed={mobilePlayerView === 'lyrics'} onClick={() => setMobilePlayerView('lyrics')}>{t('ux.lyrics')}</button>
            </div>
            {mobilePlayerView === 'artwork' && <button type="button" className="mobile-song-artwork min-[900px]:hidden" aria-label={t('song.playerView.lyrics')} onClick={() => setMobilePlayerView('lyrics')}>
              {data.coverUrl ? <img src={resolveMediaUrl(data.coverUrl)} alt={data.displayTitle} /> : <span className="text-5xl font-bold">AU</span>}
            </button>}

            <div
              className={`song-lyrics-panel ${mobilePlayerView === 'lyrics' ? 'block' : 'hidden'} relative mt-2 min-h-0 flex-1 overflow-hidden min-[900px]:block`}
              onClick={(event) => {
                if (window.matchMedia('(min-width: 900px)').matches) return
                if ((event.target as HTMLElement).closest('[data-lyric-line]')) return
                setMobilePlayerView('artwork')
              }}
            >
              <div className="song-lyric-fade-top pointer-events-none absolute inset-x-0 top-0 z-10 h-10 md:h-16" />
              <div className="song-lyric-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 md:h-20" />
              <div
                className="song-lyric-toolbar absolute right-2 top-1/2 z-20 flex w-11 -translate-y-1/2 flex-col items-center overflow-hidden rounded-full border p-1 text-white/55 sm:right-3"
                onClick={(event) => event.stopPropagation()}
              >
                <Type size={14} className="my-1.5 text-white/45" aria-hidden="true" />
                <button
                  type="button"
                  title={t('lyric.increaseFontSize')}
                  aria-label={t('lyric.increaseFontSize')}
                  disabled={lyricFontSize >= 48}
                  className="song-lyric-toolbar-button grid h-8 w-8 place-items-center rounded-full disabled:opacity-25"
                  onClick={() => changeLyricFontSize(2)}
                >
                  <Plus size={15} />
                </button>
                <output className="grid h-7 w-8 place-items-center text-[11px] tabular-nums text-white/65" aria-label={t('lyric.fontSize')}>
                  {lyricFontSize}
                </output>
                <button
                  type="button"
                  title={t('lyric.decreaseFontSize')}
                  aria-label={t('lyric.decreaseFontSize')}
                  disabled={lyricFontSize <= 18}
                  className="song-lyric-toolbar-button grid h-8 w-8 place-items-center rounded-full disabled:opacity-25"
                  onClick={() => changeLyricFontSize(-2)}
                >
                  <Minus size={15} />
                </button>
                <span aria-hidden="true" className="my-1 h-px w-6 bg-white/10" />
                <button
                  type="button"
                  aria-pressed={showFurigana}
                  title={t(showFurigana ? 'lyric.hideFurigana' : 'lyric.showFurigana')}
                  className={`song-lyric-track-toggle grid h-9 w-9 place-items-center rounded-full text-[11px] font-medium ${showFurigana ? 'is-active' : ''}`}
                  onClick={toggleFurigana}
                >
                  {t('lyric.furigana', { defaultValue: '假名' })}
                </button>
                <button
                  type="button"
                  aria-pressed={showRomaji}
                  title={t(showRomaji ? 'lyric.hideRomaji' : 'lyric.showRomaji')}
                  className={`song-lyric-track-toggle grid h-9 w-9 place-items-center rounded-full text-[10px] font-medium leading-tight ${showRomaji ? 'is-active' : ''}`}
                  onClick={toggleRomaji}
                >
                  <span>{t('lyric.romaji', { defaultValue: '罗马音' })}</span>
                </button>
                <button type="button" aria-label="显示中文翻译" title="显示中文翻译" aria-pressed={lyricPreferences.showTranslation} onClick={() => updateLyricPreferences({ showTranslation: !lyricPreferences.showTranslation })} className={`song-lyric-track-toggle grid h-9 w-9 place-items-center rounded-full ${lyricPreferences.showTranslation ? 'is-active' : ''}`}><Languages size={16} /></button>
                {canAdjustLyricTiming && (
                  <>
                    <span aria-hidden="true" className="my-1 h-px w-6 bg-white/10" />
                    <button
                      type="button"
                      aria-pressed={timingPanelOpen}
                      title={t('lyric.timing.title')}
                      aria-label={t('lyric.timing.title')}
                      className={`song-lyric-track-toggle grid h-9 w-9 place-items-center rounded-full ${timingPanelOpen || timingOffsetMs !== 0 ? 'is-active' : ''}`}
                      onClick={() => setTimingPanelOpen((current) => !current)}
                    >
                      <Clock3 size={15} />
                    </button>
                  </>
                )}
              </div>
              {canAdjustLyricTiming && timingPanelOpen && (
                <div
                  className="song-lyric-toolbar absolute right-14 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1 rounded-full border p-1.5 text-white/60 sm:right-16"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    disabled={timingOffsetMutation.isPending || timingOffsetMs <= -30_000}
                    title={t('lyric.timing.earlierAction')}
                    aria-label={t('lyric.timing.earlierAction')}
                    className="song-lyric-toolbar-button grid h-8 w-8 place-items-center rounded-full disabled:opacity-25"
                    onClick={() => timingOffsetMutation.mutate(Math.max(-30_000, timingOffsetMs - 500))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <output className="min-w-24 px-1 text-center text-xs font-medium tabular-nums text-white/75" aria-label={t('lyric.timing.current')}>
                    {timingOffsetMs === 0
                      ? t('lyric.timing.synced')
                      : timingOffsetMs < 0
                        ? t('lyric.timing.earlier', { seconds: Math.abs(timingOffsetMs / 1000).toFixed(1) })
                        : t('lyric.timing.later', { seconds: (timingOffsetMs / 1000).toFixed(1) })}
                  </output>
                  <button
                    type="button"
                    disabled={timingOffsetMutation.isPending || timingOffsetMs >= 30_000}
                    title={t('lyric.timing.laterAction')}
                    aria-label={t('lyric.timing.laterAction')}
                    className="song-lyric-toolbar-button grid h-8 w-8 place-items-center rounded-full disabled:opacity-25"
                    onClick={() => timingOffsetMutation.mutate(Math.min(30_000, timingOffsetMs + 500))}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={timingOffsetMutation.isPending || timingOffsetMs === 0}
                    title={t('lyric.timing.reset')}
                    aria-label={t('lyric.timing.reset')}
                    className="song-lyric-toolbar-button grid h-8 w-8 place-items-center rounded-full disabled:opacity-25"
                    onClick={() => timingOffsetMutation.mutate(0)}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              )}
              {timingOffsetMutation.isError && timingPanelOpen && (
                <p className="absolute right-16 top-[calc(50%+3rem)] z-20 text-xs text-red-200">
                  {getApiErrorMessage(timingOffsetMutation.error, t('lyric.timing.failed'))}
                </p>
              )}
              {lyricsQuery.isLoading && <p className="pt-24 text-white/45">{t('lyric.loading')}</p>}
              {lyricsQuery.isError && <p className="pt-24 text-red-200">{t('lyric.loadFailed')}</p>}
              {!lyricsQuery.isLoading && !lyricsQuery.isError && lyricLines.length === 0 && displayedCreditLines.length === 0 && (
                <p className="pt-24 text-white/45">{t('lyric.empty')}</p>
              )}
              {(lyricLines.length > 0 || displayedCreditLines.length > 0) && (
                <ol
                  ref={lyricListRef}
                  data-testid="lyric-list"
                  className="h-full min-h-0 overflow-y-auto pb-28 pt-6 pl-1 pr-14 overscroll-contain [scrollbar-width:none] sm:pl-6 sm:pr-20 min-[900px]:pl-7"
                  onWheel={pauseLyricFollow}
                  onTouchMove={pauseLyricFollow}
                >
                  {displayedCreditLines.length > 0 && (
                    <li className="song-lyric-credits mb-4 space-y-1 pb-1" aria-label={t('song.creators')}>
                      {displayedCreditLines.map((credit) => <p key={credit}>{credit}</p>)}
                    </li>
                  )}
                  {lyricLines.map((line, index) => {
                    const isActiveLine = index === activeLyricIndex
                    const translation = visibleTranslation(data.languageCode, line.originalText, line.translatedText)
                    const romaji = visibleRomaji(line.originalText, line.romajiText)
                    return (
                      <li
                        key={line.id}
                        data-lyric-line
                        data-active={isActiveLine ? 'true' : 'false'}
                        data-testid={`lyric-line-${index}`}
                        ref={(element) => {
                          lyricItemRefs.current[line.id] = element
                        }}
                        data-playing={activeLyricIndex >= 0 ? 'true' : 'false'}
                        className="song-lyric-line group cursor-pointer select-none py-3 transition duration-300 [touch-action:pan-y]"
                        onPointerDown={(event) => startLyricLongPress(line.id, event)}
                        onPointerMove={moveLyricLongPress}
                        onPointerUp={cancelLyricLongPress}
                        onPointerCancel={cancelLyricLongPress}
                        onPointerLeave={cancelLyricLongPress}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          cancelLyricLongPress()
                          setStudyLineId(line.id)
                          setActiveToolPanel('study')
                        }}
                        onClick={() => {
                          if (lyricLongPressTriggeredRef.current) {
                            lyricLongPressTriggeredRef.current = false
                            return
                          }
                          if (!window.matchMedia('(min-width: 900px)').matches) {
                            setMobilePlayerView('artwork')
                            return
                          }
                          if (line.startMs != null) {
                            seekTo(Math.max(0, (line.startMs + timingOffsetMs) / 1000))
                          }
                        }}
                      >
                        <p
                          lang="ja"
                          className={isActiveLine ? 'pt-2 font-semibold' : 'pt-2 font-medium'}
                          style={{ fontSize: `${lyricFontSize}px`, lineHeight: 1.75 }}
                        >
                          <InteractiveLyricText
                            text={line.originalText}
                            segments={line.originalRuby}
                            occurrences={lyricWordOccurrences.get(line.id) ?? []}
                            showFurigana={showFurigana}
                            onSelectWord={(wordId) => {
                              pauseLyricFollow()
                              quickAddStudyMutation.reset()
                              setSelectedWordId(wordId)
                            }}
                          />
                        </p>
                        {showRomaji && romaji && <p className="song-lyric-romaji mt-0.5 leading-5" style={{ fontSize: `${Math.max(12, Math.round(lyricFontSize * 0.46))}px` }}>{romaji}</p>}
                        {lyricPreferences.showTranslation && translation && <p className="song-lyric-translation mt-1 leading-relaxed" style={{ fontSize: `${Math.max(15, Math.round(lyricFontSize * 0.62))}px` }}>{translation}</p>}
                      </li>
                    )
                  })}
                </ol>
              )}
              {selectedWord && (
                <section
                  aria-label={t('lyric.wordDetails')}
                  className="absolute inset-x-3 bottom-3 z-30 rounded-md border border-white/10 bg-[#202027]/95 p-4 text-left shadow-2xl backdrop-blur sm:left-auto sm:right-3 sm:w-[min(24rem,calc(100%-1.5rem))]"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <strong className="text-xl text-white">{selectedWord.writing}</strong>
                        {selectedWord.reading && <span lang="ja" className="text-sm font-medium text-[#ff9caf]">{selectedWord.reading}</span>}
                        {selectedWord.jlptLevel && <span className="rounded bg-[#ff4d6d]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#ff8ca1]">{selectedWord.jlptLevel}</span>}
                        {selectedWord.partOfSpeech && <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[11px] text-zinc-400">{selectedWord.partOfSpeech}</span>}
                      </div>
                      {selectedWord.readingKatakana && selectedWord.readingKatakana !== selectedWord.reading && (
                        <p className="mt-1 text-xs text-zinc-500">{t('study.songWords.readingKatakana')}: {selectedWord.readingKatakana}</p>
                      )}
                      {selectedWord.romaji && <p className="mt-0.5 text-xs text-zinc-500">{t('study.songWords.romaji')}: {selectedWord.romaji}</p>}
                    </div>
                    <button
                      type="button"
                      title={t('common.close')}
                      aria-label={t('common.close')}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-white"
                      onClick={() => setSelectedWordId(null)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="mt-3 border-t border-white/[0.08] pt-3">
                    <p className="text-xs text-zinc-500">{t('study.songWords.meaningZh')}</p>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-100">{selectedWord.meaningZh || t('study.pendingMeaning')}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={quickAddStudyMutation.isPending}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#ff4d6d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#ff617d] disabled:cursor-wait disabled:opacity-60"
                      onClick={() => quickAddStudyMutation.mutate(selectedWord.id)}
                    >
                      {quickAddStudyMutation.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <BookPlus size={16} aria-hidden="true" />}
                      {t(quickAddStudyMutation.isPending ? 'study.songWords.adding' : 'study.songWords.add')}
                    </button>
                    {quickAddStudyMutation.isSuccess && quickAddStudyMutation.variables === selectedWord.id && (
                      <p className="text-xs text-emerald-400">
                        {t(quickAddStudyMutation.data.added > 0 ? 'study.songWords.added' : 'study.songWords.alreadyAdded', { count: quickAddStudyMutation.data.added })}
                      </p>
                    )}
                    {quickAddStudyMutation.isError && quickAddStudyMutation.variables === selectedWord.id && (
                      <p className="text-xs text-red-400">{getApiErrorMessage(quickAddStudyMutation.error, t('study.songWords.addFailed'))}</p>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </section>

      <Dialog open={songActionsOpen} onClose={() => setSongActionsOpen(false)} title={data.displayTitle}>
        <div className="song-action-menu py-2">
          <button type="button" disabled={!data.audioSourceUri} onClick={() => { playNextInQueue(playerSong); setSongActionsOpen(false) }}><ListStart size={20} />{t('player.playNextInQueue')}</button>
          <button type="button" disabled={!data.audioSourceUri} onClick={() => { addToQueue(playerSong); setSongActionsOpen(false) }}><ListPlus size={20} />{t('player.addToQueue')}</button>
          {secondaryTools.map(({ id: panel, label, icon: Icon }) => <button key={panel} type="button" onClick={() => { setSongActionsOpen(false); toggleToolPanel(panel) }}><Icon size={20} />{label}</button>)}
        </div>
      </Dialog>
      <h2 className="sr-only">{data.displayTitle}</h2>
      {lyricPreferenceError && <p role="alert" className="fixed bottom-28 left-1/2 z-50 -translate-x-1/2 rounded-md bg-zinc-900 px-4 py-2 text-sm text-red-300">歌词设置暂未同步，请检查连接</p>}

      {activeToolPanel && (
        <Dialog open onClose={() => setActiveToolPanel(null)} title={secondaryTools.find((tool) => tool.id === activeToolPanel)?.label ?? ''} className="song-tools-dialog">
            <div className="song-tool-body">
              <div className="song-tool-identity">
                {data.coverUrl && <img src={resolveMediaUrl(data.coverUrl)} alt="" />}
                <div><h3>{data.displayTitle}</h3><p>{data.artists.map((artist) => artist.displayName).join(' / ')}</p></div>
              </div>
              <nav className="song-tool-tabs" aria-label={data.displayTitle}>
                {secondaryTools.map(({ id: panel, label, icon: Icon }) => <button type="button" key={panel} aria-current={activeToolPanel === panel ? 'page' : undefined} onClick={() => setActiveToolPanel(panel)}><Icon size={16} />{label}</button>)}
              </nav>
      {activeToolPanel === 'details' && (
        <div id="song-tool-panel-details" className="space-y-3">
      <p className="text-gray-300">
        {t('song.artist')}:{' '}
        {data.artists.length === 0
          ? t('common.unknown')
          : data.artists.map((item, index) => (
              <span key={item.id}>
                {index > 0 && ', '}
                <Link className="hover:text-primary" to={`/artist/${item.id}`}>
                  {item.displayName}
                </Link>
              </span>
            ))}
      </p>
      <p className="text-gray-400">{t('song.language')}: {languageLabel(data.languageCode, t)}</p>
      <p className="text-gray-400">{t('song.duration')}: {detailDurationLabel || t('common.unknown')}</p>
      <p className="text-gray-400">{t('song.audioSourceLabel')}: {audioSourceTypeLabel(t, data.audioSourceType)}</p>

      {data.works.length > 0 && (
        <p className="text-gray-300">
          {t('song.works')}:{' '}
          {data.works.map((item, index) => (
            <span key={item.id}>
              {index > 0 && ' / '}
              <Link className="hover:text-primary" to={`/work/${item.id}`}>
                {item.displayTitle}
              </Link>
            </span>
          ))}
        </p>
      )}

      {data.albums.length > 0 && (
        <p className="text-gray-300">
          {t('song.albums')}:{' '}
          {data.albums.map((item, index) => (
            <span key={item.id}>
              {index > 0 && ' / '}
              <Link className="hover:text-primary" to={`/album/${item.id}`}>
                {item.displayTitle}
              </Link>
            </span>
          ))}
        </p>
      )}

      <section className="song-metadata-columns">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-gray-100">
            <Tags size={18} className="text-primary" />
            <h3 className="font-semibold">{t('song.acgMetadata')}</h3>
          </div>
          <div className="space-y-1 text-sm text-gray-400">
            <p>
              {t('song.publisher')}:{' '}
              {data.publisher ? <Link className="text-zinc-200 hover:text-white" to={`/publisher/${data.publisher.id}`}>{data.publisher.nameZh ?? data.publisher.nameJa ?? data.publisher.name}</Link> : t('common.unknown')}
            </p>
            <p>
              {t('song.label')}:{' '}
              {data.label ? <Link className="text-zinc-200 hover:text-white" to={`/label/${data.label.id}`}>{data.label.nameZh ?? data.label.nameJa ?? data.label.name}</Link> : t('common.unknown')}
            </p>
            <p>
              {t('song.versionType')}: {versionTypeLabel(t, data.versionType)}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-gray-100">
            <Sparkles size={18} className="text-primary" />
            <h3 className="font-semibold">{t('song.creators')}</h3>
          </div>
          {(data.creators ?? []).length === 0 && <p className="text-sm text-gray-500">{t('common.noMetadata')}</p>}
          {(data.creators ?? []).map((creator) => (
            <div key={`${creator.id}-${creator.role}`} className="rounded border border-white/10 bg-black/20 px-3 py-2">
              <Link to={`/creator/${creator.id}`} className="text-sm font-semibold text-gray-100 hover:text-white">{creator.nameZh ?? creator.nameJa ?? creator.name}</Link>
              <p className="text-xs text-gray-500">{t(`song.creatorRoles.${creator.role}`, { defaultValue: t('common.unknown') })}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-gray-100">
            <Mic2 size={18} className="text-primary" />
            <h3 className="font-semibold">{t('song.characters')}</h3>
          </div>
          {(data.characters ?? []).length === 0 && <p className="text-sm text-gray-500">{t('common.noMetadata')}</p>}
          {(data.characters ?? []).map((character) => (
            <div key={character.id} className="rounded border border-white/10 bg-black/20 px-3 py-2">
              <Link to={`/character/${character.id}`} className="text-sm font-semibold text-gray-100 hover:text-white">{character.nameZh ?? character.nameJa ?? character.name}</Link>
              <p className="text-xs text-gray-500">
                {t('song.voiceActors')}:{' '}
                {character.voiceActors.length === 0
                  ? t('common.unknown')
                  : character.voiceActors.map((actor, index) => <span key={actor.id}>{index > 0 && ' / '}<Link to={`/voice-actor/${actor.id}`} className="hover:text-zinc-300">{actor.nameZh ?? actor.nameJa ?? actor.name}</Link></span>)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {data.versionGroup && (
        <section className="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-gray-100">{t('song.versionGroup')}</h3>
            <Link to={`/version-group/${data.versionGroup.id}`} className="text-xs text-gray-500 hover:text-zinc-300">{data.versionGroup.groupTitle}</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.versionGroup.versions.map((version) => (
              <Link
                key={version.id}
                to={`/song/${version.id}`}
                className={`rounded border px-3 py-2 text-sm transition ${
                  version.id === data.id
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-white/10 bg-black/20 text-gray-300 hover:border-primary/50 hover:text-white'
                }`}
              >
                <span className="font-semibold">{versionTypeLabel(t, version.versionType)}</span>
                <span className="ml-2 text-xs text-gray-500">{version.displayTitle}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
        </div>
      )}

      {activeToolPanel === 'content' && (
        <div id="song-tool-panel-content" className="space-y-3">
      <section className="song-upload-section">
        {canReplaceAudio && <div className="space-y-2">
          <div className="flex items-center gap-2 text-gray-200">
            <Upload size={18} className="text-primary" />
            <h3 className="font-semibold">{t('lyric.audioUpload')}</h3>
          </div>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-black hover:brightness-110">
            <Upload size={16} aria-hidden="true" />{t('common.chooseAudio')}
            <input
              type="file"
              accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  if (!token) {
                    navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
                    event.target.value = ''
                    return
                  }
                  uploadAudioMutation.mutate(file)
                }
                event.target.value = ''
              }}
            />
          </label>
          {uploadAudioMutation.isPending && <p className="text-sm text-gray-400">{t('lyric.uploadingAudio')}</p>}
          {uploadAudioMutation.isSuccess && <p className="text-sm text-green-400">{t('lyric.audioUpdated')}</p>}
          {uploadAudioMutation.isError && (
            <p className="text-sm text-red-400">
              {getApiErrorMessage(uploadAudioMutation.error, t('song.errors.audioUploadFailed'))}
            </p>
          )}
        </div>}

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-gray-200">
            <FileText size={18} className="text-primary" />
            <h3 className="font-semibold">{t('lyric.lyricUpload')}</h3>
          </div>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-black hover:brightness-110">
            <FileText size={16} aria-hidden="true" />{t('common.chooseLyrics')}
            <input
              type="file"
              accept=".lrc,.srt,.txt,text/plain"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  if (!token) {
                    navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
                    event.target.value = ''
                    return
                  }
                  uploadLyricsMutation.mutate(file)
                }
                event.target.value = ''
              }}
            />
          </label>
          <p className="text-xs text-gray-500">
            {t('lyric.uploadHelp')}
          </p>
          {uploadLyricsMutation.isPending && <p className="text-sm text-gray-400">{t('lyric.parsing')}</p>}
          {uploadLyricsMutation.isSuccess && <p className="text-sm text-green-400">{t('lyric.updated')}</p>}
          {uploadLyricsMutation.isError && (
            <p className="text-sm text-red-400">
              {getApiErrorMessage(uploadLyricsMutation.error, t('song.errors.lyricUploadFailed'))}
            </p>
          )}
        </div>
      </section>

      {isAdmin && token && lyricsQuery.data?.id && (
        <LyricLineEditor lyric={lyricsQuery.data} token={token} songId={songId} />
      )}
        </div>
      )}

      {activeToolPanel === 'ai' && (
        <div id="song-tool-panel-ai" className="space-y-3">
      <section className="song-ai-section space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-gray-200">
            <Sparkles size={18} className="text-primary" />
            <h3 className="font-semibold">{t('lyric.jobs.title')}</h3>
          </div>
          <p className="text-xs text-gray-500">{t('lyric.jobs.hint')}</p>
        </div>

        <div className="song-ai-actions">
          {data.languageCode !== 'zh' && <button
            type="button"
            disabled={lyricJobPending || lyricLines.length === 0}
            className="inline-flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-100 hover:bg-gray-700 disabled:opacity-40"
            onClick={() => {
              if (!token) {
                navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
                return
              }
              createLyricJobMutation.mutate('translate')
            }}
          >
            <Languages size={16} />
            {t('lyric.jobs.type.translate')}
          </button>}
          <button
            type="button"
            disabled={lyricJobPending || lyricLines.length === 0}
            className="inline-flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-100 hover:bg-gray-700 disabled:opacity-40"
            onClick={() => {
              if (!token) {
                navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
                return
              }
              createLyricJobMutation.mutate('furigana')
            }}
          >
            <Wand2 size={16} />
            {t('lyric.jobs.type.furigana')}
          </button>
          <button
            type="button"
            disabled={lyricJobPending || lyricLines.length === 0}
            className="inline-flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-100 hover:bg-gray-700 disabled:opacity-40"
            onClick={() => {
              if (!token) {
                navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
                return
              }
              createLyricJobMutation.mutate('align')
            }}
          >
            <ListRestart size={16} />
            {t('lyric.jobs.type.align')}
          </button>
          <button
            type="button"
            disabled={lyricJobPending}
            className="inline-flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-100 hover:bg-gray-700 disabled:opacity-40"
            onClick={() => createLyricJobMutation.mutate('transcribe')}
          >
            <Mic2 size={16} />
            {t('lyric.jobs.type.transcribe')}
          </button>
          <button
            type="button"
            disabled={lyricJobPending || lyricLines.length === 0}
            className="inline-flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-100 hover:bg-gray-700 disabled:opacity-40"
            onClick={() => createLyricJobMutation.mutate('tokenize')}
          >
            <FileText size={16} />
            {t('lyric.jobs.type.tokenize')}
          </button>
        </div>

        {createLyricJobMutation.isError && (
          <p className="text-sm text-red-400">
            {getApiErrorMessage(createLyricJobMutation.error, t('lyric.jobs.createFailed'))}
          </p>
        )}
        {lyricLines.length === 0 && <p className="text-sm text-gray-500">{t('lyric.jobs.needLyrics')}</p>}

        <div className="space-y-2">
          {lyricJobsQuery.isLoading && <p className="text-sm text-gray-400">{t('lyric.jobs.loading')}</p>}
          {!lyricJobsQuery.isLoading && lyricJobs.length === 0 && (
            <p className="text-sm text-gray-500">{t('lyric.jobs.empty')}</p>
          )}
          {lyricJobs.map((job) => (
            <article key={job.id} className="rounded border border-gray-800 bg-gray-950 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-100">{t(`lyric.jobs.type.${job.jobType}`)}</span>
                  <span className={`rounded border px-2 py-0.5 text-xs ${lyricJobStatusClass(job.status)}`}>
                    {t(`lyric.jobs.status.${job.status}`)}
                  </span>
                  {job.retryCount > 0 && (
                    <span className="text-xs text-gray-500">{t('common.retries', { count: job.retryCount })}</span>
                  )}
                </div>
                <span className="text-xs text-gray-500">#{job.id}</span>
              </div>
              {job.status === 'succeeded' && (
                <p className="mt-2 text-sm text-gray-400">{t(`lyric.jobs.completed.${job.jobType}`)}</p>
              )}
              {job.status === 'failed' && (
                <p className="mt-2 text-sm text-red-400">
                  {t(job.errorCode ? `apiErrors.${job.errorCode}` : 'lyric.jobs.failedGeneric', {
                    defaultValue: t('lyric.jobs.failedGeneric'),
                  })}
                </p>
              )}
              {job.status === 'failed' && job.retryCount < 3 && token && (
                <button type="button" disabled={retryLyricJobMutation.isPending} onClick={() => retryLyricJobMutation.mutate(job.id)} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#ff8ca1] hover:text-white disabled:opacity-40">
                  <RotateCcw size={13} />{t('lyric.jobs.retry', { defaultValue: '重试任务' })}
                </button>
              )}
              {job.createdAt && <p className="mt-1 text-xs text-gray-600">{formatDateTime(job.createdAt, i18n.language)}</p>}
            </article>
          ))}
        </div>
      </section>
        </div>
      )}

      {activeToolPanel === 'study' && (
        <div id="song-tool-panel-study" className="space-y-3">
      {lyricsQuery.data?.id && (
        <SongVocabularyPanel
          songId={songId}
          lineId={studyLineId}
          onShowAll={studyLineId === undefined ? undefined : () => setStudyLineId(undefined)}
        />
      )}
        </div>
      )}
            </div>
        </Dialog>
      )}

      {(addMutation.isError || removeMutation.isError) && (
        <p className="text-red-400">
          {getApiErrorMessage(addMutation.error ?? removeMutation.error, t('song.favorite.operationFailed'))}
        </p>
      )}

      {!token && <p className="text-gray-400">{t('song.favorite.loginRequired')}</p>}
    </div>
  )
}
