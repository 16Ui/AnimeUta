import { http } from './http'
import type {
  AdminAnnotationReviewItem,
  AdminLyricReviewItem,
  ApiResponse,
  LyricAnnotationCategory,
  LyricAnnotationItem,
  LyricJobType,
  LyricProcessingJobItem,
  LyricReviewStatus,
  LyricResponse,
  LyricVersionItem,
  PagedResponse,
  SongAudioUploadResponse,
  SongDetailResponse,
  SongListItem,
  SongMetadataUpdatePayload,
  SongReviewItem,
  SongReviewStatus,
} from '../types/music'

interface ListSongsParams {
  page?: number
  pageSize?: number
  keyword?: string
}

function buildAuthorizationHeader(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  }
}

function buildOptionalAuthorizationHeader(token?: string | null) {
  return token ? buildAuthorizationHeader(token) : undefined
}

export async function listSongs(params: ListSongsParams = {}): Promise<PagedResponse<SongListItem[]>> {
  const response = await http.get<PagedResponse<SongListItem[]>>('/api/v1/songs', {
    params: {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
      keyword: params.keyword,
    },
  })
  return response.data
}

export async function getSongDetail(songId: number): Promise<SongDetailResponse> {
  const response = await http.get<ApiResponse<SongDetailResponse>>(`/api/v1/songs/${songId}`)
  return response.data.data
}

export async function uploadSongAudio(songId: number, file: File, token: string): Promise<SongAudioUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await http.post<ApiResponse<SongAudioUploadResponse>>(`/api/v1/songs/${songId}/audio`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      ...buildAuthorizationHeader(token),
    },
  })
  return response.data.data
}

