import { http } from './http'
import type { ApiResponse, SearchResponse, SearchSuggestionItem } from '../types/search'

interface SearchParams {
  keyword: string
  page?: number
  pageSize?: number
  type?: 'song' | 'artist' | 'work' | 'album'
  language?: string
}

export async function searchAll(params: SearchParams): Promise<SearchResponse> {
  const response = await http.get<ApiResponse<SearchResponse>>('/api/v1/search', {
    params: {
      keyword: params.keyword,
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
      type: params.type,
      language: params.language,
    },
  })
  return response.data.data
}

export async function searchSuggestions(keyword: string, limit = 8): Promise<SearchSuggestionItem[]> {
  const response = await http.get<ApiResponse<SearchSuggestionItem[]>>('/api/v1/search/suggestions', {
    params: {
      keyword,
      limit,
    },
  })
  return response.data.data
}

export async function searchAllSongs(keyword: string): Promise<SearchResponse['songs']> {
  const firstPage = await searchAll({ keyword, page: 1, pageSize: 50, type: 'song' })
  const pageCount = Math.ceil(firstPage.pagination.total / firstPage.pagination.page_size)
  if (pageCount <= 1) return firstPage.songs
  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => searchAll({ keyword, page: index + 2, pageSize: 50, type: 'song' })),
  )
  return [firstPage, ...remainingPages].flatMap((page) => page.songs)
}
