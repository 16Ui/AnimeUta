import { beforeAll, describe, expect, it, vi } from 'vitest'
import { toMediaVolume } from '../../frontend/src/lib/playerMedia'

beforeAll(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
})

describe('player interactions', () => {
  it('adds and switches songs without replacing or duplicating the current queue', async () => {
    const { usePlayerStore } = await import('../../frontend/src/store/usePlayerStore')
    const song = (id: number) => ({ id, title: `Song ${id}`, artist: 'Artist', audioUrl: `/audio/${id}`, durationSeconds: 120 })
    const player = () => usePlayerStore.getState()
    player().playNow(song(1))
    player().playNow(song(2))
    player().playFromQueue([song(3), song(4)], 1, { type: 'search', name: 'Results' })
    expect(player().queue.map((item) => item.id)).toEqual([1, 2, 4])
    expect(player().currentSong?.id).toBe(4)
    player().playNow(song(2))
    expect(player().queue.map((item) => item.id)).toEqual([1, 2, 4])
    expect(player().currentIndex).toBe(1)
    player().playFromQueue([], 0)
    expect(player().queue).toHaveLength(3)
    player().playNow({ ...song(8), audioUrl: undefined })
    expect(player().currentSong?.id).toBe(2)
    player().playNext()
    expect(player().currentSong?.id).toBe(4)
    player().removeFromQueue(1)
    expect(player().queue.map((item) => item.id)).toEqual([2, 4])
  })

  it('offers fine low-volume control without reducing maximum volume', () => {
    expect(toMediaVolume(0)).toBe(0)
    expect(toMediaVolume(0.05)).toBeCloseTo(0.0025)
    expect(toMediaVolume(0.1)).toBeCloseTo(0.01)
    expect(toMediaVolume(1)).toBe(1)
    expect(toMediaVolume(Number.NaN)).toBe(0)
  })
})
