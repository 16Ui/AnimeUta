import type { FastifyRequest } from 'fastify'
import type { AppConfig } from './config.js'
import type { SqliteDatabase } from './db.js'
import { nowIso } from './db.js'
import { AppError, assertApp } from './errors.js'
import { normalizeImageUri } from './media.js'
import { createOpaqueToken, hashPassword, hashToken, verifyPassword } from './security.js'

export type UserRole = 'owner' | 'admin' | 'user'

interface UserRow {
  id: number
  email: string
  password_hash: string
  password_salt: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  preferred_language: string
  timezone: string
  role: UserRole
  status: 'active' | 'disabled'
  created_at: string
}

interface SessionRow {
  id: number
  user_id: number
  access_expires_at: string
  refresh_expires_at: string
  revoked_at: string | null
  device_name: string | null
  created_at: string
  updated_at: string
}

export interface AuthUser {
  id: number
  email: string
  role: UserRole
  displayName: string
  avatarUrl?: string
  bio?: string
  preferredLanguage: string
  timezone: string
}

export interface SessionTokens {
  token: string
  refreshToken: string
  tokenType: 'Bearer'
  user: ReturnType<typeof serializeUser>
}

function serializeUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    profile: {
      displayName: row.display_name,
      ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
      ...(row.bio ? { bio: row.bio } : {}),
      preferredLanguage: row.preferred_language,
      timezone: row.timezone,
    },
  }
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    displayName: row.display_name,
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    ...(row.bio ? { bio: row.bio } : {}),
    preferredLanguage: row.preferred_language,
    timezone: row.timezone,
  }
}

function futureIso(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString()
}

