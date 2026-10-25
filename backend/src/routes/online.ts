import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../auth.js'
import type { OnlineSources } from '../online-sources.js'
import type { OnlineDownloads } from '../online-downloads.js'
import { assertApp, AppError } from '../errors.js'
import { onlinePlaylist, searchOnline } from '../online-catalog.js'
import { OnlinePreview } from '../online-preview.js'
import { searchOnlineUsers, onlineUserPlaylists } from '../online-users.js'

export async function registerOnlineRoutes(app:FastifyInstance, auth:AuthService, sources:OnlineSources, downloads:OnlineDownloads) {
  const preview=new OnlinePreview(sources)
  app.addHook('onClose',async()=>preview.close())
  app.post<{Body:{sourceId:number;track:any}}>('/api/v1/online/preview',async request=>({data:await preview.resolve(auth.authenticate(request).id,Number(request.body?.sourceId),request.body?.track)}))
  app.get<{Params:{key:string}}>('/api/v1/online/preview/:key',async(request,reply)=>preview.stream(request.params.key,request,reply))
  const owner=(request:Parameters<AuthService['authenticate']>[0])=>{
    const user=auth.authenticate(request)
    assertApp(user.role==='owner',403,'forbidden','只有所有者可以管理音源脚本')
    return user
  }
  const busy=new Set<number>()
  const bounded=async(userId:number,fn:()=>Promise<unknown>)=>{
    assertApp(!busy.has(userId)&&busy.size<4,429,'online_busy','在线搜索正在进行，请稍后重试')
    busy.add(userId)
    try{return {data:await fn()}}finally{busy.delete(userId)}
  }
  app.get('/api/v1/online/sources',async request=>({data:sources.list(auth.authenticate(request).id)}))
  app.get('/api/v1/online/catalog',async request=>{owner(request);return {data:await sources.refresh()}})
  app.post<{Body:{path:string;commit:string}}>('/api/v1/online/sources/install',async request=>{
    owner(request)
    assertApp(typeof request.body?.path==='string'&&typeof request.body.commit==='string',400,'bad_request','请选择音源文件')
    return {data:await sources.install(request.body.path,request.body.commit)}
  })
  app.post<{Body:{name:string;code:string}}>('/api/v1/online/sources/import',{bodyLimit:3*1024*1024},async request=>{
    owner(request)
    assertApp(typeof request.body?.name==='string'&&typeof request.body.code==='string',400,'bad_request','请选择音源脚本')
    return {data:sources.import(request.body.name,request.body.code)}
  })
  app.get<{Params:{id:string}}>('/api/v1/online/sources/:id/code',async(request,reply)=>{
    owner(request);reply.header('Content-Type','text/plain; charset=utf-8');reply.header('X-Content-Type-Options','nosniff');return sources.get(Number(request.params.id)).code
  })
  app.post<{Params:{id:string};Body:{enabled:boolean}}>('/api/v1/online/sources/:id/enabled',async request=>{
    const user=owner(request)
    assertApp(typeof request.body?.enabled==='boolean',400,'bad_request','启用状态不正确')
    return bounded(user.id,async()=>{
      try{await sources.enable(Number(request.params.id),request.body.enabled)}catch(error){if(error instanceof AppError)throw error;throw new AppError(400,'source_incompatible',error instanceof Error?error.message:'音源不兼容')}
      return {ok:true}
    })
  })
  app.post<{Body:{id:number}}>('/api/v1/online/sources/select',async request=>{
    const user=auth.authenticate(request);sources.select(user.id,Number(request.body?.id));return {data:{ok:true}}
  })
  app.get<{Querystring:{source?:string;kind?:string;q?:string;page?:string}}>('/api/v1/online/search',async request=>{
    const user=auth.authenticate(request),q=request.query
    return bounded(user.id,()=>q.kind==='users'?searchOnlineUsers(q.source??'wy',q.q??'',Number(q.page??1)):searchOnline(q.source??'all',q.kind??'songs',q.q??'',Number(q.page??1)))
  })
  app.get<{Querystring:{source?:string;id?:string;page?:string}}>('/api/v1/online/user-playlists',async request=>{
    const user=auth.authenticate(request),q=request.query
    return bounded(user.id,()=>onlineUserPlaylists(q.source??'wy',q.id??'',Number(q.page??1)))
  })
  app.get<{Querystring:{source?:string;id?:string;page?:string}}>('/api/v1/online/playlist',async request=>{
    const user=auth.authenticate(request),q=request.query
    return bounded(user.id,()=>onlinePlaylist(q.source??'',q.id??'',Number(q.page??1)))
  })
  app.get('/api/v1/online/downloads',async request=>({data:downloads.list(auth.authenticate(request).id)}))
  app.post<{Body:{playlistId:number;keys:string[]}}>('/api/v1/online/downloaded/add-to-playlist',async request=>({data:downloads.addDownloaded(auth.authenticate(request).id,Number(request.body?.playlistId),request.body?.keys)}))
  app.post<{Body:{sourceId:number;playlistId?:number;items:Array<{track:any;quality:string}>}}>('/api/v1/online/downloads',{bodyLimit:16*1024*1024},async request=>{
    const user=auth.authenticate(request)
    assertApp(request.body&&Array.isArray(request.body.items),400,'bad_request','请选择歌曲')
    return {data:downloads.enqueue(user.id,Number(request.body.sourceId),request.body.items,request.body.playlistId)}
  })
  app.post<{Params:{id:string}}>('/api/v1/online/downloads/:id/cancel',async request=>{downloads.cancel(auth.authenticate(request).id,Number(request.params.id));return {data:{ok:true}}})
  app.post<{Params:{id:string}}>('/api/v1/online/downloads/:id/retry',async request=>{downloads.retry(auth.authenticate(request).id,Number(request.params.id));return {data:{ok:true}}})
}
