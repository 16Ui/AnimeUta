export interface ParsedLyricLine {
  lineIndex: number
  startMs?: number
  endMs?: number
  originalText: string
  translatedText?: string
  romajiText?: string
}

export interface RubySegment {
  text: string
  ruby?: string
}

interface ScriptProfile {
  kana: number
  han: number
  latin: number
}

function profileText(text: string): ScriptProfile {
  return {
    kana: (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length,
    han: (text.match(/\p{Script=Han}/gu) ?? []).length,
    latin: (text.match(/\p{Script=Latin}/gu) ?? []).length,
  }
}

function canonicalRomanization(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function canonicalDisplayText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
}

function similarity(left: string, right: string): number {
  if (left === right) return 1
  if (!left || !right) return 0

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return 1 - previous[right.length]! / Math.max(left.length, right.length)
}

const romanizedMora = new Set(`
  a i u e o n nn
  ka ki ku ke ko kya kyu kyo
  ga gi gu ge go gya gyu gyo
  sa shi su se so sha shu sho
  za ji zu ze zo ja ju jo
  ta chi tsu te to cha chu cho
  da de do
  na ni nu ne no nya nyu nyo
  ha hi fu he ho hya hyu hyo
  ba bi bu be bo bya byu byo
  pa pi pu pe po pya pyu pyo
  ma mi mu me mo mya myu myo
  ya yu yo ra ri ru re ro rya ryu ryo wa wo
`.trim().split(/\s+/))

function looksLikeSyllableSpacedRomanization(value: string): boolean {
  const tokens = value.toLowerCase().match(/[a-z]+/g) ?? []
  if (tokens.length < 4) return false
  const shortTokens = tokens.filter((token) => token.length <= 3).length
  const moraTokens = tokens.filter((token) => romanizedMora.has(token)).length
  const averageLength = tokens.reduce((total, token) => total + token.length, 0) / tokens.length
  return shortTokens / tokens.length >= 0.75 && moraTokens / tokens.length >= 0.62 && averageLength <= 2.6
}

export function isRomanizationInTranslation(line: ParsedLyricLine): boolean {
  const translated = line.translatedText?.trim()
  const romaji = line.romajiText?.trim()
  if (!translated || !romaji) return false

  const profile = profileText(translated)
  if (profile.latin < 2 || profile.kana > 0 || profile.han > 0) return false
  const translatedCanonical = canonicalRomanization(translated)
  const romajiCanonical = canonicalRomanization(romaji)
  return similarity(translatedCanonical, romajiCanonical) >= 0.85 || looksLikeSyllableSpacedRomanization(translated)
}

export function normalizeLyricTracks(line: ParsedLyricLine): ParsedLyricLine {
  const translated = line.translatedText?.trim()
  if (!translated) return line

  const comparableOriginal = canonicalDisplayText(line.originalText)
  const comparableTranslation = canonicalDisplayText(translated)
  if (translated === line.originalText.trim() || (comparableOriginal && comparableOriginal === comparableTranslation)) {
    const { translatedText: _translatedText, ...source } = line
    return source
  }

  const originalHiragana = (line.originalText.match(/\p{Script=Hiragana}/gu) ?? []).length
  const originalKatakana = (line.originalText.match(/\p{Script=Katakana}/gu) ?? []).length
  const originalHan = (line.originalText.match(/\p{Script=Han}/gu) ?? []).length
  const translatedProfile = profileText(translated)
  const isKatakanaTransliteration = !line.romajiText?.trim()
    && originalKatakana > 0
    && originalHiragana === 0
    && originalHan === 0
    && translatedProfile.latin >= 2
    && translatedProfile.kana === 0
    && translatedProfile.han === 0

  if (isKatakanaTransliteration) {
    const { translatedText: _translatedText, ...source } = line
    return { ...source, romajiText: translated }
  }

  if (!isRomanizationInTranslation(line)) return line
  const romaji = line.romajiText!.trim()
  const shouldPreferImportedReading = similarity(canonicalRomanization(translated), canonicalRomanization(romaji)) < 0.9
  const { translatedText: _translatedText, ...source } = line
  return {
    ...source,
    romajiText: shouldPreferImportedReading ? translated : romaji,
  }
}

/**
 * Embedded lyrics commonly store original, Chinese translation and romaji as
 * adjacent entries sharing one timestamp. Collapse those tracks before they
 * reach persistence so translations do not appear as separate lyric lines.
 */
export function normalizeParallelLyrics(lines: ParsedLyricLine[]): ParsedLyricLine[] {
  if (lines.length < 2) return completeEndTimes(lines.map((line, lineIndex) => normalizeLyricTracks({ ...line, lineIndex })))

  const firstAtTimestamp = lines.filter((line, index) => index === 0 || line.startMs !== lines[index - 1]?.startMs)
  const sourceProfile = profileText(firstAtTimestamp.map((line) => line.originalText).join('\n'))
  const sourceLooksJapanese = sourceProfile.kana >= 3
  const result: ParsedLyricLine[] = []

  for (let index = 0; index < lines.length;) {
    const first = { ...lines[index]! }
    const group = [first]
    let cursor = index + 1
    while (cursor < lines.length && first.startMs !== undefined && lines[cursor]!.startMs === first.startMs) {
      group.push({ ...lines[cursor]! })
      cursor += 1
    }

    if (group.length > 1) {
      const originalProfile = profileText(first.originalText)
      const extras: ParsedLyricLine[] = []
      for (const candidate of group.slice(1)) {
        const candidateProfile = profileText(candidate.originalText)
        const isChineseTranslation = candidateProfile.han > 0 && candidateProfile.kana === 0 && (
          originalProfile.kana > 0 || originalProfile.latin >= 2 || (sourceLooksJapanese && originalProfile.han > 0)
        )
        const isRomajiTrack = candidateProfile.latin >= 2 && candidateProfile.kana === 0 && candidateProfile.han === 0 && (
          originalProfile.kana > 0 || (sourceLooksJapanese && originalProfile.han > 0)
        )

        if (isChineseTranslation) {
          if (!first.translatedText) first.translatedText = candidate.originalText.trim()
        } else if (isRomajiTrack) {
          if (!first.romajiText) first.romajiText = candidate.originalText.trim()
        } else if (candidate.originalText.trim() !== first.originalText.trim()) {
          extras.push(candidate)
        }
      }
      result.push(first, ...extras)
    } else {
      result.push(first)
    }
    index = cursor
  }

  return completeEndTimes(result.map((line, lineIndex) => normalizeLyricTracks({ ...line, lineIndex })))
}

export function detectLyricsLanguage(lines: ParsedLyricLine[], title = '', artist = ''): 'ja' | 'zh' | 'en' {
  const profile = profileText(lines.map((line) => line.originalText).join('\n'))
  const chineseVoicebank = /(?:洛天依|言和|乐正绫|星尘|心华|墨清弦|徵羽摩柯)/u.test(artist)
  if (profile.kana >= 3) return 'ja'
  if (chineseVoicebank && profile.han >= 3) return 'zh'
  if (profile.latin >= 12 && profile.latin > profile.han * 1.2) return 'en'
  if (profile.han >= 3) return 'zh'
  if (profile.latin > 0) return 'en'
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title)) return 'ja'
  return chineseVoicebank ? 'zh' : 'ja'
}