export class AuthService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly config: AppConfig,
  ) {}

  lyricPreferences(userId: number) {
    const row = this.database.prepare('SELECT lyric_preferences FROM app_user WHERE id = ?').get(userId) as { lyric_preferences: string }
    return { showFurigana: true, showRomaji: true, showTranslation: true, showNextLine: true, desktopBackground: false, fontSize: 28, ...JSON.parse(row.lyric_preferences) } as { showFurigana: boolean; showRomaji: boolean; showTranslation: boolean; showNextLine: boolean; desktopBackground: boolean; fontSize: number }
  }

  updateLyricPreferences(userId: number, body: unknown) {
    assertApp(body && typeof body === 'object' && !Array.isArray(body), 400, 'invalid_preferences', 'Invalid lyric preferences')
    const patch = body as Record<string, unknown>
    const current = this.lyricPreferences(userId)
    for (const key of Object.keys(patch)) {
      assertApp(['showFurigana', 'showRomaji', 'showTranslation', 'showNextLine', 'desktopBackground', 'fontSize'].includes(key), 400, 'invalid_preferences', 'Unknown lyric preference')
      const value = patch[key]
      if (key === 'fontSize') {
        assertApp(typeof value === 'number' && Number.isInteger(value) && value >= 18 && value <= 48, 400, 'invalid_preferences', 'Font size must be 18–48')
        current.fontSize = value
      } else {
        assertApp(typeof value === 'boolean', 400, 'invalid_preferences', 'Preference must be boolean')
        current[key as 'showFurigana' | 'showRomaji' | 'showTranslation' | 'showNextLine' | 'desktopBackground'] = value
      }
    }
    this.database.prepare('UPDATE app_user SET lyric_preferences = ? WHERE id = ?').run(JSON.stringify(current), userId)
    return current
  }

  async bootstrapOwner(): Promise<void> {
    if (!this.config.bootstrapAdminEmail || !this.config.bootstrapAdminPassword) return
    const count = this.database.prepare('SELECT count(*) AS count FROM app_user').get() as { count: number }
    if (count.count > 0) return
    const { hash, salt } = await hashPassword(this.config.bootstrapAdminPassword)
    this.database.prepare(`
      INSERT INTO app_user(email, password_hash, password_salt, display_name, role)
      VALUES (?, ?, ?, ?, 'owner')
    `).run(this.config.bootstrapAdminEmail, hash, salt, this.config.bootstrapAdminName)
  }

  getSetupStatus(): { needsOwner: boolean; registrationMode: AppConfig['registrationMode'] } {
    const count = this.database.prepare('SELECT count(*) AS count FROM app_user').get() as { count: number }
    return { needsOwner: count.count === 0, registrationMode: this.config.registrationMode }
  }

  async register(input: { email: string; password: string; displayName?: string; inviteCode?: string; deviceName?: string }): Promise<SessionTokens> {
    const email = input.email.trim().toLowerCase()
    const displayName = input.displayName?.trim() || email.split('@')[0] || 'AnimeUta User'
    this.validateCredentials(email, input.password)
    const { hash, salt } = await hashPassword(input.password)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const count = this.database.prepare('SELECT count(*) AS count FROM app_user').get() as { count: number }
      const isFirstUser = count.count === 0
      assertApp(this.config.registrationMode !== 'closed' || isFirstUser, 403, 'registration_closed', '当前未开放注册')

      let inviteId: number | undefined
      if (!isFirstUser && this.config.registrationMode === 'invite') {
        assertApp(input.inviteCode, 400, 'invite_required', '请输入邀请码')
        const invite = this.database.prepare(`
          SELECT id, max_uses, used_count, expires_at, disabled_at
          FROM invite_code WHERE code_hash = ?
        `).get(hashToken(input.inviteCode.trim())) as {
          id: number; max_uses: number; used_count: number; expires_at: string | null; disabled_at: string | null
        } | undefined
        assertApp(invite && !invite.disabled_at, 400, 'invite_invalid', '邀请码无效')
        assertApp(invite.used_count < invite.max_uses, 400, 'invite_exhausted', '邀请码已被使用')
        assertApp(!invite.expires_at || Date.parse(invite.expires_at) > Date.now(), 400, 'invite_expired', '邀请码已过期')
        inviteId = invite.id
      }

      const existing = this.database.prepare('SELECT id FROM app_user WHERE email = ?').get(email)
      assertApp(!existing, 409, 'email_exists', '该邮箱已注册')
      const result = this.database.prepare(`
        INSERT INTO app_user(email, password_hash, password_salt, display_name, role)
        VALUES (?, ?, ?, ?, ?)
      `).run(email, hash, salt, displayName, isFirstUser ? 'owner' : 'user')
      if (inviteId) {
        this.database.prepare('UPDATE invite_code SET used_count = used_count + 1 WHERE id = ?').run(inviteId)
      }
      const session = this.issueSession(Number(result.lastInsertRowid), input.deviceName)
      this.database.exec('COMMIT')
      return session
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async login(input: { email: string; password: string; deviceName?: string }): Promise<SessionTokens> {
    const row = this.database.prepare('SELECT * FROM app_user WHERE email = ?').get(input.email.trim().toLowerCase()) as UserRow | undefined
    assertApp(row && row.status === 'active', 401, 'invalid_credentials', '邮箱或密码错误')
    assertApp(await verifyPassword(input.password, row.password_salt, row.password_hash), 401, 'invalid_credentials', '邮箱或密码错误')
    return this.issueSession(row.id, input.deviceName)
  }

  refresh(refreshToken: string, accessToken: string, deviceName?: string): SessionTokens {
    assertApp(refreshToken, 400, 'refresh_token_required', '缺少刷新令牌')
    assertApp(accessToken, 400, 'access_token_required', '缺少访问令牌')
    const session = this.database.prepare(`
      SELECT s.* FROM auth_session s
      JOIN app_user u ON u.id = s.user_id
      WHERE s.refresh_token_hash = ? AND s.access_token_hash = ?
        AND s.revoked_at IS NULL AND u.status = 'active'
    `).get(hashToken(refreshToken), hashToken(accessToken)) as SessionRow | undefined
    assertApp(session && Date.parse(session.refresh_expires_at) > Date.now(), 401, 'session_expired', '登录状态已失效')

    const now = nowIso()
    this.database.prepare(`
      UPDATE auth_session
      SET access_expires_at = ?, device_name = ?, updated_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(
      futureIso(this.config.accessTokenTtlMinutes * 60_000),
      deviceName ?? session.device_name ?? null,
      now,
      session.id,
    )
    const user = this.database.prepare('SELECT * FROM app_user WHERE id = ?').get(session.user_id) as UserRow | undefined
    assertApp(user, 401, 'session_expired', '登录状态已失效')
    return { token: accessToken, refreshToken, tokenType: 'Bearer', user: serializeUser(user) }
  }

  logout(accessToken: string): void {
    this.database.prepare(`
      UPDATE auth_session SET revoked_at = ?, updated_at = ? WHERE access_token_hash = ? AND revoked_at IS NULL
    `).run(nowIso(), nowIso(), hashToken(accessToken))
  }

  authenticate(request: FastifyRequest): AuthUser {
    const token = this.getBearerToken(request)
    const row = this.database.prepare(`
      SELECT u.* FROM auth_session s
      JOIN app_user u ON u.id = s.user_id
      WHERE s.access_token_hash = ? AND s.revoked_at IS NULL
        AND s.access_expires_at > ? AND u.status = 'active'
    `).get(hashToken(token), nowIso()) as UserRow | undefined
    assertApp(row, 401, 'unauthorized', '请先登录')
    return toAuthUser(row)
  }

  requireRole(request: FastifyRequest, roles: UserRole[]): AuthUser {
    const user = this.authenticate(request)
    assertApp(roles.includes(user.role), 403, 'forbidden', '没有执行此操作的权限')
    return user
  }

  getUser(id: number) {
    const row = this.database.prepare('SELECT * FROM app_user WHERE id = ?').get(id) as UserRow | undefined
    assertApp(row, 404, 'user_not_found', '用户不存在')
    return serializeUser(row)
  }

  updateProfile(userId: number, input: { displayName?: string; avatarUrl?: string; bio?: string; preferredLanguage?: string; timezone?: string }) {
    const current = this.database.prepare('SELECT * FROM app_user WHERE id = ?').get(userId) as UserRow | undefined
    assertApp(current, 404, 'user_not_found', '用户不存在')
    const displayName = input.displayName?.trim() || current.display_name
    const avatarUrl = input.avatarUrl === undefined ? current.avatar_url : normalizeImageUri(input.avatarUrl) || null
    const bio = input.bio === undefined ? current.bio : input.bio.trim() || null
    const preferredLanguage = input.preferredLanguage?.trim() || current.preferred_language
    const timezone = input.timezone?.trim() || current.timezone
    assertApp(['zh-CN', 'ja', 'en'].includes(preferredLanguage), 400, 'invalid_language', '界面语言无效')
    assertApp(this.isValidTimeZone(timezone), 400, 'invalid_timezone', '时区无效')
    this.database.prepare(`
      UPDATE app_user SET display_name = ?, avatar_url = ?, bio = ?, preferred_language = ?, timezone = ?, updated_at = ? WHERE id = ?
    `).run(displayName, avatarUrl, bio, preferredLanguage, timezone, nowIso(), userId)
    return this.getUser(userId)
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const row = this.database.prepare('SELECT * FROM app_user WHERE id = ?').get(userId) as UserRow | undefined
    assertApp(row, 404, 'user_not_found', '用户不存在')
    assertApp(await verifyPassword(currentPassword, row.password_salt, row.password_hash), 400, 'password_incorrect', '当前密码不正确')
    this.validatePassword(newPassword)
    const { hash, salt } = await hashPassword(newPassword)
    const now = nowIso()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE app_user SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').run(hash, salt, now, userId)
      this.database.prepare('UPDATE auth_session SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, now, userId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  createInvite(createdBy: number, input: { maxUses?: number; expiresAt?: string }) {
    const code = createOpaqueToken(18)
    const maxUses = Math.min(20, Math.max(1, Math.floor(input.maxUses ?? 1)))
    if (input.expiresAt) assertApp(Date.parse(input.expiresAt) > Date.now(), 400, 'invalid_expiry', '过期时间必须晚于现在')
    const result = this.database.prepare(`
      INSERT INTO invite_code(code_hash, created_by, max_uses, expires_at) VALUES (?, ?, ?, ?)
    `).run(hashToken(code), createdBy, maxUses, input.expiresAt ?? null)
    return { id: Number(result.lastInsertRowid), code, maxUses, expiresAt: input.expiresAt ?? null }
  }

  listInvites() {
    const rows = this.database.prepare(`
      SELECT i.id, i.max_uses, i.used_count, i.expires_at, i.disabled_at, i.created_at,
        u.display_name AS created_by_name
      FROM invite_code i LEFT JOIN app_user u ON u.id = i.created_by
      ORDER BY i.created_at DESC
    `).all() as Array<Record<string, unknown>>
    const now = Date.now()
    return rows.map((row) => {
      const expiresAt = row.expires_at ? String(row.expires_at) : undefined
      const disabledAt = row.disabled_at ? String(row.disabled_at) : undefined
      const usedCount = Number(row.used_count)
      const maxUses = Number(row.max_uses)
      const status = disabledAt
        ? 'revoked'
        : expiresAt && Date.parse(expiresAt) <= now
          ? 'expired'
          : usedCount >= maxUses
            ? 'exhausted'
            : 'active'
      return {
        id: Number(row.id), maxUses, usedCount, status,
        ...(expiresAt ? { expiresAt } : {}),
        ...(disabledAt ? { disabledAt } : {}),
        ...(row.created_by_name ? { createdByName: String(row.created_by_name) } : {}),
        createdAt: String(row.created_at),
      }
    })
  }

  revokeInvite(inviteId: number): void {
    const result = this.database.prepare(`
      UPDATE invite_code SET disabled_at = coalesce(disabled_at, ?) WHERE id = ?
    `).run(nowIso(), inviteId)
    assertApp(result.changes > 0, 404, 'invite_not_found', '邀请码不存在')
  }

  listSessions(userId: number, accessToken: string) {
    const currentHash = hashToken(accessToken)
    const rows = this.database.prepare(`
      SELECT id, access_token_hash, access_expires_at, refresh_expires_at, revoked_at, device_name, created_at, updated_at
      FROM auth_session WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: Number(row.id),
      ...(row.device_name ? { deviceName: String(row.device_name) } : {}),
      accessExpiresAt: String(row.access_expires_at),
      refreshExpiresAt: String(row.refresh_expires_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      isCurrent: row.access_token_hash === currentHash,
      isRevoked: Boolean(row.revoked_at),
    }))
  }

  revokeSession(userId: number, sessionId: number): void {
    const now = nowIso()
    const result = this.database.prepare(`
      UPDATE auth_session SET revoked_at = coalesce(revoked_at, ?), updated_at = ? WHERE id = ? AND user_id = ?
    `).run(now, now, sessionId, userId)
    assertApp(result.changes > 0, 404, 'session_not_found', '设备会话不存在')
  }

  listUsers() {
    const rows = this.database.prepare(`SELECT * FROM app_user ORDER BY created_at`).all() as unknown as UserRow[]
    return rows.map((row) => ({ ...serializeUser(row), status: row.status, createdAt: row.created_at }))
  }

  updateUser(actor: AuthUser, userId: number, input: { role?: string; status?: string }) {
    const target = this.database.prepare('SELECT * FROM app_user WHERE id = ?').get(userId) as UserRow | undefined
    assertApp(target, 404, 'user_not_found', '用户不存在')
    assertApp(input.role === undefined || ['admin', 'user'].includes(input.role), 400, 'invalid_user_role', '用户角色无效')
    assertApp(input.status === undefined || ['active', 'disabled'].includes(input.status), 400, 'invalid_user_status', '用户状态无效')
    assertApp(!(target.role === 'owner' && input.role !== undefined), 403, 'owner_protected', '不能修改站点所有者角色')
    const role = input.role === 'admin' || input.role === 'user' ? input.role : target.role
    const status = input.status === 'disabled' || input.status === 'active' ? input.status : target.status
    assertApp(!(target.id === actor.id && status === 'disabled'), 400, 'cannot_disable_self', '不能禁用自己的账号')
    const now = nowIso()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE app_user SET role = ?, status = ?, updated_at = ? WHERE id = ?').run(role, status, now, userId)
      if (status === 'disabled') this.database.prepare('UPDATE auth_session SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, now, userId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { ...this.getUser(userId), status }
  }

  private issueSession(userId: number, deviceName?: string): SessionTokens {
    const user = this.database.prepare('SELECT * FROM app_user WHERE id = ?').get(userId) as UserRow | undefined
    if (!user) throw new AppError(404, 'user_not_found', '用户不存在')
    const token = createOpaqueToken()
    const refreshToken = createOpaqueToken(48)
    this.database.prepare(`
      INSERT INTO auth_session(
        user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at, device_name
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      hashToken(token),
      hashToken(refreshToken),
      futureIso(this.config.accessTokenTtlMinutes * 60_000),
      futureIso(this.config.refreshTokenTtlDays * 86_400_000),
      deviceName ?? null,
    )
    return { token, refreshToken, tokenType: 'Bearer', user: serializeUser(user) }
  }

  private getBearerToken(request: FastifyRequest): string {
    const header = request.headers.authorization
    assertApp(typeof header === 'string' && header.startsWith('Bearer '), 401, 'unauthorized', '请先登录')
    const token = header.slice(7).trim()
    assertApp(token, 401, 'unauthorized', '请先登录')
    return token
  }

  private validateCredentials(email: string, password: string): void {
    assertApp(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, 'invalid_email', '邮箱格式不正确')
    this.validatePassword(password)
  }

  private validatePassword(password: string): void {
    assertApp(password.length >= 8 && password.length <= 128, 400, 'invalid_password', '密码长度应为 8 到 128 个字符')
  }

  private isValidTimeZone(value: string): boolean {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
      return true
    } catch {
      return false
    }
  }
}
