import { http } from './http'
import type { ApiResponse } from '../types/auth'
import type {
  AddPlaylistSongPayload,
  CreatePlaylistPayload,
  PlaylistDetailResponse,
  PlaylistItem,
  ReorderPlaylistPayload,
  UpdatePlaylistPayload,
} from '../types/playlist'

function buildAuthorizationHeader(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  }
}

export async function listPlaylists(token: string): Promise<PlaylistItem[]> {
  const response = await http.get<ApiResponse<PlaylistItem[]>>('/api/v1/me/playlists', {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function createPlaylist(token: string, payload: CreatePlaylistPayload): Promise<PlaylistItem> {
  const response = await http.post<ApiResponse<PlaylistItem>>('/api/v1/me/playlists', payload, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function getPlaylistDetail(playlistId: number): Promise<PlaylistDetailResponse> {
  const response = await http.get<ApiResponse<PlaylistDetailResponse>>(`/api/v1/playlists/${playlistId}`)
  return response.data.data
}

export async function updatePlaylist(
  token: string,
  playlistId: number,
  payload: UpdatePlaylistPayload,
): Promise<PlaylistDetailResponse> {
  const response = await http.patch<ApiResponse<PlaylistDetailResponse>>(`/api/v1/playlists/${playlistId}`, payload, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function deletePlaylist(token: string, playlistId: number): Promise<void> {
  await http.delete<ApiResponse<null>>(`/api/v1/playlists/${playlistId}`, {
    headers: buildAuthorizationHeader(token),
  })
}

export async function addPlaylistSong(
  token: string,
  playlistId: number,
  payload: AddPlaylistSongPayload,
): Promise<void> {
  await http.post<ApiResponse<null>>(`/api/v1/playlists/${playlistId}/songs`, payload, {
    headers: buildAuthorizationHeader(token),
  })
}

export async function removePlaylistSong(token: string, playlistId: number, songId: number): Promise<void> {
  await http.delete<ApiResponse<null>>(`/api/v1/playlists/${playlistId}/songs/${songId}`, {
    headers: buildAuthorizationHeader(token),
  })
}

export async function reorderPlaylistSongs(
  token: string,
  playlistId: number,
  payload: ReorderPlaylistPayload,
): Promise<void> {
  await http.patch<ApiResponse<null>>(`/api/v1/playlists/${playlistId}/songs/reorder`, payload, {
    headers: buildAuthorizationHeader(token),
  })
}
