import type { FastifyInstance } from 'fastify'
import type { AcgEntityKind, AcgService } from '../acg.js'
import type { AuthService } from '../auth.js'
import { assertApp } from '../errors.js'

const entityKinds = new Set<AcgEntityKind>(['creator', 'character', 'voice_actor', 'publisher', 'label', 'version_group'])

function parseEntityKind(value: string): AcgEntityKind {
  assertApp(entityKinds.has(value as AcgEntityKind), 404, 'entity_type_not_found', '资料类型不存在')
  return value as AcgEntityKind
}

export async function registerAcgRoutes(app: FastifyInstance, options: { auth: AuthService; acg: AcgService }): Promise<void> {
  const { auth, acg } = options

  app.get<{ Params: { kind: string; id: string } }>('/api/v1/acg/:kind/:id', async (request) => ({
    data: acg.detail(auth.authenticate(request), parseEntityKind(request.params.kind), Number(request.params.id)),
  }))

  app.patch<{ Params: { kind: string; id: string } }>('/api/v1/admin/acg/:kind/:id', async (request) => {
    const user = auth.requireRole(request, ['owner', 'admin'])
    const body = request.body as Record<string, unknown>
    return {
      data: acg.update(user, parseEntityKind(request.params.kind), Number(request.params.id), {
        ...(body.name !== undefined ? { name: String(body.name) } : {}),
        ...(body.nameJa !== undefined ? { nameJa: String(body.nameJa) } : {}),
        ...(body.nameZh !== undefined ? { nameZh: String(body.nameZh) } : {}),
        ...(body.nameEn !== undefined ? { nameEn: String(body.nameEn) } : {}),
        ...(body.nameRomaji !== undefined ? { nameRomaji: String(body.nameRomaji) } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: String(body.imageUrl) } : {}),
        ...(body.description !== undefined ? { description: String(body.description) } : {}),
        ...(body.websiteUrl !== undefined ? { websiteUrl: String(body.websiteUrl) } : {}),
        aliases: Array.isArray(body.aliases) ? body.aliases.map(String) : [],
      }),
    }
  })
}
