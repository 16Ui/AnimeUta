import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { getCurrentUser, logout as logoutRequest, refreshToken as refreshTokenRequest } from '../api/auth'
import type { CurrentUserResponse, LoginResponse } from '../types/auth'
import { authStorageKey } from '../api/http'

interface AuthState {
  token: string | null
  refreshToken: string | null
  currentUser: CurrentUserResponse | null
  isAuthenticated: boolean
  rememberLogin: boolean
  setAuth: (auth: LoginResponse, rememberLogin?: boolean) => void
  setRememberLogin: (rememberLogin: boolean) => void
  setToken: (token: string, refreshToken?: string) => void
  clearAuth: () => Promise<void>
  clearLocalAuth: () => void
  refreshAccessToken: () => Promise<string>
  fetchMe: () => Promise<CurrentUserResponse>
}

const authStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name) ?? sessionStorage.getItem(name),
  setItem: (name, value) => {
    let rememberLogin = true
    try {
      rememberLogin = JSON.parse(value)?.state?.rememberLogin !== false
    } catch {
      // Preserve the safer long-lived default for legacy state.
    }
    const target = rememberLogin ? localStorage : sessionStorage
    const other = rememberLogin ? sessionStorage : localStorage
    target.setItem(name, value)
    other.removeItem(name)
  },
  removeItem: (name) => {
    localStorage.removeItem(name)
    sessionStorage.removeItem(name)
  },
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      currentUser: null,
      isAuthenticated: false,
      rememberLogin: true,
      setAuth: (auth, rememberLogin = get().rememberLogin) =>
        set({
          token: auth.token,
          refreshToken: auth.refreshToken,
          currentUser: auth.user,
          isAuthenticated: true,
          rememberLogin,
        }),
      setRememberLogin: (rememberLogin) => set({ rememberLogin }),
      setToken: (token, refreshToken) =>
        set({
          token,
          refreshToken: refreshToken ?? get().refreshToken,
          isAuthenticated: true,
        }),
      clearLocalAuth: () => set({ token: null, refreshToken: null, currentUser: null, isAuthenticated: false }),
      clearAuth: async () => {
        const token = get().token
        set({ token: null, refreshToken: null, currentUser: null, isAuthenticated: false })
        if (token) {
          await logoutRequest(token).catch(() => undefined)
        }
      },
      refreshAccessToken: async () => {
        const refreshToken = get().refreshToken
        const accessToken = get().token
        if (!refreshToken || !accessToken) {
          throw new Error('refresh_token_missing')
        }
        const auth = await refreshTokenRequest(refreshToken, accessToken)
        get().setAuth(auth)
        return auth.token
      },
      fetchMe: async () => {
        const token = get().token
        if (!token) {
          throw new Error('not_authenticated')
        }

        const currentUser = await getCurrentUser(token)
        set({
          currentUser,
          isAuthenticated: true,
        })
        return currentUser
      },
    }),
    {
      name: authStorageKey(),
      storage: createJSONStorage(() => authStorage),
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        currentUser: state.currentUser,
        isAuthenticated: state.isAuthenticated,
        rememberLogin: state.rememberLogin,
      }),
    },
  ),
)
