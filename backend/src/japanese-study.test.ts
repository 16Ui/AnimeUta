import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JapaneseStudyAnalyzer, TomoshiDictionary } from './japanese-study.js'
import type { LlmClient } from './llm.js'

const directories: string[] = []

function dictionaryFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'animeuta-tomoshi-'))
  directories.push(directory)
  const path = join(directory, 'tomoshi.db')
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE entries(id TEXT PRIMARY KEY, is_common INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE forms(text TEXT NOT NULL, entry_id TEXT NOT NULL, is_kana INTEGER NOT NULL, is_common INTEGER NOT NULL);
  `)
  database.prepare("INSERT INTO meta VALUES ('exported_at', 'fixture-v1')").run()
  const insertEntry = database.prepare('INSERT INTO entries VALUES (?, ?, ?)')
  const insertForm = database.prepare('INSERT INTO forms VALUES (?, ?, ?, ?)')
  const add = (id: string, forms: string[], kana: string, senses: Array<{ pos: string[]; meaning: string }>, common = 1) => {
    insertEntry.run(id, common, JSON.stringify({
      id,
      is_common: Boolean(common),
      kanji: forms.filter((form) => form !== kana).map((text) => ({ text, priority: common ? ['ichi1'] : [] })),
      kana: [{ text: kana, priority: common ? ['ichi1'] : [], restricted_to: [] }],
      senses: senses.map((sense) => ({ pos: sense.pos, glosses: [{ text: sense.meaning, lang: 'zho' }] })),
    }))
    for (const form of [...forms, kana]) insertForm.run(form, id, form === kana ? 1 : 0, common)
  }
  add('1', ['音楽'], 'おんがく', [{ pos: ['noun (common) (futsuumeishi)'], meaning: '音乐' }])
  add('2', ['君'], 'きみ', [{ pos: ['pronoun'], meaning: '你' }])
  add('3', ['君'], 'くん', [{ pos: ['suffix'], meaning: '君（称谓）' }])
  add('4', ['聴く'], 'きく', [{ pos: ['Godan verb with ku ending'], meaning: '听' }])
  add('5', ['走る'], 'はしる', [
    { pos: ['Godan verb with ru ending'], meaning: '跑' },
    { pos: ['Godan verb with ru ending'], meaning: '行驶' },
  ])
  database.close()
  return path
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('JapaneseStudyAnalyzer', () => {
  it('does not generate romaji for a pure English lyric line', async () => {
    const analyzer = new JapaneseStudyAnalyzer()
    const [line] = await analyzer.annotateLines([{ lineIndex: 0, text: "Don't worry & be happy!" }])

    expect(line?.romaji).toBe('')
    expect(line?.ruby).toEqual([{ text: "Don't worry & be happy!" }])
    analyzer.close()
  })

  it('keeps the full inflected word under its complete reading', async () => {
    const analyzer = new JapaneseStudyAnalyzer()
    const [line] = await analyzer.annotateLines([{ lineIndex: 0, text: '暗い部屋で紡ぐ音の調べ' }])

    expect(line?.ruby).toEqual([
      { text: '暗い', ruby: 'くらい' },
      { text: '部屋', ruby: 'へや' },
      { text: 'で' },
      { text: '紡ぐ', ruby: 'つむぐ' },
      { text: '音', ruby: 'おと' },
      { text: 'の' },
      { text: '調べ', ruby: 'しらべ' },
    ])
    analyzer.close()
  })

  it('normalizes simplified and old glyphs only when resolving missing readings', async () => {
    const analyzer = new JapaneseStudyAnalyzer()
    const [line] = await analyzer.annotateLines([{ lineIndex: 0, text: '淚拭う 仆は绮丽な梦を見る' }])

    expect(line?.ruby.find((segment) => segment.text === '淚')).toMatchObject({ ruby: 'なみだ' })
    expect(line?.ruby.find((segment) => segment.text === '仆')).toMatchObject({ ruby: 'ぼく' })
    expect(line?.ruby.some((segment) => segment.text.includes('绮') && segment.ruby)).toBe(true)
    analyzer.close()
  })

  it('turns embedded parenthetical readings into ruby without duplicating the kana', async () => {
    const analyzer = new JapaneseStudyAnalyzer()
    const [line] = await analyzer.annotateLines([{ lineIndex: 0, text: '疲（つか）れちゃう' }])

    expect(line?.ruby).toEqual([{ text: '疲', ruby: 'つか' }, { text: 'れちゃう' }])
    analyzer.close()
  })

  it('uses Kuromoji basic forms and resolves Tomoshi entries by reading and part of speech', async () => {
    const analyzer = new JapaneseStudyAnalyzer(new TomoshiDictionary(dictionaryFixture()))
    try {
      const result = await analyzer.analyze([{ id: 1, lineIndex: 0, originalText: '君は音楽を聴いた', translatedText: '你听了音乐' }])
      expect(result.dictionaryAvailable).toBe(true)
      expect(result.dictionaryVersion).toBe('fixture-v1')
      expect(result.lines[0]?.tokens.find((token) => token.surface === '君')).toMatchObject({
        lemma: '君', reading: 'きみ', romaji: 'kimi', meaningZh: '你', dictionaryEntryId: '2', resolutionStatus: 'resolved',
      })
      expect(result.lines[0]?.tokens.find((token) => token.surface === '音楽')).toMatchObject({
        lemma: '音楽', reading: 'おんがく', romaji: 'ongaku', meaningZh: '音乐', source: 'tomoshi',
      })
      expect(result.lines[0]?.tokens.find((token) => token.surface === '聴い')).toMatchObject({
        lemma: '聴く', writing: '聴く', reading: 'きく', surfaceReadingKatakana: 'キイ', meaningZh: '听', partOfSpeech: expect.stringContaining('动词'),
      })
    } finally {
      analyzer.close()
    }
  })

  it('calls the LLM only to select an ambiguous dictionary sense', async () => {
    const chatJson = vi.fn().mockImplementation((_system: string, input: { items: Array<{ key: string; lemma: string }> }) => Promise.resolve({
      items: [{ key: input.items.find((item) => item.lemma === '走る')?.key, entryId: '5', senseIndex: 1 }],
    }))
    const llm = { isConfigured: () => true, chatJson } as unknown as LlmClient
    const analyzer = new JapaneseStudyAnalyzer(new TomoshiDictionary(dictionaryFixture()), llm)
    try {
      const result = await analyzer.analyze([{ id: 1, lineIndex: 0, originalText: '電車が走る', translatedText: '电车行驶' }])
      const token = result.lines[0]?.tokens.find((item) => item.lemma === '走る')
      expect(token).toMatchObject({ dictionaryEntryId: '5', selectedSenseIndex: 1, meaningZh: '行驶', source: 'llm_fallback', resolutionStatus: 'resolved' })
      expect(chatJson).toHaveBeenCalledOnce()
      const llmInput = chatJson.mock.calls[0]?.[1] as { items: Array<{ lemma: string }> }
      expect(llmInput.items.some((item) => item.lemma === '走る')).toBe(true)
      expect(llmInput.items.some((item) => item.lemma === '電車')).toBe(true)
      expect(result.llmResolved).toBe(1)
    } finally {
      analyzer.close()
    }
  })

  it('uses Kuromoji grammar details for particles and dependent forms', async () => {
    const analyzer = new JapaneseStudyAnalyzer(new TomoshiDictionary())
    try {
      const result = await analyzer.analyze([{
        id: 1,
        lineIndex: 0,
        originalText: '目を閉じて、君の手も握ってるんだ。好きなことを忘れないで',
        translatedText: '闭上眼睛，也正握着你的手。不要忘记喜欢的事',
      }])
      const tokens = result.lines[0]?.tokens ?? []
      expect(tokens.find((token) => token.surface === 'て')?.meaningZh).toContain('连接前后')
      expect(tokens.find((token) => token.surface === 'も')?.meaningZh).toContain('也')
      expect(tokens.find((token) => token.surface === 'てる')?.meaningZh).toContain('ている')
      expect(tokens.find((token) => token.surface === 'ん')?.meaningZh).toContain('形式名词')
      expect(tokens.find((token) => token.surface === 'こと')?.meaningZh).toContain('事情')
      expect(tokens.find((token) => token.surface === 'で')?.meaningZh).toContain('请不要')
      expect(tokens.filter((token) => ['て', 'も', 'てる', 'ん', 'こと', 'で'].includes(token.surface))
        .every((token) => token.resolutionStatus === 'resolved')).toBe(true)
    } finally {
      analyzer.close()
    }
  })

  it('does not create duplicate study words from embedded parenthetical readings', async () => {
    const analyzer = new JapaneseStudyAnalyzer(new TomoshiDictionary(dictionaryFixture()))
    try {
      const result = await analyzer.analyze([{ id: 1, lineIndex: 0, originalText: '未来（みらい）まで' }])
      const surfaces = result.lines[0]?.tokens.map((token) => token.surface)
      expect(surfaces).not.toContain('みらい')
      expect(surfaces).not.toContain('み')
      expect(surfaces).not.toContain('らい')
      expect(surfaces).toContain('未来')
    } finally {
      analyzer.close()
    }
  })
})
