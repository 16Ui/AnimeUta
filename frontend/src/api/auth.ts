import { http } from './http'
import type {
  ApiResponse,
  CurrentUserResponse,
  RegisterRequest,
  UpdateProfileRequest,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  AuthSessionItem,
  InviteItem,
} from '../types/auth'

function buildAuthorizationHeader(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  }
}

function currentDeviceName(): string {
  if (typeof navigator === 'undefined') return 'AnimeUta'
  const agent = navigator.userAgent
  const platform = /Android/i.test(agent) ? 'Android' : /iPhone|iPad|iPod/i.test(agent) ? 'iOS' : /Windows/i.test(agent) ? 'Windows' : /Macintosh/i.test(agent) ? 'macOS' : 'Web'
  const client = /Edg\//i.test(agent) ? 'Edge' : /Chrome\//i.test(agent) ? 'Chrome' : /Firefox\//i.test(agent) ? 'Firefox' : /Safari\//i.test(agent) ? 'Safari' : 'Browser'
  return `${client} · ${platform}`
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const response = await http.post<ApiResponse<LoginResponse>>('/api/v1/auth/login', { ...payload, deviceName: currentDeviceName() })
  return response.data.data
}

export async function getSetupStatus(): Promise<{ needsOwner: boolean; registrationMode: 'invite' | 'open' | 'closed' }> {
  const response = await http.get<ApiResponse<{ needsOwner: boolean; registrationMode: 'invite' | 'open' | 'closed' }>>('/api/v1/setup/status')
  return response.data.data
}

export async function register(payload: RegisterRequest): Promise<LoginResponse> {
  const response = await http.post<ApiResponse<LoginResponse>>('/api/v1/auth/register', { ...payload, deviceName: currentDeviceName() })
  return response.data.data
}

export async function refreshToken(refreshToken: string, accessToken: string): Promise<LoginResponse> {
  const response = await http.post<ApiResponse<LoginResponse>>('/api/v1/auth/refresh', {
    refreshToken,
    accessToken,
    deviceName: currentDeviceName(),
  })
  return response.data.data
}

export async function logout(token: string): Promise<void> {
  await http.post<ApiResponse<null>>('/api/v1/auth/logout', null, {
    headers: buildAuthorizationHeader(token),
  })
}

export async function getCurrentUser(token: string): Promise<CurrentUserResponse> {
  const response = await http.get<ApiResponse<CurrentUserResponse>>('/api/v1/auth/me', {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function updateMyProfile(token: string, payload: UpdateProfileRequest): Promise<CurrentUserResponse> {
  const response = await http.patch<ApiResponse<CurrentUserResponse>>('/api/v1/users/me', payload, {
    headers: buildAuthorizationHeader(token),
  })
  return response.data.data
}

export async function changeMyPassword(token: string, payload: ChangePasswordRequest): Promise<void> {
  await http.post<ApiResponse<null>>('/api/v1/users/me/password', payload, {
    headers: buildAuthorizationHeader(token),
  })
}

export interface AdminUserItem extends CurrentUserResponse {
  status: 'active' | 'disabled'
  createdAt?: string
}

export async function listUsers(token: string): Promise<AdminUserItem[]> {
  return (await http.get<ApiResponse<AdminUserItem[]>>('/api/v1/admin/users', { headers: buildAuthorizationHeader(token) })).data.data
}

export async function updateUser(token: string, userId: number, payload: { role?: 'admin' | 'user'; status?: 'active' | 'disabled' }): Promise<void> {
  await http.patch(`/api/v1/admin/users/${userId}`, payload, { headers: buildAuthorizationHeader(token) })
}

export async function createInvite(token: string, maxUses = 1): Promise<{ code: string; maxUses: number }> {
  return (await http.post<ApiResponse<{ code: string; maxUses: number }>>('/api/v1/admin/invites', { maxUses }, { headers: buildAuthorizationHeader(token) })).data.data
}

export async function listInvites(token: string): Promise<InviteItem[]> {
  return (await http.get<ApiResponse<InviteItem[]>>('/api/v1/admin/invites', { headers: buildAuthorizationHeader(token) })).data.data
}

export async function revokeInvite(token: string, inviteId: number): Promise<void> {
  await http.delete<ApiResponse<null>>(`/api/v1/admin/invites/${inviteId}`, { headers: buildAuthorizationHeader(token) })
}

export async function listMySessions(token: string): Promise<AuthSessionItem[]> {
  return (await http.get<ApiResponse<AuthSessionItem[]>>('/api/v1/users/me/sessions', { headers: buildAuthorizationHeader(token) })).data.data
}

export async function revokeMySession(token: string, sessionId: number): Promise<void> {
  await http.delete<ApiResponse<null>>(`/api/v1/users/me/sessions/${sessionId}`, { headers: buildAuthorizationHeader(token) })
}
