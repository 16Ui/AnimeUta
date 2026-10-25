import { describe, expect, it } from 'vitest'
import { alignLyricLines } from './lyric-alignment.js'

describe('lyric text alignment', () => {
  it('merges adjacent transcript segments that belong to one lyric line', () => {
    const result = alignLyricLines(
      ['それは簡単でとても困難で', '認めることで前に進めるのに'],
      [
        { start: 0, end: 2, text: 'それは簡単で' },
        { start: 2, end: 4, text: 'とても困難で' },
        { start: 4, end: 6, text: '認めることで' },
        { start: 6, end: 9, text: '前に進めるのに' },
      ],
    )
    expect(result).toEqual([
      { start: 0, end: 4, confidence: 1 },
      { start: 4, end: 9, confidence: 1 },
    ])
  })

  it('splits one transcript segment across two lyric lines', () => {
    const result = alignLyricLines(
      ['信じられなくて', '信じたくなくて'],
      [{ start: 10, end: 14, text: '信じられなくて信じたくなくて' }],
    )
    expect(result[0]).toMatchObject({ start: 10, end: 12, confidence: 1 })
    expect(result[1]).toMatchObject({ start: 12, end: 14, confidence: 1 })
  })

  it('skips unrelated recognition noise before a matching line', () => {
    const result = alignLyricLines(
      ['君の声を忘れない'],
      [
        { start: 0, end: 1, text: 'music' },
        { start: 1, end: 3, text: '君の声を忘れない' },
      ],
    )
    expect(result[0]).toMatchObject({ start: 1, end: 3, confidence: 1 })
  })

  it('gives unmatched lines a monotonic time range between anchors', () => {
    const result = alignLyricLines(
      ['最初の行', '認識されない行', '最後の行'],
      [
        { start: 0, end: 2, text: '最初の行' },
        { start: 5, end: 7, text: '最後の行' },
      ],
    )
    expect(result[0]).toMatchObject({ start: 0, end: 2 })
    expect(result[1]!.start).toBeGreaterThanOrEqual(2)
    expect(result[1]!.end).toBeLessThanOrEqual(5)
    expect(result[2]).toMatchObject({ start: 5, end: 7 })
  })
})
