import axios from 'axios'
import i18n from '../i18n'

interface ErrorPayload {
  error?: {
    code?: string
    message?: string
  }
}

export function getApiErrorStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status
  }
  return undefined
}

export function getApiErrorMessage(error: unknown, fallback = i18n.t('common.requestFailed')): string {
  if (axios.isAxiosError<ErrorPayload>(error)) {
    const responseError = error.response?.data?.error
    if (responseError?.code) {
      const translated = i18n.t(`apiErrors.${responseError.code}`, { defaultValue: '' })
      if (translated) return translated
    }
    return fallback
  }

  return fallback
}
