import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { OnlineTrack } from '../lib/onlineMusic'

export interface PlayerSong {
  id: number
  title: string
  artist: string
  coverUrl?: string
  audioUrl?: string
  durationSeconds?: number
  onlinePreview?: {sourceId:number;track:OnlineTrack}
}

type RepeatMode = 'off' | 'one' | 'all' | 'shuffle'

export type PlaybackSource = {
  type: 'playlist'
  playlistId: number
  name: string
} | {
  type: 'favorites' | 'search' | 'single' | 'collection' | 'custom'
  name: string
}

const DEFAULT_VOLUME = 0.3
const LEGACY_DEFAULT_VOLUMES = [0.45, 0.8]

interface PlayerState {
  currentSong: PlayerSong | null
  queue: PlayerSong[]
  currentIndex: number
  queueSource: PlaybackSource | null
  playbackSessionId: number
  repeatMode: RepeatMode
  shuffleHistory: number[]
  shuffleHistoryIndex: number
  isPlaying: boolean
  volume: number
  currentTime: number
  duration: number
  seekTime: number
  seekRequestId: number
  playNow: (song: PlayerSong, source?: PlaybackSource | null) => void
  playFromQueue: (songs: PlayerSong[], index: number, source?: PlaybackSource | null) => void
  playNextInQueue: (song: PlayerSong) => void
  addToQueue: (song: PlayerSong) => void
  resumeQueue: () => void
  removeFromQueue: (songId: number) => void
  setIsPlaying: (playing: boolean) => void
  setVolume: (volume: number) => void
  setCurrentTime: (currentTime: number) => void
  setDuration: (duration: number) => void
  seekTo: (seconds: number) => void
  playNext: () => void
  playPrevious: () => void
  cycleRepeatMode: () => void
  togglePlay: () => void
}

function normalizeVolume(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_VOLUME
  }
  return Math.min(Math.max(value, 0), 1)
}

function wasLegacyDefaultVolume(value: unknown) {
  return typeof value === 'number' && LEGACY_DEFAULT_VOLUMES.some((legacyValue) => Math.abs(value - legacyValue) < 0.001)
}

function normalizeRepeatMode(value: unknown): RepeatMode {
  return value === 'one' || value === 'all' || value === 'shuffle' || value === 'off' ? value : 'off'
}

