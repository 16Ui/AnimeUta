import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GripHorizontal, Languages, ListEnd, Lock, Minus, Plus, Settings2, Type, Unlock, X, Contrast, SkipBack, SkipForward, Play, Pause, RotateCcw, Repeat1, Subtitles } from 'lucide-react'
import { DesktopLyricTrack } from '../components/music/DesktopLyricTrack'
import { sentenceRange } from '../lib/lyricPlayback'
import { useTranslation } from 'react-i18next'
import { getSongLyrics } from '../api/music'
import {
  dragDesktopLyricsWindow,
  hideDesktopLyricsWindow,
  readDesktopLyricsSnapshot,
  setDesktopLyricsWindowLocked,
  subscribeDesktopLyricsSnapshot,
  subscribeDesktopLyricsTimingOffset,
  type DesktopLyricsSnapshot,
  type DesktopLyricsTimingOffset,
  desktopLyricsLockKey, changeDesktopLyricsLock, watchDesktopLyricsHitArea, isTauriRuntime,
  watchDesktopLyricsBounds, restoreDesktopLyricsBounds, sendDesktopLyricsCommand, type DesktopLyricsCommand,
} from '../lib/desktopLyrics'
import type { LyricRubySegment } from '../types/music'
import { useLyricPreferences, type LyricPreferences } from '../lib/useLyricPreferences'

function DesktopLyricText({ text, ruby, enabled }: { text: string; ruby?: LyricRubySegment[]; enabled: boolean }) {
  if (!enabled || !ruby?.length) return <>{text}</>
  return <>{ruby.map((segment, index) => segment.ruby
    ? <ruby key={`${segment.text}-${index}`} lang="ja" className="lyric-ruby">{segment.text}<rt className="lyric-ruby-reading">{segment.ruby}</rt></ruby>
    : <span key={`${segment.text}-${index}`}>{segment.text}</span>)}</>
}

function isUnavailableTrack(value?: string) {
  const normalized = value?.trim().toLocaleLowerCase().replace(/[\s.…。!！?？_\-/\\[\]()（）:：]+/gu, '') ?? ''
  return !normalized || [
    '暂无翻译', '暂无中文翻译', '无翻译', '待翻译', '等待翻译', '未翻译', '翻译待补', '翻译待生成',
    '暂无罗马音', '暂无羅馬音', '暂无音译', '无罗马音', '待补罗马音', '等待罗马音', '罗马音待生成',
    'notranslation', 'translationpending', 'translationunavailable', 'noromaji', 'romajipending', 'romajiunavailable',
    '翻訳なし', '翻訳待ち', '訳なし', 'ローマ字なし', 'ローマ字待ち',
  ].includes(normalized)
}

