import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../auth.js'
import type { LibraryService } from '../library.js'
import type { MediaService, SavedUpload } from '../media.js'
import { readFileSync } from 'node:fs'
import { assertApp } from '../errors.js'

export async function registerLibraryRoutes(app: FastifyInstance, options: { auth: AuthService; library: LibraryService; media: MediaService }): Promise<void> {
  const { auth, library, media } = options

  app.post<{Params:{id:string}}>('/api/v1/playlists/:id/edit',async request=>{
    const user=auth.authenticate(request),id=Number(request.params.id)
    library.requirePlaylistOwner(user,id)
    let upload:SavedUpload|undefined,name:string|undefined,removeCover=false
    try {
      for await(const part of request.parts({limits:{files:1,fields:2,fileSize:5*1024*1024}})) {
        if(part.type==='file') {
          assertApp(part.fieldname==='cover',400,'invalid_field','请选择歌单封面')
          upload=await media.saveMultipartFile(part,'images')
          const bytes=readFileSync(upload.absolutePath)
          const valid=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.subarray(0,3).equals(Buffer.from([255,216,255]))||/^GIF8[79]a/.test(bytes.subarray(0,6).toString())||(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')
          assertApp(valid,400,'invalid_image','文件不是有效的 JPG、PNG、GIF 或 WebP 图片')
        } else if(part.fieldname==='name') name=String(part.value)
        else if(part.fieldname==='remove_cover') removeCover=part.value==='true'
      }
      const result=library.updatePlaylist(user,id,{...(name!==undefined?{name}:{}),...(upload?{coverUrl:media.storedImageUri(upload.relativePath)}:removeCover?{coverUrl:''}:{})})
      upload=undefined
      return {data:result}
    }finally{media.removeSavedUpload(upload)}
  })

  app.get('/api/v1/me/favorites/songs', async (request) => {
    const user = auth.authenticate(request)
    const query = request.query as Record<string, unknown>
    return library.listFavorites(user, Number(query.page ?? 1), Number(query.page_size ?? 20))
  })
  app.post<{ Params: { songId: string } }>('/api/v1/me/favorites/songs/:songId', async (request) => {
    const user = auth.authenticate(request)
    library.addFavorite(user, Number(request.params.songId))
    return { data: null }
  })
  app.delete<{ Params: { songId: string } }>('/api/v1/me/favorites/songs/:songId', async (request) => {
    const user = auth.authenticate(request)
    library.removeFavorite(user, Number(request.params.songId))
    return { data: null }
  })

  app.get('/api/v1/me/play-history', async (request) => {
    const user = auth.authenticate(request)
    const query = request.query as Record<string, unknown>
    return library.listHistory(user, Number(query.page ?? 1), Number(query.page_size ?? 50))
  })
  app.post('/api/v1/me/play-history', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    library.addHistory(user, {
      songId: Number(body.song_id),
      ...(body.played_at ? { playedAt: String(body.played_at) } : {}),
      ...(body.play_duration_seconds !== undefined ? { duration: Number(body.play_duration_seconds) } : {}),
      ...(body.completion_rate !== undefined ? { completionRate: Number(body.completion_rate) } : {}),
      ...(body.last_position_seconds !== undefined ? { lastPosition: Number(body.last_position_seconds) } : {}),
      ...(Object.hasOwn(body, 'playlist_id') ? { playlistId: body.playlist_id === null ? null : Number(body.playlist_id) } : {}),
      ...(body.play_started !== undefined ? { started: Boolean(body.play_started) } : {}),
    })
    return { data: null }
  })

  app.get('/api/v1/me/playlists', async (request) => {
    const user = auth.authenticate(request)
    return { data: library.listPlaylists(user) }
  })
  app.post('/api/v1/me/playlists', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: library.createPlaylist(user, {
      name: String(body.name ?? ''),
      ...(body.description !== undefined ? { description: String(body.description) } : {}),
      ...(body.cover_url !== undefined ? { coverUrl: String(body.cover_url) } : {}),
      ...(body.visibility !== undefined ? { visibility: String(body.visibility) } : {}),
    }) }
  })
  app.get<{ Params: { id: string } }>('/api/v1/playlists/:id', async (request) => {
    const user = auth.authenticate(request)
    return { data: library.playlistDetail(user, Number(request.params.id)) }
  })
  app.patch<{ Params: { id: string } }>('/api/v1/playlists/:id', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    return { data: library.updatePlaylist(user, Number(request.params.id), {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.description !== undefined ? { description: String(body.description) } : {}),
      ...(body.cover_url !== undefined ? { coverUrl: String(body.cover_url) } : {}),
      ...(body.visibility !== undefined ? { visibility: String(body.visibility) } : {}),
    }) }
  })
  app.delete<{ Params: { id: string } }>('/api/v1/playlists/:id', async (request) => {
    const user = auth.authenticate(request)
    library.deletePlaylist(user, Number(request.params.id))
    return { data: null }
  })
  app.post<{ Params: { id: string }; Body: { song_ids: number[] } }>('/api/v1/playlists/:id/songs/batch', async (request) => {
    return { data: library.addPlaylistSongs(auth.authenticate(request), Number(request.params.id), request.body?.song_ids) }
  })
  app.post<{ Params: { id: string } }>('/api/v1/playlists/:id/songs', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    library.addPlaylistSong(user, Number(request.params.id), Number(body.song_id), body.position === undefined ? undefined : Number(body.position))
    return { data: null }
  })
  app.delete<{ Params: { id: string; songId: string } }>('/api/v1/playlists/:id/songs/:songId', async (request) => {
    const user = auth.authenticate(request)
    library.removePlaylistSong(user, Number(request.params.id), Number(request.params.songId))
    return { data: null }
  })
  app.patch<{ Params: { id: string } }>('/api/v1/playlists/:id/songs/reorder', async (request) => {
    const user = auth.authenticate(request)
    const body = request.body as Record<string, unknown>
    library.reorderPlaylist(user, Number(request.params.id), Array.isArray(body.song_ids) ? body.song_ids.map(Number) : [])
    return { data: null }
  })
}
