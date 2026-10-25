import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function listFromEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name]
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : fallback
}

export interface AppConfig {
  host: string
  port: number
  databasePath: string
  dictionaryPath?: string
  mediaRoot: string
  audioLibraryRoots?: string[]
  appOrigins: string[]
  registrationMode: 'invite' | 'open' | 'closed'
  friendShareReview: boolean
  bootstrapAdminEmail?: string
  bootstrapAdminPassword?: string
  bootstrapAdminName: string
  accessTokenTtlMinutes: number
  refreshTokenTtlDays: number
  maxAudioBytes: number
  maxImageBytes: number
  mediaSigningSecret: string
  llmBaseUrl: string
  llmModel: string
  transcriptionBaseUrl?: string
  transcriptionModel: string
  transcriptionTimeoutSeconds?: number
  aiDailyLimit: number
  llmApiKey?: string
  transcriptionApiKey?: string
}

export function loadConfig(cwd = process.cwd()): AppConfig {
  const registrationMode = process.env.REGISTRATION_MODE
  const mode = registrationMode === 'open' || registrationMode === 'closed' ? registrationMode : 'invite'
  const bootstrapAdminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
  const bootstrapAdminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD
  const llmApiKey = process.env.LLM_API_KEY
  const transcriptionApiKey = process.env.TRANSCRIPTION_API_KEY
  const appOrigins = [...new Set([
    ...listFromEnv('APP_ORIGIN', [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://127.0.0.1:5174',
      'http://localhost:5174',
    ]),
    'https://localhost',
    'capacitor://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
  ])]

  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: numberFromEnv('PORT', 8080),
    databasePath: resolve(cwd, process.env.DATABASE_PATH ?? './data/animeuta.sqlite'),
    dictionaryPath: resolve(cwd, process.env.TOMOSHI_DICTIONARY_PATH ?? './data/dictionaries/tomoshi-dict-open.db'),
    mediaRoot: resolve(cwd, process.env.MEDIA_ROOT ?? './data/media'),
    audioLibraryRoots: (process.env.AUDIO_LIBRARY_ROOTS ?? '').split(';').map((path) => path.trim()).filter(Boolean).map((path) => resolve(cwd, path)),
    appOrigins,
    registrationMode: mode,
    friendShareReview: process.env.FRIEND_SHARE_REVIEW?.toLowerCase() !== 'false',
    ...(bootstrapAdminEmail ? { bootstrapAdminEmail } : {}),
    ...(bootstrapAdminPassword ? { bootstrapAdminPassword } : {}),
    bootstrapAdminName: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'AnimeUta Admin',
    accessTokenTtlMinutes: numberFromEnv('ACCESS_TOKEN_TTL_MINUTES', 30),
    refreshTokenTtlDays: numberFromEnv('REFRESH_TOKEN_TTL_DAYS', 30),
    maxAudioBytes: numberFromEnv('MAX_AUDIO_BYTES', 100 * 1024 * 1024),
    maxImageBytes: numberFromEnv('MAX_IMAGE_BYTES', 10 * 1024 * 1024),
    mediaSigningSecret: process.env.MEDIA_SIGNING_SECRET || randomBytes(32).toString('hex'),
    llmBaseUrl: process.env.LLM_BASE_URL?.replace(/\/$/, '') || 'https://api.openai.com/v1',
    llmModel: process.env.LLM_MODEL?.trim() || 'gpt-4o-mini',
    ...(process.env.TRANSCRIPTION_BASE_URL ? { transcriptionBaseUrl: process.env.TRANSCRIPTION_BASE_URL.replace(/\/$/, '') } : {}),
    transcriptionModel: process.env.TRANSCRIPTION_MODEL?.trim() || 'whisper-1',
    transcriptionTimeoutSeconds: numberFromEnv('TRANSCRIPTION_TIMEOUT_SECONDS', 1_800),
    aiDailyLimit: numberFromEnv('AI_DAILY_LIMIT', 20),
    ...(llmApiKey ? { llmApiKey } : {}),
    ...(transcriptionApiKey ? { transcriptionApiKey } : {}),
  }
}
