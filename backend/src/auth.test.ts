import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthService } from './auth.js'
import { buildApp } from './app.js'
import type { AppConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'

const temporaryDirectories: string[] = []

function createConfig(directory: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    databasePath: join(directory, 'test.sqlite'),
    mediaRoot: join(directory, 'media'),
    appOrigins: ['http://localhost:5173'],
    registrationMode: 'invite',
    friendShareReview: true,
    bootstrapAdminName: 'Owner',
    accessTokenTtlMinutes: 30,
    refreshTokenTtlDays: 30,
    maxAudioBytes: 1024,
    maxImageBytes: 1024,
    mediaSigningSecret: 'test-signing-secret',
    llmBaseUrl: 'http://127.0.0.1:11434/v1',
    llmModel: 'test',
    transcriptionModel: 'test-transcription',
    aiDailyLimit: 20,
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('authentication', () => {
  it('stores lyric preferences per user, merges patches and rejects invalid values', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-lyrics-prefs-'))
    temporaryDirectories.push(directory)
    const config = { ...createConfig(directory), registrationMode: 'open' as const }
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const auth = new AuthService(database, config)
    const app = await buildApp(config, database, auth)
    try {
      const first = await auth.register({ email: 'first@example.com', password: 'correct-password' })
      const second = await auth.register({ email: 'second@example.com', password: 'correct-password' })
      const url = '/api/v1/users/me/lyric-preferences'
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
      const headers = { authorization: `Bearer ${first.token}` }
      expect((await app.inject({ method: 'PATCH', url, headers, payload: { fontSize: 34, showRomaji: false } })).statusCode).toBe(200)
      await app.inject({ method: 'PATCH', url, headers, payload: { showFurigana: false } })
      expect(auth.lyricPreferences(first.user.id)).toEqual({ fontSize: 34, showRomaji: false, showFurigana: false, showTranslation: true, showNextLine: true, desktopBackground: false })
      expect((await app.inject({ method: 'PATCH', url, headers, payload: { showTranslation: false } })).statusCode).toBe(200)
      expect(new AuthService(database, config).lyricPreferences(first.user.id).showTranslation).toBe(false)
      expect(auth.lyricPreferences(second.user.id).showTranslation).toBe(true)
      expect((await app.inject({ method: 'PATCH', url, headers, payload: { showTranslation: 'false' } })).statusCode).toBe(400)
      await app.inject({ method: 'PATCH', url, headers, payload: { desktopBackground: true } })
      expect(auth.lyricPreferences(first.user.id).desktopBackground).toBe(true)
      expect(auth.lyricPreferences(second.user.id).desktopBackground).toBe(false)
      expect(auth.lyricPreferences(second.user.id).fontSize).toBe(28)
      for (const payload of [{ fontSize: 99 }, { showRomaji: 'false' }, { desktopBackground: 'true' }, { timingOffsetMs: 500 }, { fontSize: 20.5 }]) {
        expect((await app.inject({ method: 'PATCH', url, headers, payload })).statusCode).toBe(400)
      }
      expect(new AuthService(database, config).lyricPreferences(first.user.id).fontSize).toBe(34)
    } finally { await app.close(); database.close() }
  })
  it('allows browser preflight for mutating API methods', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-auth-'))
    temporaryDirectories.push(directory)
    const config = createConfig(directory)
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const app = await buildApp(config, database, new AuthService(database, config))

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/study/lexemes/1',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type',
      },
    })

    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-methods']).toContain('PATCH')
    expect(response.headers['access-control-allow-methods']).toContain('DELETE')
    await app.close()
    database.close()
  })

  it('serializes concurrent first-user registration so exactly one owner is created', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-auth-'))
    temporaryDirectories.push(directory)
    const config = { ...createConfig(directory), registrationMode: 'open' as const }
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const auth = new AuthService(database, config)
    const app = await buildApp(config, database, auth)

    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'first@example.com', password: 'correct-password' } }),
      app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'second@example.com', password: 'correct-password' } }),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200])
    expect(responses.map((response) => response.json().data.user.role).sort()).toEqual(['owner', 'user'])
    expect(database.prepare("SELECT count(*) AS count FROM app_user WHERE role = 'owner'").get()).toEqual({ count: 1 })

    await app.close()
    database.close()
  })

  it('allows only one concurrent registration to consume a single-use invite', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-auth-'))
    temporaryDirectories.push(directory)
    const config = createConfig(directory)
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const auth = new AuthService(database, config)
    const app = await buildApp(config, database, auth)
    const ownerResponse = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'owner@example.com', password: 'correct-password' },
    })
    const inviteResponse = await app.inject({
      method: 'POST', url: '/api/v1/admin/invites',
      headers: { authorization: `Bearer ${ownerResponse.json().data.token}` },
      payload: { maxUses: 1 },
    })
    const inviteCode = inviteResponse.json().data.code as string

    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'first@example.com', password: 'correct-password', inviteCode } }),
      app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'second@example.com', password: 'correct-password', inviteCode } }),
    ])
    const successful = responses.filter((response) => response.statusCode === 200)
    const rejected = responses.filter((response) => response.statusCode === 400)

    expect(successful).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].json().error.code).toBe('invite_exhausted')
    expect(database.prepare('SELECT used_count FROM invite_code').get()).toEqual({ used_count: 1 })
    expect(database.prepare('SELECT count(*) AS count FROM app_user').get()).toEqual({ count: 2 })

    await app.close()
    database.close()
  })

  it('makes the first registered user owner and requires an invite afterwards', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-auth-'))
    temporaryDirectories.push(directory)
    const config = createConfig(directory)
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const auth = new AuthService(database, config)
    const app = await buildApp(config, database, auth)

    const ownerResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'owner@example.com', password: 'correct-password', displayName: 'Owner' },
    })
    expect(ownerResponse.statusCode).toBe(200)
    const owner = ownerResponse.json().data
    expect(owner.user.role).toBe('owner')

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'friend@example.com', password: 'correct-password' },
    })
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json().error.code).toBe('invite_required')

    const inviteResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invites',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { maxUses: 1 },
    })
    expect(inviteResponse.statusCode).toBe(200)

    const friendResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'friend@example.com',
        password: 'correct-password',
        inviteCode: inviteResponse.json().data.code,
      },
    })
    expect(friendResponse.statusCode).toBe(200)
    expect(friendResponse.json().data.user.role).toBe('user')

    await app.close()
    database.close()
  })

  it('revokes an access token on logout', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-auth-'))
    temporaryDirectories.push(directory)
    const config = createConfig(directory)
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const auth = new AuthService(database, config)
    const app = await buildApp(config, database, auth)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'owner@example.com', password: 'correct-password' },
    })
    const token = response.json().data.token as string

    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)

    await app.close()
    database.close()
  })

  it('refreshes one device session idempotently under concurrent requests', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-auth-'))
    temporaryDirectories.push(directory)
    const config = createConfig(directory)
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const auth = new AuthService(database, config)
    const app = await buildApp(config, database, auth)
    const registered = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'owner@example.com', password: 'correct-password' },
    })
    const token = registered.json().data.token as string
    const refreshToken = registered.json().data.refreshToken as string
    database.prepare('UPDATE auth_session SET access_expires_at = ?').run(new Date(Date.now() - 60_000).toISOString())

    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken, accessToken: token } }),
      app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken, accessToken: token } }),
    ])
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(first.json().data.token).toBe(token)
    expect(second.json().data.token).toBe(token)
    expect(first.json().data.refreshToken).toBe(refreshToken)
    expect(second.json().data.refreshToken).toBe(refreshToken)
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)

    await app.close()
    database.close()
  })

  it('protects the owner role and revokes both token types when disabling a user', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-auth-'))
    temporaryDirectories.push(directory)
    const config = createConfig(directory)
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const auth = new AuthService(database, config)
    const app = await buildApp(config, database, auth)
    const owner = (await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'owner@example.com', password: 'correct-password' },
    })).json().data
    const ownerHeaders = { authorization: `Bearer ${owner.token}` }
    const invite = (await app.inject({
      method: 'POST', url: '/api/v1/admin/invites', headers: ownerHeaders, payload: { maxUses: 1 },
    })).json().data
    const friend = (await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'friend@example.com', password: 'correct-password', inviteCode: invite.code },
    })).json().data

    const ownerDemotion = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/users/${owner.user.id}`, headers: ownerHeaders, payload: { role: 'user' },
    })
    expect(ownerDemotion.statusCode).toBe(403)
    expect(ownerDemotion.json().error.code).toBe('owner_protected')
    expect((database.prepare('SELECT role FROM app_user WHERE id = ?').get(owner.user.id) as { role: string }).role).toBe('owner')

    const invalidRole = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/users/${friend.user.id}`, headers: ownerHeaders, payload: { role: 'moderator' },
    })
    expect(invalidRole.statusCode).toBe(400)
    expect(invalidRole.json().error.code).toBe('invalid_user_role')
    const invalidStatus = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/users/${friend.user.id}`, headers: ownerHeaders, payload: { status: 'sleeping' },
    })
    expect(invalidStatus.statusCode).toBe(400)
    expect(invalidStatus.json().error.code).toBe('invalid_user_status')

    const disabled = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/users/${friend.user.id}`, headers: ownerHeaders, payload: { status: 'disabled' },
    })
    expect(disabled.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${friend.token}` } })).statusCode).toBe(401)
    const refresh = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: friend.refreshToken, accessToken: friend.token } })
    expect(refresh.statusCode).toBe(401)
    expect(refresh.json().error.code).toBe('session_expired')

    await app.close()
    database.close()
  })

  it('manages invite codes, profile timezone and individual device sessions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-auth-'))
    temporaryDirectories.push(directory)
    const config = createConfig(directory)
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const auth = new AuthService(database, config)
    const app = await buildApp(config, database, auth)
    const ownerResponse = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'owner@example.com', password: 'correct-password', deviceName: 'Desktop' },
    })
    const owner = ownerResponse.json().data as { token: string }
    const headers = { authorization: `Bearer ${owner.token}` }

    const profileResponse = await app.inject({
      method: 'PATCH', url: '/api/v1/users/me', headers,
      payload: { timezone: 'Asia/Tokyo', preferredLanguage: 'ja' },
    })
    expect(profileResponse.statusCode).toBe(200)
    expect(profileResponse.json().data.profile).toMatchObject({ timezone: 'Asia/Tokyo', preferredLanguage: 'ja' })

    const inviteResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/invites', headers, payload: { maxUses: 2 } })
    const invite = inviteResponse.json().data as { id: number; code: string }
    const invitesBefore = await app.inject({ method: 'GET', url: '/api/v1/admin/invites', headers })
    expect(invitesBefore.json().data[0]).toMatchObject({ id: invite.id, status: 'active', maxUses: 2 })
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/admin/invites/${invite.id}`, headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/invites', headers })).json().data[0].status).toBe('revoked')
    const rejected = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'friend@example.com', password: 'correct-password', inviteCode: invite.code },
    })
    expect(rejected.json().error.code).toBe('invite_invalid')

    const loginResponse = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: 'owner@example.com', password: 'correct-password', deviceName: 'Phone' },
    })
    const phoneToken = loginResponse.json().data.token as string
    const sessionsResponse = await app.inject({ method: 'GET', url: '/api/v1/users/me/sessions', headers })
    const phoneSession = sessionsResponse.json().data.find((item: { deviceName?: string }) => item.deviceName === 'Phone') as { id: number }
    expect(phoneSession).toBeTruthy()
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/users/me/sessions/${phoneSession.id}`, headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${phoneToken}` } })).statusCode).toBe(401)

    await app.close()
    database.close()
  })
})
