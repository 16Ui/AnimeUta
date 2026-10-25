import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export function Dialog({ open, onClose, title, description, children, className = '' }: DialogProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <dialog ref={ref} className={`app-dialog ${className}`} aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); closeRef.current() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeRef.current()
      }}>
      <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-base font-semibold text-white">{title}</h2>
          {description && <p id={descriptionId} className="mt-1 text-xs text-zinc-400">{description}</p>}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')} title={t('common.close')} autoFocus><X size={20} /></button>
      </header>
      <div className="dialog-content min-h-0 overflow-y-auto overscroll-contain">{open && children}</div>
    </dialog>
  )
}
