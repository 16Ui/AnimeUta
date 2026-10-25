import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './desktopLyrics'

export function supportsSecureDesktopCredentials() {
  return isTauriRuntime()
}

export interface DesktopSavedLogin {
  email: string
  password: string
}

export async function loadDesktopLogin(): Promise<DesktopSavedLogin | null> {
  if (!supportsSecureDesktopCredentials()) return null
  return invoke<DesktopSavedLogin | null>('load_saved_login')
}

export async function loadDesktopPassword(email: string): Promise<string | null> {
  if (!supportsSecureDesktopCredentials() || !email.trim()) return null
  return invoke<string | null>('load_saved_password', { email: email.trim() })
}

export async function saveDesktopPassword(email: string, password: string): Promise<void> {
  if (!supportsSecureDesktopCredentials()) return
  await invoke('save_login_password', { email: email.trim(), password })
}

export async function deleteDesktopPassword(email: string): Promise<void> {
  if (!supportsSecureDesktopCredentials() || !email.trim()) return
  await invoke('delete_saved_password', { email: email.trim() })
}
