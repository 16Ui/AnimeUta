export interface SearchSongItem {
  id: number
  titleJa?: string
  titleZh?: string
  titleEn?: string
  titleRomaji?: string
  displayTitle: string
  coverUrl?: string
  durationSeconds?: number
  audioSourceUri?: string
  primaryArtistName?: string
  primaryWorkTitle?: string
}

export interface SearchArtistItem {
  id: number
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  displayName: string
  avatarUrl?: string
}

export interface SearchWorkItem {
  id: number
  titleJa?: string
  titleZh?: string
  titleEn?: string
  titleRomaji?: string
  displayTitle: string
  coverUrl?: string
}

export interface SearchAlbumItem {
  id: number
  titleJa?: string
  titleZh?: string
  titleEn?: string
  titleRomaji?: string
  displayTitle: string
  coverUrl?: string
}

export interface SearchAcgEntityItem {
  id: number
  displayName: string
  imageUrl?: string
  secondaryText?: string
}

export interface SearchResponse {
  songs: SearchSongItem[]
  artists: SearchArtistItem[]
  works: SearchWorkItem[]
  albums: SearchAlbumItem[]
  creators: SearchAcgEntityItem[]
  characters: SearchAcgEntityItem[]
  voiceActors: SearchAcgEntityItem[]
  publishers: SearchAcgEntityItem[]
  labels: SearchAcgEntityItem[]
  versionGroups: SearchAcgEntityItem[]
  pagination: {
    page: number
    page_size: number
    total: number
  }
}

export interface SearchSuggestionItem {
  type: 'song' | 'artist' | 'work' | 'album' | 'creator' | 'character' | 'voice_actor' | 'publisher' | 'label' | 'version_group'
  id: number
  text: string
  displayTitle: string
}

export interface ApiResponse<T> {
  data: T
}
