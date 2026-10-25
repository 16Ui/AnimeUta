import type { SongListItem } from './music'

export interface PlaylistItem {
  id: number
  userId: number
  name: string
  description?: string
  coverUrl?: string
  visibility: string
  songCount: number
  createdAt?: string
  updatedAt?: string
}

export interface PlaylistSongItem {
  song: SongListItem
  position: number
  addedAt?: string
}

export interface PlaylistDetailResponse extends PlaylistItem {
  songs: PlaylistSongItem[]
}

export interface CreatePlaylistPayload {
  name: string
  description?: string
  cover_url?: string
  visibility?: string
}

export interface UpdatePlaylistPayload {
  name?: string
  description?: string
  cover_url?: string
  visibility?: string
}

export interface AddPlaylistSongPayload {
  song_id: number
  position?: number
}

export interface ReorderPlaylistPayload {
  song_ids: number[]
}

export interface ApiResponse<T> {
  data: T
}
