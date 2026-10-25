import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Save } from 'lucide-react'
import { updateLyricLines } from '../../api/music'
import { getApiErrorMessage } from '../../api/error'
import { queryClient } from '../../lib/query-client'
import type { LyricResponse } from '../../types/music'

interface DraftLine {
  id: number
  start: string
  end: string
  originalText: string
  translatedText: string
  romajiText: string
}

function milliseconds(value: string): number | null {
  if (!value.trim()) return null
  return Math.max(0, Math.round(Number(value) * 1000))
}

export default function LyricLineEditor({ lyric, token, songId }: { lyric: LyricResponse; token: string; songId: number }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<DraftLine[]>([])

  useEffect(() => {
    setDraft(lyric.lines.map((line) => ({
      id: line.id,
      start: line.startMs == null ? '' : (line.startMs / 1000).toFixed(2),
      end: line.endMs == null ? '' : (line.endMs / 1000).toFixed(2),
      originalText: line.originalText,
      translatedText: line.translatedText ?? '',
      romajiText: line.romajiText ?? '',
    })))
  }, [lyric.id, lyric.lines])

  const saveMutation = useMutation({
    mutationFn: () => updateLyricLines(lyric.id as number, draft.map((line) => ({
      id: line.id,
      startMs: milliseconds(line.start),
      endMs: milliseconds(line.end),
      originalText: line.originalText,
      translatedText: line.translatedText || null,
      romajiText: line.romajiText || null,
    })), token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['song-lyrics', songId] })
      await queryClient.invalidateQueries({ queryKey: ['song-words', songId] })
    },
  })

  const update = (index: number, field: keyof Omit<DraftLine, 'id'>, value: string) => {
    setDraft((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line))
  }

  return (
    <details className="rounded-md border border-white/[0.08] bg-black/10">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-200">
        {t('lyric.editor.title', { defaultValue: '逐句编辑歌词与时间轴' })}
      </summary>
      <div className="space-y-3 border-t border-white/[0.08] p-4">
        <p className="text-xs text-zinc-500">{t('lyric.editor.hint', { defaultValue: '时间以秒为单位。修改原文后，对应的分词结果会等待重新生成。' })}</p>
        <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {draft.map((line, index) => (
            <div key={line.id} className="grid gap-2 rounded border border-white/[0.07] bg-black/20 p-3 lg:grid-cols-[58px_86px_86px_1fr_1fr]">
              <span className="self-center text-xs text-zinc-600">#{index + 1}</span>
              <input aria-label={t('lyric.editor.start', { defaultValue: '开始秒数' })} type="number" min="0" step="0.01" value={line.start} onChange={(event) => update(index, 'start', event.target.value)} className="h-9 rounded border border-white/10 bg-[#18181d] px-2 text-xs" placeholder="0.00" />
              <input aria-label={t('lyric.editor.end', { defaultValue: '结束秒数' })} type="number" min="0" step="0.01" value={line.end} onChange={(event) => update(index, 'end', event.target.value)} className="h-9 rounded border border-white/10 bg-[#18181d] px-2 text-xs" placeholder="--" />
              <div className="grid gap-2">
                <input value={line.originalText} onChange={(event) => update(index, 'originalText', event.target.value)} className="h-9 rounded border border-white/10 bg-[#18181d] px-2 text-sm" placeholder={t('lyric.editor.original', { defaultValue: '日文原文' })} />
                <input value={line.romajiText} onChange={(event) => update(index, 'romajiText', event.target.value)} className="h-9 rounded border border-white/10 bg-[#18181d] px-2 text-xs text-zinc-400" placeholder={t('lyric.editor.romaji', { defaultValue: '罗马音' })} />
              </div>
              <input value={line.translatedText} onChange={(event) => update(index, 'translatedText', event.target.value)} className="h-9 rounded border border-white/10 bg-[#18181d] px-2 text-sm" placeholder={t('lyric.editor.translation', { defaultValue: '中文翻译' })} />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={saveMutation.isPending || draft.length === 0} onClick={() => saveMutation.mutate()} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#ff4d6d] px-4 text-sm font-semibold text-white disabled:opacity-40">
            <Save size={16} />{saveMutation.isPending ? t('common.saving') : t('lyric.editor.save', { defaultValue: '保存逐句修改' })}
          </button>
          {saveMutation.isSuccess && <span className="text-sm text-emerald-400">{t('lyric.editor.saved', { defaultValue: '歌词已更新' })}</span>}
          {saveMutation.isError && <span className="text-sm text-red-400">{getApiErrorMessage(saveMutation.error, t('lyric.editor.failed', { defaultValue: '歌词保存失败' }))}</span>}
        </div>
      </div>
    </details>
  )
}
