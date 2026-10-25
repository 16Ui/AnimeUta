import { describe, expect, it } from 'vitest'
import { sentenceRange, validSentenceRange, fitLyricsBounds } from '../../frontend/src/lib/lyricPlayback'

describe('sentence playback', () => {
  it('applies song delay to both boundaries and skips duplicate timestamps', () => {
    expect(sentenceRange([{ startMs: 1000 }, { startMs: 1000 }, {}, { startMs: 4000 }], 0, 500, 8)).toEqual({ start: 1.5, end: 4.5 })
  })
  it('uses duration for the last sentence and rejects untimed or unknown ends', () => {
    expect(sentenceRange([{ startMs: 3000 }], 0, -500, 6)).toEqual({ start: 2.5, end: 6 })
    expect(sentenceRange([{}], 0, 0, 6)).toBeNull()
    expect(sentenceRange([{ startMs: 3000 }], 0, 0, 0)).toBeNull()
    expect(sentenceRange([{ startMs: 3000 }], 0, 10000, 6)).toBeNull()
  })
  it('rejects invalid ranges and clamps negative starts', () => {
    expect(sentenceRange([{ startMs: 0 }, { startMs: 3000 }], 0, -1000, 6)).toEqual({ start: 0, end: 2 })
    for (const range of [{ start: NaN, end: 4 }, { start: -1, end: 4 }, { start: 5, end: 4 }, { start: 0, end: 20 }]) expect(validSentenceRange(range, 10)).toBe(false)
  })
})
describe('desktop lyrics placement', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  it('brings a disconnected monitor window back to the work area', () => {
    expect(fitLyricsBounds({ x: 2400, y: 1100, width: 920, height: 400 }, [primary])).toEqual({ x: 1000, y: 640, width: 920, height: 400 })
  })
  it('keeps valid negative-coordinate secondary monitor placement', () => {
    const saved = { x: -1800, y: 300, width: 920, height: 400 }
    expect(fitLyricsBounds(saved, [primary, { ...primary, x: -1920 }])).toEqual(saved)
  })
  it('fits oversized windows without overflowing the monitor', () => {
    expect(fitLyricsBounds({ x: -100, y: -100, width: 3000, height: 2000 }, [primary])).toEqual(primary)
  })
})
