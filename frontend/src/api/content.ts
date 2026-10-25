import { http } from './http'
import type {
  AlbumDetailResponse,
  AcgEntityDetailResponse,
  AcgEntityKind,
  AcgEntityUpdatePayload,
  ApiResponse,
  ArtistDetailResponse,
  WorkDetailResponse,
} from '../types/content'

export async function getArtistDetail(artistId: number): Promise<ArtistDetailResponse> {
  const response = await http.get<ApiResponse<ArtistDetailResponse>>(`/api/v1/artists/${artistId}`)
  return response.data.data
}

export async function getWorkDetail(workId: number): Promise<WorkDetailResponse> {
  const response = await http.get<ApiResponse<WorkDetailResponse>>(`/api/v1/works/${workId}`)
  return response.data.data
}

export async function getAlbumDetail(albumId: number): Promise<AlbumDetailResponse> {
  const response = await http.get<ApiResponse<AlbumDetailResponse>>(`/api/v1/albums/${albumId}`)
  return response.data.data
}

export async function getAcgEntityDetail(kind: AcgEntityKind, entityId: number): Promise<AcgEntityDetailResponse> {
  const response = await http.get<ApiResponse<AcgEntityDetailResponse>>(`/api/v1/acg/${kind}/${entityId}`)
  return response.data.data
}

export async function updateAcgEntity(
  kind: AcgEntityKind,
  entityId: number,
  payload: AcgEntityUpdatePayload,
  token: string,
): Promise<AcgEntityDetailResponse> {
  const response = await http.patch<ApiResponse<AcgEntityDetailResponse>>(`/api/v1/admin/acg/${kind}/${entityId}`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.data
}
