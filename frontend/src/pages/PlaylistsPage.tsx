import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ListMusic, Music2, Plus } from 'lucide-react'
import { createPlaylist, listPlaylists } from '../api/playlists'
import { getApiErrorMessage } from '../api/error'
import { resolveMediaUrl } from '../api/http'
import { queryClient } from '../lib/query-client'
import { useAuthStore } from '../store/useAuthStore'
import PlaylistDetailPage from './PlaylistDetailPage'
import { Dialog } from '../components/ui/Dialog'

export default function PlaylistsPage() {
  const { t } = useTranslation()
  const token = useAuthStore((state) => state.token)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState('public')

  const query = useQuery({ queryKey: ['playlists', token], queryFn: () => listPlaylists(token as string), enabled: Boolean(token) })
  const playlists = useMemo(() => query.data ?? [], [query.data])
  useEffect(() => {
    if (playlists.length === 0) { setSelectedId(null); return }
    if (!selectedId || !playlists.some((item) => item.id === selectedId)) setSelectedId(playlists[0]!.id)
  }, [playlists, selectedId])

  const createMutation = useMutation({
    mutationFn: () => createPlaylist(token as string, { name: name.trim(), description: description.trim() || undefined, visibility }),
    onSuccess: async (playlist) => {
      setName(''); setDescription(''); setShowCreate(false); setSelectedId(playlist.id)
      await queryClient.invalidateQueries({ queryKey: ['playlists', token] })
    },
  })
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (name.trim()) createMutation.mutate() }

  return (
    <div className="content-page space-y-7">
      <header className="page-heading flex items-end justify-between gap-4">
        <div><h2>{t('playlists.title')}</h2></div>
        <button type="button" onClick={() => setShowCreate(true)} className="primary-button"><Plus size={17} />{t('playlists.create')}</button>
      </header>

      {query.isLoading && <p className="py-12 text-center text-sm text-zinc-500">{t('playlists.loading')}</p>}
      {query.isError && <p className="text-red-400">{getApiErrorMessage(query.error, t('playlists.loadFailed'))}</p>}
      {!query.isLoading && !query.isError && playlists.length === 0 && <div className="empty-state"><ListMusic size={38} /><p>{t('playlists.empty')}</p><button type="button" onClick={() => setShowCreate(true)}>{t('playlists.create')}</button></div>}

      {playlists.length > 0 && <section>
        <div className="mb-4 flex items-center justify-between"><h3 className="section-title">{t('playlists.all', { defaultValue: '全部歌单' })}</h3><span className="text-xs text-zinc-600">{playlists.length}</span></div>
        <div className="playlist-shelf grid grid-cols-[repeat(auto-fill,minmax(132px,170px))] gap-x-4 gap-y-5">
          {playlists.map((playlist) => <button key={playlist.id} type="button" aria-pressed={selectedId === playlist.id} onClick={() => setSelectedId(playlist.id)} className={`playlist-tile min-w-0 text-left ${selectedId === playlist.id ? 'is-active' : ''}`}>
            <span className="playlist-cover relative block aspect-square w-full overflow-hidden rounded-md bg-[#24242b] shadow-[0_12px_28px_rgba(0,0,0,0.24)]">{playlist.coverUrl ? <img src={resolveMediaUrl(playlist.coverUrl)} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center"><Music2 size={30} className="text-zinc-600" /></span>}<span className="playlist-count absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-zinc-200">{playlist.songCount}</span></span>
            <strong className="mt-2 block truncate text-sm font-medium text-zinc-200">{playlist.name}</strong>
            <span className="text-xs text-zinc-400">{playlist.visibility === 'public' ? '公共歌单' : '私人歌单'}</span>
            <span className="mt-0.5 block truncate text-xs text-zinc-600">{playlist.description || t('common.songsCount', { count: playlist.songCount })}</span>
          </button>)}
        </div>
      </section>}

      {selectedId && <section className="border-t border-white/[0.065] pt-7"><PlaylistDetailPage playlistId={selectedId} embedded onDeleted={() => setSelectedId(null)} /></section>}

      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title={t('playlists.create')}>
        <form onSubmit={submit} className="p-5">
          <label className="mb-4 grid gap-2 text-sm text-zinc-400">可见范围<select className="account-input" value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="public">公共歌单</option><option value="private">私人歌单</option></select></label>
          <label className="grid gap-2 text-sm text-zinc-400">{t('playlists.name')}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="account-input" /></label>
          <label className="mt-4 grid gap-2 text-sm text-zinc-400">{t('playlists.description')}<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="account-input min-h-24 resize-y py-3" /></label>
          {createMutation.isError && <p className="mt-4 text-sm text-red-400">{getApiErrorMessage(createMutation.error, t('playlists.createFailed'))}</p>}
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="h-10 px-4 text-sm text-zinc-400">{t('common.cancel')}</button><button type="submit" disabled={!name.trim() || createMutation.isPending} className="h-10 rounded-md bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{createMutation.isPending ? t('playlists.creating') : t('playlists.create')}</button></div>
        </form>
      </Dialog>
    </div>
  )
}
