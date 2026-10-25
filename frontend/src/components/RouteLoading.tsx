import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function RouteLoading() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen items-center justify-center gap-3 bg-[#111116] text-sm text-zinc-500">
      <Loader2 size={18} className="animate-spin" />
      <span>{t('common.loading')}</span>
    </div>
  )
}
