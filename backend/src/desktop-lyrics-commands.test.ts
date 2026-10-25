import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeDesktopLyricsCommands, sendDesktopLyricsCommand } from '../../frontend/src/lib/desktopLyrics'

afterEach(() => vi.unstubAllGlobals())
describe('desktop lyrics command transport', () => {
  it('sends a unique command envelope with the originating playback session', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    sendDesktopLyricsCommand({ action: 'replay', songId: 2, sessionId: 7, range: { start: 1, end: 3 } })
    const [key, data] = setItem.mock.calls[0]
    expect(key).toBe('animeuta-desktop-lyrics-command')
    expect(JSON.parse(data)).toMatchObject({ action: 'replay', songId: 2, sessionId: 7, range: { start: 1, end: 3 }, id: expect.any(String), sentAt: expect.any(Number) })
  })
  it('ignores malformed, unrelated and expired messages and cleans up the listener', () => {
    let handler: (event: unknown) => void = () => {}
    const removeEventListener = vi.fn()
    vi.stubGlobal('window', { addEventListener: (_: string, fn: typeof handler) => { handler = fn }, removeEventListener })
    const receive = vi.fn()
    const stop = subscribeDesktopLyricsCommands(receive)
    const key = 'animeuta-desktop-lyrics-command'
    handler({ key, newValue: '{' })
    handler({ key, newValue: JSON.stringify({ songId: 2, sentAt: Date.now() - 10000 }) })
    handler({ key: 'other', newValue: '{}' })
    handler({ key, newValue: JSON.stringify({ songId: 2, sentAt: Date.now(), action: 'toggle' }) })
    expect(receive).toHaveBeenCalledTimes(1)
    stop()
    expect(removeEventListener).toHaveBeenCalledWith('storage', handler)
  })
})
