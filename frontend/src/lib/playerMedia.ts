export function toMediaVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) ** 2 : 0
}

export function mediaLinkExpired(value?: string, now = Date.now()): boolean {
  if (!value) return false
  try {
    const url = new URL(value, 'http://animeuta.local')
    if (url.pathname.startsWith('/api/v1/online/preview/')) return Number(url.searchParams.get('expires')) * 1000 <= now + 30_000
    if (!url.pathname.startsWith('/api/v1/media/')) return false
    const expires = Number(url.searchParams.get('expires'))
    return url.searchParams.has('signature') && (!Number.isFinite(expires) || expires * 1000 <= now + 30_000)
  } catch {
    return false
  }
}
