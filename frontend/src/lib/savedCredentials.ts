import { Capacitor, registerPlugin } from '@capacitor/core'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './desktopLyrics'

export interface SavedLogin { email: string; password: string }
interface CredentialPlugin {
  load(options: { server: string }): Promise<{ login: SavedLogin | null }>
  save(options: { server: string; email: string; password: string }): Promise<void>
  remove(options: { server: string }): Promise<void>
}
const native = registerPlugin<CredentialPlugin>('SavedCredentials')
const databaseName = 'animeuta-saved-logins-v1'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('logins')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('credential_database_blocked'))
  })
}

async function record<T>(server: string, mode: IDBTransactionMode, value?: unknown, remove = false): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('logins', mode)
      const store = tx.objectStore('logins')
      const request = remove ? store.delete(server) : mode === 'readonly' ? store.get(server) : store.put(value, server)
      tx.oncomplete = () => resolve(request.result as T)
      tx.onabort = () => reject(tx.error ?? new Error('credential_transaction_aborted'))
      tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}

export function canSaveCredentials(): boolean {
  return isTauriRuntime() || Capacitor.getPlatform() === 'android'
    || (globalThis.isSecureContext && !!globalThis.crypto?.subtle && !!globalThis.indexedDB)
}

export async function loadSavedLogin(server: string): Promise<SavedLogin | null> {
  if (isTauriRuntime()) return invoke('load_scoped_login', { server })
  if (Capacitor.getPlatform() === 'android') return (await native.load({ server })).login
  const entry = await record<{ key: CryptoKey; iv: Uint8Array; cipher: ArrayBuffer } | undefined>(server, 'readonly')
  if (!entry) return null
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(entry.iv), additionalData: new TextEncoder().encode(server) }, entry.key, entry.cipher)
  const login = JSON.parse(new TextDecoder().decode(bytes)) as SavedLogin
  if (typeof login.email !== 'string' || typeof login.password !== 'string') throw new Error('invalid_saved_login')
  return login
}

export async function saveLogin(server: string, email: string, password: string): Promise<void> {
  email = email.trim().toLowerCase()
  if (!email || !password) throw new Error('empty_credentials')
  if (isTauriRuntime()) return invoke('save_scoped_login', { server, email, password })
  if (Capacitor.getPlatform() === 'android') return native.save({ server, email, password })
  // Non-extractable keys prevent accidental export, not same-origin script/XSS access.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(server) }, key,
    new TextEncoder().encode(JSON.stringify({ email, password })))
  await record(server, 'readwrite', { key, iv, cipher })
}

export async function removeSavedLogin(server: string): Promise<void> {
  if (isTauriRuntime()) return invoke('delete_scoped_login', { server })
  if (Capacitor.getPlatform() === 'android') return native.remove({ server })
  await record(server, 'readwrite', undefined, true)
}
