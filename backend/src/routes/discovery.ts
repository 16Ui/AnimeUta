import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../auth.js'
import type { DiscoveryService } from '../discovery.js'

export async function registerDiscoveryRoutes(app: FastifyInstance, options: { auth: AuthService; discovery: DiscoveryService }): Promise<void> {
  const { auth, discovery } = options
  app.get('/api/v1/search', async (request) => {
    const user = auth.authenticate(request)
    const query = request.query as Record<string, unknown>
    return { data: discovery.search(user, String(query.keyword ?? ''), Number(query.page ?? 1), Number(query.page_size ?? 20)) }
  })
  app.get('/api/v1/search/suggestions', async (request) => {
    const user = auth.authenticate(request)
    const query = request.query as Record<string, unknown>
    return { data: discovery.suggestions(user, String(query.keyword ?? ''), Number(query.limit ?? 8)) }
  })
  app.get<{ Params: { id: string } }>('/api/v1/artists/:id', async (request) => ({ data: discovery.artistDetail(auth.authenticate(request), Number(request.params.id)) }))
  app.get<{ Params: { id: string } }>('/api/v1/works/:id', async (request) => ({ data: discovery.workDetail(auth.authenticate(request), Number(request.params.id)) }))
  app.get<{ Params: { id: string } }>('/api/v1/albums/:id', async (request) => ({ data: discovery.albumDetail(auth.authenticate(request), Number(request.params.id)) }))
}
