import { Image as ImageIcon, Trash2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resolveMediaUrl } from '../../api/http'

function isManagedImageUrl(value: string): boolean {
  if (!value) return false
  try {
    const url = new URL(value, 'http://animeuta.local')
    return /^\/(?:api\/v1\/)?media\/images\/[^/]+$/.test(url.pathname)
  } catch {
    return false
  }
}

interface ImageEditorFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  onUpload: (file: File) => void
  disabled?: boolean
}

export function ImageEditorField({ label, value, onChange, onUpload, disabled = false }: ImageEditorFieldProps) {
  const { t } = useTranslation()
  const managed = isManagedImageUrl(value)
  const previewUrl = resolveMediaUrl(value)

  return (
    <div className="grid gap-2 text-sm text-zinc-300">
      <span>{label}</span>
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
        <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-md border border-white/10 bg-black/20 text-zinc-600">
          {previewUrl
            ? <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            : <ImageIcon size={22} aria-hidden="true" />}
        </div>
        <div className="min-w-0 space-y-2">
          <input
            aria-label={t('common.externalImageUrl')}
            className="h-9 w-full rounded-md border border-white/10 bg-black/20 px-3 text-white outline-none placeholder:text-zinc-600 focus:border-[#ff6b84]/60"
            value={managed ? '' : value}
            placeholder={managed ? t('common.uploadedImageActive') : t('common.externalImageUrlPlaceholder')}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs text-zinc-300 hover:bg-white/[0.08]">
              <Upload size={14} aria-hidden="true" />
              {value ? t('common.replaceImage') : t('common.chooseImage')}
              <input
                type="file"
                accept="image/*,.jpg,.jpeg,.png,.webp,.gif"
                className="sr-only"
                disabled={disabled}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) onUpload(file)
                }}
              />
            </label>
            {value && (
              <button
                type="button"
                title={t('common.removeImage')}
                aria-label={t('common.removeImage')}
                disabled={disabled}
                className="grid h-8 w-8 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-red-300 disabled:opacity-40"
                onClick={() => onChange('')}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
