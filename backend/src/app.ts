import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdirSync } from 'node:fs'
import type { AuthService } from './auth.js'
import type { AppConfig } from './config.js'
import type { SqliteDatabase } from './db.js'
import { AcgService } from './acg.js'
import { DiscoveryService } from './discovery.js'
import { AppError } from './errors.js'
import { MediaService } from './media.js'
import { LibraryService } from './library.js'
import { LlmClient } from './llm.js'
import { LyricJobService } from './lyric-jobs.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerAcgRoutes } from './routes/acg.js'
import { registerLibraryRoutes } from './routes/library.js'
import { registerDiscoveryRoutes } from './routes/discovery.js'
import { registerLyricJobRoutes } from './routes/lyric-jobs.js'
import { registerSongRoutes } from './routes/songs.js'
import { SongService } from './songs.js'
import { StudyService } from './study.js'
import { JapaneseStudyAnalyzer, TomoshiDictionary } from './japanese-study.js'
import { registerStudyRoutes } from './routes/study.js'
import { OnlineSources } from './online-sources.js'
import { OnlineDownloads } from './online-downloads.js'
import { registerOnlineRoutes } from './routes/online.js'

export async function buildApp(config: AppConfig, database: SqliteDatabase, auth: AuthService): Promise<FastifyInstance> {
  mkdirSync(config.mediaRoot, { recursive: true })
  const app = Fastify({ logger: true, bodyLimit: config.maxAudioBytes + config.maxImageBytes })
  await app.register(cors, {
    origin: config.appOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
  await app.register(multipart, {
    limits: { fileSize: config.maxAudioBytes, files: 8, fields: 40 },
  })
  const media = new MediaService(database, config)
  app.addHook('preSerialization', async (_request, _reply, payload) => media.signImageFields(payload))
  const songs = new SongService(database, config, media)
  songs.recoverInterruptedImports()
  songs.cleanupAbandonedImports()
  const importCleanupTimer = setInterval(() => songs.cleanupAbandonedImports(), 60 * 60 * 1000)
  importCleanupTimer.unref()
  const library = new LibraryService(database, songs)
  const acg = new AcgService(database, songs)
  const discovery = new DiscoveryService(database, songs, acg)
  const llm = new LlmClient(config)
  const study = new StudyService(database, songs, new JapaneseStudyAnalyzer(new TomoshiDictionary(config.dictionaryPath), llm))
  songs.setLyricAnalysisHandler((user, songId) => study.tokenizeSong(user, songId))
  const jobs = new LyricJobService(database, config, songs, llm, study)

  app.get('/health', async () => ({ status: 'ok', service: 'animeuta-backend' }))
  app.get('/api/v1/health', async () => ({ data: { status: 'ok', service: 'animeuta-backend' } }))
  await registerAuthRoutes(app, { auth })
  await registerAcgRoutes(app, { auth, acg })
  await registerSongRoutes(app, { auth, config, media, songs })
  await registerLibraryRoutes(app, { auth, library, media })
  await registerDiscoveryRoutes(app, { auth, discovery })
  await registerStudyRoutes(app, { auth, study })
  await registerLyricJobRoutes(app, { auth, jobs })
  const onlineSources = new OnlineSources(database)
  const downloads = new OnlineDownloads(database, config, onlineSources, songs, media)
  await registerOnlineRoutes(app, auth, onlineSources, downloads)
  downloads.start()
  jobs.start()
  app.addHook('onClose', async () => {
    clearInterval(importCleanupTimer)
    await jobs.stop()
    await downloads.stop()
    study.close()
  })

  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ error: { code: 'not_found', message: '接口不存在' } })
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } })
      return
    }
    if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
      const message = 'message' in error && typeof error.message === 'string' ? error.message : '请求格式不正确'
      void reply.status(error.statusCode).send({ error: { code: 'bad_request', message } })
      return
    }
    app.log.error(error)
    void reply.status(500).send({ error: { code: 'internal_error', message: '服务器处理请求时发生错误' } })
  })
  return app
}
