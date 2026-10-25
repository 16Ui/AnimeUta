export function formatDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) {
    return '--:--'
  }
  const totalSeconds = Math.round(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

export function formatRelativeTime(value?: string | null, locale?: string) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const diffMs = Date.now() - date.getTime()
  const absMs = Math.abs(diffMs)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const direction = diffMs < 0 ? 1 : -1
  if (absMs < minute) return relative.format(0, 'second')
  if (absMs < hour) return relative.format(direction * Math.floor(absMs / minute), 'minute')
  if (absMs < day) return relative.format(direction * Math.floor(absMs / hour), 'hour')
  if (absMs < 7 * day) return relative.format(direction * Math.floor(absMs / day), 'day')

  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function formatDateTime(value?: string | null, locale?: string) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