export async function listSongSubmissionsForReview(token: string, status: SongReviewStatus = 'pending'): Promise<SongReviewItem[]> {
  const response = await http.get<ApiResponse<SongReviewItem[]>>('/api/v1/admin/song-submissions', {
    params: { status, limit: 50 },
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function reviewSongSubmission(
  songId: number,
  status: SongReviewStatus,
  reviewNote: string | undefined,
  token: string,
): Promise<SongReviewItem> {
  const response = await http.patch<ApiResponse<SongReviewItem>>(`/api/v1/admin/songs/${songId}/review`, {
    status,
    reviewNote,
  }, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function updateSongMetadata(
  songId: number,
  payload: SongMetadataUpdatePayload,
  token: string,
): Promise<void> {
  await http.patch<ApiResponse<{ ok: boolean }>>(`/api/v1/admin/songs/${songId}/metadata`, payload, {
    headers: buildAuthorizationHeader(token),
  })
}

export async function deleteSong(songId: number, token: string): Promise<void> {
  await http.delete<ApiResponse<{ ok: boolean }>>(`/api/v1/admin/songs/${songId}`, {
    headers: buildAuthorizationHeader(token),
  })
}

export async function requestSongShare(songId: number, token: string): Promise<{ song: SongDetailResponse; reviewRequired: boolean }> {
  const response = await http.post<ApiResponse<{ song: SongDetailResponse; reviewRequired: boolean }>>(`/api/v1/me/songs/${songId}/share-request`, undefined, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function getSongLyrics(songId: number, token?: string | null): Promise<LyricResponse> {
  const response = await http.get<ApiResponse<LyricResponse>>(`/api/v1/songs/${songId}/lyrics`, {
    headers: buildOptionalAuthorizationHeader(token),
  })
  return response.data.data
}

export async function uploadSongLyrics(songId: number, file: File, token: string, languageCode = 'ja'): Promise<LyricResponse> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('language_code', languageCode)
  const response = await http.post<ApiResponse<LyricResponse>>(`/api/v1/songs/${songId}/lyrics`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      ...buildAuthorizationHeader(token),
    },
  })
  return response.data.data
}

export async function listLyricProcessingJobs(songId: number): Promise<LyricProcessingJobItem[]> {
  const response = await http.get<ApiResponse<LyricProcessingJobItem[]>>(`/api/v1/songs/${songId}/lyrics/jobs`, {
    params: { limit: 10 },
  })
  return response.data.data
}

export async function listLyricVersions(songId: number, token?: string | null): Promise<LyricVersionItem[]> {
  const response = await http.get<ApiResponse<LyricVersionItem[]>>(`/api/v1/songs/${songId}/lyrics/versions`, {
    headers: buildOptionalAuthorizationHeader(token),
  })
  return response.data.data
}

export async function reviewLyrics(
  lyricId: number,
  status: LyricReviewStatus,
  reviewNote: string | undefined,
  token: string,
): Promise<LyricVersionItem> {
  const response = await http.patch<ApiResponse<LyricVersionItem>>(`/api/v1/lyrics/${lyricId}/review`, {
    status,
    reviewNote,
  }, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function requestLyricReview(lyricId: number, token: string): Promise<LyricVersionItem> {
  const response = await http.post<ApiResponse<LyricVersionItem>>(`/api/v1/lyrics/${lyricId}/share-request`, undefined, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function listLyricSubmissionsForReview(token: string, status: LyricReviewStatus): Promise<AdminLyricReviewItem[]> {
  const response = await http.get<ApiResponse<AdminLyricReviewItem[]>>('/api/v1/admin/lyric-submissions', {
    params: { status, limit: 100 },
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function listAnnotationSubmissionsForReview(token: string, status: LyricReviewStatus): Promise<AdminAnnotationReviewItem[]> {
  const response = await http.get<ApiResponse<AdminAnnotationReviewItem[]>>('/api/v1/admin/annotation-submissions', {
    params: { status, limit: 100 },
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function reviewLyricAnnotation(
  annotationId: number,
  status: LyricReviewStatus,
  reviewNote: string | undefined,
  token: string,
): Promise<LyricAnnotationItem> {
  const response = await http.patch<ApiResponse<LyricAnnotationItem>>(`/api/v1/annotations/${annotationId}/review`, {
    status,
    reviewNote,
  }, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function requestLyricAnnotationReview(annotationId: number, token: string): Promise<LyricAnnotationItem> {
  const response = await http.post<ApiResponse<LyricAnnotationItem>>(`/api/v1/annotations/${annotationId}/share-request`, undefined, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function listLyricAnnotations(lyricId: number, token?: string | null): Promise<LyricAnnotationItem[]> {
  const response = await http.get<ApiResponse<LyricAnnotationItem[]>>(`/api/v1/lyrics/${lyricId}/annotations`, {
    headers: buildOptionalAuthorizationHeader(token),
  })
  return response.data.data
}

export async function createLyricAnnotation(
  lyricId: number,
  payload: { body: string; category?: LyricAnnotationCategory; lineId?: number; visibility?: 'public' | 'private' },
  token: string,
): Promise<LyricAnnotationItem> {
  const response = await http.post<ApiResponse<LyricAnnotationItem>>(`/api/v1/lyrics/${lyricId}/annotations`, payload, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function createLyricProcessingJob(
  songId: number,
  jobType: LyricJobType,
  token: string,
): Promise<LyricProcessingJobItem> {
  const response = await http.post<ApiResponse<LyricProcessingJobItem>>(`/api/v1/songs/${songId}/lyrics/jobs`, {
    jobType,
  }, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function retryLyricProcessingJob(jobId: number, token: string): Promise<LyricProcessingJobItem> {
  const response = await http.post<ApiResponse<LyricProcessingJobItem>>(`/api/v1/lyrics/jobs/${jobId}/retry`, undefined, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function updateLyricLines(
  lyricId: number,
  lines: Array<{
    id: number
    originalText: string
    translatedText?: string | null
    romajiText?: string | null
    startMs?: number | null
    endMs?: number | null
  }>,
  token: string,
): Promise<LyricResponse> {
  const response = await http.patch<ApiResponse<LyricResponse>>(`/api/v1/lyrics/${lyricId}/lines`, { lines }, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function updateLyricTimingOffset(lyricId: number, timingOffsetMs: number, token: string): Promise<LyricResponse> {
  const response = await http.patch<ApiResponse<LyricResponse>>(`/api/v1/lyrics/${lyricId}/timing-offset`, { timingOffsetMs }, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}
