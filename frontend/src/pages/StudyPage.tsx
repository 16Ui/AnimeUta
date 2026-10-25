import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Dialog } from '../components/ui/Dialog'
import { ArrowDown, ArrowUp, BookOpenCheck, CalendarCheck2, Check, CheckCircle2, Flame, History, Library, LockKeyhole, Pause, Pencil, Play, Plus, RotateCcw, Route, Settings2, Target, Trash2, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { completeGrammarLesson, createStudyDeck, deleteStudyCard, deleteStudyDeck, getGrammarPath, getJlptCoverage, getNextGrammarReview, getNextReviewCard, getReviewHistory, getStudyPreferences, getStudyToday, listStudyCards, listStudyDecks, reorderStudyDecks, submitGrammarReview, submitReview, updateStudyCard, updateStudyDeck, updateStudyPreferences } from '../api/study'
import { getApiErrorMessage } from '../api/error'
import { queryClient } from '../lib/query-client'
import { japaneseVoices, preferredJapaneseVoiceName, savePreferredJapaneseVoiceName, speakJapanese } from '../lib/japaneseSpeech'
import type { GrammarLesson, GrammarReviewCard, JlptCoverage, ReviewCard, StudyCard, StudyDeck, StudyDirection, StudyToday } from '../types/study'

type StudySection = 'today' | 'grammar' | 'vocabulary'
type ReviewQueue = 'word' | 'grammar'
type UtilityPanel = 'stats' | 'history' | 'settings'

export default function StudyPage() {
  const { t } = useTranslation()
  const [section, setSection] = useState<StudySection>('today')
  const [reviewQueue, setReviewQueue] = useState<ReviewQueue>('word')
  const [direction, setDirection] = useState<StudyDirection>('ja_zh')
  const [revealed, setRevealed] = useState(false)
  const [activePanel, setActivePanel] = useState<UtilityPanel | null>(null)
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null)
  const [newDeckName, setNewDeckName] = useState('')
  const [dailyNewLimit, setDailyNewLimit] = useState(20)
  const [dailyReviewLimit, setDailyReviewLimit] = useState(100)
  const [autoplayPronunciation, setAutoplayPronunciation] = useState(false)
  const [speechVoices, setSpeechVoices] = useState<SpeechSynthesisVoice[]>([])
  const [speechVoiceName, setSpeechVoiceName] = useState(preferredJapaneseVoiceName)
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null)
  const [editingDeckName, setEditingDeckName] = useState('')

  const todayQuery = useQuery({ queryKey: ['study-today', direction], queryFn: () => getStudyToday(direction) })
  const cardQuery = useQuery({ queryKey: ['study-next', direction], queryFn: () => getNextReviewCard(direction) })
  const grammarPathQuery = useQuery({ queryKey: ['study-grammar-path'], queryFn: getGrammarPath })
  const grammarCardQuery = useQuery({ queryKey: ['study-grammar-next'], queryFn: getNextGrammarReview })
  const decksQuery = useQuery({ queryKey: ['study-decks'], queryFn: listStudyDecks })
  const preferencesQuery = useQuery({ queryKey: ['study-preferences'], queryFn: getStudyPreferences })
  const cardsQuery = useQuery({ queryKey: ['study-cards', selectedDeckId], queryFn: () => listStudyCards(selectedDeckId as number), enabled: Boolean(selectedDeckId) })
  const historyQuery = useQuery({ queryKey: ['study-history'], queryFn: () => getReviewHistory(30) })
  const jlptCoverageQuery = useQuery({ queryKey: ['study-jlpt-coverage'], queryFn: getJlptCoverage })

  useEffect(() => {
    if (!preferencesQuery.data) return
    setDirection(preferencesQuery.data.defaultDirection)
    setDailyNewLimit(preferencesQuery.data.dailyNewLimit)
    setDailyReviewLimit(preferencesQuery.data.dailyReviewLimit)
    setAutoplayPronunciation(preferencesQuery.data.autoplayPronunciation)
  }, [preferencesQuery.data])
  useEffect(() => {
    const refreshVoices = () => setSpeechVoices(japaneseVoices())
    refreshVoices()
    window.speechSynthesis?.addEventListener('voiceschanged', refreshVoices)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', refreshVoices)
  }, [])
  useEffect(() => {
    const decks = decksQuery.data ?? []
    if (decks.length && (!selectedDeckId || !decks.some((deck) => deck.id === selectedDeckId))) setSelectedDeckId(decks[0]!.id)
  }, [decksQuery.data, selectedDeckId])
  useEffect(() => {
    const lessons = grammarPathQuery.data?.lessons ?? []
    if (!lessons.length) return
    if (!selectedLessonId || !lessons.some((lesson) => lesson.id === selectedLessonId)) {
      setSelectedLessonId((lessons.find((lesson) => !lesson.locked && !lesson.completedAt) ?? lessons.find((lesson) => !lesson.locked) ?? lessons[0])!.id)
    }
  }, [grammarPathQuery.data, selectedLessonId])
  useEffect(() => {
    if (reviewQueue === 'word' && !cardQuery.data && grammarCardQuery.data) setReviewQueue('grammar')
    if (reviewQueue === 'grammar' && !grammarCardQuery.data && cardQuery.data) setReviewQueue('word')
  }, [cardQuery.data, grammarCardQuery.data, reviewQueue])

  const refreshStudy = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['study-next'] }), queryClient.invalidateQueries({ queryKey: ['study-today'] }),
    queryClient.invalidateQueries({ queryKey: ['study-grammar-next'] }), queryClient.invalidateQueries({ queryKey: ['study-grammar-path'] }),
    queryClient.invalidateQueries({ queryKey: ['study-decks'] }), queryClient.invalidateQueries({ queryKey: ['study-cards'] }),
    queryClient.invalidateQueries({ queryKey: ['study-history'] }),
  ])
  const reviewMutation = useMutation({ mutationFn: (grade: 1 | 2 | 3) => submitReview(cardQuery.data?.id as number, grade), onSuccess: async () => { setRevealed(false); setReviewQueue('grammar'); await refreshStudy() } })
  const grammarReviewMutation = useMutation({ mutationFn: (grade: 1 | 2 | 3) => submitGrammarReview(grammarCardQuery.data?.lessonId as string, grade), onSuccess: async () => { setRevealed(false); setReviewQueue('word'); await refreshStudy() } })
  const completeLessonMutation = useMutation({ mutationFn: completeGrammarLesson, onSuccess: async () => { setReviewQueue('grammar'); await refreshStudy() } })
  const createDeckMutation = useMutation({ mutationFn: () => createStudyDeck(newDeckName.trim()), onSuccess: async (deck) => { setNewDeckName(''); setSelectedDeckId(deck.id); await queryClient.invalidateQueries({ queryKey: ['study-decks'] }) } })
  const renameDeckMutation = useMutation({ mutationFn: () => updateStudyDeck(selectedDeckId as number, { name: editingDeckName.trim() }), onSuccess: async () => { setEditingDeckName(''); await queryClient.invalidateQueries({ queryKey: ['study-decks'] }) } })
  const deleteDeckMutation = useMutation({ mutationFn: deleteStudyDeck, onSuccess: async () => { setSelectedDeckId(null); await queryClient.invalidateQueries({ queryKey: ['study-decks'] }) } })
  const reorderDeckMutation = useMutation({ mutationFn: reorderStudyDecks, onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['study-decks'] }) })
  const updateCardMutation = useMutation({ mutationFn: ({ id, state, deckId }: { id: number; state?: StudyCard['state']; deckId?: number }) => updateStudyCard(id, { state, deckId }), onSuccess: refreshStudy })
  const deleteCardMutation = useMutation({ mutationFn: deleteStudyCard, onSuccess: refreshStudy })
  const preferencesMutation = useMutation({ mutationFn: () => updateStudyPreferences({ dailyNewLimit, dailyReviewLimit, defaultDirection: direction, autoplayPronunciation }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['study-preferences'] }); await refreshStudy() } })

  const decks = decksQuery.data ?? []
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId)
  const selectedLesson = grammarPathQuery.data?.lessons.find((lesson) => lesson.id === selectedLessonId)
  const isLoadingReview = cardQuery.isLoading || grammarCardQuery.isLoading
  const noReview = !cardQuery.data && !grammarCardQuery.data
  const moveDeck = (offset: -1 | 1) => {
    if (!selectedDeckId) return
    const index = decks.findIndex((deck) => deck.id === selectedDeckId)
    const target = index + offset
    if (index < 0 || target < 0 || target >= decks.length) return
    const ids = decks.map((deck) => deck.id)
    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    reorderDeckMutation.mutate(ids)
  }

  return <div className="content-page study-page mx-auto max-w-6xl space-y-5">
    <header className="page-heading"><h2>{t('nav.study')}</h2></header>
    <nav className="grid grid-cols-3 border-b border-white/[0.08]" aria-label="学习板块">
      <SectionTab active={section === 'today'} icon={<CalendarCheck2 size={18} />} label="今日学习" hint="复习单词和语法" onClick={() => setSection('today')} />
      <SectionTab active={section === 'grammar'} icon={<Route size={18} />} label="语法路径" hint="从零开始顺序学习" onClick={() => setSection('grammar')} />
      <SectionTab active={section === 'vocabulary'} icon={<Library size={18} />} label="我的词库" hint="管理歌词生词" onClick={() => setSection('vocabulary')} />
    </nav>

    {section === 'today' && <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><QueueButton active={reviewQueue === 'word'} label={`单词 ${todayQuery.data?.due ?? 0}`} disabled={!cardQuery.data} onClick={() => { setReviewQueue('word'); setRevealed(false) }} /><QueueButton active={reviewQueue === 'grammar'} label={`语法 ${grammarPathQuery.data?.summary.due ?? 0}`} disabled={!grammarCardQuery.data} onClick={() => { setReviewQueue('grammar'); setRevealed(false) }} /></div><div className="flex items-center gap-1"><UtilityButton icon={<BookOpenCheck size={16} />} label="概况" onClick={() => setActivePanel('stats')} /><UtilityButton icon={<History size={16} />} label="历史" onClick={() => setActivePanel('history')} /><UtilityButton icon={<Settings2 size={16} />} label="设置" onClick={() => setActivePanel('settings')} /></div></div>
      {(todayQuery.isError || cardQuery.isError || grammarPathQuery.isError || grammarCardQuery.isError) && <p className="text-sm text-red-400">{getApiErrorMessage(todayQuery.error ?? cardQuery.error ?? grammarPathQuery.error ?? grammarCardQuery.error, t('study.loadFailed'))}</p>}
      {isLoadingReview && <div className="py-24 text-center text-zinc-500">{t('study.loading')}</div>}
      {!isLoadingReview && noReview && <div className="py-24 text-center"><CheckCircle2 className="mx-auto text-emerald-400" size={42} /><h3 className="mt-4 text-xl font-semibold">今天的复习已完成</h3><p className="mt-2 text-sm text-zinc-500">可以去语法路径学习下一课，或从歌词中加入新单词。</p><button type="button" onClick={() => setSection('grammar')} className="mt-6 rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black">继续语法路径</button></div>}
      {!isLoadingReview && reviewQueue === 'word' && cardQuery.data && <WordReview card={cardQuery.data} direction={direction} revealed={revealed} speechVoiceName={speechVoiceName} onReveal={() => { setRevealed(true); if (autoplayPronunciation) window.setTimeout(() => speakJapanese(cardQuery.data!.answer.writing, speechVoiceName), 0) }} onGrade={(grade) => reviewMutation.mutate(grade)} pending={reviewMutation.isPending} />}
      {!isLoadingReview && reviewQueue === 'grammar' && grammarCardQuery.data && <GrammarReview card={grammarCardQuery.data} revealed={revealed} onReveal={() => setRevealed(true)} onGrade={(grade) => grammarReviewMutation.mutate(grade)} pending={grammarReviewMutation.isPending} />}
      {!noReview && <button type="button" onClick={() => void refreshStudy()} className="mx-auto flex items-center gap-2 text-sm text-zinc-500 hover:text-white"><RotateCcw size={15} />刷新今日内容</button>}
    </section>}

    {section === 'grammar' && <GrammarPathView lessons={grammarPathQuery.data?.lessons ?? []} summary={grammarPathQuery.data?.summary} selected={selectedLesson} loading={grammarPathQuery.isLoading} pending={completeLessonMutation.isPending} onSelect={setSelectedLessonId} onComplete={(id) => completeLessonMutation.mutate(id)} onReview={() => { setSection('today'); setReviewQueue('grammar'); setRevealed(false) }} />}
    {section === 'vocabulary' && <section className="space-y-5"><details className="border-b border-white/10 pb-3"><summary className="cursor-pointer py-2 text-sm text-zinc-400">N2 词汇覆盖参考</summary><JlptCoveragePanel data={jlptCoverageQuery.data} loading={jlptCoverageQuery.isLoading} /></details><VocabularyView decks={decks} selectedDeck={selectedDeck} selectedDeckId={selectedDeckId} cards={cardsQuery.data?.data ?? []} cardsLoading={cardsQuery.isLoading} newDeckName={newDeckName} editingDeckName={editingDeckName} pending={createDeckMutation.isPending || renameDeckMutation.isPending || deleteDeckMutation.isPending} onSelectDeck={setSelectedDeckId} onNewDeckName={setNewDeckName} onCreateDeck={() => createDeckMutation.mutate()} onEditingDeckName={setEditingDeckName} onRenameDeck={() => renameDeckMutation.mutate()} onDeleteDeck={(id) => deleteDeckMutation.mutate(id)} onMoveDeck={moveDeck} onUpdateCard={(id, payload) => updateCardMutation.mutate({ id, ...payload })} onDeleteCard={(id) => deleteCardMutation.mutate(id)} /></section>}

    {activePanel && <UtilityDialog panel={activePanel} onClose={() => setActivePanel(null)}>
      {activePanel === 'stats' && <StatsPanel wordStats={todayQuery.data} grammarSummary={grammarPathQuery.data?.summary} />}
      {activePanel === 'history' && <HistoryPanel data={historyQuery.data} loading={historyQuery.isLoading} />}
      {activePanel === 'settings' && <SettingsPanel direction={direction} dailyNewLimit={dailyNewLimit} dailyReviewLimit={dailyReviewLimit} autoplay={autoplayPronunciation} voiceName={speechVoiceName} voices={speechVoices} pending={preferencesMutation.isPending} onDirection={setDirection} onDailyNew={setDailyNewLimit} onDailyReview={setDailyReviewLimit} onAutoplay={setAutoplayPronunciation} onVoice={(value) => { setSpeechVoiceName(value); savePreferredJapaneseVoiceName(value) }} onSave={() => preferencesMutation.mutate()} />}
    </UtilityDialog>}
  </div>
}

