import type { SongListItem, PagedResponse } from './music'

export interface PlayHistoryItem {
  id: number
  song: SongListItem
  playedAt?: string
  playDurationSeconds?: number
  completionRate?: number
  lastPositionSeconds?: number
  playlist?: { id: number; name: string }
}

export interface CreatePlayHistoryPayload {
  song_id: number
  played_at?: string
  play_duration_seconds?: number
  completion_rate?: number
  last_position_seconds?: number
  playlist_id?: number | null
  play_started?: boolean
}

export type PlayHistoryPagedResponse = PagedResponse<PlayHistoryItem[]>
