import { useEffect, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { checkClientUpdate, downloadClientUpdate } from '../lib/clientUpdates'

export function ClientUpdate({ automatic = false }: { automatic?: boolean }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkClientUpdate>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const check = async () => {
    setBusy(true); setError('')
    try { setResult(await checkClientUpdate()); setDismissed(false) }
    catch (e) { setError(e instanceof Error ? e.message : '检查更新失败，请重试') }
    finally { setBusy(false) }
  }
  useEffect(() => { if (automatic) void check() }, [automatic])
  if (automatic && (!result?.release || dismissed)) return null
  const download = async () => {
    try { await downloadClientUpdate() }
    catch { setError('无法打开下载，请重试') }
  }
  return <section className={automatic ? 'fixed bottom-28 left-4 right-4 z-50 mx-auto max-w-md rounded-md border border-white/15 bg-[#26262c] p-4 shadow-xl' : 'border-t border-white/10 py-4'} aria-label="客户端更新">
    <div className="flex items-center justify-between gap-3"><strong className="text-sm">{result?.release ? `发现新版本 ${result.release.version}` : '客户端更新'}</strong>{automatic ? <button type="button" className="icon-button" title="稍后更新" aria-label="稍后更新" onClick={() => setDismissed(true)}><X size={18} /></button> : <button type="button" disabled={busy} onClick={() => void check()} className="secondary-button"><RefreshCw size={16} className={busy ? 'animate-spin' : ''} />{busy ? '正在检查' : '检查更新'}</button>}</div>
    {result?.client && <p className="mt-2 text-xs text-zinc-400">当前版本 {result.client.version}{!result.release ? ' · 已是最新版本' : ''}</p>}
    {result && !result.client && <p className="mt-2 text-sm text-zinc-400">网页端刷新即可使用最新版本</p>}
    {result?.release && <><p className="my-3 whitespace-pre-wrap text-sm text-zinc-300">{result.release.notes}</p><button type="button" className="primary-button" onClick={() => void download()}><Download size={16} />下载更新 · {(result.release.size / 1048576).toFixed(1)} MB</button></>}
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  </section>
}
