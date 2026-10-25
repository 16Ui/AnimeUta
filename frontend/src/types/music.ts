export interface Pagination {
  page: number
  page_size: number
  total: number
}

export interface SongListItem {
  id: number
  titleJa?: string
  titleZh?: string
  titleEn?: string
  titleRomaji?: string
  displayTitle: string
  durationSeconds?: number
  languageCode?: string
  releaseDate?: string
  coverUrl?: string
  audioSourceType?: string
  audioSourceUri?: string
  primaryArtistName?: string
  primaryWorkTitle?: string
}

export interface SongArtistItem {
  id: number
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  displayName: string
  avatarUrl?: string
  aliases?: string[]
}

export interface SongWorkItem {
  id: number
  titleJa?: string
  titleZh?: string
  titleEn?: string
  titleRomaji?: string
  displayTitle: string
  coverUrl?: string
  relationType?: string
  aliases?: string[]
}

export interface SongAlbumItem {
  id: number
  titleJa?: string
  titleZh?: string
  titleEn?: string
  titleRomaji?: string
  displayTitle: string
  coverUrl?: string
  aliases?: string[]
}

export interface PublisherItem {
  id: number
  name: string
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  websiteUrl?: string
  imageUrl?: string
  aliases?: string[]
}

export interface LabelItem {
  id: number
  publisherId?: number
  name: string
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  imageUrl?: string
  aliases?: string[]
}

export interface SongCreatorItem {
  id: number
  name: string
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  creatorType?: string
  imageUrl?: string
  aliases?: string[]
  role: string
  sortOrder: number
}

export interface VoiceActorItem {
  id: number
  name: string
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  avatarUrl?: string
  aliases?: string[]
}

export interface SongCharacterItem {
  id: number
  workId?: number
  name: string
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  description?: string
  imageUrl?: string
  aliases?: string[]
  relationType: string
  sortOrder: number
  voiceActors: VoiceActorItem[]
}

export type SongVersionType = 'full' | 'tv_size' | 'instrumental' | 'cover' | 'live' | 'ost' | 'variation'

export interface SongVersionItem {
  id: number
  displayTitle: string
  versionType?: SongVersionType
  durationSeconds?: number
  audioSourceUri?: string
}

export interface SongVersionGroupItem {
  id: number
  groupTitle: string
  workId?: number
  canonicalSongId?: number
  description?: string
  imageUrl?: string
  aliases?: string[]
  versions: SongVersionItem[]
}

export interface SongDetailResponse {
  id: number
  titleJa?: string
  titleZh?: string
  titleEn?: string
  titleRomaji?: string
  displayTitle: string
  durationSeconds?: number
  languageCode?: string
  releaseDate?: string
  coverUrl?: string
  audioSourceType?: string
  audioSourceUri?: string
  submittedBy?: number
  reviewStatus?: SongReviewStatus
  visibility?: SongVisibility
  reviewNote?: string
  versionType?: SongVersionType
  aliases?: string[]
  publisher?: PublisherItem
  label?: LabelItem
  artists: SongArtistItem[]
  works: SongWorkItem[]
  albums: SongAlbumItem[]
  creators: SongCreatorItem[]
  characters: SongCharacterItem[]
  versionGroup?: SongVersionGroupItem
}

export interface SongAudioUploadResponse {
  audioSourceType: string
  audioSourceUri: string
  durationSeconds?: number
}

export type SongReviewStatus = 'pending' | 'approved' | 'rejected' | 'needs_revision'
export type SongVisibility = 'private' | 'public'

export interface SongSubmissionResponse {
  song: SongDetailResponse
  lyric?: LyricResponse
}

export interface SongReviewItem {
  id: number
  displayTitle: string
  languageCode?: string
  coverUrl?: string
  audioSourceType?: string
  audioSourceUri?: string
  submittedBy?: number
  submittedByName?: string
  submittedByEmail?: string
  reviewStatus: SongReviewStatus
  visibility: SongVisibility
  reviewNote?: string
  createdAt?: string
}

