import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { searchAll, searchAllSongs, searchSuggestions } from '../../api/search'
import { getApiErrorMessage } from '../../api/error'
import { SongRow } from './SongRow'
import { BulkSongs } from './BulkSongs'
import { Pagination } from '../navigation/Pagination'
import { usePlayerStore } from '../../store/usePlayerStore'
import type { SearchSuggestionItem } from '../../types/search'

function suggestionPath(type: SearchSuggestionItem['type'], id: number) {
  const paths: Record<SearchSuggestionItem['type'], string> = {
    song: 'song', artist: 'artist', work: 'work', album: 'album', creator: 'creator',
    character: 'character', voice_actor: 'voice-actor', publisher: 'publisher', label: 'label', version_group: 'version-group',
  }
  return `/${paths[type]}/${id}`
}

export function LibrarySearch() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const suggestionsId = useId()
  const [focused, setFocused] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const queueRequest = useRef(0)
  const playFromQueue = usePlayerStore((state) => state.playFromQueue)
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const [searchParams, setSearchParams] = useSearchParams()
  const submittedKeyword = searchParams.get('q')?.trim() ?? ''
  const searchPage = Math.max(1, Math.min(100000, Math.floor(Number(searchParams.get('searchPage')) || 1)))
  const [keyword, setKeyword] = useState(submittedKeyword)
  const updateSearch = (query: string, page = 1) => setSearchParams((previous) => {
    const params = new URLSearchParams(previous)
    if (query) params.set('q', query); else params.delete('q')
    if (page > 1) params.set('searchPage', String(page)); else params.delete('searchPage')
    return params
  }, { replace: true })
  useEffect(() => { setKeyword(submittedKeyword) }, [submittedKeyword])
  const [queueLoadingSongId, setQueueLoadingSongId] = useState<number | null>(null)
  const [queueError, setQueueError] = useState('')
  const trimmed = keyword.trim()
  const searchPageSize = 10
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(trimmed), 200)
    return () => window.clearTimeout(timer)
  }, [trimmed])
  useEffect(() => () => { queueRequest.current++ }, [])

  const searchQuery = useQuery({
    queryKey: ['home-search', submittedKeyword, searchPage, searchPageSize],
    queryFn: () => searchAll({ keyword: submittedKeyword, page: searchPage, pageSize: searchPageSize }),
    enabled: submittedKeyword.length > 0,
  })
  const suggestionsQuery = useQuery({
    queryKey: ['search-suggestions', debouncedKeyword],
    queryFn: () => searchSuggestions(debouncedKeyword, 8),
    enabled: debouncedKeyword.length >= 2 && debouncedKeyword !== submittedKeyword && focused,
  })
  const songs = useMemo(() => searchQuery.data?.songs ?? [], [searchQuery.data])
  const queue = useMemo(() => songs.map((song) => ({
    id: song.id,
    title: song.displayTitle,
    artist: song.primaryArtistName ?? t('common.unknownArtist'),
    coverUrl: song.coverUrl,
    audioUrl: song.audioSourceUri,
    durationSeconds: song.durationSeconds,
  })), [songs, t])
  const suggestions = suggestionsQuery.data ?? []
  const showSuggestions = focused && trimmed === debouncedKeyword && trimmed.length >= 2 && trimmed !== submittedKeyword && suggestions.length > 0
  const clear = () => { queueRequest.current++; setQueueLoadingSongId(null); setQueueError(''); setKeyword(''); updateSearch(''); setActiveSuggestion(-1) }

  const toPlayerSong = (song: typeof songs[number]) => ({
    id: song.id,
    title: song.displayTitle,
    artist: song.primaryArtistName ?? t('common.unknownArtist'),
    coverUrl: song.coverUrl,
    audioUrl: song.audioSourceUri,
    durationSeconds: song.durationSeconds,
  })

  const playSearchResults = async (songId: number) => {
    const request = ++queueRequest.current
    setQueueLoadingSongId(songId)
    setQueueError('')
    try {
      const allSongs = await searchAllSongs(submittedKeyword)
      if (request !== queueRequest.current) return
      const allQueue = allSongs.map(toPlayerSong)
      const index = allQueue.findIndex((song) => song.id === songId)
      playFromQueue(allQueue, index, { type: 'search', name: submittedKeyword })
    } catch (error) {
      if (request !== queueRequest.current) return
      setQueueError(getApiErrorMessage(error, t('common.requestFailed')))
    } finally {
      if (request === queueRequest.current) setQueueLoadingSongId(null)
    }
  }

  const submitSearch = () => {
    queueRequest.current++
    setQueueLoadingSongId(null)
    setFocused(false)
    setActiveSuggestion(-1)
    updateSearch(trimmed)
  }

  return (
    <section className="library-search relative z-10" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
      <form className="relative max-w-2xl" onSubmit={(event) => { event.preventDefault(); submitSearch() }}>
        <button type="submit" className="icon-button absolute left-0 top-0" aria-label={t('nav.search')} title={t('nav.search')}><Search size={19} /></button>
        <input
          role="combobox" aria-label={t('search.placeholder')} aria-autocomplete="list" aria-expanded={showSuggestions}
          aria-controls={suggestionsId} aria-activedescendant={showSuggestions && activeSuggestion >= 0 ? `${suggestionsId}-${activeSuggestion}` : undefined}
          enterKeyHint="search" autoComplete="off" onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape') { event.preventDefault(); setFocused(false); setActiveSuggestion(-1) }
            if (!showSuggestions) return
            if (event.key === 'ArrowDown') { event.preventDefault(); setActiveSuggestion((index) => (index + 1) % suggestions.length) }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActiveSuggestion((index) => (index <= 0 ? suggestions.length : index) - 1) }
            if (event.key === 'Enter' && suggestions[activeSuggestion]) { event.preventDefault(); const item = suggestions[activeSuggestion]; navigate(suggestionPath(item.type, item.id)) }
          }}
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value)
            setActiveSuggestion(-1)
            setFocused(true)
            if (!event.target.value.trim()) {
              updateSearch('')
            }
          }}
          className="h-11 w-full rounded-md border border-white/[0.085] bg-white/[0.045] pl-11 pr-11 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#ff5c78]/55 focus:bg-white/[0.065]"
          placeholder={t('search.placeholder')}
        />
        {keyword && <button type="button" onClick={clear} aria-label={t('common.close')} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center text-zinc-500 hover:text-white"><X size={16} /></button>}
      </form>

      {showSuggestions && (
        <div id={suggestionsId} role="listbox" aria-label={t('nav.search')} className="absolute left-0 top-12 max-h-[50dvh] w-full max-w-2xl overflow-y-auto rounded-md border border-white/[0.1] bg-[#1b1b22] shadow-2xl">
          {suggestions.map((item, index) => (
            <button type="button" role="option" aria-selected={activeSuggestion === index} id={`${suggestionsId}-${index}`} key={`${item.type}-${item.id}-${item.text}`} onClick={() => navigate(suggestionPath(item.type, item.id))} className={`flex w-full items-center gap-3 border-t border-white/[0.06] px-4 py-3 text-left first:border-t-0 hover:bg-white/[0.06] ${activeSuggestion === index ? 'bg-white/10' : ''}`}>
              <span className="w-14 shrink-0 text-xs text-[#ff7890]">{t(`search.type.${item.type}`)}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{item.text}</span>
              {item.displayTitle !== item.text && <span className="hidden max-w-48 truncate text-xs text-zinc-600 sm:block">{item.displayTitle}</span>}
            </button>
          ))}
        </div>
      )}

      {submittedKeyword && (
        <div className="mt-4 border-b border-white/[0.08] pb-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{t('search.resultsFor', { keyword: submittedKeyword, defaultValue: `“${submittedKeyword}”的搜索结果` })}</h3>
            <button type="button" onClick={clear} className="text-xs text-zinc-500 hover:text-white">{t('common.close')}</button>
          </div>
          {searchQuery.isFetching && <p className="py-5 text-sm text-zinc-500">{t('search.searching')}</p>}
          {searchQuery.isError && <p className="py-5 text-sm text-red-400">{getApiErrorMessage(searchQuery.error, t('common.requestFailed'))}</p>}
          {queueError && <p className="py-2 text-sm text-red-400">{queueError}</p>}
          {queueLoadingSongId !== null && <p role="status" className="py-2 text-sm text-zinc-400">{t('song.loadingSongs')}</p>}
          {!searchQuery.isFetching && !searchQuery.isError && songs.length === 0 && <p className="py-5 text-sm text-zinc-500">{t('search.noResults', { keyword: submittedKeyword })}</p>}
          <BulkSongs songs={songs} scope={`search:${submittedKeyword}:${searchPage}`}>
          <div className="song-list overflow-hidden border-y border-white/[0.06]">
            {songs.map((song, index) => <SongRow
              key={song.id}
              song={song}
              onPlay={() => { if (queueLoadingSongId === null) void playSearchResults(song.id) }}
              onPlayNext={() => playNextInQueue(queue[index])}
              onAddToQueue={() => addToQueue(queue[index])}
            />)}
          </div>
          </BulkSongs>
          {searchQuery.data?.pagination && (
            <div className="mt-4">
              <Pagination
                page={searchQuery.data.pagination.page}
                pageSize={searchQuery.data.pagination.page_size}
                total={searchQuery.data.pagination.total}
                onPageChange={(page) => updateSearch(submittedKeyword, page)}
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
