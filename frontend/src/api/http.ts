import axios from 'axios'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'

const apiBaseUrlStorageKey = 'animeuta-api-base-url'
const legacyLocalBaseUrl = 'http://localhost:8080'
const buildTimeBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:8080'

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported_api_protocol')
  if (url.username || url.password || url.search || url.hash) throw new Error('invalid_api_url')
  return url.toString().replace(/\/$/, '')
}

function storedBaseUrl(): string | undefined {
  try {
    const value = localStorage.getItem(apiBaseUrlStorageKey)
    if (!value) return undefined
    const normalized = normalizeBaseUrl(value)
    const currentDefault = normalizeBaseUrl(buildTimeBaseUrl)
    if (normalized === legacyLocalBaseUrl && currentDefault !== legacyLocalBaseUrl) {
      localStorage.setItem(apiBaseUrlStorageKey, currentDefault)
      return currentDefault
    }
    return normalized
  } catch {
    return undefined
  }
}

export let backendBaseUrl = storedBaseUrl() ?? normalizeBaseUrl(buildTimeBaseUrl)
export const authStorageKey = () => `animeuta-auth:${backendBaseUrl}`

export const http = axios.create({
  baseURL: backendBaseUrl,
  timeout: 10000,
})

export function setBackendBaseUrl(value: string, persist = true): string {
  const normalized = normalizeBaseUrl(value)
  if (persist) localStorage.setItem(apiBaseUrlStorageKey, normalized)
  backendBaseUrl = normalized
  http.defaults.baseURL = normalized
  return normalized
}

type RetryableRequest = InternalAxiosRequestConfig & { _animeutaRetried?: boolean }
let refreshHandler: (() => Promise<string>) | undefined
let authFailureHandler: (() => void) | undefined
let refreshInFlight: Promise<string> | undefined

export function configureAuthRefresh(onRefresh: () => Promise<string>, onFailure: () => void): void {
  refreshHandler = onRefresh
  authFailureHandler = onFailure
}

http.interceptors.request.use((config) => {
  try {
    const persisted = JSON.parse(localStorage.getItem(authStorageKey()) ?? sessionStorage.getItem(authStorageKey()) ?? '{}') as { state?: { token?: string } }
    if (config.baseURL === backendBaseUrl && persisted.state?.token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${persisted.state.token}`
    }
  } catch {
    // Invalid local state is handled by the authentication store.
  }
  return config
})

http.interceptors.response.use(undefined, async (error: AxiosError) => {
  const request = error.config as RetryableRequest | undefined
  const requestUrl = request?.url ?? ''
  const canRefresh = error.response?.status === 401 && request && !request._animeutaRetried && refreshHandler
    && !requestUrl.includes('/auth/login') && !requestUrl.includes('/auth/register')
    && !requestUrl.includes('/auth/refresh') && !requestUrl.includes('/auth/logout')
  if (!canRefresh) return Promise.reject(error)
  request._animeutaRetried = true
  try {
    refreshInFlight ??= refreshHandler!().finally(() => { refreshInFlight = undefined })
    const token = await refreshInFlight
    request.headers.Authorization = `Bearer ${token}`
    return await http.request(request)
  } catch (refreshError) {
    authFailureHandler?.()
    return Promise.reject(refreshError)
  }
})

export function resolveMediaUrl(value?: string) {
  if (!value) {
    return undefined
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value
  }
  if (value.startsWith('/')) {
    return `${backendBaseUrl}${value}`
  }
  return value
}