export interface SongMetadataUpdatePayload {
  songCoverUrl?: string
  artistName?: string
  artistAvatarUrl?: string
  workTitle?: string
  workCoverUrl?: string
  workRelationType?: string
  albumTitle?: string
  albumCoverUrl?: string
  publisherName?: string
  labelName?: string
  versionType?: SongVersionType
  versionGroupTitle?: string
  songAliases: string[]
  artistAliases: string[]
  workAliases: string[]
  albumAliases: string[]
  creators: Array<{
    name: string
    role: string
    creatorType?: string
  }>
  characters: Array<{
    name: string
    relationType?: string
    voiceActorNames: string[]
  }>
}

export interface LyricRubySegment {
  text: string
  ruby?: string
}

export interface LyricLineItem {
  id: number
  lineIndex: number
  startMs?: number
  endMs?: number
  originalText: string
  translatedText?: string
  romajiText?: string
  originalRuby?: LyricRubySegment[]
}

export interface LyricResponse {
  id?: number
  songId: number
  languageCode?: string
  sourceType: string
  reviewStatus?: LyricReviewStatus
  visibility?: LyricVisibility
  isCurrent?: boolean
  versionLabel?: string
  sourceRef?: string
  reviewNote?: string
  uploadedBy?: number
  reviewedBy?: number
  reviewedAt?: string
  reviewRequestedAt?: string
  timingOffsetMs?: number
  lines: LyricLineItem[]
  createdAt?: string
}

export type LyricJobType = 'transcribe' | 'translate' | 'furigana' | 'align' | 'annotate' | 'tokenize'
export type LyricJobStatus = 'pending' | 'processing' | 'succeeded' | 'failed'
export type LyricReviewStatus = 'pending' | 'approved' | 'rejected' | 'needs_revision'
export type LyricVisibility = 'private' | 'public'

export interface LyricVersionItem {
  id: number
  songId: number
  languageCode?: string
  sourceType: string
  reviewStatus: LyricReviewStatus
  visibility: LyricVisibility
  isCurrent: boolean
  versionLabel?: string
  sourceRef?: string
  reviewNote?: string
  uploadedBy?: number
  reviewedBy?: number
  reviewedAt?: string
  reviewRequestedAt?: string
  lineCount: number
  createdAt?: string
}

export type LyricAnnotationCategory = 'note' | 'grammar' | 'vocabulary' | 'translation' | 'timing' | 'culture'

export interface LyricAnnotationItem {
  id: number
  lyricId: number
  lineId?: number
  category: LyricAnnotationCategory
  body: string
  visibility: LyricVisibility
  annotationScope: 'learning' | 'admin_review'
  createdBy?: number
  reviewStatus: LyricReviewStatus
  reviewNote?: string
  reviewedBy?: number
  reviewedAt?: string
  reviewRequestedAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface AdminLyricReviewItem extends LyricVersionItem {
  songTitle: string
  songCoverUrl?: string
  uploaderName?: string
  uploaderEmail?: string
}

export interface AdminAnnotationReviewItem extends LyricAnnotationItem {
  songId: number
  songTitle: string
  songCoverUrl?: string
  lineIndex?: number
  creatorName?: string
  creatorEmail?: string
}

export interface LyricProcessingJobItem {
  id: number
  songId: number
  lyricId?: number
  jobType: LyricJobType
  status: LyricJobStatus
  inputPayload?: Record<string, unknown>
  outputPayload?: {
    message?: string
    mode?: string
    lines?: unknown[]
  }
  errorCode?: string
  errorMessage?: string
  retryCount: number
  requestedBy?: number
  startedAt?: string
  completedAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface PagedResponse<T> {
  data: T
  pagination: Pagination
}

export interface ApiResponse<T> {
  data: T
}
