import { http } from './http'
import type { ApiResponse } from '../types/auth'
import type { FavoriteSongItem, FavoritesPagedResponse } from '../types/favorites'

function buildAuthorizationHeader(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  }
}

interface ListFavoriteSongsParams {
  page?: number
  pageSize?: number
}

export async function listFavoriteSongs(
  token: string,
  params: ListFavoriteSongsParams = {},
): Promise<FavoritesPagedResponse<FavoriteSongItem[]>> {
  const response = await http.get<FavoritesPagedResponse<FavoriteSongItem[]>>('/api/v1/me/favorites/songs', {
    headers: buildAuthorizationHeader(token),
    params: {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
    },
  })
  return response.data
}

export async function listAllFavoriteSongs(token: string): Promise<FavoriteSongItem[]> {
  const firstPage = await listFavoriteSongs(token, { page: 1, pageSize: 100 })
  const pageCount = Math.ceil(firstPage.pagination.total / firstPage.pagination.page_size)
  if (pageCount <= 1) return firstPage.data
  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => listFavoriteSongs(token, { page: index + 2, pageSize: 100 })),
  )
  return [firstPage, ...remainingPages].flatMap((page) => page.data)
}

export async function addFavoriteSong(token: string, songId: number): Promise<void> {
  await http.post<ApiResponse<null>>(`/api/v1/me/favorites/songs/${songId}`, {}, {
    headers: buildAuthorizationHeader(token),
  })
}

export async function removeFavoriteSong(token: string, songId: number): Promise<void> {
  await http.delete<ApiResponse<null>>(`/api/v1/me/favorites/songs/${songId}`, {
    headers: buildAuthorizationHeader(token),
  })
}