function SectionTab({ active, icon, label, hint, onClick }: { active: boolean; icon: ReactNode; label: string; hint: string; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} title={hint} className={`relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-3 transition sm:flex-row sm:gap-3 ${active ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>{icon}<strong className="text-xs font-medium sm:text-sm">{label}</strong>{active && <span className="absolute inset-x-4 bottom-0 h-0.5 bg-[#ff4d6d]" />}</button>
}

function QueueButton({ active, label, disabled, onClick }: { active: boolean; label: string; disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-md px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-35 ${active ? 'bg-white text-black' : 'bg-white/[0.055] text-zinc-400 hover:text-white'}`}>{label}</button>
}

function UtilityButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className="flex h-11 items-center gap-1.5 rounded-md px-2.5 text-xs text-zinc-500 hover:bg-white/[0.055] hover:text-white">{icon}<span className="hidden sm:inline">{label}</span></button>
}

function WordReview({ card, direction, revealed, speechVoiceName, onReveal, onGrade, pending }: { card: ReviewCard; direction: StudyDirection; revealed: boolean; speechVoiceName: string; onReveal: () => void; onGrade: (grade: 1 | 2 | 3) => void; pending: boolean }) {
  const { t } = useTranslation()
  return <ReviewFrame kind="歌词单词" front={card.front} revealed={revealed} onReveal={onReveal} onGrade={onGrade} pending={pending} directionLabel={t(direction === 'ja_zh' ? 'study.dirJaZh' : 'study.dirZhJa')}>
    <div className="flex items-center justify-center gap-3"><span className="text-3xl font-semibold">{card.answer.writing}</span><button type="button" title={t('study.speak')} onClick={() => speakJapanese(card.answer.writing, speechVoiceName)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/[0.08]"><Volume2 size={19} /></button></div>
    <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">{card.answer.reading && <ReadingValue label="平假名" value={card.answer.reading} accent />}{card.answer.readingKatakana && card.answer.readingKatakana !== card.answer.reading && <ReadingValue label="片假名" value={card.answer.readingKatakana} />}{card.answer.romaji && <ReadingValue label="罗马音" value={card.answer.romaji} />}</div>
    <div className="mt-6"><p className="text-[11px] text-zinc-600">中文释义</p><div className="mt-1 flex flex-wrap items-center justify-center gap-2">{card.answer.partOfSpeech && <span className="rounded bg-white/[0.07] px-2 py-1 text-xs text-zinc-400">{card.answer.partOfSpeech}</span>}<p className={`text-lg ${card.answer.meaningZh ? 'text-zinc-100' : 'text-amber-300'}`}>{card.answer.meaningZh || '待补充释义'}</p></div></div>
    {(card.answer.exampleJa || card.source?.text) && <div className="mx-auto mt-7 max-w-lg rounded-md bg-black/20 px-4 py-3 text-left"><p className="text-xs text-zinc-600">歌词例句</p>{card.source?.tokens?.length ? <TokenizedExample text={card.source.text} tokens={card.source.tokens} /> : <p lang="ja" className="mt-2 text-sm leading-relaxed text-zinc-200">{card.answer.exampleJa || card.source?.text}</p>}{(card.source?.translatedText || card.answer.exampleZh) && <p className="mt-3 border-t border-white/[0.06] pt-2 text-xs leading-relaxed text-zinc-500">{card.source?.translatedText || card.answer.exampleZh}</p>}</div>}
    {card.source && <Link to={`/song/${card.source.songId ?? ''}${card.source.startMs == null ? '' : `?t=${Math.floor(card.source.startMs / 1000)}`}`} className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-white"><Play size={14} />回到歌词原句</Link>}
  </ReviewFrame>
}

function GrammarReview({ card, revealed, onReveal, onGrade, pending }: { card: GrammarReviewCard; revealed: boolean; onReveal: () => void; onGrade: (grade: 1 | 2 | 3) => void; pending: boolean }) {
  return <ReviewFrame kind="语法复习" front={card.front} revealed={revealed} onReveal={onReveal} onGrade={onGrade} pending={pending}>
    <p className="text-sm font-medium text-[#ff8ca1]">{card.answer.title}</p><p className="mt-2 text-2xl font-semibold text-white">{card.answer.pattern}</p><p className="mx-auto mt-5 max-w-xl text-base leading-7 text-zinc-200">{card.answer.reviewAnswer}</p><div className="mx-auto mt-7 max-w-xl border-t border-white/[0.08] pt-5 text-left"><p className="text-sm leading-7 text-zinc-400">{card.answer.explanation}</p>{card.answer.examples.slice(0, 2).map((example) => <div key={example.ja} className="mt-4"><p lang="ja" className="text-base text-zinc-100">{example.ja}</p><p className="mt-1 text-xs text-[#ff8ca1]">{example.reading}</p><p className="mt-1 text-sm text-zinc-500">{example.zh}</p></div>)}</div>
  </ReviewFrame>
}

function ReviewFrame({ kind, directionLabel, front, revealed, onReveal, onGrade, pending, children }: { kind: string; directionLabel?: string; front: string; revealed: boolean; onReveal: () => void; onGrade: (grade: 1 | 2 | 3) => void; pending: boolean; children: ReactNode }) {
  return <section className="study-review-card mx-auto w-full max-w-2xl overflow-hidden rounded-lg border border-white/[0.085] bg-[#1b1b22] shadow-[0_24px_70px_rgba(0,0,0,0.22)]"><div className="min-h-72 p-8 text-center md:p-12"><p className="text-xs text-zinc-500">{kind}{directionLabel ? ` · ${directionLabel}` : ''}</p><div className="mt-9 text-3xl font-semibold leading-tight md:text-4xl">{front}</div>{!revealed && <button type="button" className="mt-14 rounded-md bg-white px-6 py-3 text-sm font-semibold text-black" onClick={onReveal}>显示答案</button>}{revealed && <div className="mt-9 border-t border-white/[0.08] pt-7">{children}</div>}</div>{revealed && <GradeButtons pending={pending} onGrade={onGrade} />}</section>
}

function GradeButtons({ pending, onGrade }: { pending: boolean; onGrade: (grade: 1 | 2 | 3) => void }) {
  return <div className="grid grid-cols-3 gap-px bg-white/[0.08]"><button type="button" disabled={pending} onClick={() => onGrade(3)} className="bg-emerald-500/20 px-2 py-4 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">认识</button><button type="button" disabled={pending} onClick={() => onGrade(2)} className="bg-amber-400/20 px-2 py-4 text-sm font-semibold text-amber-300 hover:bg-amber-400/30 disabled:opacity-40">模糊</button><button type="button" disabled={pending} onClick={() => onGrade(1)} className="bg-red-500/20 px-2 py-4 text-sm font-semibold text-red-300 hover:bg-red-500/30 disabled:opacity-40">忘记</button></div>
}

function GrammarPathView({ lessons, summary, selected, loading, pending, onSelect, onComplete, onReview }: { lessons: GrammarLesson[]; summary?: { total: number; completed: number; due: number }; selected?: GrammarLesson; loading: boolean; pending: boolean; onSelect: (id: string) => void; onComplete: (id: string) => void; onReview: () => void }) {
  if (loading) return <div className="py-24 text-center text-zinc-500">正在读取语法路径...</div>
  return <section><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-xl font-semibold">零基础语法路径</h3><p className="mt-1 text-sm text-zinc-500">按顺序学习，每完成一课就自动加入间隔复习。</p></div><div className="text-right"><p className="text-sm text-zinc-300">{summary?.completed ?? 0} / {summary?.total ?? 0} 课</p><div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full bg-[#ff4d6d]" style={{ width: `${summary?.total ? (summary.completed / summary.total) * 100 : 0}%` }} /></div></div></div>
    <label className="mb-3 grid gap-2 text-sm text-zinc-400 lg:hidden">选择语法章节<select className="account-input" value={selected?.id ?? ''} onChange={(event) => onSelect(event.target.value)}>{Array.from(new Set(lessons.map((lesson) => lesson.stage))).map((stage) => <optgroup key={stage} label={stage}>{lessons.filter((lesson) => lesson.stage === stage).map((lesson) => <option key={lesson.id} value={lesson.id} disabled={lesson.locked}>{lesson.order}. {lesson.title}{lesson.completedAt ? ' · 已学习' : ''}</option>)}</optgroup>)}</select></label><div className="study-grammar-split min-h-[560px] overflow-hidden rounded-lg border border-white/[0.08] bg-[#15151b]"><div className="hidden lg:block max-h-64 overflow-y-auto border-b border-white/[0.08] p-2 lg:max-h-[70vh] lg:border-b-0 lg:border-r">{lessons.map((lesson, index) => <div key={lesson.id}>{(index === 0 || lessons[index - 1]?.stage !== lesson.stage) && <div className="sticky top-0 z-10 flex items-center justify-between bg-[#15151b]/95 px-3 pb-1 pt-3 text-[10px] font-semibold text-zinc-600 backdrop-blur"><span>{lesson.stage}</span><span>{lessons.filter((item) => item.stage === lesson.stage && item.completedAt).length}/{lessons.filter((item) => item.stage === lesson.stage).length}</span></div>}<button type="button" disabled={lesson.locked} onClick={() => onSelect(lesson.id)} className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition ${selected?.id === lesson.id ? 'bg-white/[0.09] text-white' : 'text-zinc-400 hover:bg-white/[0.045]'} disabled:cursor-not-allowed disabled:opacity-45`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs ${lesson.completedAt ? 'bg-emerald-500/15 text-emerald-300' : selected?.id === lesson.id ? 'bg-[#ff4d6d] text-white' : 'bg-white/[0.06]'}`}>{lesson.completedAt ? <Check size={15} /> : lesson.locked ? <LockKeyhole size={13} /> : lesson.order}</span><span className="min-w-0"><strong className="block truncate text-sm font-medium">{lesson.title}</strong><span className="mt-0.5 block truncate text-[10px] text-zinc-600">{lesson.pattern}</span></span></button></div>)}</div>
      {selected ? <article className="overflow-y-auto p-6 md:p-9"><div className="flex items-center gap-2 text-xs text-[#ff6b85]"><span>第 {selected.order} 课</span><span>·</span><span>{selected.stage}</span>{selected.completedAt && <span className="ml-auto inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 size={14} />已学习</span>}</div><h3 className="mt-3 text-2xl font-semibold">{selected.title}</h3><p className="mt-3 inline-block rounded bg-white/[0.06] px-3 py-2 text-lg font-medium text-zinc-100">{selected.pattern}</p><p className="mt-5 text-base leading-7 text-zinc-300">{selected.summary}</p><p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-500">{selected.explanation}</p><div className="mt-8 space-y-5 border-t border-white/[0.08] pt-6">{selected.examples.map((example, index) => <div key={example.ja} className="grid gap-1 sm:grid-cols-[32px_1fr]"><span className="text-xs text-zinc-700">{String(index + 1).padStart(2, '0')}</span><div><p lang="ja" className="text-lg text-zinc-100">{example.ja}</p><p className="mt-1 text-xs text-[#ff8ca1]">{example.reading}</p><p className="mt-2 text-sm text-zinc-500">{example.zh}</p></div></div>)}</div><div className="mt-9 flex flex-wrap gap-3">{!selected.completedAt ? <button type="button" disabled={selected.locked || pending} onClick={() => onComplete(selected.id)} className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40">完成本课并加入复习</button> : <button type="button" onClick={onReview} className="rounded-md bg-[#ff4d6d] px-5 py-2.5 text-sm font-semibold text-white">去今日学习复习</button>}</div></article> : <div className="grid place-items-center text-zinc-600">选择一课开始学习</div>}
    </div></section>
}

interface VocabularyViewProps {
  decks: StudyDeck[]; selectedDeck?: StudyDeck; selectedDeckId: number | null; cards: StudyCard[]; cardsLoading: boolean
  newDeckName: string; editingDeckName: string; pending: boolean
  onSelectDeck: (id: number) => void; onNewDeckName: (value: string) => void; onCreateDeck: () => void
  onEditingDeckName: (value: string) => void; onRenameDeck: () => void; onDeleteDeck: (id: number) => void
  onMoveDeck: (offset: -1 | 1) => void; onUpdateCard: (id: number, payload: { state?: StudyCard['state']; deckId?: number }) => void; onDeleteCard: (id: number) => void
}

function JlptCoveragePanel({ data, loading }: { data?: JlptCoverage; loading: boolean }) {
  if (loading) return <div className="border-y border-white/[0.08] py-6 text-sm text-zinc-600">正在统计曲库词汇…</div>
  if (!data?.available) return <div className="border-y border-white/[0.08] py-6 text-sm text-zinc-600">本地词典暂时无法提供 JLPT 等级参考。</div>
  return <section className="border-y border-white/[0.08] py-5" aria-label="N2 词汇覆盖参考"><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-sm font-semibold"><Target size={17} className="text-[#ff6b85]" />N2 词汇参考</div><p className="mt-1 text-xs text-zinc-600">当前曲库已分词 {data.songs?.analyzed ?? 0} / {data.songs?.total ?? 0} 首日语歌曲</p></div><div className="text-right"><strong className="text-2xl font-semibold text-white">{data.target.percent}%</strong><p className="mt-1 text-xs text-zinc-600">覆盖 {data.target.covered.toLocaleString()} / {data.target.total.toLocaleString()} 个 N5–N2 参考词条</p></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full bg-[#ff4d6d] transition-[width]" style={{ width: `${Math.min(100, data.target.percent)}%` }} /></div><div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">{data.levels.map((item) => <div key={item.level}><div className="flex items-center justify-between text-xs"><span className="font-semibold text-zinc-300">{item.level}</span><span className="text-zinc-600">{item.percent}%</span></div><div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full bg-white/45" style={{ width: `${Math.min(100, item.percent)}%` }} /></div><p className="mt-1.5 text-[11px] text-zinc-600">{item.covered} / {item.total}，尚差 {item.remaining}</p></div>)}</div><p className="mt-4 text-[10px] leading-relaxed text-zinc-700">等级来自 {data.reference.source}（{data.reference.license}），用于学习覆盖参考，不是 JLPT 官方固定词表；“尚差”仅表示当前曲库未遇到的词条。</p></section>
}

function VocabularyView({ decks, selectedDeck, selectedDeckId, cards, cardsLoading, newDeckName, editingDeckName, pending, onSelectDeck, onNewDeckName, onCreateDeck, onEditingDeckName, onRenameDeck, onDeleteDeck, onMoveDeck, onUpdateCard, onDeleteCard }: VocabularyViewProps) {
  return <section className="study-vocabulary-split min-h-[520px] overflow-hidden rounded-lg border border-white/[0.08] bg-[#15151b]"><aside className="border-b border-white/[0.08] p-3 lg:border-b-0 lg:border-r"><label className="mb-3 grid gap-2 text-sm text-zinc-400 lg:hidden">选择词库<select className="account-input" value={selectedDeckId ?? ''} onChange={(event) => onSelectDeck(Number(event.target.value))}>{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name} · {deck.cardCount}</option>)}</select></label><div className="mb-3 px-2"><h3 className="text-sm font-semibold">我的词库</h3><p className="mt-1 text-[11px] text-zinc-600">从歌词中收集的学习范围</p></div><div className="hidden space-y-1 lg:block">{decks.map((deck) => <button type="button" key={deck.id} onClick={() => onSelectDeck(deck.id)} className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left ${selectedDeckId === deck.id ? 'bg-white/[0.09] text-white' : 'text-zinc-400 hover:bg-white/[0.045]'}`}><Library size={16} /><span className="min-w-0 flex-1 truncate text-sm">{deck.name}</span><span className="text-xs text-zinc-600">{deck.cardCount}</span></button>)}</div><form className="mt-4 flex gap-2 border-t border-white/[0.08] pt-4" onSubmit={(event) => { event.preventDefault(); if (newDeckName.trim()) onCreateDeck() }}><input value={newDeckName} onChange={(event) => onNewDeckName(event.target.value)} placeholder="新词库名称" className="account-input min-w-0 flex-1" /><button type="submit" title="创建词库" disabled={!newDeckName.trim() || pending} className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white text-black disabled:opacity-40"><Plus size={17} /></button></form></aside>
    {selectedDeck ? <div className="p-5 md:p-7"><div className="flex flex-wrap items-start gap-3 border-b border-white/[0.08] pb-5">{editingDeckName ? <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); if (editingDeckName.trim()) onRenameDeck() }}><input autoFocus value={editingDeckName} onChange={(event) => onEditingDeckName(event.target.value)} className="account-input min-w-0 flex-1" /><button type="submit" className="rounded-md bg-white px-3 text-sm text-black">保存</button></form> : <div className="min-w-0 flex-1"><h3 className="text-xl font-semibold">{selectedDeck.name}</h3><p className="mt-1 text-sm text-zinc-500">共 {selectedDeck.cardCount} 张卡片，{selectedDeck.dueCount} 张到期</p></div>}<button type="button" title="重命名" onClick={() => onEditingDeckName(selectedDeck.name)} className="study-icon-button"><Pencil size={15} /></button><button type="button" title="上移" disabled={decks.findIndex((deck) => deck.id === selectedDeck.id) <= 0} onClick={() => onMoveDeck(-1)} className="study-icon-button"><ArrowUp size={16} /></button><button type="button" title="下移" disabled={decks.findIndex((deck) => deck.id === selectedDeck.id) >= decks.length - 1} onClick={() => onMoveDeck(1)} className="study-icon-button"><ArrowDown size={16} /></button>{!selectedDeck.isDefault && <button type="button" title="删除词库" onClick={() => { if (window.confirm(`确定删除词库“${selectedDeck.name}”吗？`)) onDeleteDeck(selectedDeck.id) }} className="study-icon-button hover:text-red-300"><Trash2 size={16} /></button>}</div>{cardsLoading ? <p className="py-16 text-center text-sm text-zinc-600">正在读取词库...</p> : cards.length ? <div className="divide-y divide-white/[0.07]">{cards.map((item) => <article key={item.id} className="flex items-center gap-3 py-3.5"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-3"><strong lang="ja" className="text-base">{item.answer.writing}</strong>{item.answer.reading && <span className="text-xs text-[#ff8ca1]">{item.answer.reading}</span>}{item.answer.partOfSpeech && <span className="text-[10px] text-zinc-600">{item.answer.partOfSpeech}</span>}</div><p className="mt-1 truncate text-xs text-zinc-500">{item.answer.meaningZh || '待补充中文释义'}</p></div><select value={item.deckId} onChange={(event) => onUpdateCard(item.id, { deckId: Number(event.target.value) })} className="hidden h-9 rounded-md bg-white/[0.06] px-2 text-xs sm:block">{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select><button type="button" title={item.state === 'suspended' ? '恢复学习' : '暂停学习'} onClick={() => onUpdateCard(item.id, { state: item.state === 'suspended' ? (item.repetitions === 0 ? 'new' : 'review') : 'suspended' })} className="study-icon-button">{item.state === 'suspended' ? <Play size={15} /> : <Pause size={15} />}</button><button type="button" title="移除卡片" onClick={() => onDeleteCard(item.id)} className="study-icon-button hover:text-red-300"><Trash2 size={15} /></button></article>)}</div> : <div className="py-20 text-center"><Library className="mx-auto text-zinc-700" size={34} /><p className="mt-3 text-sm text-zinc-500">这个词库还没有单词</p><p className="mt-1 text-xs text-zinc-700">在歌曲歌词中点击单词并选择“加入学习”</p></div>}</div> : <div className="grid place-items-center text-sm text-zinc-600">先创建或选择一个词库</div>}
  </section>
}

function UtilityDialog({ panel, onClose, children }: { panel: UtilityPanel; onClose: () => void; children: ReactNode }) {
  const titles = { stats: '学习概况', history: '复习历史', settings: '学习设置' }
  return <Dialog open onClose={onClose} title={titles[panel]}><div className="p-5">{children}</div></Dialog>
}

function StatsPanel({ wordStats, grammarSummary }: { wordStats?: StudyToday; grammarSummary?: { completed: number; total: number; due: number } }) {
  return <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-white/[0.08] md:grid-cols-4"><Stat label="待复习单词" value={wordStats?.due ?? 0} /><Stat label="待复习语法" value={grammarSummary?.due ?? 0} /><Stat label="连续学习" value={`${wordStats?.streakDays ?? 0} 天`} icon={<Flame size={16} />} /><Stat label="语法进度" value={`${grammarSummary?.completed ?? 0}/${grammarSummary?.total ?? 0}`} icon={<Route size={16} />} /></div>
}

function HistoryPanel({ data, loading }: { data?: { daily: Array<{ day: string; reviews: number }> }; loading: boolean }) {
  if (loading) return <p className="py-10 text-center text-sm text-zinc-600">正在读取历史...</p>
  const max = Math.max(1, ...(data?.daily ?? []).map((item) => item.reviews))
  return <div><p className="text-sm text-zinc-500">最近 30 天的单词复习记录</p><div className="mt-5 flex h-40 items-end gap-1 overflow-x-auto">{(data?.daily ?? []).map((day) => <div key={day.day} title={`${day.day}: ${day.reviews}`} className="flex h-full min-w-5 flex-1 items-end"><div style={{ height: `${Math.max(8, day.reviews / max * 100)}%` }} className="w-full rounded-t bg-[#ff4d6d]/70" /></div>)}{(data?.daily.length ?? 0) === 0 && <p className="self-center text-sm text-zinc-600">还没有复习记录</p>}</div></div>
}

function SettingsPanel({ direction, dailyNewLimit, dailyReviewLimit, autoplay, voiceName, voices, pending, onDirection, onDailyNew, onDailyReview, onAutoplay, onVoice, onSave }: { direction: StudyDirection; dailyNewLimit: number; dailyReviewLimit: number; autoplay: boolean; voiceName: string; voices: SpeechSynthesisVoice[]; pending: boolean; onDirection: (value: StudyDirection) => void; onDailyNew: (value: number) => void; onDailyReview: (value: number) => void; onAutoplay: (value: boolean) => void; onVoice: (value: string) => void; onSave: () => void }) {
  return <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSave() }}><label className="grid gap-1.5 text-xs text-zinc-500">默认复习方向<select value={direction} onChange={(event) => onDirection(event.target.value as StudyDirection)} className="account-input"><option value="ja_zh">日语 → 中文</option><option value="zh_ja">中文 → 日语</option></select></label><label className="grid gap-1.5 text-xs text-zinc-500">每日新词上限<input type="number" min="1" max="200" value={dailyNewLimit} onChange={(event) => onDailyNew(Number(event.target.value))} className="account-input" /></label><label className="grid gap-1.5 text-xs text-zinc-500">每日复习上限<input type="number" min="1" max="1000" value={dailyReviewLimit} onChange={(event) => onDailyReview(Number(event.target.value))} className="account-input" /></label><label className="grid gap-1.5 text-xs text-zinc-500">日语发音<select value={voiceName} onChange={(event) => onVoice(event.target.value)} className="account-input"><option value="">自动选择</option>{voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name}</option>)}</select></label><label className="flex h-11 items-center gap-3 self-start rounded-md border border-white/10 px-3 text-sm text-zinc-300"><input type="checkbox" checked={autoplay} onChange={(event) => onAutoplay(event.target.checked)} className="accent-[#ff4d6d]" />显示答案后自动发音</label><button type="submit" disabled={pending} className="h-11 rounded-md bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{pending ? '保存中...' : '保存设置'}</button></form>
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: ReactNode }) {
  return <div className="bg-[#18181f] p-4 md:p-5"><div className="flex items-center gap-2 text-xs text-zinc-500">{icon}{label}</div><div className="mt-2 text-2xl font-semibold">{value}</div></div>
}

function ReadingValue({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <span className="inline-flex items-baseline gap-1.5"><span className="text-[10px] text-zinc-600">{label}</span><span className={accent ? 'text-[#ff8ca1]' : 'text-zinc-300'}>{value}</span></span>
}

function TokenizedExample({ text, tokens }: { text: string; tokens: NonNullable<NonNullable<ReviewCard['source']>['tokens']> }) {
  const content: ReactNode[] = []
  let cursor = 0
  for (const token of tokens) {
    const start = Math.max(cursor, token.startOffset)
    const end = Math.max(start, token.endOffset)
    if (start > cursor) content.push(<span key={`gap-${cursor}`} className="self-center whitespace-pre-wrap text-zinc-400">{text.slice(cursor, start)}</span>)
    const needsRuby = Boolean(token.reading && token.reading !== token.surface)
    content.push(<span key={token.tokenId} title={[token.partOfSpeech, token.meaningZh].filter(Boolean).join(' · ')} className="inline-flex min-w-0 flex-col items-center px-0.5 align-bottom"><ruby lang="ja" className="text-base leading-7 text-zinc-100">{token.surface}{needsRuby && <rt className="text-[9px] font-normal text-[#ff8ca1]">{token.reading}</rt>}</ruby>{token.romaji && <span className="max-w-24 truncate text-[9px] leading-none text-zinc-600">{token.romaji}</span>}</span>)
    cursor = Math.max(cursor, end)
  }
  if (cursor < text.length) content.push(<span key="tail" className="self-center whitespace-pre-wrap text-zinc-400">{text.slice(cursor)}</span>)
  return <div className="mt-3 flex flex-wrap items-end gap-x-1 gap-y-3 leading-relaxed">{content}</div>
}
