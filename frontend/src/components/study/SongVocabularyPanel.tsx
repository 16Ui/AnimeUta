import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BookOpenCheck, Check, CheckSquare2, Loader2, Pencil, Plus, Scissors, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { addStudyCardsToDecks, getSongWords, listStudyDecks, tokenizeSong, updateStudyLexeme } from '../../api/study'
import { getApiErrorMessage } from '../../api/error'
import { queryClient } from '../../lib/query-client'
import type { StudyDirection, StudyWord } from '../../types/study'

interface WordDraft {
  writing: string
  reading: string
  romaji: string
  partOfSpeech: string
  meaningZh: string
  meaningEn: string
  exampleJa: string
  exampleZh: string
}

function draftFromWord(word: StudyWord): WordDraft {
  return {
    writing: word.writing,
    reading: word.reading ?? '',
    romaji: word.romaji ?? '',
    partOfSpeech: word.partOfSpeech ?? '',
    meaningZh: word.meaningZh ?? '',
    meaningEn: word.meaningEn ?? '',
    exampleJa: word.exampleJa ?? word.occurrences[0]?.lineText ?? '',
    exampleZh: word.exampleZh ?? word.occurrences[0]?.lineTranslatedText ?? '',
  }
}

export default function SongVocabularyPanel({ songId, lineId, onShowAll }: { songId: number; lineId?: number; onShowAll?: () => void }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deckIds, setDeckIds] = useState<Set<number>>(new Set())
  const [directions, setDirections] = useState<StudyDirection[]>(['ja_zh'])
  const [editingWordId, setEditingWordId] = useState<number | null>(null)
  const [wordDraft, setWordDraft] = useState<WordDraft | null>(null)
  const autoAnalyzeAttemptedRef = useRef(false)
  const wordsQuery = useQuery({ queryKey: ['song-study-words', songId], queryFn: () => getSongWords(songId) })
  const decksQuery = useQuery({ queryKey: ['study-decks'], queryFn: listStudyDecks })
  const allWords = useMemo(() => wordsQuery.data?.words ?? [], [wordsQuery.data])
  const words = useMemo(
    () => lineId === undefined ? allWords : allWords.filter((word) => word.occurrences.some((occurrence) => occurrence.lineId === lineId)),
    [allWords, lineId],
  )
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data])

  useEffect(() => {
    if (deckIds.size === 0 && decks.length > 0) setDeckIds(new Set([decks[0]!.id]))
  }, [deckIds.size, decks])

  const tokenizeMutation = useMutation({
    mutationFn: () => tokenizeSong(songId),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['song-study-words', songId] }),
  })

  useEffect(() => {
    autoAnalyzeAttemptedRef.current = false
  }, [songId])

  useEffect(() => {
    if (lineId === undefined || wordsQuery.isLoading || wordsQuery.isError || allWords.length > 0 || autoAnalyzeAttemptedRef.current) return
    autoAnalyzeAttemptedRef.current = true
    tokenizeMutation.mutate()
  }, [allWords.length, lineId, tokenizeMutation, wordsQuery.isError, wordsQuery.isLoading])
  const addMutation = useMutation({
    mutationFn: () => addStudyCardsToDecks({ deckIds: [...deckIds], lexemeIds: [...selected], songId, directions }),
    onSuccess: async () => {
      setSelected(new Set())
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['study-decks'] }),
        queryClient.invalidateQueries({ queryKey: ['study-today'] }),
      ])
    },
  })
  const editMutation = useMutation({
    mutationFn: () => updateStudyLexeme(editingWordId as number, wordDraft as WordDraft),
    onSuccess: async () => {
      setEditingWordId(null)
      setWordDraft(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['song-study-words', songId] }),
        queryClient.invalidateQueries({ queryKey: ['study-next'] }),
        queryClient.invalidateQueries({ queryKey: ['study-cards'] }),
      ])
    },
  })
  useEffect(() => {
    setSelected(new Set())
    setEditingWordId(null)
    setWordDraft(null)
  }, [lineId])

  const selectedVisibleCount = useMemo(() => words.filter((word) => selected.has(word.id)).length, [selected, words])
  const allSelected = words.length > 0 && selectedVisibleCount === words.length
  const toggleDirection = (direction: StudyDirection) => setDirections((current) => current.includes(direction) ? current.filter((item) => item !== direction) : [...current, direction])
  const toggleDeck = (deckId: number) => setDeckIds((current) => { const next = new Set(current); next.has(deckId) ? next.delete(deckId) : next.add(deckId); return next })

  return (
    <section className="space-y-4 border-y border-white/[0.08] py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="flex items-center gap-2"><BookOpenCheck size={18} className="text-[#ff6b85]" /><h3 className="font-semibold">{t('study.songWords.title')}</h3></div><p className="mt-1 text-sm text-zinc-500">{t('study.songWords.hint')}</p></div>
        <button type="button" disabled={tokenizeMutation.isPending} onClick={() => tokenizeMutation.mutate()} className="inline-flex items-center gap-2 rounded-md bg-white/[0.06] px-3 py-2 text-sm hover:bg-white/[0.1] disabled:opacity-40">{tokenizeMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />}{t(words.length ? 'study.songWords.reanalyze' : 'study.songWords.analyze')}</button>
      </div>
      {wordsQuery.data?.coverage?.available && wordsQuery.data.coverage.classified > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-white/[0.07] py-3 text-xs text-zinc-500">
          <span className="font-medium text-zinc-300">本曲 JLPT 参考词 {wordsQuery.data.coverage.classified} 个</span>
          {wordsQuery.data.coverage.levels.filter((item) => item.covered > 0).map((item) => <span key={item.level}>{item.level} <strong className="text-zinc-300">{item.covered}</strong></span>)}
          {(wordsQuery.data.coverage.unclassified ?? 0) > 0 && <span>N2 范围外或未分级 {wordsQuery.data.coverage.unclassified}</span>}
        </div>
      )}
      {lineId !== undefined && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[#ff6b85]/25 bg-[#ff4d6d]/[0.06] px-3 py-2">
          <span className="text-sm text-zinc-300">{t('study.songWords.selectedLine')}</span>
          {onShowAll && <button type="button" className="text-sm font-medium text-[#ff8ca1] hover:text-white" onClick={onShowAll}>{t('study.songWords.showAll')}</button>}
        </div>
      )}
      {wordsQuery.isLoading && <p className="text-sm text-zinc-500">{t('study.songWords.loading')}</p>}
      {(wordsQuery.isError || tokenizeMutation.isError) && <p className="text-sm text-red-400">{getApiErrorMessage(wordsQuery.error ?? tokenizeMutation.error, t('study.songWords.failed'))}</p>}
      {!wordsQuery.isLoading && words.length === 0 && <p className="py-5 text-center text-sm text-zinc-500">{t(lineId === undefined ? 'study.songWords.empty' : 'study.songWords.emptyLine')}</p>}
      {words.length > 0 && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {words.map((word) => {
              const checked = selected.has(word.id)
              const editing = editingWordId === word.id && wordDraft
              if (editing) return (
                <div key={word.id} data-testid={`study-word-${word.id}`} className="rounded-md border border-[#ff6b85]/40 bg-[#ff4d6d]/5 p-4 sm:col-span-2 lg:col-span-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <WordField label={t('study.songWords.writing')} value={wordDraft.writing} onChange={(value) => setWordDraft({ ...wordDraft, writing: value })} />
                    <WordField label={t('study.songWords.reading')} value={wordDraft.reading} onChange={(value) => setWordDraft({ ...wordDraft, reading: value })} />
                    <WordField label={t('study.songWords.romaji')} value={wordDraft.romaji} onChange={(value) => setWordDraft({ ...wordDraft, romaji: value })} />
                    <WordField label={t('study.songWords.partOfSpeech')} value={wordDraft.partOfSpeech} onChange={(value) => setWordDraft({ ...wordDraft, partOfSpeech: value })} />
                    <WordField label={t('study.songWords.meaningZh')} value={wordDraft.meaningZh} onChange={(value) => setWordDraft({ ...wordDraft, meaningZh: value })} />
                    <WordField label={t('study.songWords.exampleJa')} value={wordDraft.exampleJa} onChange={(value) => setWordDraft({ ...wordDraft, exampleJa: value })} wide />
                    <WordField label={t('study.songWords.exampleZh')} value={wordDraft.exampleZh} onChange={(value) => setWordDraft({ ...wordDraft, exampleZh: value })} />
                  </div>
                  <div className="mt-2 flex justify-end gap-1"><button type="button" title={t('common.cancel')} onClick={() => { setEditingWordId(null); setWordDraft(null) }} className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><X size={15} /></button><button type="button" title={t('common.save')} disabled={!wordDraft.writing.trim() || editMutation.isPending} onClick={() => editMutation.mutate()} className="grid h-8 w-8 place-items-center rounded bg-[#ff4d6d] disabled:opacity-40"><Check size={15} /></button></div>
                </div>
              )
              return (
                <div key={word.id} data-testid={`study-word-${word.id}`} className={`flex min-w-0 items-start gap-2 rounded-md border p-3 ${checked ? 'border-[#ff6b85]/60 bg-[#ff4d6d]/10' : 'border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.05]'}`}>
                  <button type="button" onClick={() => setSelected((current) => { const next = new Set(current); checked ? next.delete(word.id) : next.add(word.id); return next })} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                    {checked ? <CheckSquare2 size={16} className="mt-0.5 shrink-0 text-[#ff6b85]" /> : <Square size={16} className="mt-0.5 shrink-0 text-zinc-600" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-baseline gap-2"><strong className="truncate font-medium">{word.writing}</strong>{word.jlptLevel && <span className="shrink-0 rounded bg-[#ff4d6d]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#ff8ca1]">{word.jlptLevel}</span>}{word.partOfSpeech && <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] text-zinc-400">{word.partOfSpeech}</span>}{word.resolutionStatus && word.resolutionStatus !== 'resolved' && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${word.resolutionStatus === 'ambiguous' ? 'bg-amber-400/10 text-amber-300' : 'bg-red-400/10 text-red-300'}`}>{t(word.resolutionStatus === 'ambiguous' ? 'study.songWords.ambiguous' : 'study.songWords.unresolved')}</span>}</span>
                      {word.reading && <span className="mt-1 block truncate text-xs text-[#ff8ca1]">{word.reading}</span>}
                      {word.romaji && <span className="block truncate text-[11px] text-zinc-500">{word.romaji}</span>}
                      <span className="mt-1 block text-xs text-zinc-300">{word.meaningZh || t('study.songWords.occurrences', { count: word.occurrences.length })}</span>
                      {(word.exampleJa || word.occurrences[0]?.lineText) && <span className="mt-2 block line-clamp-2 border-l border-white/10 pl-2 text-[11px] leading-relaxed text-zinc-500">{word.exampleJa || word.occurrences[0]?.lineText}</span>}
                      {(word.exampleZh || word.occurrences[0]?.lineTranslatedText) && <span className="mt-1 block line-clamp-2 border-l border-white/10 pl-2 text-[11px] leading-relaxed text-zinc-600">{word.exampleZh || word.occurrences[0]?.lineTranslatedText}</span>}
                    </span>
                  </button>
                  <button type="button" aria-label={t('study.songWords.edit')} title={t('study.songWords.edit')} onClick={() => { setEditingWordId(word.id); setWordDraft(draftFromWord(word)) }} className="grid h-8 w-8 shrink-0 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-white"><Pencil size={14} /></button>
                </div>
              )
            })}
          </div>
          <div className="space-y-3 border-t border-white/[0.08] pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="text-sm text-zinc-400 hover:text-white" onClick={() => setSelected((current) => { const next = new Set(current); words.forEach((word) => allSelected ? next.delete(word.id) : next.add(word.id)); return next })}>{t(allSelected ? 'study.songWords.clearAll' : 'study.songWords.selectAll')} ({selectedVisibleCount}/{words.length})</button>
              {(['ja_zh', 'zh_ja'] as StudyDirection[]).map((direction) => <label key={direction} className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={directions.includes(direction)} onChange={() => toggleDirection(direction)} />{t(direction === 'ja_zh' ? 'study.dirJaZh' : 'study.dirZhJa')}</label>)}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-zinc-500">{t('study.songWords.targetDecks')}</span>
              {decks.map((deck) => <label key={deck.id} className="flex cursor-pointer items-center gap-2 rounded bg-white/[0.04] px-3 py-2 text-sm"><input type="checkbox" checked={deckIds.has(deck.id)} onChange={() => toggleDeck(deck.id)} />{deck.name}</label>)}
              <button type="button" disabled={deckIds.size === 0 || selected.size === 0 || directions.length === 0 || addMutation.isPending} onClick={() => addMutation.mutate()} className="ml-auto inline-flex h-9 items-center gap-2 rounded-md bg-[#ff4d6d] px-4 text-sm font-semibold disabled:opacity-40"><Plus size={15} />{t('study.songWords.add')}</button>
            </div>
          </div>
          {addMutation.isSuccess && <p className="text-sm text-emerald-400">{t('study.songWords.added', { count: addMutation.data.added })}</p>}
          {(addMutation.isError || editMutation.isError) && <p className="text-sm text-red-400">{getApiErrorMessage(addMutation.error ?? editMutation.error, t('study.songWords.addFailed'))}</p>}
        </>
      )}
    </section>
  )
}

function WordField({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return <label className={`grid gap-1 text-xs text-zinc-500 ${wide ? 'lg:col-span-2' : ''}`}><span>{label}</span><input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-0 rounded border border-white/10 bg-black/30 px-2 text-sm text-white outline-none focus:border-[#ff6b85]/60" /></label>
}
