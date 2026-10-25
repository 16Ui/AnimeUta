import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji'
import OpenCC from 'opencc-js'
import { toHiragana, toKatakana, toRomaji } from 'wanakana'
import type { LlmClient } from './llm.js'

interface TomoshiSense {
  pos?: string[]
  glosses?: Array<{ text?: string; lang?: string }>
}

interface TomoshiEntry {
  id: string
  is_common?: boolean
  kanji?: Array<{ text: string; priority?: string[] }>
  kana?: Array<{ text: string; priority?: string[]; restricted_to?: string[] }>
  senses?: TomoshiSense[]
}

interface DictionaryRow {
  matched_form: string
  id: string
  is_common: number
  data: string
}

interface DictionaryCandidate {
  entry: TomoshiEntry
  score: number
  reading: string
  senseIndexes: number[]
  posMatched: boolean
}

export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1'

export interface JlptReference {
  available: boolean
  totals: Record<JlptLevel, number>
  source: string
  license: string
  attribution: string
}

export interface StudySourceLine {
  id: number
  lineIndex: number
  originalText: string
  translatedText?: string
  startMs?: number
  endMs?: number
}

export interface AnalyzedStudyToken {
  surface: string
  lemma: string
  writing: string
  reading: string
  readingKatakana: string
  surfaceReadingKatakana: string
  romaji: string
  partOfSpeech: string
  conjugatedType: string
  conjugatedForm: string
  meaningZh: string
  startOffset: number
  endOffset: number
  dictionarySource?: string
  dictionaryEntryId?: string
  selectedSenseIndex?: number
  resolutionStatus: 'resolved' | 'ambiguous' | 'unresolved'
  source: 'tomoshi' | 'llm_fallback' | 'kuromoji'
}

export interface AnalyzedStudyLine extends StudySourceLine {
  tokens: AnalyzedStudyToken[]
}

export interface StudyAnalysisResult {
  lines: AnalyzedStudyLine[]
  dictionaryAvailable: boolean
  dictionaryVersion?: string
  resolved: number
  llmResolved: number
  unresolved: number
  llmFallbackError?: string
}

export interface GeneratedLyricReading {
  lineIndex: number
  romaji: string
  ruby: Array<{ text: string; ruby?: string }>
}

const japanesePattern = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u
const hanPattern = /\p{Script=Han}/u
const toJapaneseShinjitai = OpenCC.Converter({ from: 'cn', to: 'jp' })
const fallbackKanjiReadings: Record<string, string> = {
  '迴': 'まわ', '剥': 'は', '騒': 'さわ', '戯': 'ぎ', '占': 'し', '携': 'けい', '晒': 'さら',
  '捉': 'つか', '蕩': 'たゆた', '嗤': 'わら', '癒': 'い', '泣': 'な', '囁': 'ささや',
  '砕': 'くだ', '滲': 'にじ', '励': 'はげ', '謳': 'うた', '遊戯': 'ゆうぎ', '旋回': 'せんかい',
  '痒': 'かゆ', '聴': 'き', '聞': 'き', '疲': 'つか', '壊': 'こわ', '吐': 'つ',
}
const kuromojiDictionaryPath = fileURLToPath(new URL('../node_modules/kuromoji/dict/', import.meta.url))
const posLabels: Record<string, string> = {
  '名詞': '名词', '動詞': '动词', '形容詞': '形容词', '副詞': '副词', '助詞': '助词',
  '助動詞': '助动词', '連体詞': '连体词', '接続詞': '接续词', '感動詞': '感叹词',
  '接頭詞': '接头词', 'フィラー': '填充词', 'その他': '其他',
}
const posNeedles: Record<string, string[]> = {
  '名詞': ['noun', 'pronoun', 'counter'],
  '動詞': ['verb'],
  '形容詞': ['adjective'],
  '副詞': ['adverb'],
  '助詞': ['particle'],
  '助動詞': ['auxiliary'],
  '連体詞': ['pre-noun'],
  '接続詞': ['conjunction'],
  '感動詞': ['interjection'],
  '接頭詞': ['prefix'],
}

function buildTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: kuromojiDictionaryPath }).build((error, tokenizer) => {
      if (error) reject(error)
      else resolve(tokenizer)
    })
  })
}

function normalizedReading(value: string | undefined): string {
  return value ? toHiragana(value) : ''
}

function convertedTokenReading(tokenizer: Tokenizer<IpadicFeatures>, surface: string): string {
  if (!hanPattern.test(surface)) return ''
  const normalized = toJapaneseShinjitai(surface)
  if (normalized === surface) return ''
  const tokens = tokenizer.tokenize(normalized)
  if (!tokens.length || tokens.some((token) => japanesePattern.test(token.surface_form) && !token.reading)) return ''
  return normalizedReading(tokens.map((token) => token.reading ?? '').join(''))
}

function displayPartOfSpeech(token: IpadicFeatures): string {
  const label = posLabels[token.pos] ?? token.pos
  return token.pos_detail_1 && token.pos_detail_1 !== '*' ? `${label} · ${token.pos_detail_1}` : label
}

function grammarMeaning(token: IpadicFeatures): string | undefined {
  const surface = token.surface_form
  const lemma = token.basic_form === '*' ? surface : token.basic_form
  const detail = token.pos_detail_1 ?? ''

  if (token.pos === '助詞') {
    const meanings: Record<string, string> = {
      'は': '提示句子主题或形成对比',
      'が': detail === '接続助詞' ? '但是；表示转折' : '标记句子的主语或对象',
      'を': '标记动作的对象或经过的场所',
      'に': '表示时间、地点、对象、方向或结果',
      'へ': '表示动作的方向；向、朝',
      'の': '的；表示所属、修饰或名词化',
      'と': '和、与；也可标记引用内容',
      'も': '也；还；连……也',
      'て': '连接前后动作或状态，表示顺接、方式或原因',
      'で': '格助词时表示动作地点、方式、手段或原因；接续助词时连接后项，在「ないで」中表示“不……地／请不要……”',
      'から': detail === '接続助詞' ? '因为；由于' : '从；由；表示起点或来源',
      'まで': '到……为止；直到',
      'や': '……和……等；表示不完全列举',
      'か': '表示疑问或不确定；接疑问词后表示“某……”',
      'よ': '表示告知、强调或提醒',
      'ね': '表示确认、征求同意或感叹',
      'だけ': '只；仅仅；表示限定',
      'しか': '只有；仅（后接否定）',
      'ほど': '程度达到……；越……越……',
      'より': '比；较；从',
    }
    return meanings[surface] ?? meanings[lemma]
  }

  if (token.pos === '助動詞') {
    if (token.conjugated_type?.includes('特殊・タ')) return '表示过去或动作已完成'
    if (surface === 'な' && lemma === 'だ') return '连接形容动词和名词，相当于“……的”'
    const meanings: Record<string, string> = {
      'ない': '表示否定；不……、没有……',
      'ます': '表示礼貌语气',
      'たい': '表示愿望；想要……',
      'だ': '判断助动词，相当于“是”；也可表示解释或强调',
      'です': '判断助动词「だ」的礼貌形',
    }
    return meanings[lemma]
  }

  if (token.pos === '動詞' && detail === '非自立' && (surface === 'てる' || lemma === 'てる')) {
    return '「ている」的口语缩约，表示动作正在进行或状态持续'
  }
  if (token.pos === '名詞' && detail === '非自立' && surface === 'ん') {
    return '形式名词，相当于「の」；在「んだ」中表示解释或强调'
  }
  if (token.pos === '名詞' && detail === '非自立' && surface === 'こと') {
    return '事情；内容；也作形式名词将前面的句子名词化'
  }
  if (token.pos === '名詞' && detail === '接尾' && surface === 'さ') {
    return '表示程度或性质，将形容词名词化'
  }
  return undefined
}

function embeddedReadingRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const pattern = /[\p{Script=Han}々〆ヵヶ]+[（(]([\p{Script=Hiragana}\p{Script=Katakana}ー・]+)[）)]/gu
  for (const match of text.matchAll(pattern)) {
    const reading = match[1]
    const full = match[0]
    const matchStart = match.index
    if (!reading || matchStart === undefined) continue
    const readingStart = matchStart + full.indexOf(reading)
    ranges.push({ start: readingStart, end: readingStart + reading.length })
  }
  return ranges
}

function applyEmbeddedReadings(segments: Array<{ text: string; ruby?: string }>, source: string): Array<{ text: string; ruby?: string }> {
  const matches = [...source.matchAll(/([\p{Script=Han}々〆ヵヶ]+)[（(]([\p{Script=Hiragana}\p{Script=Katakana}ー・]+)[）)]/gu)]
  if (!matches.length) return segments

  let result = segments
  let removedLength = 0
  for (const match of matches) {
    if (match.index === undefined || !match[1] || !match[2]) continue
    const start = match.index - removedLength
    const end = start + match[0].length
    const next: Array<{ text: string; ruby?: string }> = []
    let offset = 0
    let inserted = false
    for (const segment of result) {
      const segmentStart = offset
      const segmentEnd = offset + segment.text.length
      if (segmentEnd <= start || segmentStart >= end) {
        next.push(segment)
      } else {
        if (segmentStart < start) next.push({ text: segment.text.slice(0, start - segmentStart), ...(segment.ruby ? { ruby: segment.ruby } : {}) })
        if (!inserted) {
          next.push({ text: match[1], ruby: toHiragana(match[2]) })
          inserted = true
        }
        if (segmentEnd > end) next.push({ text: segment.text.slice(end - segmentStart), ...(segment.ruby ? { ruby: segment.ruby } : {}) })
      }
      offset = segmentEnd
    }
    result = next.filter((segment) => segment.text)
    removedLength += match[0].length - match[1].length
  }
  return result
}

function senseMatchesPos(sense: TomoshiSense, kuromojiPos: string): boolean {
  const needles = posNeedles[kuromojiPos]
  if (!needles?.length) return true
  const value = (sense.pos ?? []).join(' ').toLowerCase()
  return needles.some((needle) => value.includes(needle))
}

function senseMeaning(sense: TomoshiSense | undefined): string {
  if (!sense) return ''
  const chinese = (sense.glosses ?? []).filter((gloss) => gloss.lang === 'zho' && gloss.text).map((gloss) => gloss.text)
  return [...new Set(chinese)].join('；')
}

function candidateReading(entry: TomoshiEntry, lemma: string, tokenReading: string): string {
  const kana = entry.kana ?? []
  const allowed = kana.filter((item) => !item.restricted_to?.length || item.restricted_to.includes(lemma))
  const pool = allowed.length ? allowed : kana
  const exact = pool.find((item) => normalizedReading(item.text) === normalizedReading(tokenReading))
  const prioritized = pool.find((item) => item.priority?.length)
  return normalizedReading(exact?.text ?? prioritized?.text ?? pool[0]?.text)
}

export class TomoshiDictionary {
  private readonly database?: DatabaseSync
  private readonly jlptLevelCache = new Map<string, JlptLevel | null>()
  private jlptReferenceCache?: JlptReference
  readonly version: string | undefined

  constructor(readonly path?: string) {
    if (!path || !existsSync(path)) return
    this.database = new DatabaseSync(path, { readOnly: true })
    this.database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;')
    const metadata = this.database.prepare("SELECT value FROM meta WHERE key = 'exported_at'").get() as { value: string } | undefined
    this.version = metadata?.value
  }

  get available(): boolean {
    return Boolean(this.database)
  }

  close(): void {
    this.database?.close()
  }

