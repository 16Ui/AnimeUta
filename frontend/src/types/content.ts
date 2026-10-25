import type { SongListItem } from './music'

export interface ArtistDetailResponse {
  id: number
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  displayName: string
  artistType?: string
  countryCode?: string
  avatarUrl?: string
  aliases: string[]
  songs: SongListItem[]
}

export interface WorkDetailResponse {
  id: number
  titleJa?: string
  titleZh?: string
  titleEn?: string
  titleRomaji?: string
  displayTitle: string
  workType?: string
  releaseDate?: string
  seasonLabel?: string
  coverUrl?: string
  aliases: string[]
  songs: SongListItem[]
}

export interface AlbumTrackItem {
  song: SongListItem
  discNo: number
  trackNo: number
}

export interface AlbumDetailResponse {
  id: number
  titleJa?: string
  titleZh?: string
  titleEn?: string
  titleRomaji?: string
  displayTitle: string
  albumType?: string
  releaseDate?: string
  catalogNo?: string
  coverUrl?: string
  aliases: string[]
  tracks: AlbumTrackItem[]
}

export type AcgEntityKind = 'creator' | 'character' | 'voice_actor' | 'publisher' | 'label' | 'version_group'

export interface AcgEntityConnection {
  kind: AcgEntityKind | 'work'
  id: number
  displayName: string
}

export interface AcgEntityDetailResponse {
  kind: AcgEntityKind
  id: number
  displayName: string
  name: string
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  imageUrl?: string
  secondaryText?: string
  description?: string
  websiteUrl?: string
  aliases: string[]
  connections: AcgEntityConnection[]
  relatedSongs: Array<{ song: SongListItem; relation?: string }>
}

export interface AcgEntityUpdatePayload {
  name?: string
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  imageUrl?: string
  description?: string
  websiteUrl?: string
  aliases: string[]
}

export interface ApiResponse<T> {
  data: T
}
