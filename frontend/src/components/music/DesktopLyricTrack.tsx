import { useEffect, useRef, type ReactNode, type CSSProperties } from 'react'

// Keep short lines centered; pan overflowing tracks without moving the toolbar.
export function DesktopLyricTrack({ children, className = '', style, lang }: { children: ReactNode; className?: string; style?: CSSProperties; lang?: string }) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const outer = viewport.current
    const inner = content.current
    if (!outer || !inner) return
    let animation: Animation | undefined
    const measure = () => {
      animation?.cancel()
      const distance = inner.scrollWidth - outer.clientWidth
      if (distance <= 1) return
      const travel = Math.max(2000, distance / 32 * 1000)
      const total = travel * 2 + 3000
      const pause = 1500 / total
      animation = inner.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: pause },
        { transform: `translateX(-${distance}px)`, offset: 0.5 },
        { transform: `translateX(-${distance}px)`, offset: 0.5 + pause },
        { transform: 'translateX(0)', offset: 1 },
      ], { duration: total, iterations: Infinity, easing: 'linear' })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    measure()
    return () => { observer.disconnect(); animation?.cancel() }
  }, [])
  return <div ref={viewport} lang={lang} className={`max-w-full overflow-hidden ${className}`} style={style}>
    <div ref={content} className="w-max min-w-full whitespace-nowrap px-1 py-1 text-center">{children}</div>
  </div>
}
