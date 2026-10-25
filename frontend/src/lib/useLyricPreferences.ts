import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { http, backendBaseUrl, authStorageKey } from '../api/http'
import { useAuthStore } from '../store/useAuthStore'

export interface LyricPreferences {
  showFurigana: boolean
  showRomaji: boolean
  showTranslation: boolean
  showNextLine: boolean
  desktopBackground: boolean
  fontSize: number
}
const defaults: LyricPreferences = { showFurigana: true, showRomaji: true, showTranslation: true, showNextLine: true, desktopBackground: false, fontSize: 28 }
let writes = Promise.resolve()

export function useLyricPreferences() {
  const userId = useAuthStore((state) => state.currentUser?.id)
  const token = useAuthStore((state) => state.token)
  const client = useQueryClient()
  const [saveError, setSaveError] = useState(false)
  const scope = `${backendBaseUrl}:${userId}`
  const queryKey = ['lyric-preferences', scope]
  const query = useQuery({
    queryKey, enabled: Boolean(userId),
    queryFn: async () => (await http.get<{ data: LyricPreferences }>('/api/v1/users/me/lyric-preferences')).data.data,
    refetchInterval: 15_000,
  })
  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if (event.key === authStorageKey()) void useAuthStore.persist.rehydrate()
      if (event.key === `lyric-preferences-updated:${scope}`) void client.invalidateQueries({ queryKey: ['lyric-preferences', scope] })
    }
    window.addEventListener('storage', listener)
    return () => window.removeEventListener('storage', listener)
  }, [client, scope])
  const update = (patch: Partial<LyricPreferences>) => {
    if (!userId) return
    setSaveError(false)
    client.setQueryData<LyricPreferences>(queryKey, (old) => ({ ...defaults, ...old, ...patch }))
    writes = writes.catch(() => {}).then(async () => {
      try {
        if (useAuthStore.getState().currentUser?.id !== userId || scope !== `${backendBaseUrl}:${userId}`) return
        await http.patch('/api/v1/users/me/lyric-preferences', patch, { headers: { Authorization: `Bearer ${token}` } })
        localStorage.setItem(`lyric-preferences-updated:${scope}`, String(Date.now()))
      } catch {
        setSaveError(true)
        await client.invalidateQueries({ queryKey })
      }
    })
  }
  return { preferences: { ...defaults, ...query.data }, update, error: saveError || query.isError }
}
