import { http } from './http'
import type { ApiResponse } from '../types/auth'
import type { CreatePlayHistoryPayload, PlayHistoryPagedResponse } from '../types/history'

function buildAuthorizationHeader(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  }
}

export async function listPlayHistory(
  token: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<PlayHistoryPagedResponse> {
  const response = await http.get<PlayHistoryPagedResponse>('/api/v1/me/play-history', {
    headers: buildAuthorizationHeader(token),
    params: {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 50,
    },
  })
  return response.data
}

export async function createPlayHistory(token: string, payload: CreatePlayHistoryPayload): Promise<void> {
  await http.post<ApiResponse<null>>('/api/v1/me/play-history', payload, {
    headers: buildAuthorizationHeader(token),
  })
}
