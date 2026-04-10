import { create } from 'zustand'

interface Song {
  id: string
  title: string
  artist: string
  coverUrl?: string
  audioUrl: string
}

interface PlayerState {
  currentSong: Song | null
  isPlaying: boolean
  volume: number
  setCurrentSong: (song: Song | null) => void
  setIsPlaying: (playing: boolean) => void
  setVolume: (volume: number) => void
  togglePlay: () => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  currentSong: null,
  isPlaying: false,
  volume: 0.8,
  setCurrentSong: (song) => set({ currentSong: song, isPlaying: !!song }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setVolume: (volume) => set({ volume }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
}))