  jlptLevels(entryIds: string[]): Map<string, JlptLevel> {
    const result = new Map<string, JlptLevel>()
    if (!this.database) return result
    const uniqueIds = [...new Set(entryIds.filter(Boolean))]
    const missing = uniqueIds.filter((id) => !this.jlptLevelCache.has(id))
    for (let offset = 0; offset < missing.length; offset += 400) {
      const chunk = missing.slice(offset, offset + 400)
      const placeholders = chunk.map(() => '?').join(', ')
      for (const id of chunk) this.jlptLevelCache.set(id, null)
      const rows = this.database.prepare(`
        SELECT entry_id, level FROM vocab_jlpt WHERE entry_id IN (${placeholders})
      `).all(...chunk) as unknown as Array<{ entry_id: string; level: JlptLevel }>
      for (const row of rows) this.jlptLevelCache.set(row.entry_id, row.level)
    }
    for (const id of uniqueIds) {
      const level = this.jlptLevelCache.get(id)
      if (level) result.set(id, level)
    }
    return result
  }

  jlptReference(): JlptReference {
    if (this.jlptReferenceCache) return this.jlptReferenceCache
    const emptyTotals: Record<JlptLevel, number> = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0 }
    if (!this.database) return { available: false, totals: emptyTotals, source: '', license: '', attribution: '' }
    const totals = { ...emptyTotals }
    const rows = this.database.prepare('SELECT level, count(*) AS total FROM vocab_jlpt GROUP BY level')
      .all() as unknown as Array<{ level: JlptLevel; total: number }>
    for (const row of rows) totals[row.level] = Number(row.total)
    const license = this.database.prepare("SELECT license, attribution FROM table_licenses WHERE table_name = 'vocab_jlpt'")
      .get() as { license: string; attribution: string } | undefined
    this.jlptReferenceCache = {
      available: true,
      totals,
      source: 'yomitan-jlpt-vocab',
      license: license?.license ?? 'CC-BY-SA-4.0',
      attribution: license?.attribution ?? '',
    }
    return this.jlptReferenceCache
  }

  candidates(tokens: IpadicFeatures[]): Map<IpadicFeatures, DictionaryCandidate[]> {
    const result = new Map<IpadicFeatures, DictionaryCandidate[]>()
    if (!this.database || tokens.length === 0) return result
    const forms = [...new Set(tokens.flatMap((token) => [token.basic_form === '*' ? token.surface_form : token.basic_form, token.surface_form]).filter(Boolean))]
    const entriesByForm = new Map<string, TomoshiEntry[]>()
    for (let offset = 0; offset < forms.length; offset += 400) {
      const chunk = forms.slice(offset, offset + 400)
      const placeholders = chunk.map(() => '?').join(', ')
      const rows = this.database.prepare(`
        SELECT f.text AS matched_form, e.id, e.is_common, e.data
        FROM forms f JOIN entries e ON e.id = f.entry_id
        WHERE f.text IN (${placeholders})
      `).all(...chunk) as unknown as DictionaryRow[]
      for (const row of rows) {
        try {
          const entry = JSON.parse(row.data) as TomoshiEntry
          entry.is_common = Boolean(row.is_common)
          const list = entriesByForm.get(row.matched_form) ?? []
          if (!list.some((item) => item.id === entry.id)) list.push(entry)
          entriesByForm.set(row.matched_form, list)
        } catch {
          // A malformed third-party entry is treated as a dictionary miss.
        }
      }
    }
    for (const token of tokens) {
      const lemma = token.basic_form === '*' ? token.surface_form : token.basic_form
      const unique = new Map<string, TomoshiEntry>()
      for (const entry of [...(entriesByForm.get(lemma) ?? []), ...(entriesByForm.get(token.surface_form) ?? [])]) unique.set(entry.id, entry)
      const candidates = [...unique.values()].map((entry): DictionaryCandidate => {
        const reading = candidateReading(entry, lemma, token.reading ?? '')
        const matchingSenses = (entry.senses ?? []).map((sense, index) => ({ sense, index })).filter(({ sense }) => senseMatchesPos(sense, token.pos)).map(({ index }) => index)
        const senseIndexes = matchingSenses.length ? matchingSenses : (entry.senses ?? []).map((_, index) => index)
        let score = entry.is_common ? 2 : 0
        if ((entry.kanji ?? []).some((form) => form.text === lemma) || (entry.kana ?? []).some((form) => form.text === lemma)) score += 5
        if (token.surface_form === lemma && reading === normalizedReading(token.reading)) score += 5
        if (matchingSenses.length) score += 5
        else if (posNeedles[token.pos]?.length) score -= 8
        return { entry, score, reading, senseIndexes, posMatched: matchingSenses.length > 0 }
      }).sort((left, right) => right.score - left.score || Number(left.entry.id) - Number(right.entry.id))
      result.set(token, candidates)
    }
    return result
  }
}

