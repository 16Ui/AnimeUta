import { createHash, randomBytes } from 'node:crypto'
import { parseBuffer } from 'music-metadata'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { OnlineSources } from './online-sources.js'
import { allowedQualities, runSource } from './online-runtime.js'
import { publicRequest } from './online-network.js'
import { assertApp, AppError } from './errors.js'

// Bounded temporary audio cache. Previews never create songs or download jobs.
export class OnlinePreview {
  private cache=new Map<string,{body:Buffer;type:string;expires:number}>()
  private busy=new Set<number>()
  private timer=setInterval(()=>this.prune(),60_000).unref()
  constructor(private sources:OnlineSources) {}
  close(){clearInterval(this.timer);this.cache.clear()}
  private prune(){for(const [key,item] of this.cache)if(item.expires<Date.now())this.cache.delete(key)}
  async resolve(userId:number,sourceId:number,track:any){
    assertApp(track&&typeof track.name==='string'&&track.songmid!=null&&JSON.stringify(track).length<=20000,400,'invalid_track','歌曲信息不正确')
    assertApp(!this.busy.has(userId)&&this.busy.size<2,429,'preview_busy','试听正在加载，请稍后重试')
    const source=this.sources.get(sourceId)
    assertApp(source.enabled,400,'source_disabled','音源未启用')
    const quality=allowedQualities(JSON.parse(source.capabilities_json),track)[0]
    assertApp(quality,400,'quality_unavailable','该歌曲暂无可试听音质')
    this.busy.add(userId)
    try{
      const resolved=await runSource(source.code,{source:track.source,action:'musicUrl',info:{type:quality,musicInfo:track}})
      const url=typeof resolved==='string'?resolved:resolved?.url
      assertApp(typeof url==='string',502,'invalid_audio_url','音源未返回试听地址')
      const result=await publicRequest(url,{maxBytes:32*1024*1024})
      assertApp(result.statusCode===200,502,'preview_failed','试听音频获取失败')
      const metadata=await parseBuffer(result.body,undefined,{duration:true})
      assertApp(metadata.format.codec&&metadata.format.duration,502,'preview_failed','音源返回的试听音频无效')
      this.prune()
      let total=[...this.cache.values()].reduce((n,item)=>n+item.body.length,0)
      for(const [key,item] of this.cache){if(total+result.body.length<=96*1024*1024)break;this.cache.delete(key);total-=item.body.length}
      const key=randomBytes(24).toString('hex'),expires=Date.now()+30*60_000
      const type=metadata.format.container?.includes('FLAC')?'audio/flac':metadata.format.container?.includes('WAVE')?'audio/wav':metadata.format.container?.includes('MPEG-4')?'audio/mp4':metadata.format.container?.includes('Ogg')?'audio/ogg':'audio/mpeg'
      this.cache.set(key,{body:result.body,type,expires})
      return {id:-parseInt(createHash('sha256').update(`${track.source}:${track.songmid}`).digest('hex').slice(0,12),16)-1,title:track.name,artist:track.singer||'',coverUrl:track.img,durationSeconds:metadata.format.duration,audioUrl:`/api/v1/online/preview/${key}?expires=${Math.floor(expires/1000)}`,onlinePreview:{sourceId,track}}
    }catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'preview_failed',`试听失败：${error instanceof Error?error.message:'音源暂时不可用'}`)}
    finally{this.busy.delete(userId)}
  }
  stream(key:string,request:FastifyRequest,reply:FastifyReply){
    this.prune()
    const item=this.cache.get(key)
    assertApp(item,410,'preview_expired','试听缓存已过期，请重新播放')
    reply.header('Cache-Control','no-store').header('Content-Type',item.type).header('Accept-Ranges','bytes')
    let start=0,end=item.body.length-1
    if(request.headers.range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range)
      assertApp(match&&(match[1]||match[2]),416,'invalid_range','无效的音频范围')
      if(!match[1])start=Math.max(0,item.body.length-Number(match[2]))
      else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]))}
      assertApp(start<=end&&start>=0&&end<item.body.length,416,'invalid_range','无效的音频范围')
      reply.status(206).header('Content-Range',`bytes ${start}-${end}/${item.body.length}`)
    }
    return reply.header('Content-Length',end-start+1).send(item.body.subarray(start,end+1))
  }
}
