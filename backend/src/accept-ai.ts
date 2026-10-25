import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AuthUser } from './auth.js'
import { loadConfig, type AppConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'
import { LlmClient } from './llm.js'
import { LyricJobService } from './lyric-jobs.js'
import { MediaService } from './media.js'
import { SongService } from './songs.js'

type JobType = 'transcribe' | 'translate' | 'furigana' | 'align' | 'annotate' | 'tokenize'
type JobResult = {
  id: number
  jobType: JobType
  status: 'pending' | 'processing' | 'succeeded' | 'failed'
  errorCode?: string
  errorMessage?: string
}

const textJobs: JobType[] = ['translate', 'furigana', 'annotate', 'tokenize']
const audioJobs: JobType[] = ['align', 'transcribe']

function writeSilentWav(path: string): void {
  const sampleRate = 16_000
  const samples = sampleRate
  const dataBytes = samples * 2
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataBytes, 40)
  writeFileSync(path, wav)
}

async function waitForJob(jobs: LyricJobService, user: AuthUser, id: number): Promise<JobResult> {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const result = jobs.list(user, 1, 50).find((job) => job.id === id) as JobResult | undefined
    if (result?.status === 'succeeded' || result?.status === 'failed') return result
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`AI 任务 ${id} 在 180 秒内没有结束。`)
}

const audioMimeTypes: Record<string, string> = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
}

export async function acceptAiJobs(baseConfig: AppConfig, audioFixture?: string): Promise<JobResult[]> {
  const fixturePath = audioFixture ? resolve(audioFixture) : undefined
  if (fixturePath && !existsSync(fixturePath)) throw new Error(`AI 验收音频不存在：${fixturePath}`)
  const extension = fixturePath ? extname(fixturePath).toLowerCase() : '.wav'
  const audioMimeType = audioMimeTypes[extension]
  if (!audioMimeType) throw new Error(`AI 验收不支持该音频格式：${extension || '无扩展名'}`)
  const directory = mkdtempSync(join(tmpdir(), 'animeuta-ai-acceptance-'))
  const mediaRoot = join(directory, 'media')
  const audioDirectory = join(mediaRoot, 'audio')
  mkdirSync(audioDirectory, { recursive: true })
  const audioFilename = `fixture${extension}`
  const audioPath = join(audioDirectory, audioFilename)
  if (fixturePath) copyFileSync(fixturePath, audioPath)
  else writeSilentWav(audioPath)
  const audioSize = statSync(audioPath).size
  const config: AppConfig = {
    ...baseConfig,
    databasePath: join(directory, 'acceptance.sqlite'),
    mediaRoot,
  }
  const database = openDatabase(config.databasePath)
  let jobs: LyricJobService | undefined
  try {
    runMigrations(database)
    database.prepare(`
      INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role)
      VALUES (1, 'acceptance@animeuta.local', 'not-a-login', 'not-a-login', 'AI Acceptance', 'owner')
    `).run()
    database.prepare(`
      INSERT INTO song(id, title_ja, language_code, duration_seconds, audio_source_uri, audio_mime_type,
        audio_size_bytes, submitted_by, review_status, visibility)
      VALUES (1, '光の歌', 'ja', 1, ?, ?, ?, 1, 'approved', 'shared')
    `).run(`audio/${audioFilename}`, audioMimeType, audioSize)
    database.prepare(`
      INSERT INTO lyric(id, song_id, language_code, source_type, original_text, review_status, visibility, is_current)
      VALUES (1, 1, 'ja', 'user_upload', '君の声を忘れない', 'approved', 'shared', 1)
    `).run()
    database.prepare(`
      INSERT INTO lyric_line(id, lyric_id, line_index, start_ms, end_ms, original_text)
      VALUES (1, 1, 0, 0, 1000, '君の声を忘れない')
    `).run()

    const user: AuthUser = {
      id: 1,
      email: 'acceptance@animeuta.local',
      role: 'owner',
      displayName: 'AI Acceptance',
      preferredLanguage: 'zh-CN',
      timezone: 'UTC',
    }
    const songs = new SongService(database, config, new MediaService(database, config))
    jobs = new LyricJobService(database, config, songs, new LlmClient(config))
    jobs.start()
    const results: JobResult[] = []
    for (const jobType of [...textJobs, ...audioJobs]) {
      process.stdout.write(`运行 ${jobType}... `)
      const created = jobs.create(user, 1, jobType)
      const result = await waitForJob(jobs, user, created.id)
      results.push(result)
      process.stdout.write(result.status === 'succeeded'
        ? '成功\n'
        : `可解释失败：${result.errorCode ?? 'unknown'} (${result.errorMessage ?? '无详细信息'})\n`)
    }
    return results
  } finally {
    if (jobs) await jobs.stop()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // Process-level environment variables are sufficient when no local .env exists.
  }
  const requireAudio = process.env.AI_ACCEPTANCE_REQUIRE_AUDIO?.toLowerCase() === 'true'
  const audioFixture = process.env.AI_ACCEPTANCE_AUDIO_PATH?.trim()
  if (requireAudio && !audioFixture) throw new Error('要求音频任务成功时必须设置 AI_ACCEPTANCE_AUDIO_PATH。')
  const results = await acceptAiJobs(loadConfig(), audioFixture)
  const failedText = results.filter((job) => textJobs.includes(job.jobType) && job.status !== 'succeeded')
  if (failedText.length > 0) {
    throw new Error(`真实文本模型验收失败：${failedText.map((job) => `${job.jobType}:${job.errorCode ?? 'unknown'}`).join(', ')}`)
  }
  const failedAudio = results.filter((job) => audioJobs.includes(job.jobType) && job.status !== 'succeeded')
  if (requireAudio && failedAudio.length > 0) {
    throw new Error(`真实音频任务验收失败：${failedAudio.map((job) => `${job.jobType}:${job.errorCode ?? 'unknown'}`).join(', ')}`)
  }
  process.stdout.write(failedAudio.length === 0
    ? 'AI 验收完成：六类任务均已真实写回。\n'
    : 'AI 验收完成：四类文本任务已真实写回；音频任务已返回稳定、可解释的 provider 错误。\n')
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined
if (entrypoint === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`AI 验收失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