export function parseRubyMarkup(value: string): { text: string; segments: RubySegment[] } {
  const source = value.trim()
  const pattern = /[|｜]?([\p{Script=Han}々〆ヶ]+)(?:\(([\p{Script=Hiragana}\p{Script=Katakana}ー・]+)\)|《([\p{Script=Hiragana}\p{Script=Katakana}ー・]+)》)/gu
  const segments: RubySegment[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) segments.push({ text: source.slice(cursor, match.index) })
    segments.push({ text: match[1]!, ruby: match[2] || match[3]! })
    cursor = pattern.lastIndex
  }

  if (segments.length === 0) return { text: source, segments: [] }
  if (cursor < source.length) segments.push({ text: source.slice(cursor) })
  return { text: segments.map((segment) => segment.text).join(''), segments }
}

function timestampToMilliseconds(minutes: string, seconds: string, fraction = '0'): number {
  const normalizedFraction = fraction.padEnd(3, '0').slice(0, 3)
  return Number(minutes) * 60_000 + Number(seconds) * 1_000 + Number(normalizedFraction)
}

function splitTranslation(text: string): { originalText: string; translatedText?: string } {
  const separator = text.includes(' || ') ? ' || ' : text.includes('\t') ? '\t' : undefined
  if (!separator) return { originalText: text.trim() }
  const [originalText, ...translation] = text.split(separator)
  const translatedText = translation.join(separator).trim()
  return { originalText: originalText?.trim() ?? '', ...(translatedText ? { translatedText } : {}) }
}

function completeEndTimes(lines: ParsedLyricLine[]): ParsedLyricLine[] {
  return lines.map((line, index) => {
    const next = lines.slice(index + 1).find((candidate) => candidate.startMs !== undefined)
    if (line.startMs === undefined || !next?.startMs) return line
    return { ...line, endMs: Math.max(line.startMs, next.startMs - 1) }
  })
}

export function parseLrc(content: string): ParsedLyricLine[] {
  const parsed = parseLrcEntries(content)
  parsed.sort((left, right) => (left.startMs ?? 0) - (right.startMs ?? 0))
  return normalizeParallelLyrics(parsed.map((line, lineIndex) => ({ ...line, lineIndex })))
}

function parseLrcEntries(content: string): Array<Omit<ParsedLyricLine, 'lineIndex'>> {
  const parsed: Array<Omit<ParsedLyricLine, 'lineIndex'>> = []
  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (timestamps.length === 0) continue
    const text = rawLine.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').trim()
    if (!text) continue
    for (const match of timestamps) {
      const split = splitTranslation(text)
      parsed.push({
        startMs: timestampToMilliseconds(match[1]!, match[2]!, match[3]),
        ...split,
      })
    }
  }
  return parsed
}

type LrcEntry = Omit<ParsedLyricLine, 'lineIndex'>

