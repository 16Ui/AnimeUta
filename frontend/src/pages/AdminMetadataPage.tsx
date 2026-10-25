import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { deleteSong, getSongDetail, listSongs, updateSongMetadata } from '../api/music'
import { getApiErrorMessage } from '../api/error'
import { resolveMediaUrl } from '../api/http'
import { uploadImage } from '../api/media'
import { ImageEditorField } from '../components/inputs/ImageEditorField'
import { queryClient } from '../lib/query-client'
import { useAuthStore } from '../store/useAuthStore'
import { usePlayerStore } from '../store/usePlayerStore'
import type { SongMetadataUpdatePayload, SongVersionType } from '../types/music'

const versionTypes: SongVersionType[] = ['full', 'tv_size', 'instrumental', 'cover', 'live', 'ost', 'variation']
const workRelationTypes = ['opening', 'ending', 'insert_song', 'theme_song', 'background', 'character_song', 'other'] as const
const creatorRoles = ['composer', 'lyricist', 'arranger', 'producer'] as const

type CreatorDraft = { name: string; role: string }
type CharacterDraft = { name: string; voiceActors: string; relationType: string }

function parseAliases(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

export default function AdminMetadataPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const token = useAuthStore((state) => state.token)
  const currentUser = useAuthStore((state) => state.currentUser)
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue)
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner'

  const routeSongId = Number(id)
  const selectedSongId = Number.isInteger(routeSongId) && routeSongId > 0 ? routeSongId : null
  const [songCoverUrl, setSongCoverUrl] = useState('')
  const [artistName, setArtistName] = useState('')
  const [artistAvatarUrl, setArtistAvatarUrl] = useState('')
  const [workTitle, setWorkTitle] = useState('')
  const [workCoverUrl, setWorkCoverUrl] = useState('')
  const [workRelationType, setWorkRelationType] = useState('opening')
  const [albumTitle, setAlbumTitle] = useState('')
  const [albumCoverUrl, setAlbumCoverUrl] = useState('')
  const [publisherName, setPublisherName] = useState('')
  const [labelName, setLabelName] = useState('')
  const [versionType, setVersionType] = useState<SongVersionType>('full')
  const [versionGroupTitle, setVersionGroupTitle] = useState('')
  const [creators, setCreators] = useState<CreatorDraft[]>([])
  const [characters, setCharacters] = useState<CharacterDraft[]>([])
  const [songAliasesText, setSongAliasesText] = useState('')
  const [artistAliasesText, setArtistAliasesText] = useState('')
  const [workAliasesText, setWorkAliasesText] = useState('')
  const [albumAliasesText, setAlbumAliasesText] = useState('')
  const [imageUploadError, setImageUploadError] = useState('')

  const songsQuery = useQuery({
    queryKey: ['admin-manage-songs'],
    queryFn: () => listSongs({ page: 1, pageSize: 100 }),
    enabled: Boolean(token && isAdmin),
  })

  const songs = useMemo(() => songsQuery.data?.data ?? [], [songsQuery.data])

  const detailQuery = useQuery({
    queryKey: ['song-detail', selectedSongId],
    queryFn: () => getSongDetail(selectedSongId as number),
    enabled: Boolean(selectedSongId),
  })

  useEffect(() => {
    const detail = detailQuery.data
    if (!detail) {
      return
    }
    setSongCoverUrl(detail.coverUrl ?? '')
    setArtistName(detail.artists[0]?.displayName ?? '')
    setArtistAvatarUrl(detail.artists[0]?.avatarUrl ?? '')
    setWorkTitle(detail.works[0]?.displayTitle ?? '')
    setWorkCoverUrl(detail.works[0]?.coverUrl ?? '')
    setWorkRelationType(detail.works[0]?.relationType ?? 'opening')
    setAlbumTitle(detail.albums[0]?.displayTitle ?? '')
    setAlbumCoverUrl(detail.albums[0]?.coverUrl ?? '')
    setPublisherName(detail.publisher?.name ?? '')
    setLabelName(detail.label?.name ?? '')
    setVersionType(detail.versionType ?? 'full')
    setVersionGroupTitle(detail.versionGroup?.groupTitle ?? detail.displayTitle)
    setSongAliasesText((detail.aliases ?? []).join('\n'))
    setArtistAliasesText((detail.artists[0]?.aliases ?? []).join('\n'))
    setWorkAliasesText((detail.works[0]?.aliases ?? []).join('\n'))
    setAlbumAliasesText((detail.albums[0]?.aliases ?? []).join('\n'))
    setCreators(detail.creators.map((creator) => ({ name: creator.name, role: creator.role })))
    setCharacters(detail.characters.map((character) => ({
      name: character.nameZh ?? character.nameJa ?? character.name,
      voiceActors: character.voiceActors.map((actor) => actor.nameZh ?? actor.nameJa ?? actor.name).join(', '),
      relationType: character.relationType,
    })))
  }, [detailQuery.data])

  const mutation = useMutation({
    mutationFn: (payload: SongMetadataUpdatePayload) =>
      updateSongMetadata(selectedSongId as number, payload, token as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['song-detail', selectedSongId] })
      await queryClient.invalidateQueries({ queryKey: ['songs'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSong(selectedSongId as number, token as string),
    onSuccess: async () => {
      if (selectedSongId) {
        removeFromQueue(selectedSongId)
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-manage-songs'] })
      await queryClient.invalidateQueries({ queryKey: ['songs'] })
      await queryClient.invalidateQueries({ queryKey: ['charts'] })
      navigate('/admin/songs', { replace: true })
    },
  })

  if (!isAdmin) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedSongId) {
      return
    }
    mutation.mutate({
      workTitle: workTitle.trim() || undefined,
      workCoverUrl: workCoverUrl.trim(),
      workRelationType: workRelationType.trim() || undefined,
      songCoverUrl: songCoverUrl.trim(),
      artistName: artistName.trim() || undefined,
      artistAvatarUrl: artistAvatarUrl.trim(),
      albumTitle: albumTitle.trim() || undefined,
      albumCoverUrl: albumCoverUrl.trim(),
      publisherName: publisherName.trim() || undefined,
      labelName: labelName.trim() || undefined,
      versionType,
      versionGroupTitle: versionGroupTitle.trim() || undefined,
      songAliases: parseAliases(songAliasesText),
      artistAliases: parseAliases(artistAliasesText),
      workAliases: parseAliases(workAliasesText),
      albumAliases: parseAliases(albumAliasesText),
      creators: creators.filter((item) => item.name.trim()).map((item) => ({
        name: item.name.trim(),
        role: item.role,
        creatorType: item.role,
      })),
      characters: characters.filter((item) => item.name.trim()).map((item) => ({
        name: item.name.trim(),
        relationType: item.relationType,
        voiceActorNames: item.voiceActors.split(/[,，]/).map((actor) => actor.trim()).filter(Boolean),
      })),
    })
  }

  const uploadMetadataImage = async (file: File, setter: (value: string) => void) => {
    if (!token) {
      return
    }
    setImageUploadError('')
    try {
      const uri = await uploadImage(file, token)
      setter(uri)
    } catch (error) {
      setImageUploadError(getApiErrorMessage(error, t('admin.metadata.imageUploadFailed')))
    }
  }

  const handleDeleteSong = () => {
    if (!selectedSongId || !detailQuery.data) {
      return
    }
    const confirmed = window.confirm(t('admin.metadata.deleteConfirm', { title: detailQuery.data.displayTitle }))
    if (confirmed) {
      deleteMutation.mutate()
    }
  }

  if (!selectedSongId) {
    return (
      <div className="space-y-5 p-3 md:p-6">
        <div className="flex items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div>
            <h2 className="text-2xl font-bold">{t('admin.metadata.title')}</h2>
            <p className="mt-1 text-sm text-gray-400">{t('admin.metadata.listSubtitle')}</p>
          </div>
          <span className="text-sm text-zinc-500">{t('admin.metadata.songCount', { count: songs.length })}</span>
        </div>
        {songsQuery.isLoading && <p className="text-sm text-gray-400">{t('common.loading')}</p>}
        {songsQuery.isError && <p className="text-sm text-red-400">{getApiErrorMessage(songsQuery.error, t('admin.metadata.loadFailed'))}</p>}
        {!songsQuery.isLoading && songs.length === 0 && <p className="text-sm text-zinc-500">{t('admin.metadata.empty')}</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {songs.map((song) => (
            <Link
              key={song.id}
              to={`/admin/songs/${song.id}`}
              className="group grid grid-cols-[76px_minmax(0,1fr)_32px] items-center gap-3 rounded-md border border-white/[0.08] bg-white/[0.03] p-3 transition hover:border-white/20 hover:bg-white/[0.06]"
            >
              <div className="h-[76px] w-[76px] overflow-hidden rounded bg-white/[0.06]">
                {song.coverUrl ? (
                  <img src={resolveMediaUrl(song.coverUrl)} alt={song.displayTitle} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center px-1 text-center text-xs text-zinc-500">{t('common.noCover')}</div>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{song.displayTitle}</p>
                <p className="mt-1 truncate text-xs text-zinc-500">{song.primaryArtistName ?? t('common.unknownArtist')}</p>
              </div>
              <Pencil size={17} className="text-zinc-600 transition group-hover:text-[#ff4d6d]" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-3 md:p-6">
      <div className="flex items-start gap-3 border-b border-white/[0.08] pb-5">
        <Link to="/admin/songs" className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-white" title={t('admin.metadata.backToList')}>
          <ArrowLeft size={19} aria-hidden="true" />
          <span className="sr-only">{t('admin.metadata.backToList')}</span>
        </Link>
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-bold">{detailQuery.data?.displayTitle ?? t('admin.metadata.editTitle')}</h2>
          <p className="mt-1 text-sm text-gray-400">{t('admin.metadata.subtitle')}</p>
        </div>
      </div>

      {detailQuery.isLoading && <p className="text-sm text-zinc-500">{t('common.loading')}</p>}
      {detailQuery.isError && <p className="text-sm text-red-400">{getApiErrorMessage(detailQuery.error, t('admin.metadata.loadFailed'))}</p>}

      {detailQuery.data && (
        <nav aria-label={t('content.relatedEntities')} className="flex flex-wrap gap-2">
          {detailQuery.data.publisher && <EntityLink to={`/publisher/${detailQuery.data.publisher.id}`} label={detailQuery.data.publisher.nameZh ?? detailQuery.data.publisher.nameJa ?? detailQuery.data.publisher.name} />}
          {detailQuery.data.label && <EntityLink to={`/label/${detailQuery.data.label.id}`} label={detailQuery.data.label.nameZh ?? detailQuery.data.label.nameJa ?? detailQuery.data.label.name} />}
          {detailQuery.data.creators.map((creator) => <EntityLink key={`creator-${creator.id}`} to={`/creator/${creator.id}`} label={creator.nameZh ?? creator.nameJa ?? creator.name} />)}
          {detailQuery.data.characters.map((character) => (
            <span key={`character-${character.id}`} className="contents">
              <EntityLink to={`/character/${character.id}`} label={character.nameZh ?? character.nameJa ?? character.name} />
              {character.voiceActors.map((actor) => <EntityLink key={`voice-${actor.id}`} to={`/voice-actor/${actor.id}`} label={actor.nameZh ?? actor.nameJa ?? actor.name} />)}
            </span>
          ))}
          {detailQuery.data.versionGroup && <EntityLink to={`/version-group/${detailQuery.data.versionGroup.id}`} label={detailQuery.data.versionGroup.groupTitle} />}
        </nav>
      )}

      <form className="grid gap-4" onSubmit={handleSubmit}>

        <div className="grid gap-3 md:grid-cols-2">
          <ImageEditorField label={t('admin.metadata.songCoverUrl')} value={songCoverUrl} onChange={setSongCoverUrl} onUpload={(file) => void uploadMetadataImage(file, setSongCoverUrl)} />
          <label className="grid gap-2 text-sm text-gray-300">
            {t('admin.metadata.artistName')}
            <input className="rounded border border-gray-700 bg-gray-900 p-2 text-white" value={artistName} onChange={(event) => setArtistName(event.target.value)} />
          </label>
          <ImageEditorField label={t('admin.metadata.artistAvatarUrl')} value={artistAvatarUrl} onChange={setArtistAvatarUrl} onUpload={(file) => void uploadMetadataImage(file, setArtistAvatarUrl)} />
          <label className="grid gap-2 text-sm text-gray-300">
            {t('admin.metadata.workTitle')}
            <input className="rounded border border-gray-700 bg-gray-900 p-2 text-white" value={workTitle} onChange={(event) => setWorkTitle(event.target.value)} />
          </label>
          <ImageEditorField label={t('admin.metadata.workCoverUrl')} value={workCoverUrl} onChange={setWorkCoverUrl} onUpload={(file) => void uploadMetadataImage(file, setWorkCoverUrl)} />
          <label className="grid gap-2 text-sm text-gray-300">
            {t('admin.metadata.workRelationType')}
            <select className="rounded border border-gray-700 bg-gray-900 p-2 text-white" value={workRelationType} onChange={(event) => setWorkRelationType(event.target.value)}>
              {workRelationTypes.map((item) => <option key={item} value={item}>{t(`song.workRelations.${item}`)}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm text-gray-300">
            {t('admin.metadata.albumTitle')}
            <input className="rounded border border-gray-700 bg-gray-900 p-2 text-white" value={albumTitle} onChange={(event) => setAlbumTitle(event.target.value)} />
          </label>
          <ImageEditorField label={t('admin.metadata.albumCoverUrl')} value={albumCoverUrl} onChange={setAlbumCoverUrl} onUpload={(file) => void uploadMetadataImage(file, setAlbumCoverUrl)} />
          <label className="grid gap-2 text-sm text-gray-300">
            {t('admin.metadata.publisherName')}
            <input className="rounded border border-gray-700 bg-gray-900 p-2 text-white" value={publisherName} onChange={(event) => setPublisherName(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm text-gray-300">
            {t('admin.metadata.labelName')}
            <input className="rounded border border-gray-700 bg-gray-900 p-2 text-white" value={labelName} onChange={(event) => setLabelName(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm text-gray-300">
            {t('admin.metadata.versionType')}
            <select className="rounded border border-gray-700 bg-gray-900 p-2 text-white" value={versionType} onChange={(event) => setVersionType(event.target.value as SongVersionType)}>
              {versionTypes.map((item) => (
                <option key={item} value={item}>
                  {t(`song.versionTypes.${item}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm text-gray-300">
            {t('admin.metadata.versionGroupTitle')}
            <input className="rounded border border-gray-700 bg-gray-900 p-2 text-white" value={versionGroupTitle} onChange={(event) => setVersionGroupTitle(event.target.value)} />
          </label>
        </div>
        {imageUploadError && <p className="text-sm text-red-400">{imageUploadError}</p>}

        <section className="space-y-3 border-t border-white/[0.08] pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">{t('admin.metadata.creators')}</h3>
            <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 px-3 text-xs text-zinc-300 hover:bg-white/[0.06]" onClick={() => setCreators((items) => [...items, { name: '', role: 'composer' }])}>
              <Plus size={14} aria-hidden="true" />{t('admin.metadata.addCreator')}
            </button>
          </div>
          {creators.map((creator, index) => (
            <div key={`creator-${index}`} className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_36px]">
              <select aria-label={t('admin.metadata.creatorRole')} className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-white" value={creator.role} onChange={(event) => setCreators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, role: event.target.value } : item))}>
                {creatorRoles.map((role) => <option key={role} value={role}>{t(`song.creatorRoles.${role}`)}</option>)}
              </select>
              <input aria-label={t('admin.metadata.creatorName')} placeholder={t('admin.metadata.creatorName')} className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-white" value={creator.name} onChange={(event) => setCreators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
              <button type="button" title={t('common.remove')} aria-label={t('common.remove')} className="grid h-10 w-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-red-300" onClick={() => setCreators((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} aria-hidden="true" /></button>
            </div>
          ))}
        </section>

        <section className="space-y-3 border-t border-white/[0.08] pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">{t('admin.metadata.characters')}</h3>
            <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 px-3 text-xs text-zinc-300 hover:bg-white/[0.06]" onClick={() => setCharacters((items) => [...items, { name: '', voiceActors: '', relationType: 'character_song' }])}>
              <Plus size={14} aria-hidden="true" />{t('admin.metadata.addCharacter')}
            </button>
          </div>
          {characters.map((character, index) => (
            <div key={`character-${index}`} className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_36px]">
              <input aria-label={t('admin.metadata.characterName')} placeholder={t('admin.metadata.characterName')} className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-white" value={character.name} onChange={(event) => setCharacters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
              <input aria-label={t('admin.metadata.voiceActorNames')} placeholder={t('admin.metadata.voiceActorNames')} className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-white" value={character.voiceActors} onChange={(event) => setCharacters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, voiceActors: event.target.value } : item))} />
              <select aria-label={t('admin.metadata.characterRelation')} className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-white" value={character.relationType} onChange={(event) => setCharacters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, relationType: event.target.value } : item))}>
                {workRelationTypes.map((relation) => <option key={relation} value={relation}>{t(`song.workRelations.${relation}`)}</option>)}
              </select>
              <button type="button" title={t('common.remove')} aria-label={t('common.remove')} className="grid h-10 w-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-red-300" onClick={() => setCharacters((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} aria-hidden="true" /></button>
            </div>
          ))}
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          {([
            ['songAliases', songAliasesText, setSongAliasesText],
            ['artistAliases', artistAliasesText, setArtistAliasesText],
            ['workAliases', workAliasesText, setWorkAliasesText],
            ['albumAliases', albumAliasesText, setAlbumAliasesText],
          ] as const).map(([key, value, setter]) => (
            <label key={key} className="grid gap-2 text-sm text-gray-300">
              {t(`admin.metadata.${key}`)}
              <textarea value={value} onChange={(event) => setter(event.target.value)} placeholder={t('admin.metadata.aliasesPlaceholder')} className="min-h-20 rounded border border-gray-700 bg-gray-900 p-2 text-sm text-white" />
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!selectedSongId || mutation.isPending} className="rounded bg-primary px-4 py-2 text-sm font-semibold text-black disabled:opacity-40">
            {mutation.isPending ? t('common.saving') : t('admin.metadata.save')}
          </button>
          <button
            type="button"
            disabled={!selectedSongId || deleteMutation.isPending}
            className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            onClick={handleDeleteSong}
          >
            {deleteMutation.isPending ? t('common.deleting') : t('admin.metadata.deleteSong')}
          </button>
          {mutation.isSuccess && <span className="text-sm text-green-400">{t('admin.metadata.saved')}</span>}
          {mutation.isError && <span className="text-sm text-red-400">{getApiErrorMessage(mutation.error, t('admin.metadata.saveFailed'))}</span>}
          {deleteMutation.isSuccess && <span className="text-sm text-green-400">{t('admin.metadata.deleted')}</span>}
          {deleteMutation.isError && <span className="text-sm text-red-400">{getApiErrorMessage(deleteMutation.error, t('admin.metadata.deleteFailed'))}</span>}
        </div>
      </form>
    </div>
  )
}

function EntityLink({ to, label }: { to: string; label: string }) {
  return <Link to={to} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-300 hover:border-[#ff6b84]/50 hover:text-white">{label}</Link>
}
