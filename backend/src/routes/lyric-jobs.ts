import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../auth.js'
import type { LyricJobService } from '../lyric-jobs.js'

export async function registerLyricJobRoutes(app: FastifyInstance, options: { auth: AuthService; jobs: LyricJobService }): Promise<void> {
  const { auth, jobs } = options
  app.get<{ Params: { id: string } }>('/api/v1/songs/:id/lyrics/jobs', async (request) => {
    const user = auth.authenticate(request)
    const query = request.query as Record<string, unknown>
    return { data: jobs.list(user, Number(request.params.id), Number(query.limit ?? 10)) }
  })
  app.post<{ Params: { id: string } }>('/api/v1/songs/:id/lyrics/jobs', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: jobs.create(user, Number(request.params.id), String(body.jobType ?? '')) }
  })
  app.post<{ Params: { id: string } }>('/api/v1/lyrics/jobs/:id/retry', async (request) => ({
    data: jobs.retry(auth.authenticate(request), Number(request.params.id)),
  }))
}