export class JapaneseStudyAnalyzer {
  private readonly tokenizerPromise = buildTokenizer()

  constructor(
    private readonly dictionary = new TomoshiDictionary(),
    private readonly llm?: LlmClient,
  ) {}

  close(): void {
    this.dictionary.close()
  }

  jlptLevels(entryIds: string[]): Map<string, JlptLevel> {
    return this.dictionary.jlptLevels(entryIds)
  }

  jlptReference(): JlptReference {
    return this.dictionary.jlptReference()
  }

  async annotateLines(lines: Array<{ lineIndex: number; text: string }>): Promise<GeneratedLyricReading[]> {
    const tokenizer = await this.tokenizerPromise
    const tokenized = lines.map((line) => ({
      line,
      tokens: japanesePattern.test(line.text)
        ? tokenizer.tokenize((() => {
            const normalized = toJapaneseShinjitai(line.text)
            return normalized.length === line.text.length ? normalized : line.text
          })())
        : [],
    }))
    const candidates = this.dictionary.candidates(tokenized.flatMap((item) => item.tokens))
    return tokenized.map(({ line, tokens }) => {
      if (!japanesePattern.test(line.text)) {
        return { lineIndex: line.lineIndex, romaji: '', ruby: [{ text: line.text }] }
      }
      const readingRanges = embeddedReadingRanges(line.text)
      const ruby: Array<{ text: string; ruby?: string }> = []
      const romaji: string[] = []
      let cursor = 0
      const appendPlain = (text: string) => {
        if (!text) return
        const previous = ruby.at(-1)
        if (previous && !previous.ruby) previous.text += text
        else ruby.push({ text })
      }
      for (const token of tokens) {
        const start = Math.max(0, token.word_position - 1)
        const end = start + token.surface_form.length
        const sourceSurface = line.text.slice(start, end) || token.surface_form
        appendPlain(line.text.slice(cursor, start))
        const insideEmbeddedReading = readingRanges.some((range) => start >= range.start && start < range.end)
        const reading = normalizedReading(token.reading)
          || candidates.get(token)?.find((candidate) => candidate.reading)?.reading
          || convertedTokenReading(tokenizer, token.surface_form)
          || fallbackKanjiReadings[sourceSurface]
          || ''
        if (reading && /\p{Script=Han}/u.test(sourceSurface) && !insideEmbeddedReading) {
          ruby.push({ text: sourceSurface, ruby: reading })
        } else {
          appendPlain(sourceSurface)
        }
        if (!insideEmbeddedReading) {
          if (reading && japanesePattern.test(sourceSurface)) romaji.push(toRomaji(reading))
          else if (/\p{Script=Latin}|\d/u.test(sourceSurface)) romaji.push(sourceSurface)
        }
        cursor = end
      }
      appendPlain(line.text.slice(cursor))
      return {
        lineIndex: line.lineIndex,
        romaji: romaji.join(' ').replace(/\s+/g, ' ').trim(),
        ruby: applyEmbeddedReadings(ruby, line.text),
      }
    })
  }

