import { useEffect, useRef } from 'react'
import { ListMusic } from 'lucide-react'
import { getSongDetail } from '../../api/music'
import { resolveMediaUrl } from '../../api/http'
import { mediaLinkExpired } from '../../lib/playerMedia'
import { usePlayerStore, type PlayerSong } from '../../store/usePlayerStore'

export function QueueArtwork({ song }: { song: PlayerSong }) {
  const ref = useRef<HTMLSpanElement>(null)
  const expired = mediaLinkExpired(song.coverUrl)
  useEffect(() => {
    if (!expired || !ref.current) return
    let cancelled = false
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void getSongDetail(song.id).then((data) => {
        if (cancelled) return
        usePlayerStore.setState((state) => ({ queue: state.queue.map((item) => item.id === song.id ? { ...item, coverUrl: data.coverUrl, audioUrl: data.audioSourceUri } : item) }))
      }).catch(() => undefined)
    })
    observer.observe(ref.current)
    return () => { cancelled = true; observer.disconnect() }
  }, [song.id, expired])
  return <span ref={ref} className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded bg-white/5">
    {song.coverUrl && !expired ? <img src={resolveMediaUrl(song.coverUrl)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ListMusic size={20} />}
  </span>
}
