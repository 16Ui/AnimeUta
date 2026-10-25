import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ExternalLink, Save, Tags } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { getAcgEntityDetail, updateAcgEntity } from '../api/content'
import { getApiErrorMessage } from '../api/error'
import { resolveMediaUrl } from '../api/http'
import { uploadImage } from '../api/media'
import { ImageEditorField } from '../components/inputs/ImageEditorField'
import { SongRow } from '../components/music/SongRow'
import { queryClient } from '../lib/query-client'
import { acgEntityPath } from '../lib/acg'
import { useAuthStore } from '../store/useAuthStore'
import { usePlayerStore } from '../store/usePlayerStore'
import type { AcgEntityKind } from '../types/content'

function parseAliases(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function relationLabel(kind: AcgEntityKind, relation: string | undefined, t: TFunction): string | undefined {
  if (!relation) return undefined
  if (kind === 'creator') return t(`song.creatorRoles.${relation}`, { defaultValue: t('common.unknown') })
  if (kind === 'character') return t(`song.workRelations.${relation}`, { defaultValue: t('common.unknown') })
  if (kind === 'version_group') return t(`song.versionTypes.${relation}`, { defaultValue: t('common.unknown') })
  return undefined
}

export default function AcgEntityDetailPage({ kind }: { kind: AcgEntityKind }) {
  const { t } = useTranslation()
  const { id } = useParams()
  const entityId = Number(id)
  const token = useAuthStore((state) => state.token)
  const currentUser = useAuthStore((state) => state.currentUser)
  const playFromQueue = usePlayerStore((state) => state.playFromQueue)
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const isAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin'
  const [name, setName] = useState('')
  const [nameJa, setNameJa] = useState('')
  const [nameZh, setNameZh] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [nameRomaji, setNameRomaji] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [description, setDescription] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [aliasesText, setAliasesText] = useState('')
  const [imageError, setImageError] = useState('')

  const detailQuery = useQuery({
    queryKey: ['acg-entity', kind, entityId],
    queryFn: () => getAcgEntityDetail(kind, entityId),
    enabled: Number.isInteger(entityId) && entityId > 0,
  })

  useEffect(() => {
    if (!detailQuery.data) return
    setName(detailQuery.data.name)
    setNameJa(detailQuery.data.nameJa ?? '')
    setNameZh(detailQuery.data.nameZh ?? '')
    setNameEn(detailQuery.data.nameEn ?? '')
    setNameRomaji(detailQuery.data.nameRomaji ?? '')
    setImageUrl(detailQuery.data.imageUrl ?? '')
    setDescription(detailQuery.data.description ?? '')
    setWebsiteUrl(detailQuery.data.websiteUrl ?? '')
    setAliasesText(detailQuery.data.aliases.join('\n'))
  }, [detailQuery.data])

  const songs = useMemo(() => detailQuery.data?.relatedSongs.map((item) => item.song) ?? [], [detailQuery.data])
  const queue = useMemo(() => songs.map((song) => ({
    id: song.id,
    title: song.displayTitle,
    artist: song.primaryArtistName ?? t('common.unknownArtist'),
    coverUrl: song.coverUrl,
    audioUrl: song.audioSourceUri,
    durationSeconds: song.durationSeconds,
  })), [songs, t])

  const updateMutation = useMutation({
    mutationFn: () => updateAcgEntity(kind, entityId, {
      name,
      nameJa,
      nameZh,
      nameEn,
      nameRomaji,
      imageUrl,
      description,
      websiteUrl,
      aliases: parseAliases(aliasesText),
    }, token as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['acg-entity', kind, entityId] })
      await queryClient.invalidateQueries({ queryKey: ['search'] })
      await queryClient.invalidateQueries({ queryKey: ['song-detail'] })
    },
  })

  const handleImage = async (file: File) => {
    if (!token) return
    setImageError('')
    try {
      setImageUrl(await uploadImage(file, token))
    } catch (error) {
      setImageError(getApiErrorMessage(error, t('content.imageUploadFailed')))
    }
  }

  if (!Number.isInteger(entityId) || entityId <= 0) return <p className="p-6 text-red-400">{t('content.invalidEntityId')}</p>
  if (detailQuery.isLoading) return <p className="p-6 text-zinc-500">{t('content.loadingEntity')}</p>
  if (detailQuery.isError || !detailQuery.data) {
    return <p className="p-6 text-red-400">{t('content.loadEntityFailed', { message: getApiErrorMessage(detailQuery.error, t('common.unknown')) })}</p>
  }

  const data = detailQuery.data
  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 pb-12 md:p-7">
      <header className="grid gap-5 border-b border-white/[0.08] pb-7 sm:grid-cols-[144px_minmax(0,1fr)] sm:items-end">
        <div className="aspect-square w-32 overflow-hidden rounded-md bg-white/[0.06] sm:w-36">
          {data.imageUrl ? <img src={resolveMediaUrl(data.imageUrl)} alt={data.displayName} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-zinc-600"><Tags size={38} /></div>}
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase text-[#ff6b84]">{t(`search.type.${kind}`)}</p>
          <h1 className="mt-2 break-words text-3xl font-semibold text-white md:text-4xl">{data.displayName}</h1>
          {data.secondaryText && <p className="mt-2 text-sm text-zinc-400">{data.secondaryText}</p>}
          {data.aliases.length > 0 && <p className="mt-3 text-xs text-zinc-500">{t('content.aliases')}: {data.aliases.join(' / ')}</p>}
          {data.websiteUrl && <a href={data.websiteUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-zinc-300 hover:text-white">{t('content.officialWebsite')}<ExternalLink size={14} /></a>}
        </div>
      </header>

      {data.description && <section><h2 className="text-lg font-semibold">{t('content.description')}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-zinc-300">{data.description}</p></section>}

      {data.connections.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('content.relatedEntities')}</h2>
          <div className="flex flex-wrap gap-2">
            {data.connections.map((connection) => <Link key={`${connection.kind}-${connection.id}`} to={acgEntityPath(connection.kind, connection.id)} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 hover:border-[#ff6b84]/50 hover:text-white">{t(`search.type.${connection.kind}`)} · {connection.displayName}</Link>)}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('content.songs')}</h2>
        {data.relatedSongs.length === 0 && <p className="text-sm text-zinc-500">{t('content.noSongsLinked')}</p>}
        <ul className="space-y-2">
          {data.relatedSongs.map((item, index) => <li key={item.song.id}><SongRow song={item.song} eyebrow={relationLabel(kind, item.relation, t) ? <span>{relationLabel(kind, item.relation, t)}</span> : undefined} onPlay={() => playFromQueue(queue, index, { type: 'collection', name: data.displayName })} onPlayNext={() => playNextInQueue(queue[index])} onAddToQueue={() => addToQueue(queue[index])} /></li>)}
        </ul>
      </section>

      {isAdmin && (
        <form className="space-y-5 border-t border-white/[0.08] pt-7" onSubmit={(event: FormEvent) => { event.preventDefault(); updateMutation.mutate() }}>
          <h2 className="text-lg font-semibold">{t('content.editEntity')}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('content.primaryName')} value={name} onChange={setName} required />
            <Field label={t('content.nameJa')} value={nameJa} onChange={setNameJa} />
            <Field label={t('content.nameZh')} value={nameZh} onChange={setNameZh} />
            <Field label={t('content.nameEn')} value={nameEn} onChange={setNameEn} />
            <Field label={t('content.nameRomaji')} value={nameRomaji} onChange={setNameRomaji} />
            <ImageEditorField label={t('content.imageUrl')} value={imageUrl} onChange={setImageUrl} onUpload={(file) => void handleImage(file)} disabled={updateMutation.isPending} />
          </div>
          {imageError && <p className="text-sm text-red-400">{imageError}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <Area label={t('content.aliases')} value={aliasesText} onChange={setAliasesText} />
            <Area label={t('content.description')} value={description} onChange={setDescription} />
          </div>
          {kind === 'publisher' && <Field label={t('content.officialWebsite')} value={websiteUrl} onChange={setWebsiteUrl} />}
          <button type="submit" disabled={updateMutation.isPending} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#ff4d6d] px-4 text-sm font-semibold text-white disabled:opacity-40"><Save size={16} />{updateMutation.isPending ? t('common.saving') : t('common.save')}</button>
          {updateMutation.isSuccess && <span className="ml-3 text-sm text-emerald-400">{t('content.entitySaved')}</span>}
          {updateMutation.isError && <p className="text-sm text-red-400">{getApiErrorMessage(updateMutation.error, t('content.entitySaveFailed'))}</p>}
        </form>
      )}
    </div>
  )
}

function Field({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="grid gap-2 text-sm text-zinc-300">{label}<input required={required} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-white outline-none focus:border-[#ff6b84]/60" /></label>
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2 text-sm text-zinc-300">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} className="min-h-28 rounded-md border border-white/10 bg-black/20 p-3 text-white outline-none focus:border-[#ff6b84]/60" /></label>
}
