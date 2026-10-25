import { describe, expect, it } from 'vitest'
import { desktopLyricsPointerState } from '../../frontend/src/lib/desktopLyrics'

describe('desktop lyrics pointer policy', () => {
  it('reveals controls over locked lyrics without blocking clicks through lyrics', () => {
    expect(desktopLyricsPointerState(true, true, false)).toEqual({ hovered: true, ignore: true })
  })
  it('allows unlocking through the fixed toolbar even while locked', () => {
    expect(desktopLyricsPointerState(true, false, true)).toEqual({ hovered: true, ignore: false })
  })
  it('hides controls and passes through empty space in either mode', () => {
    for (const locked of [true, false]) expect(desktopLyricsPointerState(locked, false, false)).toEqual({ hovered: false, ignore: true })
  })
  it('allows dragging unlocked lyrics and clicking controls', () => {
    expect(desktopLyricsPointerState(false, true, false).ignore).toBe(false)
    expect(desktopLyricsPointerState(false, false, true).ignore).toBe(false)
  })
})