  async analyze(lines: StudySourceLine[]): Promise<StudyAnalysisResult> {
    const tokenizer = await this.tokenizerPromise
    const tokenized = lines.map((line) => {
      const readingRanges = embeddedReadingRanges(line.originalText)
      const tokens = tokenizer.tokenize(line.originalText).filter((token) => {
        if (token.pos === '記号' || !japanesePattern.test(token.surface_form)) return false
        const start = Math.max(0, token.word_position - 1)
        return !readingRanges.some((range) => start >= range.start && start < range.end)
      })
      return { line, tokens }
    })
    const allTokens = tokenized.flatMap((item) => item.tokens)
    const candidates = this.dictionary.candidates(allTokens)
    const analyzed: AnalyzedStudyLine[] = tokenized.map(({ line, tokens }) => ({
      ...line,
      tokens: tokens.map((token) => this.resolveLocally(token, candidates.get(token) ?? [])),
    }))
    const fallbackTargets = analyzed.flatMap((line) => line.tokens.map((token, tokenIndex) => ({ line, token, tokenIndex }))).filter(({ token }) => token.resolutionStatus !== 'resolved')
    let llmFallbackError: string | undefined
    if (fallbackTargets.length && this.llm?.isConfigured()) {
      try {
        await this.resolveWithLlm(fallbackTargets, candidates, tokenized)
      } catch (error) {
        llmFallbackError = error instanceof Error ? error.message : String(error)
      }
    }
    const flat = analyzed.flatMap((line) => line.tokens)
    return {
      lines: analyzed,
      dictionaryAvailable: this.dictionary.available,
      ...(this.dictionary.version ? { dictionaryVersion: this.dictionary.version } : {}),
      resolved: flat.filter((token) => token.source === 'tomoshi' && token.resolutionStatus === 'resolved').length,
      llmResolved: flat.filter((token) => token.source === 'llm_fallback').length,
      unresolved: flat.filter((token) => token.resolutionStatus !== 'resolved').length,
      ...(llmFallbackError ? { llmFallbackError } : {}),
    }
  }

  private resolveLocally(token: IpadicFeatures, candidates: DictionaryCandidate[]): AnalyzedStudyToken {
    const lemma = token.basic_form === '*' ? token.surface_form : token.basic_form
    const grammar = grammarMeaning(token)
    const top = candidates[0]
    const tiedEntries = top ? candidates.filter((candidate) => candidate.score === top.score) : []
    const senseIndex = top?.senseIndexes[0]
    const unambiguous = Boolean(top && tiedEntries.length === 1 && top.senseIndexes.length === 1)
    const reading = top?.reading || normalizedReading(token.reading) || normalizedReading(lemma)
    const startOffset = Math.max(0, token.word_position - 1)
    return {
      surface: token.surface_form,
      lemma,
      writing: lemma,
      reading,
      readingKatakana: reading ? toKatakana(reading) : '',
      surfaceReadingKatakana: token.reading ?? '',
      romaji: reading ? toRomaji(reading) : '',
      partOfSpeech: displayPartOfSpeech(token),
      conjugatedType: token.conjugated_type === '*' ? '' : token.conjugated_type,
      conjugatedForm: token.conjugated_form === '*' ? '' : token.conjugated_form,
      meaningZh: grammar ?? senseMeaning(top?.entry.senses?.[senseIndex ?? -1]),
      startOffset,
      endOffset: startOffset + token.surface_form.length,
      ...(!grammar && top ? { dictionarySource: 'tomoshi', dictionaryEntryId: top.entry.id } : {}),
      ...(!grammar && senseIndex !== undefined ? { selectedSenseIndex: senseIndex } : {}),
      resolutionStatus: grammar || unambiguous ? 'resolved' : top ? 'ambiguous' : 'unresolved',
      source: grammar ? 'kuromoji' : top ? 'tomoshi' : 'kuromoji',
    }
  }