function normalizedDuration(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function playableQueue(songs: PlayerSong[]) {
  const ids = new Set<number>()
  return songs.filter((song) => {
    if (!song.audioUrl || ids.has(song.id)) return false
    ids.add(song.id)
    return true
  })
}

const customQueueSource: PlaybackSource = { type: 'custom', name: '' }

function randomIndexExcept(length: number, excludedIndex: number) {
  if (length <= 1) return 0
  const offset = 1 + Math.floor(Math.random() * (length - 1))
  return (Math.max(excludedIndex, 0) + offset) % length
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentSong: null,
      queue: [],
      currentIndex: -1,
      queueSource: null,
      playbackSessionId: 0,
      repeatMode: 'off',
      shuffleHistory: [],
      shuffleHistoryIndex: -1,
      isPlaying: false,
      volume: DEFAULT_VOLUME,
      currentTime: 0,
      duration: 0,
      seekTime: 0,
      seekRequestId: 0,
      playNow: (song, source = null) =>
        set((state) => {
          if (!song.audioUrl) return state
          const exists = state.queue.some((item) => item.id === song.id)
          const queue = exists ? state.queue.map((item) => item.id === song.id ? song : item) : [...state.queue, song]
          return {
            currentSong: song,
            queue,
            queueSource: state.queue.length === 0 ? source ?? { type: 'single', name: song.title } : exists ? state.queueSource : customQueueSource,
            playbackSessionId: state.playbackSessionId + 1,
            currentIndex: queue.findIndex((item) => item.id === song.id),
            isPlaying: !!song.audioUrl,
            currentTime: 0,
            duration: normalizedDuration(song.durationSeconds),
            shuffleHistory: state.repeatMode === 'shuffle' ? [song.id] : [],
            shuffleHistoryIndex: state.repeatMode === 'shuffle' ? 0 : -1,
          }
        }),
      playFromQueue: (songs, index, source = null) => {
        const song = songs[index]
        if (song) get().playNow(song, source)
      },
      playNextInQueue: (song) =>
        set((state) => {
          if (!song.audioUrl) return state
          if (!state.currentSong || state.currentIndex < 0) {
            return {
              currentSong: song,
              queue: [song],
              queueSource: { type: 'single', name: song.title },
              playbackSessionId: state.playbackSessionId + 1,
              currentIndex: 0,
              isPlaying: true,
              currentTime: 0,
              duration: normalizedDuration(song.durationSeconds),
              shuffleHistory: state.repeatMode === 'shuffle' ? [song.id] : [],
              shuffleHistoryIndex: state.repeatMode === 'shuffle' ? 0 : -1,
            }
          }
          if (state.currentSong.id === song.id) return state
          const withoutSong = state.queue.filter((item) => item.id !== song.id)
          const currentIndex = Math.max(0, withoutSong.findIndex((item) => item.id === state.currentSong?.id))
          const queue = [...withoutSong]
          queue.splice(currentIndex + 1, 0, song)
          return {
            queue,
            currentIndex,
            queueSource: customQueueSource,
            shuffleHistory: state.repeatMode === 'shuffle' ? [state.currentSong.id] : [],
            shuffleHistoryIndex: state.repeatMode === 'shuffle' ? 0 : -1,
          }
        }),
      addToQueue: (song) =>
        set((state) => {
          if (!song.audioUrl || state.queue.some((item) => item.id === song.id)) return state
          if (!state.currentSong) {
            return {
              currentSong: song,
              queue: [song],
              queueSource: customQueueSource,
              currentIndex: 0,
              isPlaying: false,
              currentTime: 0,
              duration: normalizedDuration(song.durationSeconds),
              shuffleHistory: [],
              shuffleHistoryIndex: -1,
            }
          }
          return { queue: [...state.queue, song], queueSource: customQueueSource }
        }),
      resumeQueue: () =>
        set((state) => state.currentSong?.audioUrl ? { isPlaying: true } : state),
      removeFromQueue: (songId) =>
        set((state) => {
          const queue = state.queue.filter((song) => song.id !== songId)
          if (state.currentSong?.id === songId) {
            const nextIndex = Math.min(Math.max(state.currentIndex, 0), queue.length - 1)
            return {
              queue,
              queueSource: queue.length > 0 ? customQueueSource : null,
              currentIndex: nextIndex,
              currentSong: queue[nextIndex] ?? null,
              playbackSessionId: state.playbackSessionId + 1,
              isPlaying: Boolean(queue[nextIndex]?.audioUrl),
              currentTime: 0,
              duration: normalizedDuration(queue[nextIndex]?.durationSeconds),
              shuffleHistory: queue[nextIndex] && state.repeatMode === 'shuffle' ? [queue[nextIndex].id] : [],
              shuffleHistoryIndex: queue[nextIndex] && state.repeatMode === 'shuffle' ? 0 : -1,
            }
          }
          const currentIndex = queue.findIndex((song) => song.id === state.currentSong?.id)
          return {
            queue,
            currentIndex,
            queueSource: queue.length > 0 ? customQueueSource : null,
            shuffleHistory: state.currentSong && state.repeatMode === 'shuffle' ? [state.currentSong.id] : [],
            shuffleHistoryIndex: state.currentSong && state.repeatMode === 'shuffle' ? 0 : -1,
          }
        }),
      setIsPlaying: (playing) => set({ isPlaying: playing }),
      setVolume: (volume) => set({ volume: normalizeVolume(volume) }),
      setCurrentTime: (currentTime) => set({ currentTime }),
      setDuration: (duration) => set({ duration }),
      seekTo: (seconds) =>
        set((state) => ({
          currentTime: seconds,
          seekTime: seconds,
          seekRequestId: state.seekRequestId + 1,
        })),
      playNext: () =>
        set((state) => {
          if (state.queue.length === 0) {
            return { isPlaying: false }
          }
          if (state.repeatMode === 'shuffle') {
            const validIds = new Set(state.queue.map((song) => song.id))
            let history = state.shuffleHistory.filter((songId) => validIds.has(songId))
            let historyIndex = Math.min(state.shuffleHistoryIndex, history.length - 1)
            if (historyIndex < 0 || history[historyIndex] !== state.currentSong?.id) {
              history = state.currentSong ? [state.currentSong.id] : []
              historyIndex = history.length - 1
            }

            let nextSongId = history[historyIndex + 1]
            if (nextSongId === undefined) {
              const nextIndex = randomIndexExcept(state.queue.length, state.currentIndex)
              nextSongId = state.queue[nextIndex].id
              history = [...history.slice(0, historyIndex + 1), nextSongId].slice(-100)
              historyIndex = history.length - 1
            } else {
              historyIndex += 1
            }

            const nextIndex = Math.max(0, state.queue.findIndex((song) => song.id === nextSongId))
            const nextSong = state.queue[nextIndex]
            return {
              currentIndex: nextIndex,
              currentSong: nextSong,
              playbackSessionId: state.playbackSessionId + 1,
              shuffleHistory: history,
              shuffleHistoryIndex: historyIndex,
              isPlaying: true,
              currentTime: 0,
              duration: normalizedDuration(nextSong?.durationSeconds),
            }
          }
          const hasNext = state.currentIndex < state.queue.length - 1
          if (hasNext) {
            return {
              currentIndex: state.currentIndex + 1,
              currentSong: state.queue[state.currentIndex + 1],
              playbackSessionId: state.playbackSessionId + 1,
              isPlaying: true,
              currentTime: 0,
              duration: normalizedDuration(state.queue[state.currentIndex + 1]?.durationSeconds),
            }
          }
          if (state.repeatMode === 'all') {
            return {
              currentIndex: 0,
              currentSong: state.queue[0],
              playbackSessionId: state.playbackSessionId + 1,
              isPlaying: true,
              currentTime: 0,
              duration: normalizedDuration(state.queue[0]?.durationSeconds),
            }
          }
          return { isPlaying: false, currentTime: 0 }
        }),
      playPrevious: () =>
        set((state) => {
          if (state.queue.length === 0) {
            return { isPlaying: false }
          }
          if (state.repeatMode === 'shuffle') {
            const previousHistoryIndex = state.shuffleHistoryIndex - 1
            if (previousHistoryIndex < 0) {
              return { currentTime: 0, isPlaying: true }
            }
            const previousSongId = state.shuffleHistory[previousHistoryIndex]
            const previousIndex = state.queue.findIndex((song) => song.id === previousSongId)
            if (previousIndex < 0) {
              return { shuffleHistory: [state.currentSong?.id].filter((id): id is number => typeof id === 'number'), shuffleHistoryIndex: 0, currentTime: 0 }
            }
            return {
              currentIndex: previousIndex,
              currentSong: state.queue[previousIndex],
              playbackSessionId: state.playbackSessionId + 1,
              shuffleHistoryIndex: previousHistoryIndex,
              isPlaying: true,
              currentTime: 0,
              duration: normalizedDuration(state.queue[previousIndex]?.durationSeconds),
            }
          }
          const previousIndex = state.currentIndex > 0 ? state.currentIndex - 1 : state.repeatMode === 'all' ? state.queue.length - 1 : 0
          return {
            currentIndex: previousIndex,
            currentSong: state.queue[previousIndex],
            playbackSessionId: state.playbackSessionId + 1,
            isPlaying: true,
            currentTime: 0,
            duration: normalizedDuration(state.queue[previousIndex]?.durationSeconds),
          }
        }),
      cycleRepeatMode: () =>
        set((state) => {
          const repeatMode = state.repeatMode === 'off'
            ? 'all'
            : state.repeatMode === 'all'
              ? 'one'
              : state.repeatMode === 'one'
                ? 'shuffle'
                : 'off'
          return {
            repeatMode,
            shuffleHistory: repeatMode === 'shuffle' && state.currentSong ? [state.currentSong.id] : [],
            shuffleHistoryIndex: repeatMode === 'shuffle' && state.currentSong ? 0 : -1,
          }
        }),
      togglePlay: () =>
        set((state) => {
          if (!state.currentSong?.audioUrl) {
            return state
          }
          return { isPlaying: !state.isPlaying }
        }),
    }),
    {
      name: 'animeuta-player-preferences',
      version: 4,
      partialize: (state) => ({
        volume: state.volume,
        repeatMode: state.repeatMode,
        currentSong: state.currentSong,
        queue: state.queue,
        currentIndex: state.currentIndex,
        queueSource: state.queueSource,
        shuffleHistory: state.shuffleHistory,
        shuffleHistoryIndex: state.shuffleHistoryIndex,
      }),
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState
        }
        const state = persistedState as Partial<PlayerState>
        const queue = Array.isArray(state.queue) ? playableQueue(state.queue) : []
        const restoredIndex = state.currentSong
          ? queue.findIndex((song) => song.id === state.currentSong?.id)
          : -1
        const currentIndex = restoredIndex >= 0
          ? restoredIndex
          : queue.length > 0
            ? Math.min(Math.max(state.currentIndex ?? 0, 0), queue.length - 1)
            : -1
        const currentSong = currentIndex >= 0 ? queue[currentIndex] : null
        const repeatMode = normalizeRepeatMode(state.repeatMode)
        const shuffleHistory = repeatMode === 'shuffle' && currentSong
          ? (Array.isArray(state.shuffleHistory) ? state.shuffleHistory : [])
              .filter((songId) => queue.some((song) => song.id === songId))
          : []
        const normalizedShuffleHistory = repeatMode === 'shuffle' && currentSong && !shuffleHistory.includes(currentSong.id)
          ? [currentSong.id]
          : shuffleHistory
        const shuffleHistoryIndex = currentSong && repeatMode === 'shuffle'
          ? Math.max(0, normalizedShuffleHistory.lastIndexOf(currentSong.id))
          : -1
        if (version < 2 && wasLegacyDefaultVolume(state.volume)) {
          return {
            ...state,
            volume: DEFAULT_VOLUME,
            repeatMode,
            queue,
            currentSong,
            currentIndex,
            shuffleHistory: normalizedShuffleHistory,
            shuffleHistoryIndex,
          }
        }
        return {
          ...state,
          volume: normalizeVolume(state.volume),
          repeatMode,
          queue,
          currentSong,
          currentIndex,
          queueSource: queue.length > 0 ? state.queueSource ?? null : null,
          shuffleHistory: normalizedShuffleHistory,
          shuffleHistoryIndex,
        }
      },
    },
  ),
)
