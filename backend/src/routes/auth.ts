import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../auth.js'
import { assertApp } from '../errors.js'

interface AuthRoutesOptions {
  auth: AuthService
}

export async function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { auth } = options

  app.get('/api/v1/users/me/lyric-preferences', async (request) => ({ data: auth.lyricPreferences(auth.authenticate(request).id) }))
  app.patch('/api/v1/users/me/lyric-preferences', async (request) => ({ data: auth.updateLyricPreferences(auth.authenticate(request).id, request.body) }))

  app.get('/api/v1/setup/status', async () => ({ data: auth.getSetupStatus() }))

  app.post('/api/v1/auth/register', async (request) => {
    const body = request.body as Record<string, unknown>
    return { data: await auth.register({
      email: String(body.email ?? ''),
      password: String(body.password ?? ''),
      ...(body.displayName ? { displayName: String(body.displayName) } : {}),
      ...(body.inviteCode ? { inviteCode: String(body.inviteCode) } : {}),
      ...(body.deviceName ? { deviceName: String(body.deviceName) } : {}),
    }) }
  })

  app.post('/api/v1/auth/login', async (request) => {
    const body = request.body as Record<string, unknown>
    return { data: await auth.login({
      email: String(body.email ?? ''),
      password: String(body.password ?? ''),
      ...(body.deviceName ? { deviceName: String(body.deviceName) } : {}),
    }) }
  })

  app.post('/api/v1/auth/refresh', async (request) => {
    const body = request.body as Record<string, unknown>
    const authorization = request.headers.authorization
    const headerToken = typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : ''
    return { data: auth.refresh(
      String(body.refreshToken ?? ''),
      String(body.accessToken ?? headerToken),
      body.deviceName ? String(body.deviceName) : undefined,
    ) }
  })

  app.post('/api/v1/auth/logout', async (request) => {
    auth.authenticate(request)
    auth.logout(request.headers.authorization!.slice(7).trim())
    return { data: null }
  })

  app.get('/api/v1/auth/me', async (request) => {
    const user = auth.authenticate(request)
    return { data: auth.getUser(user.id) }
  })

  app.patch('/api/v1/users/me', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: auth.updateProfile(user.id, {
      ...(body.displayName !== undefined ? { displayName: String(body.displayName) } : {}),
      ...(body.avatarUrl !== undefined ? { avatarUrl: String(body.avatarUrl) } : {}),
      ...(body.bio !== undefined ? { bio: String(body.bio) } : {}),
      ...(body.preferredLanguage !== undefined ? { preferredLanguage: String(body.preferredLanguage) } : {}),
      ...(body.timezone !== undefined ? { timezone: String(body.timezone) } : {}),
    }) }
  })

  app.post('/api/v1/users/me/password', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    assertApp(body.currentPassword && body.newPassword, 400, 'password_required', '请输入当前密码和新密码')
    await auth.changePassword(user.id, String(body.currentPassword), String(body.newPassword))
    return { data: null }
  })

  app.post('/api/v1/admin/invites', async (request) => {
    const user = auth.requireRole(request, ['owner'])
    const body = request.body as Record<string, unknown>
    return { data: auth.createInvite(user.id, {
      ...(body.maxUses !== undefined ? { maxUses: Number(body.maxUses) } : {}),
      ...(body.expiresAt ? { expiresAt: String(body.expiresAt) } : {}),
    }) }
  })

  app.get('/api/v1/admin/invites', async (request) => {
    auth.requireRole(request, ['owner'])
    return { data: auth.listInvites() }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/admin/invites/:id', async (request) => {
    auth.requireRole(request, ['owner'])
    auth.revokeInvite(Number(request.params.id))
    return { data: null }
  })

  app.get('/api/v1/users/me/sessions', async (request) => {
    const user = auth.authenticate(request)
    const accessToken = request.headers.authorization!.slice(7).trim()
    return { data: auth.listSessions(user.id, accessToken) }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/users/me/sessions/:id', async (request) => {
    const user = auth.authenticate(request)
    auth.revokeSession(user.id, Number(request.params.id))
    return { data: null }
  })

  app.get('/api/v1/admin/users', async (request) => {
    auth.requireRole(request, ['owner'])
    return { data: auth.listUsers() }
  })

  app.patch<{ Params: { id: string } }>('/api/v1/admin/users/:id', async (request) => {
    const actor = auth.requireRole(request, ['owner'])
    const body = request.body as Record<string, unknown>
    return { data: auth.updateUser(actor, Number(request.params.id), {
      ...(body.role ? { role: String(body.role) } : {}),
      ...(body.status ? { status: String(body.status) } : {}),
    }) }
  })
}
