export interface LoginUserProfile {
  displayName?: string
  avatarUrl?: string
  bio?: string
  preferredLanguage?: string
  timezone?: string
}

export interface AIQuotaInfo {
  dailyLimit: number
  remaining: number
  resetAt?: string
}

export interface LoginUserInfo {
  id: number
  email: string
  role: 'owner' | 'user' | 'admin'
  profile?: LoginUserProfile
  aiQuota?: AIQuotaInfo
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  token: string
  refreshToken: string
  tokenType: string
  user: LoginUserInfo
}

export interface CurrentUserResponse {
  id: number
  email: string
  role: 'owner' | 'user' | 'admin'
  profile?: LoginUserProfile
  aiQuota?: AIQuotaInfo
}

export interface RegisterRequest {
  email: string
  password: string
  displayName?: string
  inviteCode?: string
}

export interface UpdateProfileRequest {
  displayName?: string
  avatarUrl?: string
  bio?: string
  preferredLanguage?: string
  timezone?: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

export interface AuthSessionItem {
  id: number
  deviceName?: string
  accessExpiresAt: string
  refreshExpiresAt: string
  createdAt: string
  updatedAt: string
  isCurrent: boolean
  isRevoked: boolean
}

export interface InviteItem {
  id: number
  maxUses: number
  usedCount: number
  status: 'active' | 'revoked' | 'expired' | 'exhausted'
  expiresAt?: string
  disabledAt?: string
  createdByName?: string
  createdAt: string
}

export interface ApiResponse<T> {
  data: T
}
