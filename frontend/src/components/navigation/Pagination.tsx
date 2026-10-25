import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

function visiblePages(page: number, pageCount: number): number[] {
  const start = Math.max(1, Math.min(page - 2, pageCount - 4))
  const end = Math.min(pageCount, start + 4)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const { t } = useTranslation()
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (pageCount <= 1) return null

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4" aria-label={t('common.pagination')}>
      <p className="text-xs text-zinc-500">
        {t('common.pageSummary', { page, pages: pageCount, total })}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title={t('common.previousPage')}
          aria-label={t('common.previousPage')}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 transition hover:bg-white/[0.08] hover:text-white disabled:pointer-events-none disabled:opacity-25"
        >
          <ChevronLeft size={17} />
        </button>
        {visiblePages(page, pageCount).map((value) => (
          <button
            key={value}
            type="button"
            aria-current={value === page ? 'page' : undefined}
            onClick={() => onPageChange(value)}
            className={`h-8 min-w-8 rounded-md px-2 text-xs font-medium transition ${
              value === page ? 'bg-[#ff3b5f] text-white' : 'text-zinc-400 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            {value}
          </button>
        ))}
        <button
          type="button"
          title={t('common.nextPage')}
          aria-label={t('common.nextPage')}
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 transition hover:bg-white/[0.08] hover:text-white disabled:pointer-events-none disabled:opacity-25"
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </nav>
  )
}
