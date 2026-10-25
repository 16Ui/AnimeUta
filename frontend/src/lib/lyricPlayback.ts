export interface SentenceRange { start: number; end: number }

export function sentenceRange(lines: { startMs?: number }[], index: number, offsetMs: number, duration: number): SentenceRange | null {
  const startMs = lines[index]?.startMs
  if (startMs == null || !Number.isFinite(startMs) || !Number.isFinite(offsetMs)) return null
  const next = lines.slice(index + 1).find(line => line.startMs != null && line.startMs > startMs)?.startMs
  const start = Math.max(0, (startMs + offsetMs) / 1000)
  const end = next == null ? duration : Math.min(duration || Infinity, (next + offsetMs) / 1000)
  return Number.isFinite(end) && end > start + 0.1 ? { start, end } : null
}

export function validSentenceRange(range: SentenceRange | undefined, duration: number): range is SentenceRange {
  return !!range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end > range.start + 0.1 && (duration <= 0 || range.end <= duration + 0.1)
}

export const playbackRates = [0.75, 0.9, 1] as const

export interface WindowBounds { x: number; y: number; width: number; height: number }
export function fitLyricsBounds(saved: WindowBounds, screens: WindowBounds[]): WindowBounds {
  const screen = screens.find(s => saved.x + saved.width / 2 >= s.x && saved.x + saved.width / 2 < s.x + s.width && saved.y + saved.height / 2 >= s.y && saved.y + saved.height / 2 < s.y + s.height) ?? screens[0]
  if (!screen) return saved
  const width = Math.min(Math.max(520, saved.width), screen.width)
  const height = Math.min(Math.max(160, saved.height), screen.height)
  return { width, height, x: Math.max(screen.x, Math.min(saved.x, screen.x + screen.width - width)), y: Math.max(screen.y, Math.min(saved.y, screen.y + screen.height - height)) }
}
