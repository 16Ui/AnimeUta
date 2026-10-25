import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Clock3, KeyRound, Laptop, LogOut, PencilLine, Upload, UserCog, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { changeMyPassword, listMySessions, revokeMySession, updateMyProfile } from '../api/auth'
import { getApiErrorMessage } from '../api/error'
import { backendBaseUrl, resolveMediaUrl } from '../api/http'
import { uploadImage } from '../api/media'
import { ImageEditorField } from '../components/inputs/ImageEditorField'
import { formatDateTime } from '../lib/format'
import { interfaceLanguageCodes, languageLabel } from '../lib/language'
import { queryClient } from '../lib/query-client'
import { canSaveCredentials, removeSavedLogin, saveLogin } from '../lib/savedCredentials'
import { useAuthStore } from '../store/useAuthStore'
import { ClientUpdate } from '../components/ClientUpdate'

type AccountSection = 'overview' | 'profile' | 'password' | 'sessions'

export default function AccountPage({ section = 'overview' }: { section?: AccountSection }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const token = useAuthStore((state) => state.token)
  const currentUser = useAuthStore((state) => state.currentUser)
  const fetchMe = useAuthStore((state) => state.fetchMe)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const clearLocalAuth = useAuthStore((state) => state.clearLocalAuth)
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner'
  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [bio, setBio] = useState('')
  const [preferredLanguage, setPreferredLanguage] = useState('')
  const [timezone, setTimezone] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const sessionsQuery = useQuery({ queryKey: ['my-sessions'], queryFn: () => listMySessions(token as string), enabled: Boolean(token) && section === 'sessions' })
  const revokeSessionMutation = useMutation({
    mutationFn: ({ id }: { id: number; isCurrent: boolean }) => revokeMySession(token as string, id),
    onSuccess: async (_data, session) => {
      if (session.isCurrent) { clearLocalAuth(); return }
      await queryClient.invalidateQueries({ queryKey: ['my-sessions'] })
    },
  })

  useEffect(() => {
    setDisplayName(currentUser?.profile?.displayName ?? '')
    setAvatarUrl(currentUser?.profile?.avatarUrl ?? '')
    setBio(currentUser?.profile?.bio ?? '')
    setPreferredLanguage(currentUser?.profile?.preferredLanguage ?? '')
    setTimezone(currentUser?.profile?.timezone ?? '')
  }, [currentUser])

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    setSaving(true); setMessage(''); setFormError('')
    try {
      await updateMyProfile(token, { displayName, avatarUrl, bio, preferredLanguage, timezone })
      await fetchMe()
      setMessage(t('account.profileUpdated'))
    } catch (error) { setFormError(getApiErrorMessage(error, t('account.profileUpdateFailed'))) }
    finally { setSaving(false) }
  }

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    setSaving(true); setMessage(''); setFormError('')
    try {
      await changeMyPassword(token, { currentPassword, newPassword })
      if (canSaveCredentials() && currentUser?.email) {
        try {
          if (localStorage.getItem(`animeuta-save-password:${backendBaseUrl}`) === 'true') {
            await saveLogin(backendBaseUrl, currentUser.email, newPassword)
            localStorage.setItem(`animeuta-login-email:${backendBaseUrl}`, currentUser.email)
          } else {
            await removeSavedLogin(backendBaseUrl)
          }
        } catch {
          await removeSavedLogin(backendBaseUrl).catch(() => undefined)
          sessionStorage.setItem('animeuta-credential-warning', t('auth.passwordSaveFailed'))
        }
      }
      setMessage(t('account.passwordChangedLoginAgain'))
      await clearAuth()
    } catch (error) { setFormError(getApiErrorMessage(error, t('account.passwordChangeFailed'))) }
    finally { setSaving(false) }
  }

  const uploadAvatar = async (file: File) => {
    if (!token) return
    setUploadingAvatar(true); setMessage(''); setFormError('')
    try {
      const uri = await uploadImage(file, token)
      setAvatarUrl(uri)
      await updateMyProfile(token, { displayName, avatarUrl: uri, bio, preferredLanguage, timezone })
      await fetchMe()
      setMessage(t('account.profileUpdated'))
    } catch (error) { setFormError(getApiErrorMessage(error, t('account.avatarUploadFailed'))) }
    finally { setUploadingAvatar(false) }
  }

  if (section === 'overview') {
    return (
      <div className="content-page mx-auto max-w-4xl space-y-7">
        <header className="flex items-center gap-5 border-b border-white/[0.08] py-5">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.06] shadow-[0_12px_30px_rgba(0,0,0,0.25)]">
            {currentUser?.profile?.avatarUrl ? <img src={resolveMediaUrl(currentUser.profile.avatarUrl)} alt="" className="h-full w-full object-cover" /> : <UserCog size={28} className="text-zinc-500" />}
          </div>
          <div className="min-w-0"><p className="text-xs font-medium text-[#ff6b85]">{t('account.title')}</p><h2 className="mt-1 truncate text-2xl font-bold">{currentUser?.profile?.displayName || t('account.title')}</h2><p className="mt-1 truncate text-sm text-zinc-500">{currentUser?.email}</p></div>
        </header>

        <nav className="divide-y divide-white/[0.065] border-b border-white/[0.065] px-3">
          <AccountLink to="/online" icon={<Upload size={19} />} title={i18n.resolvedLanguage?.startsWith('en') ? 'Online library' : i18n.resolvedLanguage?.startsWith('ja') ? 'オンライン曲庫' : '在线曲库'} />
          <AccountLink to="/account/sources" icon={<Laptop size={19} />} title={i18n.resolvedLanguage?.startsWith('en') ? 'Music sources' : i18n.resolvedLanguage?.startsWith('ja') ? '音源設定' : '音源设置'} />
          <AccountLink to="/history" icon={<Clock3 size={19} />} title={t('nav.history')} />
          <AccountLink to="/account/profile" icon={<UserCog size={19} />} title={t('account.profile')} subtitle={t('account.profileHint', { defaultValue: '头像、显示名称和语言偏好' })} />
          <AccountLink to="/account/password" icon={<KeyRound size={19} />} title={t('account.changePassword')} subtitle={t('account.passwordHint', { defaultValue: '更新账号登录密码' })} />
          <AccountLink to="/account/sessions" icon={<Laptop size={19} />} title={t('account.sessions.title')} subtitle={t('account.sessions.subtitle')} />
        </nav>

        {isAdmin && <section><p className="mb-2 text-xs font-semibold text-zinc-600">{t('account.adminTools')}</p><div className="divide-y divide-white/[0.065] overflow-hidden rounded-lg bg-white/[0.025] px-5"><AccountLink to="/admin/songs" icon={<PencilLine size={19} />} title={t('nav.adminMetadata')} />{currentUser?.role === 'owner' && <AccountLink to="/admin/users" icon={<Users size={19} />} title={t('nav.adminUsers')} />}</div></section>}
        <ClientUpdate />
        <button type="button" onClick={() => void clearAuth()} className="inline-flex h-10 items-center gap-2 text-sm text-zinc-500 hover:text-red-300"><LogOut size={17} />{t('nav.logout')}</button>
      </div>
    )
  }

  const titles = { profile: t('account.profile'), password: t('account.changePassword'), sessions: t('account.sessions.title') }
  return (
    <div className="content-page mx-auto max-w-2xl">
      <header className="mb-7 flex items-center gap-3 border-b border-white/[0.08] pb-5"><button type="button" onClick={() => navigate('/account')} aria-label={t('common.close')} className="grid h-9 w-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-white"><ArrowLeft size={18} /></button><h2 className="text-2xl font-bold">{titles[section]}</h2></header>

      {section === 'profile' && <form className="grid gap-4" onSubmit={saveProfile}>
        <ImageEditorField label={t('account.avatar')} value={avatarUrl} onChange={setAvatarUrl} onUpload={(file) => void uploadAvatar(file)} disabled={uploadingAvatar || saving} />
        {uploadingAvatar && <span className="text-xs text-zinc-500">{t('account.uploadingAvatar')}</span>}
        <Field label={t('auth.displayName')}><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="account-input" /></Field>
        <Field label={t('account.bio')}><textarea value={bio} onChange={(event) => setBio(event.target.value)} className="account-input min-h-24 resize-y py-3" /></Field>
        <Field label={t('account.preferredLanguage')}><select value={preferredLanguage} onChange={(event) => setPreferredLanguage(event.target.value)} className="account-input"><option value="">{t('common.unknown')}</option>{interfaceLanguageCodes.map((code) => <option key={code} value={code}>{languageLabel(code, t)}</option>)}</select></Field>
        <Field label={t('account.timezone')}><input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="account-input" /></Field>
        <FormFeedback error={formError} message={message} />
        <button type="submit" disabled={saving} className="h-11 w-fit rounded-md bg-white px-5 text-sm font-semibold text-black disabled:opacity-40">{saving ? t('common.saving') : t('account.saveProfile')}</button>
      </form>}

      {section === 'password' && <form className="grid gap-4" onSubmit={savePassword}>
        <Field label={t('account.currentPassword')}><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="account-input" /></Field>
        <Field label={t('account.newPassword')}><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="account-input" /></Field>
        <FormFeedback error={formError} message={message} />
        <button type="submit" disabled={saving || !currentPassword || !newPassword} className="h-11 w-fit rounded-md bg-white px-5 text-sm font-semibold text-black disabled:opacity-40">{saving ? t('common.saving') : t('account.changePassword')}</button>
      </form>}

      {section === 'sessions' && <section><p className="mb-5 text-sm text-zinc-500">{t('account.sessions.subtitle')}</p>{sessionsQuery.isLoading && <p className="text-sm text-zinc-500">{t('account.sessions.loading')}</p>}{sessionsQuery.isError && <p className="text-sm text-red-400">{getApiErrorMessage(sessionsQuery.error, t('account.sessions.loadFailed'))}</p>}<div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">{(sessionsQuery.data ?? []).filter((item) => !item.isRevoked).map((item) => <article key={item.id} className="flex items-center gap-3 py-4"><Laptop size={19} className="shrink-0 text-zinc-500" /><div className="min-w-0 flex-1"><strong className="text-sm">{item.deviceName || t('account.sessions.unknownDevice')}</strong>{item.isCurrent && <span className="ml-2 text-xs text-emerald-400">{t('account.sessions.current')}</span>}<p className="mt-1 text-xs text-zinc-600">{t('account.sessions.signedInAt', { time: formatDateTime(item.createdAt, i18n.language) })}</p></div><button type="button" disabled={revokeSessionMutation.isPending} onClick={() => revokeSessionMutation.mutate({ id: item.id, isCurrent: item.isCurrent })} className="text-sm text-zinc-500 hover:text-red-300">{item.isCurrent ? t('account.sessions.signOut') : t('account.sessions.revoke')}</button></article>)}</div>{revokeSessionMutation.isError && <p className="mt-4 text-sm text-red-400">{getApiErrorMessage(revokeSessionMutation.error, t('account.sessions.revokeFailed'))}</p>}</section>}
    </div>
  )
}

function AccountLink({ to, icon, title, subtitle }: { to: string; icon: ReactNode; title: string; subtitle?: string }) {
  return <Link to={to} className="-mx-3 flex items-center gap-4 rounded-md px-3 py-4 text-zinc-300 transition hover:bg-white/[0.04] hover:text-white"><span className="text-zinc-500">{icon}</span><span className="min-w-0 flex-1"><strong className="block text-sm font-medium">{title}</strong>{subtitle && <span className="mt-1 block truncate text-xs text-zinc-600">{subtitle}</span>}</span><ChevronRight size={17} className="text-zinc-600" /></Link>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-2 text-sm text-zinc-400"><span>{label}</span>{children}</label> }
function FormFeedback({ error, message }: { error: string; message: string }) { return <>{error && <p className="text-sm text-red-400">{error}</p>}{message && <p className="text-sm text-emerald-400">{message}</p>}</> }
