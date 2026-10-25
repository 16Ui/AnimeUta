export interface FavoriteSongItem {
  id: number
  titleJa?: string
  titleZh?: string
  titleEn?: string
  titleRomaji?: string
  displayTitle: string
  durationSeconds?: number
  languageCode?: string
  coverUrl?: string
  audioSourceType?: string
  audioSourceUri?: string
  primaryArtistName?: string
  primaryWorkTitle?: string
  favoritedAt?: string
}

export interface FavoritesPagination {
  page: number
  page_size: number
  total: number
}

export interface FavoritesPagedResponse<T> {
  data: T
  pagination: FavoritesPagination
}
