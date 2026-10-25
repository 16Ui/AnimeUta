import { describe, expect, it } from 'vitest'
import { zonedDateKey, zonedDayRange } from './time.js'

describe('user-local calendar days', () => {
  it('uses the user timezone when an instant crosses midnight', () => {
    const instant = new Date('2026-01-01T15:30:00.000Z')
    expect(zonedDateKey(instant, 'UTC')).toBe('2026-01-01')
    expect(zonedDateKey(instant, 'Asia/Tokyo')).toBe('2026-01-02')
    const range = zonedDayRange('Asia/Tokyo', instant)
    expect(range.start.toISOString()).toBe('2026-01-01T15:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-01-02T15:00:00.000Z')
  })

  it('keeps daylight-saving days at their real duration', () => {
    const range = zonedDayRange('America/New_York', new Date('2026-03-08T17:00:00.000Z'))
    expect(range.start.toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-03-09T04:00:00.000Z')
    expect(range.end.getTime() - range.start.getTime()).toBe(23 * 60 * 60 * 1000)
  })
})
