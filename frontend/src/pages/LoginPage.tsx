import { FormEvent, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { getSetupStatus, getCurrentUser, logout, login, register } from '../api/auth'
import { getApiErrorMessage } from '../api/error'
import { backendBaseUrl, normalizeBaseUrl, setBackendBaseUrl } from '../api/http'
import { canSaveCredentials, loadSavedLogin, saveLogin, removeSavedLogin } from '../lib/savedCredentials'
import { loadDesktopLogin, supportsSecureDesktopCredentials } from '../lib/desktopCredentials'
import { useAuthStore } from '../store/useAuthStore'

const savePasswordPreferenceKey = () => `animeuta-save-password:${backendBaseUrl}`
const savedEmailKey = () => `animeuta-login-email:${backendBaseUrl}`

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const setAuth = useAuthStore((state) => state.setAuth)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const rememberLogin = useAuthStore((state) => state.rememberLogin)
  const setRememberLogin = useAuthStore((state) => state.setRememberLogin)

  const [email, setEmail] = useState(() => localStorage.getItem(savedEmailKey()) ?? '')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [serverUrl, setServerUrl] = useState(backendBaseUrl)
  const [serverMessage, setServerMessage] = useState('')
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false)
  const [savePassword, setSavePassword] = useState(() => localStorage.getItem(savePasswordPreferenceKey()) === 'true')
  const [credentialLoading, setCredentialLoading] = useState(false)
  const [credentialMessage, setCredentialMessage] = useState(() => sessionStorage.getItem('animeuta-credential-warning') ?? '')
  const [restoredCredentialEmail, setRestoredCredentialEmail] = useState('')
  const supportsSavedLogin = canSaveCredentials()
  const editVersion = useRef(0)

  const redirectTo = '/'
  const setupQuery = useQuery({ queryKey: ['setup-status'], queryFn: getSetupStatus })

  useEffect(() => {
    if (setupQuery.isError) setServerSettingsOpen(true)
  }, [setupQuery.isError])

  useEffect(() => {
    sessionStorage.removeItem('animeuta-credential-warning')
  }, [])

  useEffect(() => {
    if (!supportsSavedLogin || mode !== 'login') return
    let active = true
    const version = editVersion.current
    setCredentialLoading(true)
    void loadSavedLogin(backendBaseUrl).then((saved) => {
      if (!active || version !== editVersion.current || !saved) return
      setEmail(saved.email)
      setPassword(saved.password)
      setRestoredCredentialEmail(saved.email.trim().toLowerCase())
      setSavePassword(true)
    }).catch(() => {
      if (active) setCredentialMessage(t('auth.passwordLoadFailed'))
    }).finally(() => { if (active) setCredentialLoading(false) })
    return () => { active = false }
  }, [supportsSavedLogin, mode, t])

  const forgetPassword = async () => {
    editVersion.current++
    setCredentialLoading(true)
    try {
      await removeSavedLogin(backendBaseUrl)
      localStorage.setItem(savePasswordPreferenceKey(), 'false')
      setSavePassword(false)
      setPassword('')
      setRestoredCredentialEmail('')
      setCredentialMessage(t('auth.savedPasswordRemoved'))
    } catch { setCredentialMessage(t('auth.passwordDeleteFailed')) }
    finally { setCredentialLoading(false) }
  }

  const restoreLegacyLogin = async () => {
    editVersion.current++
    setCredentialLoading(true)
    try {
      const saved = await loadDesktopLogin()
      if (!saved) { setCredentialMessage(t('auth.noLegacyPassword')); return }
      setEmail(saved.email)
      setPassword(saved.password)
      setRestoredCredentialEmail(saved.email.trim().toLowerCase())
      setSavePassword(true)
      setCredentialMessage(t('auth.legacyPasswordRestored'))
    } catch { setCredentialMessage(t('auth.passwordLoadFailed')) }
    finally { setCredentialLoading(false) }
  }

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />
  }

  const switchMode = (nextMode: 'login' | 'register') => {
    if (nextMode === mode) return
    setMode(nextMode)
    editVersion.current++
    setPassword('')
    setErrorMessage('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setErrorMessage('')
    setCredentialMessage('')

    try {
      const result =
        mode === 'login'
          ? await login({ email: email.trim(), password })
          : await register({ email: email.trim(), password, displayName: displayName.trim() || undefined, inviteCode: inviteCode.trim() || undefined })

      if (mode === 'login' && supportsSavedLogin) {
        try {
          if (savePassword) await saveLogin(backendBaseUrl, email, password)
          else await removeSavedLogin(backendBaseUrl)
          localStorage.setItem(savePasswordPreferenceKey(), String(savePassword))
        } catch {
          await logout(result.token).catch(() => undefined)
          setCredentialMessage(t('auth.passwordSaveFailed'))
          return
        }
      }
      if (rememberLogin || savePassword) localStorage.setItem(savedEmailKey(), email.trim())
      else localStorage.removeItem(savedEmailKey())
      result.user = await getCurrentUser(result.token)
      setAuth(result, mode === 'login' ? rememberLogin : true)
      navigate(redirectTo, { replace: true })
    } catch (error) {
      await clearAuth()
      setErrorMessage(getApiErrorMessage(error, t('auth.error')))
    } finally {
      setSubmitting(false)
    }
  }

  const handleServerSave = async () => {
    setSubmitting(true)
    setErrorMessage('')
    setServerMessage('')
    const previousUrl = backendBaseUrl
    try {
      const normalized = normalizeBaseUrl(serverUrl)
      setServerUrl(normalized)
      const response = await fetch(`${normalized}/api/v1/setup/status`, { credentials: 'omit', signal: AbortSignal.timeout(10000) })
      if (!response.ok) {
        setErrorMessage(t('auth.serverUnavailable'))
        return
      }
      const status = await response.json()
      if (typeof status?.data?.needsOwner !== 'boolean') throw new Error('invalid_server')
      if (normalized !== previousUrl) await clearAuth()
      setBackendBaseUrl(normalized)
      setServerMessage(t('auth.serverConnected'))
      if (normalized !== previousUrl) window.location.reload()
    } catch {
      setBackendBaseUrl(previousUrl, false)
      setErrorMessage(t('auth.serverUrlInvalid'))
    } finally { setSubmitting(false) }
  }

  return (
    <div className="auth-page min-h-screen flex items-center justify-center px-4">
      <div className="auth-form-surface w-full max-w-sm">
        <div className="mb-5 flex flex-col items-center">
          <img
            src="/animeuta-icon-192.png"
            alt="AnimeUta"
            className="h-20 w-20 rounded-full object-cover shadow-[0_0_32px_rgba(255,59,95,0.22)]"
          />
          <p className="mt-3 text-lg font-bold text-white">AnimeUta</p>
          <p className="text-xs text-zinc-500">{t('nav.tagline')}</p>
        </div>
        <h2 className="text-2xl font-bold mb-6 text-center text-primary">
          {mode === 'login' ? t('nav.login') : t('auth.register')}
        </h2>

        <div className="mb-4 grid grid-cols-2 overflow-hidden rounded border border-gray-700">
          <button
            type="button"
            className={`px-3 py-2 text-sm ${mode === 'login' ? 'bg-primary text-black' : 'bg-gray-800 text-gray-300'}`}
            onClick={() => switchMode('login')}
          >
            {t('nav.login')}
          </button>
          <button
            type="button"
            className={`px-3 py-2 text-sm ${mode === 'register' ? 'bg-primary text-black' : 'bg-gray-800 text-gray-300'}`}
            onClick={() => switchMode('register')}
          >
            {t('auth.register')}
          </button>
        </div>

        <form className="space-y-4" autoComplete="on" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <>
            <div>
              <label className="block text-sm text-gray-300 mb-1" htmlFor="displayName">
                {t('auth.displayName')}
              </label>
              <input
                id="displayName"
                type="text"
                autoComplete="name"
                className="w-full bg-gray-800 border border-gray-700 text-white p-2 rounded"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            {!setupQuery.data?.needsOwner && setupQuery.data?.registrationMode === 'invite' && (
              <div>
                <label className="block text-sm text-gray-300 mb-1" htmlFor="inviteCode">{t('auth.inviteCode', { defaultValue: '邀请码' })}</label>
                <input id="inviteCode" type="text" required autoComplete="off" className="w-full bg-gray-800 border border-gray-700 text-white p-2 rounded" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} />
              </div>
            )}
            {setupQuery.data?.needsOwner && <p className="text-xs text-zinc-500">{t('auth.firstOwnerHint', { defaultValue: '首次注册的账号将成为此站点的所有者。' })}</p>}
            </>
          )}

          <div>
            <label className="block text-sm text-gray-300 mb-1" htmlFor="email">
              {t('auth.email')}
            </label>
            <input
              id="email"
              name="username"
              type="email"
              required
              autoComplete={mode === 'login' ? 'username' : 'email'}
              className="w-full bg-gray-800 border border-gray-700 text-white p-2 rounded"
              value={email}
              onChange={(event) => {
                editVersion.current++
                const nextEmail = event.target.value
                if (restoredCredentialEmail && nextEmail.trim().toLowerCase() !== restoredCredentialEmail) {
                  setPassword('')
                  setRestoredCredentialEmail('')
                }
                setEmail(nextEmail)
              }}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1" htmlFor="password">
              {t('auth.password')}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="w-full bg-gray-800 border border-gray-700 text-white p-2 rounded"
              value={password}
              onChange={(event) => {
                editVersion.current++
                setPassword(event.target.value)
                setRestoredCredentialEmail('')
              }}
            />
            {credentialLoading && <p className="mt-1 text-xs text-zinc-500">{t('auth.loadingSavedPassword')}</p>}
            {credentialMessage && <p className="mt-1 text-xs text-amber-400">{credentialMessage}</p>}
          </div>

          {mode === 'login' && (
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={rememberLogin}
                  onChange={(event) => setRememberLogin(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  <span className="block text-sm text-zinc-200">{t('auth.rememberLogin')}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{t('auth.rememberLoginHint')}</span>
                </span>
              </label>
              {supportsSavedLogin && (
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={savePassword}
                    onChange={(event) => { editVersion.current++; setSavePassword(event.target.checked) }}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span>
                    <span className="block text-sm text-zinc-200">{t('auth.savePassword')}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{t('auth.savedPasswordDeviceHint')}</span>
                  </span>
                </label>
              )}
              {supportsSavedLogin && <button type="button" disabled={credentialLoading || submitting} onClick={() => void forgetPassword()} className="text-xs text-zinc-400 hover:text-white disabled:opacity-50">{t('auth.forgetSavedPassword')}</button>}
              {supportsSecureDesktopCredentials() && <button type="button" disabled={credentialLoading || submitting} onClick={() => void restoreLegacyLogin()} className="block text-xs text-zinc-400 hover:text-white disabled:opacity-50">{t('auth.restoreLegacyPassword')}</button>}
            </div>
          )}

          {errorMessage && <p className="text-sm text-red-400">{errorMessage}</p>}

          <button
            type="submit"
            disabled={submitting || credentialLoading}
            className="w-full bg-primary hover:bg-primary-dark text-white p-2 rounded disabled:opacity-50"
          >
            {submitting ? t('common.saving') : mode === 'login' ? t('nav.login') : t('auth.createAccount')}
          </button>
        </form>
        <a href="/clients" className="mt-4 block text-center text-sm text-zinc-300 underline underline-offset-4 hover:text-white">下载 Windows 客户端 / Android APK</a>

        <details
          className="mt-5 border-t border-white/[0.08] pt-4"
          open={serverSettingsOpen}
          onToggle={(event) => setServerSettingsOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-sm text-zinc-400 hover:text-white">{t('auth.serverSettings')}</summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs leading-5 text-zinc-500">{t('auth.serverHint')}</p>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              aria-label={t('auth.serverAddress')}
              className="h-10 w-full rounded border border-gray-700 bg-gray-800 px-3 text-sm text-white outline-none focus:border-primary"
              placeholder="https://animeuta.example.com"
            />
            <button type="button" disabled={submitting || credentialLoading} onClick={() => void handleServerSave()} className="h-9 rounded bg-white/[0.08] px-3 text-sm text-zinc-200 hover:bg-white/[0.12] disabled:opacity-50">
              {t('auth.testAndSaveServer')}
            </button>
            {serverMessage && <p className="text-xs text-emerald-400">{serverMessage}</p>}
            {setupQuery.isError && !errorMessage && <p className="text-xs text-rose-400">{t('auth.serverUnavailable')}</p>}
          </div>

        </details>
      </div>
    </div>
  )
}