function splitRepeatedTimeline(entries: LrcEntry[]): LrcEntry[][] {
  const tracks: LrcEntry[][] = [[]]
  let previousStart: number | undefined
  for (const entry of entries) {
    const start = entry.startMs
    const current = tracks.at(-1)!
    if (start !== undefined && previousStart !== undefined && previousStart - start > 2_000 && current.length >= 2) {
      tracks.push([])
    }
    tracks.at(-1)!.push(entry)
    previousStart = start
  }
  return tracks.filter((track) => track.length > 0)
}

function scriptCounts(track: LrcEntry[]) {
  const text = track.map((line) => line.originalText).join(' ')
  return {
    kana: (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length,
    han: (text.match(/\p{Script=Han}/gu) ?? []).length,
    latin: (text.match(/\p{Script=Latin}/gu) ?? []).length,
  }
}

function overlapRatio(base: LrcEntry[], candidate: LrcEntry[]): number {
  const baseTimes = new Set(base.map((line) => line.startMs).filter((value): value is number => value !== undefined))
  const candidateTimes = candidate.map((line) => line.startMs).filter((value): value is number => value !== undefined)
  if (candidateTimes.length === 0) return 0
  return candidateTimes.filter((time) => baseTimes.has(time)).length / candidateTimes.length
}

function mergeTrackAtTimes(base: LrcEntry[], supplemental: LrcEntry[], field: 'translatedText' | 'romajiText'): void {
  const available = new Map<number, string[]>()
  for (const line of supplemental) {
    if (line.startMs === undefined || !line.originalText.trim()) continue
    const values = available.get(line.startMs) ?? []
    values.push(line.originalText.trim())
    available.set(line.startMs, values)
  }
  for (const line of base) {
    if (line.startMs === undefined) continue
    const values = available.get(line.startMs)
    const value = values?.shift()
    if (value) line[field] = value
  }
}

function parseMultilingualLrc(content: string): ParsedLyricLine[] | undefined {
  const entries = parseLrcEntries(content)
  const tracks = splitRepeatedTimeline(entries)
  if (tracks.length < 2) return undefined

  const counts = tracks.map(scriptCounts)
  const originalIndex = counts.reduce((best, current, index) => {
    const bestScore = counts[best]!.kana * 3 + counts[best]!.han
    const currentScore = current.kana * 3 + current.han
    return currentScore > bestScore ? index : best
  }, 0)
  if (counts[originalIndex]!.kana < 3) return undefined

  const base = tracks[originalIndex]!.map((line) => ({ ...line }))
  let translationIndex = -1
  let romajiIndex = -1
  for (let index = 0; index < tracks.length; index += 1) {
    if (index === originalIndex || overlapRatio(base, tracks[index]!) < 0.3) continue
    const count = counts[index]!
    if (count.kana <= Math.max(2, count.han * 0.03) && count.han >= 6) {
      if (translationIndex < 0 || count.han > counts[translationIndex]!.han) translationIndex = index
    } else if (count.kana === 0 && count.han === 0 && count.latin >= 12) {
      if (romajiIndex < 0 || count.latin > counts[romajiIndex]!.latin) romajiIndex = index
    }
  }
  if (translationIndex < 0 && romajiIndex < 0) return undefined
  if (translationIndex >= 0) mergeTrackAtTimes(base, tracks[translationIndex]!, 'translatedText')
  if (romajiIndex >= 0) mergeTrackAtTimes(base, tracks[romajiIndex]!, 'romajiText')
  base.sort((left, right) => (left.startMs ?? 0) - (right.startMs ?? 0))
  return completeEndTimes(base.map((line, lineIndex) => ({ ...line, lineIndex })))
}

function parseSrtTimestamp(value: string): number | undefined {
  const match = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/)
  if (!match) return undefined
  return Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1_000 + Number(match[4])
}

export function parseSrt(content: string): ParsedLyricLine[] {
  const lines: ParsedLyricLine[] = []
  const blocks = content.replace(/^\uFEFF/, '').trim().split(/\r?\n\s*\r?\n/)
  for (const block of blocks) {
    const parts = block.split(/\r?\n/)
    const timingIndex = parts.findIndex((part) => part.includes('-->'))
    if (timingIndex < 0) continue
    const [start, end] = parts[timingIndex]!.split('-->')
    const startMs = start ? parseSrtTimestamp(start) : undefined
    const endMs = end ? parseSrtTimestamp(end) : undefined
    const text = parts.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    if (!text) continue
    lines.push({ lineIndex: lines.length, ...(startMs !== undefined ? { startMs } : {}), ...(endMs !== undefined ? { endMs } : {}), ...splitTranslation(text) })
  }
  return lines
}

export function parseLyrics(content: string, filename = ''): ParsedLyricLine[] {
  const extension = filename.toLowerCase().split('.').pop()
  if (extension === 'srt' || content.includes('-->')) return parseSrt(content)
  const multilingual = parseMultilingualLrc(content)
  if (multilingual) return multilingual
  const lrc = parseLrc(content)
  if (lrc.length > 0) return lrc
  return content.replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, lineIndex) => ({ lineIndex, ...splitTranslation(text) }))
}
