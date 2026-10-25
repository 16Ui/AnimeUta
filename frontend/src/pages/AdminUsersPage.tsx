import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { Copy, KeyRound, ShieldCheck, Trash2, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { createInvite, listInvites, listUsers, revokeInvite, updateUser } from '../api/auth'
import { getApiErrorMessage } from '../api/error'
import { formatDateTime, formatRelativeTime } from '../lib/format'
import { queryClient } from '../lib/query-client'
import { useAuthStore } from '../store/useAuthStore'

export default function AdminUsersPage() {
  const { t, i18n } = useTranslation()
  const token = useAuthStore((state) => state.token)
  const currentUser = useAuthStore((state) => state.currentUser)
  const [inviteCode, setInviteCode] = useState('')
  const [maxUses, setMaxUses] = useState(1)
  const isOwner = currentUser?.role === 'owner'
  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: () => listUsers(token as string), enabled: isOwner })
  const invitesQuery = useQuery({ queryKey: ['admin-invites'], queryFn: () => listInvites(token as string), enabled: isOwner })
  const inviteMutation = useMutation({
    mutationFn: () => createInvite(token as string, maxUses),
    onSuccess: async (result) => {
      setInviteCode(result.code)
      await queryClient.invalidateQueries({ queryKey: ['admin-invites'] })
    },
  })
  const revokeMutation = useMutation({
    mutationFn: (inviteId: number) => revokeInvite(token as string, inviteId),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['admin-invites'] }),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, role, status }: { id: number; role?: 'admin' | 'user'; status?: 'active' | 'disabled' }) => updateUser(token as string, id, { role, status }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  if (!isOwner) return <Navigate to="/" replace />

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-2 md:p-6">
      <header>
        <div className="flex items-center gap-2"><Users className="text-[#ff6b85]" /><h2 className="text-2xl font-bold">{t('admin.users.title')}</h2></div>
        <p className="mt-1 text-sm text-zinc-500">{t('admin.users.subtitle')}</p>
      </header>

      <section className="space-y-4 border-y border-white/[0.08] py-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-zinc-500">
            {t('admin.users.maxUses')}
            <input type="number" min="1" max="20" value={maxUses} onChange={(event) => setMaxUses(Math.min(20, Math.max(1, Number(event.target.value) || 1)))} className="h-10 w-28 rounded-md border border-white/[0.1] bg-[#19191f] px-3 text-sm text-white" />
          </label>
          <button type="button" onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#ff4d6d] px-4 text-sm font-semibold disabled:opacity-40"><KeyRound size={16} />{t('admin.users.createInvite')}</button>
          {inviteCode && <div className="flex min-w-0 items-center gap-2 rounded-md bg-white/[0.06] px-3 py-2"><code className="max-w-72 truncate text-sm text-emerald-300">{inviteCode}</code><button aria-label={t('admin.users.copyInvite')} title={t('admin.users.copyInvite')} type="button" onClick={() => void navigator.clipboard.writeText(inviteCode)}><Copy size={15} /></button></div>}
        </div>
        <p className="text-xs text-zinc-600">{t('admin.users.inviteCodeHint')}</p>
        {(inviteMutation.isError || revokeMutation.isError) && <p className="text-sm text-red-400">{getApiErrorMessage(inviteMutation.error ?? revokeMutation.error, t('admin.users.inviteFailed'))}</p>}
        {invitesQuery.isLoading && <p className="text-sm text-zinc-500">{t('admin.users.invitesLoading')}</p>}
        <div className="divide-y divide-white/[0.08]">
          {(invitesQuery.data ?? []).map((invite) => (
            <article key={invite.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="min-w-44 flex-1">
                <strong>{t(`admin.users.inviteStatuses.${invite.status}`)}</strong>
                <p className="mt-1 text-xs text-zinc-500">{t('admin.users.inviteUsage', { used: invite.usedCount, max: invite.maxUses })} · {formatRelativeTime(invite.createdAt, i18n.language)}</p>
              </div>
              {invite.expiresAt && <span className="text-xs text-zinc-500">{t('admin.users.expiresAt', { time: formatDateTime(invite.expiresAt, i18n.language) })}</span>}
              <button type="button" disabled={invite.status !== 'active' || revokeMutation.isPending} onClick={() => revokeMutation.mutate(invite.id)} aria-label={t('admin.users.revokeInvite')} title={t('admin.users.revokeInvite')} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30"><Trash2 size={16} /></button>
            </article>
          ))}
        </div>
      </section>

      {usersQuery.isLoading && <p className="text-zinc-500">{t('admin.users.loading')}</p>}
      {usersQuery.isError && <p className="text-red-400">{getApiErrorMessage(usersQuery.error, t('admin.users.loadFailed'))}</p>}
      {updateMutation.isError && <p className="text-red-400">{getApiErrorMessage(updateMutation.error, t('admin.users.updateFailed'))}</p>}
      <section className="divide-y divide-white/[0.08]">
        {(usersQuery.data ?? []).map((user) => <article key={user.id} className="grid gap-3 py-4 md:grid-cols-[1fr_150px_150px] md:items-center">
          <div><div className="flex items-center gap-2"><strong>{user.profile?.displayName || user.email}</strong>{user.role === 'owner' && <ShieldCheck size={15} className="text-amber-300" />}</div><p className="text-sm text-zinc-500">{user.email}</p></div>
          <select aria-label={t('admin.users.role')} disabled={user.role === 'owner' || updateMutation.isPending} value={user.role} onChange={(event) => updateMutation.mutate({ id: user.id, role: event.target.value as 'admin' | 'user' })} className="h-9 rounded-md border border-white/[0.1] bg-[#19191f] px-2 text-sm"><option value="owner">{t('admin.users.roles.owner')}</option><option value="admin">{t('admin.users.roles.admin')}</option><option value="user">{t('admin.users.roles.user')}</option></select>
          <select aria-label={t('admin.users.status')} disabled={user.role === 'owner' || updateMutation.isPending} value={user.status} onChange={(event) => updateMutation.mutate({ id: user.id, status: event.target.value as 'active' | 'disabled' })} className="h-9 rounded-md border border-white/[0.1] bg-[#19191f] px-2 text-sm"><option value="active">{t('admin.users.statuses.active')}</option><option value="disabled">{t('admin.users.statuses.disabled')}</option></select>
        </article>)}
      </section>
    </div>
  )
}
