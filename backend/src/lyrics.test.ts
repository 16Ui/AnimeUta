import { describe, expect, it } from 'vitest'
import { detectLyricsLanguage, normalizeLyricTracks, normalizeParallelLyrics, parseLrc, parseLyrics, parseRubyMarkup, parseSrt } from './lyrics.js'

describe('lyrics parsers', () => {
  it('merges adjacent original, Chinese translation and romaji tracks at one timestamp', () => {
    const lines = normalizeParallelLyrics([
      { lineIndex: 0, startMs: 1_000, originalText: '君の声', romajiText: 'kimi no koe' },
      { lineIndex: 1, startMs: 1_000, originalText: '你的声音' },
      { lineIndex: 2, startMs: 1_000, originalText: 'kimi no koe' },
      { lineIndex: 3, startMs: 3_000, originalText: 'Can you hear me?' },
      { lineIndex: 4, startMs: 3_000, originalText: '你能听见我吗？' },
    ])

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ originalText: '君の声', translatedText: '你的声音', romajiText: 'kimi no koe' })
    expect(lines[1]).toMatchObject({ originalText: 'Can you hear me?', translatedText: '你能听见我吗？' })
  })

  it('keeps Chinese originals untranslated', () => {
    const lines = normalizeParallelLyrics([
      { lineIndex: 0, startMs: 1_000, originalText: '时间的微风吹过' },
      { lineIndex: 1, startMs: 4_000, originalText: '你的容颜悄悄改变' },
    ])

    expect(lines.every((line) => line.translatedText === undefined)).toBe(true)
    expect(detectLyricsLanguage(lines, '一半一半', '洛天依')).toBe('zh')
  })

  it('detects an English original after its Chinese track is merged', () => {
    const lines = normalizeParallelLyrics([
      { lineIndex: 0, startMs: 1_000, originalText: 'There was a star many light years away' },
      { lineIndex: 1, startMs: 1_000, originalText: '有一颗距离许多光年的星星' },
    ])

    expect(detectLyricsLanguage(lines, 'Constellation')).toBe('en')
  })
  it('parses multiple LRC timestamps, translations, and inferred end times', () => {
    const lines = parseLrc('[00:01.20][00:03.500]君の声 || 你的声音\n[00:05.00]聞こえる')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ lineIndex: 0, startMs: 1200, endMs: 3499, originalText: '君の声', translatedText: '你的声音' })
    expect(lines[1]).toMatchObject({ startMs: 3500, endMs: 4999 })
    expect(lines[2]).toMatchObject({ startMs: 5000, originalText: '聞こえる' })
  })

  it('parses SRT timing and strips simple markup', () => {
    const lines = parseSrt('1\n00:00:02,100 --> 00:00:04,250\n<i>光</i>\t光芒')
    expect(lines).toEqual([{
      lineIndex: 0,
      startMs: 2100,
      endMs: 4250,
      originalText: '光',
      translatedText: '光芒',
    }])
  })

  it('falls back to non-empty plain-text lines', () => {
    expect(parseLyrics('\ufeff春\n\n夏 || 夏天', 'lyrics.txt')).toEqual([
      { lineIndex: 0, originalText: '春' },
      { lineIndex: 1, originalText: '夏', translatedText: '夏天' },
    ])
  })

  it('merges repeated Japanese, Chinese, and romaji timelines into language tracks', () => {
    const content = [
      '[00:10.00]君の声',
      '[00:20.00]光の中で歌う',
      '[00:10.00]你的声音',
      '[00:20.00]在光芒中歌唱',
      '[00:10.00]kimi no koe',
      '[00:20.00]hikari no naka de utau',
    ].join('\n')

    expect(parseLyrics(content, 'embedded.lrc')).toEqual([
      {
        lineIndex: 0,
        startMs: 10_000,
        endMs: 19_999,
        originalText: '君の声',
        translatedText: '你的声音',
        romajiText: 'kimi no koe',
      },
      {
        lineIndex: 1,
        startMs: 20_000,
        originalText: '光の中で歌う',
        translatedText: '在光芒中歌唱',
        romajiText: 'hikari no naka de utau',
      },
    ])
  })

  it('keeps ordinary single-track LRC behavior when no language track is detected', () => {
    expect(parseLyrics('[00:20.00]二番\n[00:10.00]一番', 'lyrics.lrc')).toEqual([
      { lineIndex: 0, startMs: 10_000, endMs: 19_999, originalText: '一番' },
      { lineIndex: 1, startMs: 20_000, originalText: '二番' },
    ])
  })

  it('removes duplicated romaji from the translation track', () => {
    expect(normalizeLyricTracks({
      lineIndex: 0,
      originalText: '届かぬ声を呆く唇',
      translatedText: 'to do ka nu ko e wo tsu bu ya ku ku chi bi ru',
      romajiText: 'todoka nu koe wo tsubuyaku kuchibiru',
    })).toEqual({
      lineIndex: 0,
      originalText: '届かぬ声を呆く唇',
      romajiText: 'todoka nu koe wo tsubuyaku kuchibiru',
    })
  })

  it('keeps real translations and prefers imported contextual readings', () => {
    expect(normalizeLyricTracks({
      lineIndex: 0,
      originalText: '永久に続く路なら',
      translatedText: 'to ko shi e ni tsu zu ku mi chi na ra',
      romajiText: 'eikyuu ni tsuzuku michi nara',
    })).toEqual({
      lineIndex: 0,
      originalText: '永久に続く路なら',
      romajiText: 'to ko shi e ni tsu zu ku mi chi na ra',
    })
    expect(normalizeLyricTracks({
      lineIndex: 1,
      originalText: '逃れる術を探すばかりの',
      translatedText: '今日也不过是颗一味寻找遁离这混世之路的',
      romajiText: 'nogareru jutsu wo sagasu bakari no',
    }).translatedText).toBe('今日也不过是颗一味寻找遁离这混世之路的')
  })

  it('moves katakana transliterations into romaji and removes redundant translations', () => {
    expect(normalizeLyricTracks({
      lineIndex: 0,
      originalText: 'テッテーテレッテー',
      translatedText: 'tettey-terettey',
    })).toEqual({
      lineIndex: 0,
      originalText: 'テッテーテレッテー',
      romajiText: 'tettey-terettey',
    })
    expect(normalizeLyricTracks({
      lineIndex: 1,
      originalText: 'Wave your hands',
      translatedText: 'Wave your hands',
    })).toEqual({
      lineIndex: 1,
      originalText: 'Wave your hands',
    })
    expect(normalizeLyricTracks({
      lineIndex: 2,
      originalText: '（M・I・K・U）',
      translatedText: '（M·I·K·U）',
    })).toEqual({
      lineIndex: 2,
      originalText: '（M・I・K・U）',
    })
  })

  it('turns kana guides into ruby segments without treating ordinary parentheses as ruby', () => {
    expect(parseRubyMarkup('光(ひかり)の中《なか》で歌う')).toEqual({
      text: '光の中で歌う',
      segments: [
        { text: '光', ruby: 'ひかり' },
        { text: 'の' },
        { text: '中', ruby: 'なか' },
        { text: 'で歌う' },
      ],
    })
    expect(parseRubyMarkup('Song (Live)')).toEqual({ text: 'Song (Live)', segments: [] })
  })
})
