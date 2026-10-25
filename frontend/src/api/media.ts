import { http } from './http'
import type { ApiResponse } from '../types/music'

export async function uploadImage(file: File, token: string): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await http.post<ApiResponse<{ uri: string }>>('/api/v1/media/images', formData, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'multipart/form-data',
    },
  })
  return response.data.data.uri
}