  private async resolveWithLlm(
    targets: Array<{ line: AnalyzedStudyLine; token: AnalyzedStudyToken; tokenIndex: number }>,
    dictionaryCandidates: Map<IpadicFeatures, DictionaryCandidate[]>,
    tokenized: Array<{ line: StudySourceLine; tokens: IpadicFeatures[] }>,
  ): Promise<void> {
    const sourceTokenByKey = new Map<string, IpadicFeatures>()
    const input = targets.map(({ line, token, tokenIndex }) => {
      const key = `${line.lineIndex}:${tokenIndex}`
      const sourceToken = tokenized.find((item) => item.line.lineIndex === line.lineIndex)?.tokens[tokenIndex]
      if (sourceToken) sourceTokenByKey.set(key, sourceToken)
      return {
        key,
        sentence: line.originalText,
        translation: line.translatedText ?? '',
        surface: token.surface,
        lemma: token.lemma,
        reading: token.reading,
        partOfSpeech: token.partOfSpeech,
        candidates: (sourceToken ? dictionaryCandidates.get(sourceToken) ?? [] : []).slice(0, 8).flatMap((candidate) => candidate.senseIndexes.slice(0, 12).map((senseIndex) => ({
          entryId: candidate.entry.id,
          senseIndex,
          reading: candidate.reading,
          partOfSpeech: candidate.entry.senses?.[senseIndex]?.pos ?? [],
          meaningZh: senseMeaning(candidate.entry.senses?.[senseIndex]),
        }))),
      }
    })
    const output = await this.llm!.chatJson(
      'Resolve only the supplied unresolved Japanese lyric tokens. If candidates exist, choose one supplied entryId and senseIndex using sentence context; never invent an ID. If candidates are empty, provide dictionary-form hiragana reading, concise Simplified-Chinese meaning, and Chinese part of speech. Schema: {"items":[{"key":"0:0","entryId":"123","senseIndex":0,"reading":"たべる","meaningZh":"吃","partOfSpeech":"动词"}]}',
      { items: input },
    )
    if (!Array.isArray(output.items)) throw new Error('AI 词义判定结果缺少 items 数组')
    const targetByKey = new Map(targets.map((target) => [`${target.line.lineIndex}:${target.tokenIndex}`, target]))
    for (const raw of output.items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const value = raw as Record<string, unknown>
      const target = targetByKey.get(String(value.key))
      if (!target) continue
      const sourceToken = sourceTokenByKey.get(String(value.key))
      const options = sourceToken ? dictionaryCandidates.get(sourceToken) ?? [] : []
      if (options.length) {
        const selected = options.find((candidate) => candidate.entry.id === String(value.entryId) && candidate.senseIndexes.includes(Number(value.senseIndex)))
        if (!selected) continue
        const senseIndex = Number(value.senseIndex)
        target.token.dictionaryEntryId = selected.entry.id
        target.token.selectedSenseIndex = senseIndex
        target.token.reading = selected.reading
        target.token.readingKatakana = selected.reading ? toKatakana(selected.reading) : target.token.readingKatakana
        target.token.romaji = toRomaji(selected.reading)
        target.token.meaningZh = senseMeaning(selected.entry.senses?.[senseIndex])
      } else {
        if (typeof value.reading === 'string' && value.reading.trim()) target.token.reading = toHiragana(value.reading.trim())
        if (typeof value.meaningZh === 'string' && value.meaningZh.trim()) target.token.meaningZh = value.meaningZh.trim()
        if (typeof value.partOfSpeech === 'string' && value.partOfSpeech.trim()) target.token.partOfSpeech = value.partOfSpeech.trim()
        target.token.romaji = target.token.reading ? toRomaji(target.token.reading) : target.token.romaji
        target.token.readingKatakana = target.token.reading ? toKatakana(target.token.reading) : target.token.readingKatakana
      }
      if (!target.token.meaningZh) continue
      target.token.resolutionStatus = 'resolved'
      target.token.source = 'llm_fallback'
    }
  }
}
