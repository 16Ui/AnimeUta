import type { TFunction } from 'i18next'

export const contentLanguageCodes = ['ja', 'en', 'zh', 'ko'] as const
export const interfaceLanguageCodes = ['zh-CN', 'ja', 'en'] as const

export function languageLabel(code: string | null | undefined, t: TFunction): string {
  if (!code) return t('common.unknown')
  if (code === 'zh' || code === 'zh-CN') return t('common.languages.zh')
  if (code === 'ja') return t('common.languages.ja')
  if (code === 'en') return t('common.languages.en')
  if (code === 'ko') return t('common.languages.ko')
  return t('common.unknown')
}