export default function DesktopLyricsPage() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<DesktopLyricsSnapshot | null>(() => readDesktopLyricsSnapshot())
  const { preferences, update, error: preferenceError } = useLyricPreferences()
  const [locked, setLocked] = useState(() => localStorage.getItem(desktopLyricsLockKey) === 'true')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [timingOverride, setTimingOverride] = useState<DesktopLyricsTimingOffset | null>(null)
  const songId = snapshot?.song?.id
  const lyricsQuery = useQuery({
    queryKey: ['desktop-song-lyrics', songId],
    queryFn: () => getSongLyrics(songId as number),
    enabled: Boolean(songId),
    staleTime: 60_000,
    retry: 1,
  })

  useEffect(() => watchDesktopLyricsBounds(), [])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(timer) }, [])

  useEffect(() => {
    document.documentElement.classList.add('desktop-lyrics-root')
    return subscribeDesktopLyricsSnapshot(setSnapshot)
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let cancelled = false
    void (async () => {
        await restoreDesktopLyricsBounds()
        const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        const size = await win.innerSize()
        const scale = await win.scaleFactor()
        // Reserve track space from preferences, never from the current sentence.
        const height = Math.ceil(150 + preferences.fontSize * (preferences.showNextLine ? 5 : 4))
        if (!cancelled && Math.abs(size.height / scale - height) > 1) {
          await win.setSize(new LogicalSize(size.width / scale, height))
          await restoreDesktopLyricsBounds()
        }
    })().catch(console.error)
    return () => { cancelled = true }
  }, [preferences.fontSize, preferences.showNextLine])

  useEffect(() => {
    const read = () => setLocked(localStorage.getItem(desktopLyricsLockKey) === 'true')
    window.addEventListener('storage', read)
    window.addEventListener(desktopLyricsLockKey, read)
    return () => { window.removeEventListener('storage', read); window.removeEventListener(desktopLyricsLockKey, read) }
  }, [])

  useEffect(() => {
    if (locked) setSettingsOpen(false)
    void setDesktopLyricsWindowLocked(locked).catch(console.error)
    return watchDesktopLyricsHitArea(() => locked, setHovered)
  }, [locked])

  useEffect(() => { if (!hovered) setSettingsOpen(false) }, [hovered])

  useEffect(() => subscribeDesktopLyricsTimingOffset((value) => {
    if (value.songId === songId) setTimingOverride(value)
  }), [songId])

  const updatePreference = <Key extends keyof LyricPreferences>(key: Key, value: LyricPreferences[Key]) => {
    update({ [key]: value })
  }

  const lines = useMemo(() => lyricsQuery.data?.lines ?? [], [lyricsQuery.data?.lines])
  const timingOffsetMs = timingOverride && timingOverride.songId === songId
    ? timingOverride.timingOffsetMs
    : lyricsQuery.data?.timingOffsetMs ?? 0
  const activeIndex = useMemo(() => {
    if (lines.length === 0) return -1
    const currentMs = (snapshot?.currentTime ?? 0) * 1000 - timingOffsetMs
    let index = lines.findIndex((line) => line.startMs !== undefined && line.startMs > currentMs) - 1
    if (index < 0) index = lines.findLastIndex((line) => line.startMs !== undefined && line.startMs <= currentMs)
    return index >= 0 ? index : 0
  }, [lines, snapshot?.currentTime, timingOffsetMs])
  const activeLine = activeIndex >= 0 ? lines[activeIndex] : undefined
  const nextLine = activeIndex >= 0 ? lines[activeIndex + 1] : undefined
  const translation = activeLine?.translatedText?.trim()
  const showTranslation = Boolean(preferences.showTranslation && translation && !isUnavailableTrack(translation) && lyricsQuery.data?.languageCode !== 'zh' && translation !== activeLine?.originalText.trim())
  const romaji = activeLine?.romajiText?.trim()
  const showRomaji = Boolean(preferences.showRomaji && romaji && !isUnavailableTrack(romaji) && /[\u3040-\u30ff\u3400-\u9fff]/u.test(activeLine?.originalText ?? '') && romaji?.toLocaleLowerCase() !== activeLine?.originalText.trim().toLocaleLowerCase())

  const stale = !snapshot || now - snapshot.sentAt > 10000
  const range = sentenceRange(lines, activeIndex, timingOffsetMs, snapshot?.duration ?? 0)
  const command = (action: DesktopLyricsCommand['action'], extra: Partial<DesktopLyricsCommand> = {}) => {
    if (!songId || stale) return
    sendDesktopLyricsCommand({ ...extra, action, songId, sessionId: snapshot?.playbackSessionId })
  }
  const controlClass = 'grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/45 text-white/85 shadow-sm backdrop-blur-md transition hover:bg-black/65 hover:text-white disabled:opacity-30'
  const toggleClass = (active: boolean) => `${controlClass} ${active ? '!bg-[#6d2937]/90 !text-white' : ''}`

  return (
    <main className="group flex h-screen w-screen select-none items-start justify-center bg-transparent p-2 text-white"
      onPointerEnter={() => { if (!isTauriRuntime()) setHovered(true) }}
      onPointerLeave={() => { if (!isTauriRuntime()) setHovered(false) }}>
      <section
        className="relative flex w-full min-w-0 flex-col items-center justify-center pt-20 text-center"
        onPointerDown={(event) => {
          if (locked || (event.target as HTMLElement).closest('button, select')) return
          void dragDesktopLyricsWindow()
        }}
      >
        {!locked && hovered && <GripHorizontal data-lyrics-hit size={18} className="absolute left-1 top-2 text-white/35 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]" aria-hidden="true" />}

        <div data-lyrics-controls className={`absolute right-[20%] top-1 z-20 flex h-9 w-[284px] items-center gap-1 transition-opacity ${hovered ? 'opacity-100' : 'pointer-events-none opacity-0'}`} aria-hidden={!hovered}>
          <button type="button" title="上一首" aria-label="上一首" disabled={stale || !songId} onClick={() => command('previous')} className={controlClass}><SkipBack size={15} /></button>
          <button type="button" title={snapshot?.isPlaying ? '暂停' : '播放'} aria-label={snapshot?.isPlaying ? '暂停' : '播放'} disabled={stale || !songId} onClick={() => command('toggle')} className={controlClass}>{snapshot?.isPlaying ? <Pause size={15} /> : <Play size={15} />}</button>
          <button type="button" title="下一首" aria-label="下一首" disabled={stale || !songId} onClick={() => command('next')} className={controlClass}><SkipForward size={15} /></button>
          <button type="button" title="重听本句" aria-label="重听本句" disabled={stale || !range} onClick={() => command('replay', { range: range! })} className={controlClass}><RotateCcw size={15} /></button>
          <button type="button" title={snapshot?.sentenceLoop ? '退出单句循环' : '单句循环'} aria-label="单句循环" aria-pressed={!!snapshot?.sentenceLoop} disabled={stale || (!range && !snapshot?.sentenceLoop)} onClick={() => command('loop', { range: range ?? undefined })} className={toggleClass(!!snapshot?.sentenceLoop)}><Repeat1 size={15} /></button>
          <button type="button" title={t('player.desktopLyricsSettings')} aria-label={t('player.desktopLyricsSettings')} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((current) => !current)} className={toggleClass(settingsOpen)}><Settings2 size={15} /></button>
          <button type="button" title={t(locked ? 'player.desktopLyricsUnlock' : 'player.desktopLyricsLock')} aria-label={t(locked ? 'player.desktopLyricsUnlock' : 'player.desktopLyricsLock')} aria-pressed={locked} onClick={() => changeDesktopLyricsLock(!locked)} className={toggleClass(locked)}>{locked ? <Lock size={15} /> : <Unlock size={15} />}</button>
          <button type="button" title={t('player.desktopLyricsClose')} aria-label={t('player.desktopLyricsClose')} onClick={() => void hideDesktopLyricsWindow()} className={controlClass}><X size={16} /></button>
        </div>

        {settingsOpen && hovered && (
          <div data-lyrics-controls className="absolute right-[20%] top-9 z-20 flex h-10 items-center gap-1" role="toolbar" aria-label={t('player.desktopLyricsSettings')}>
            <button type="button" title={t('player.desktopLyricsFontDecrease')} aria-label={t('player.desktopLyricsFontDecrease')} disabled={preferences.fontSize <= 18} onClick={() => updatePreference('fontSize', Math.max(18, preferences.fontSize - 2))} className={`${controlClass} disabled:opacity-30`}><Minus size={15} /></button>
            <span className="grid h-8 min-w-8 place-items-center rounded-full bg-black/60 px-2 text-[11px] tabular-nums text-white backdrop-blur-md">{preferences.fontSize}</span>
            <button type="button" title={t('player.desktopLyricsFontIncrease')} aria-label={t('player.desktopLyricsFontIncrease')} disabled={preferences.fontSize >= 48} onClick={() => updatePreference('fontSize', Math.min(48, preferences.fontSize + 2))} className={`${controlClass} disabled:opacity-30`}><Plus size={15} /></button>
            <button type="button" title={t('player.desktopLyricsFurigana')} aria-label={t('player.desktopLyricsFurigana')} aria-pressed={preferences.showFurigana} onClick={() => updatePreference('showFurigana', !preferences.showFurigana)} className={toggleClass(preferences.showFurigana)}><Languages size={15} /></button>
            <button type="button" title={t('player.desktopLyricsRomaji')} aria-label={t('player.desktopLyricsRomaji')} aria-pressed={preferences.showRomaji} onClick={() => updatePreference('showRomaji', !preferences.showRomaji)} className={toggleClass(preferences.showRomaji)}><Type size={15} /></button>
            <button type="button" title={t('player.desktopLyricsNextLine')} aria-label={t('player.desktopLyricsNextLine')} aria-pressed={preferences.showNextLine} onClick={() => updatePreference('showNextLine', !preferences.showNextLine)} className={toggleClass(preferences.showNextLine)}><ListEnd size={15} /></button>
            <button type="button" title="半透明黑底" aria-label="半透明黑底" aria-pressed={preferences.desktopBackground} onClick={() => updatePreference('desktopBackground', !preferences.desktopBackground)} className={toggleClass(preferences.desktopBackground)}><Contrast size={15} /></button>
            <button type="button" title="显示中文翻译" aria-label="显示中文翻译" aria-pressed={preferences.showTranslation} onClick={() => updatePreference('showTranslation', !preferences.showTranslation)} className={toggleClass(preferences.showTranslation)}><Subtitles size={15} /></button>
            <select title="播放速度（保持音高）" aria-label="播放速度" disabled={stale} value={snapshot?.playbackRate ?? 1} onChange={event => command('rate', { rate: Number(event.target.value) })} className="h-8 w-[68px] rounded bg-black/60 text-xs text-white">
              <option value={0.75}>0.75×</option><option value={0.9}>0.9×</option><option value={1}>1×</option>
            </select>
          </div>
        )}

        {!snapshot?.song && <p className="text-sm text-white/65 drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)]">{t('player.empty')}</p>}
        {snapshot?.song && lyricsQuery.isLoading && <p className="text-sm text-white/65 drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)]">{t('lyric.loading')}</p>}
        {snapshot?.song && lyricsQuery.isError && <div data-lyrics-controls role="alert" className="flex items-center gap-2 bg-black/60 px-3 py-2 text-sm">歌词加载失败<button type="button" title="重新加载歌词" aria-label="重新加载歌词" disabled={lyricsQuery.isFetching} onClick={() => void lyricsQuery.refetch()} className={controlClass}><RotateCcw size={16} /></button></div>}
        {snapshot?.song && !lyricsQuery.isError && !lyricsQuery.isLoading && !activeLine && <div><p className="font-medium text-white drop-shadow-[0_1px_5px_rgba(0,0,0,0.95)]">{snapshot.song.title}</p><p className="mt-1 text-xs text-white/60 drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)]">{t('lyric.empty')}</p></div>}
        {stale && snapshot?.song && <p role="status" className="bg-black/60 px-3 py-1 text-xs text-white">播放器连接已断开</p>}
        {preferenceError && !locked && <p role="alert" className="text-xs text-red-300">设置暂未同步，请检查连接</p>}
        {activeLine && <div key={`${songId}:${activeLine.id}`} data-lyrics-hit className={`desktop-lyric-text min-w-0 max-w-full rounded-none px-4 py-2 ${preferences.desktopBackground ? 'bg-black/60' : 'bg-transparent'}`}>
          <DesktopLyricTrack
            lang="ja"
            className="font-semibold leading-[1.7] text-[#ff8298]"
            style={{ fontSize: `${preferences.fontSize}px` }}
          >
            <DesktopLyricText text={activeLine.originalText} ruby={activeLine.originalRuby} enabled={preferences.showFurigana} />
          </DesktopLyricTrack>
          {showRomaji && <DesktopLyricTrack className="mt-0.5 text-zinc-200" style={{ fontSize: `${Math.max(11, Math.round(preferences.fontSize * 0.43))}px` }}>{romaji}</DesktopLyricTrack>}
          {showTranslation && <DesktopLyricTrack lang="zh-CN" className="desktop-lyric-translation mt-2 font-medium leading-relaxed text-white" style={{ fontSize: `${Math.max(16, Math.round(preferences.fontSize * 0.65))}px`, fontFamily: '"Microsoft YaHei UI", "Noto Sans SC", sans-serif' }}>{translation}</DesktopLyricTrack>}
          {preferences.showNextLine && nextLine && <DesktopLyricTrack className="mt-2 text-zinc-200" style={{ fontSize: `${Math.max(11, Math.round(preferences.fontSize * 0.46))}px` }}>{nextLine.originalText}</DesktopLyricTrack>}
        </div>}
      </section>
    </main>
  )
}
