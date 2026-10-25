import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, statfsSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from 'music-metadata'
import type { AuthUser } from './auth.js'
import type { SqliteDatabase } from './db.js'
import type { AppConfig } from './config.js'
import type { MediaService, SavedUpload } from './media.js'
import type { SongService } from './songs.js'
import { assertApp } from './errors.js'
import { publicRequest } from './online-network.js'
import { allowedQualities, runSource } from './online-runtime.js'
import { OnlineSources } from './online-sources.js'
import { catalogueLyrics, cataloguePicture } from './online-catalog.js'
import { LibraryService } from './library.js'

export class OnlineDownloads {
  private running: Promise<void> | undefined
  private stopped = false
  private active: { id: number; abort: AbortController } | undefined
  constructor(private db: SqliteDatabase, private config: AppConfig, private sources: OnlineSources, private songs: SongService, private media: MediaService) {
    db.prepare("UPDATE online_download SET state='failed',error='服务重启，请重试',updated_at=CURRENT_TIMESTAMP WHERE state IN ('resolving','downloading','importing')").run()
  }
  list(userId: number) {
    return this.db.prepare("SELECT * FROM online_download WHERE user_id=? ORDER BY CASE WHEN state IN ('resolving','downloading','importing') THEN 0 WHEN state='queued' THEN 1 ELSE 2 END,id DESC").all(userId).map((row) => {
      const {track_json, ...rest} = row
      const track = JSON.parse(String(track_json))
      return {...rest, name:track.name, singer:track.singer}
    })
  }
  private actor(userId: number): AuthUser {
    const row=this.db.prepare("SELECT * FROM app_user WHERE id=? AND status='active'").get(userId)
    assertApp(row,403,'user_disabled','用户已停用')
    return {id:userId,email:String(row.email),displayName:String(row.display_name),role:row.role as AuthUser['role'],preferredLanguage:String(row.preferred_language),timezone:String(row.timezone)}
  }
  addDownloaded(userId:number, playlistId:number, keys:string[]) {
    assertApp(Array.isArray(keys)&&keys.length>0&&keys.every(k=>typeof k==='string'&&k.length<500),400,'invalid_tracks','请选择歌曲')
    let missing=0
    const ids=[...new Set([...new Set(keys)].flatMap(key=>{
      const row=this.db.prepare("SELECT d.song_id FROM online_download d JOIN song s ON s.id=d.song_id WHERE d.track_key=? AND d.state IN ('completed','duplicate') AND s.visibility='shared' AND s.review_status='approved' ORDER BY d.id DESC LIMIT 1").get(key)
      if(!row)missing++
      return row?[Number(row.song_id)]:[]
    }))]
    assertApp(ids.length,400,'not_downloaded','所选歌曲尚未下载入库')
    return {...new LibraryService(this.db,this.songs).addPlaylistSongs(this.actor(userId),playlistId,ids),missing}
  }
  private attach(id:number,playlistId:number,userId:number,songId?:number) {
    if(songId) new LibraryService(this.db,this.songs).addPlaylistSongs(this.actor(userId),playlistId,[songId])
    else this.db.prepare('INSERT OR IGNORE INTO online_download_playlist(download_id,playlist_id,user_id) VALUES (?,?,?)').run(id,playlistId,userId)
  }
  private attachCompleted(id:number,songId:number) {
    const failures:string[]=[]
    for(const row of this.db.prepare('SELECT * FROM online_download_playlist WHERE download_id=?').all(id)) {
      try { this.attach(id,Number(row.playlist_id),Number(row.user_id),songId) }
      catch { failures.push('歌曲已入库，但目标歌单不可用，请手动加入') }
    }
    if(failures.length) this.db.prepare("UPDATE online_download SET error=coalesce(error || '；','') || ? WHERE id=?").run(failures[0]!,id)
  }
  enqueue(userId: number, sourceId: number, items: Array<{track:any;quality:string}>, playlistId?:number) {
    if(playlistId!==undefined) new LibraryService(this.db,this.songs).requirePlaylistContributor(this.actor(userId),playlistId)
    const source = this.sources.get(sourceId)
    assertApp(source.enabled, 400, 'source_disabled', '音源未启用')
    assertApp(Array.isArray(items) && items.length > 0, 400, 'invalid_downloads', '请选择要下载的歌曲')
    const caps = JSON.parse(source.capabilities_json)
    for (const item of items) {
      assertApp(item.track && typeof item.track.name === 'string' && item.track.name.length <= 300 && item.track.songmid != null && JSON.stringify(item.track).length <= 20000, 400, 'invalid_track', '歌曲信息不正确')
      assertApp(allowedQualities(caps, item.track).includes(item.quality), 400, 'quality_unavailable', '当前歌曲与音源不支持所选音质')
    }
    const results = []
    for (const item of items) {
      const key = `${item.track.source}:${item.track.songmid}`
      const duplicate = this.db.prepare("SELECT id,song_id,state FROM online_download WHERE track_key=? AND quality=? AND (state IN ('queued','resolving','downloading','importing') OR (state IN ('completed','duplicate') AND song_id IN (SELECT id FROM song WHERE visibility='shared' AND review_status='approved'))) ORDER BY id DESC LIMIT 1").get(key,item.quality)
      if (duplicate) {
        if(playlistId!==undefined)this.attach(Number(duplicate.id),playlistId,userId,duplicate.song_id?Number(duplicate.song_id):undefined)
        results.push({...duplicate,duplicate:true}); continue
      }
      const result = this.db.prepare('INSERT INTO online_download(user_id,source_id,track_json,track_key,quality) VALUES (?,?,?,?,?)').run(userId,sourceId,JSON.stringify(item.track),key,item.quality)
      results.push({id:Number(result.lastInsertRowid),duplicate:false})
      if(playlistId!==undefined)this.attach(Number(result.lastInsertRowid),playlistId,userId)
    }
    this.start()
    return results
  }
  cancel(userId:number,id:number) {
    const result = this.db.prepare("UPDATE online_download SET state='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND state IN ('queued','resolving','downloading','importing')").run(id,userId)
    assertApp(result.changes,409,'not_cancellable','任务不存在或已经结束')
    if(this.active?.id===id) this.active.abort.abort()
  }
  retry(userId:number,id:number) {
    const row=this.db.prepare('SELECT * FROM online_download WHERE id=? AND user_id=?').get(id,userId)
    assertApp(row && ['failed','cancelled'].includes(String(row.state)),409,'not_retryable','任务不能重试')
    assertApp(this.sources.get(Number(row.source_id)).enabled,400,'source_disabled','音源已停用')
    const duplicate=this.db.prepare("SELECT 1 FROM online_download WHERE id!=? AND track_key=? AND quality=? AND (state IN ('queued','resolving','downloading','importing') OR (state IN ('completed','duplicate') AND song_id IN (SELECT id FROM song WHERE visibility='shared' AND review_status='approved'))) LIMIT 1").get(id,String(row.track_key),String(row.quality))
    assertApp(!duplicate,409,'duplicate_download','相同歌曲和音质已在队列或曲库中')
    this.db.prepare("UPDATE online_download SET state='queued',error=NULL,received=0,total=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id)
    this.start()
  }
  start() {
    if(this.running||this.stopped)return
    this.running=this.drain().finally(()=>{
      this.running=undefined
      if(!this.stopped&&this.db.prepare("SELECT 1 FROM online_download WHERE state='queued' LIMIT 1").get()) this.start()
    })
  }
  async stop() {this.stopped=true;this.active?.abort.abort();await this.running}
  private async drain() {
    while(!this.stopped) {
      const row=this.db.prepare("SELECT * FROM online_download WHERE state='queued' ORDER BY id LIMIT 1").get()
      if(!row)return
      const id=Number(row.id), abort=new AbortController()
      this.active={id,abort}
      let audio:SavedUpload|undefined,cover:SavedUpload|undefined
      try {
        const userRow=this.db.prepare("SELECT * FROM app_user WHERE id=? AND status='active'").get(Number(row.user_id))
        assertApp(userRow,403,'user_disabled','用户已停用')
        const user:AuthUser={id:Number(userRow.id),email:String(userRow.email),role:'user',displayName:String(userRow.display_name),preferredLanguage:String(userRow.preferred_language),timezone:String(userRow.timezone)}
        const disk=statfsSync(this.config.mediaRoot)
        assertApp(disk.bavail*disk.bsize>this.config.maxAudioBytes+1024*1024*1024,507,'disk_full','云端磁盘空间不足')
        const source=this.sources.get(Number(row.source_id))
        assertApp(source.enabled,400,'source_disabled','音源已停用')
        const track=JSON.parse(String(row.track_json)),quality=String(row.quality)
        this.state(id,'resolving')
        const resolved=await runSource(source.code,{source:track.source,action:'musicUrl',info:{type:quality,musicInfo:track}},abort.signal)
        const url=typeof resolved==='string'?resolved:resolved?.url
        assertApp(typeof url==='string',502,'invalid_audio_url','音源未返回音频地址')
        this.state(id,'downloading')
        let lastProgress=0
        const response=await publicRequest(url,{maxBytes:this.config.maxAudioBytes,signal:abort.signal,onProgress:(received,total)=>{
          if(Date.now()-lastProgress>200||received===total){lastProgress=Date.now();this.db.prepare('UPDATE online_download SET received=?,total=? WHERE id=?').run(received,total,id)}
        }})
        this.db.prepare('UPDATE online_download SET received=?,total=? WHERE id=?').run(response.body.length,response.body.length,id)
        assertApp(response.statusCode===200,502,'audio_download_failed',`音频下载失败 (${response.statusCode})`)
        const checksum=createHash('sha256').update(response.body).digest('hex')
        const existing=this.db.prepare("SELECT id FROM song WHERE audio_checksum=? AND visibility='shared' AND review_status='approved' LIMIT 1").get(checksum)
        if(existing){this.db.prepare("UPDATE online_download SET state='duplicate',song_id=? WHERE id=?").run(Number(existing.id),id);this.attachCompleted(id,Number(existing.id));continue}
        const head=response.body.subarray(0,16)
        const extension=head.subarray(0,4).toString()==='fLaC'?'.flac':head.subarray(0,4).toString()==='RIFF'?'.wav':head.subarray(4,8).toString()==='ftyp'?'.m4a':head.subarray(0,4).toString()==='OggS'?'.ogg':'.mp3'
        audio=this.save(response.body,'audio',extension,`${track.name}${extension}`,String(response.headers['content-type']||'audio/mpeg'))
        const metadata=await parseFile(audio.absolutePath,{duration:true})
        assertApp(metadata.format.codec && metadata.format.duration,502,'invalid_audio','返回内容不是有效的完整音频')
        if(['flac','flac24bit','flac32bit','hires','master'].includes(quality)) assertApp(metadata.format.lossless,502,'quality_mismatch','音源返回有损音频，与所选音质不符')
        if(['flac24bit','hires'].includes(quality)) assertApp((metadata.format.bitsPerSample??0)>=24,502,'quality_mismatch','返回音频不足 24-bit')
        if(quality==='flac32bit') assertApp((metadata.format.bitsPerSample??0)>=32,502,'quality_mismatch','返回音频不足 32-bit')
        if(quality==='320k') assertApp((metadata.format.bitrate??0)>=280000,502,'quality_mismatch','返回音频码率低于所选音质')
        let lyricsText:string|undefined
        const caps=JSON.parse(source.capabilities_json)[track.source]
        const warnings:string[]=[]
        let coverUrl=track.img
        if(!coverUrl){try{coverUrl=await cataloguePicture(track,abort.signal)}catch{warnings.push('平台封面获取失败')}}
        if(caps.actions.includes('pic')) {try{coverUrl=await runSource(source.code,{source:track.source,action:'pic',info:{musicInfo:track}},abort.signal)}catch{warnings.push('封面解析失败')}}
        if(typeof coverUrl==='string'&&coverUrl){try{
          const image=await publicRequest(coverUrl,{maxBytes:this.config.maxImageBytes,signal:abort.signal})
          if(image.statusCode===200 && /^image\/(jpeg|png|webp)$/.test(String(image.headers['content-type']).split(';')[0]!)) cover=this.save(image.body,'images',String(image.headers['content-type']).includes('png')?'.png':String(image.headers['content-type']).includes('webp')?'.webp':'.jpg','cover',String(image.headers['content-type']))
          else warnings.push('封面下载失败')
        }catch{warnings.push('封面下载失败')}}
        if(caps.actions.includes('lyric')){try{
          const lyric=await runSource(source.code,{source:track.source,action:'lyric',info:{musicInfo:track}},abort.signal)
          lyricsText=typeof lyric==='string'?lyric:[lyric?.lyric,lyric?.tlyric,lyric?.rlyric].filter(x=>typeof x==='string').join('\n')
        }catch{warnings.push('音源歌词获取失败')}}
        if(!lyricsText){try{const lyric=await catalogueLyrics(track,abort.signal);lyricsText=typeof lyric==='string'?lyric:[lyric?.lyric,lyric?.tlyric,lyric?.rlyric].filter(x=>typeof x==='string').join('\n')}catch{warnings.push('平台歌词获取失败')}}
        if(!lyricsText) warnings.push('未获取到外部歌词，保留音频内嵌歌词')
        abort.signal.throwIfAborted()
        this.state(id,'importing')
        const result=await this.songs.create(user,{title:track.name,artistName:track.singer||'',albumTitle:track.albumName||'',audio,...(cover?{cover}:{}),...(lyricsText?{lyricsText}:{}),signal:abort.signal},true)
        audio=undefined;cover=undefined
        this.db.prepare("UPDATE online_download SET state='completed',song_id=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(result.song.id,warnings.join('；')||null,id)
        this.attachCompleted(id,result.song.id)
      }catch(error){
        this.db.prepare("UPDATE online_download SET state=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state!='cancelled'").run(abort.signal.aborted?'cancelled':'failed',error instanceof Error?error.message.slice(0,300):'下载失败',id)
      }finally{this.media.removeSavedUpload(audio);this.media.removeSavedUpload(cover);this.active=undefined}
    }
  }
  private state(id:number,state:string){this.db.prepare("UPDATE online_download SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state!='cancelled'").run(state,id)}
  private save(body:Buffer,kind:string,extension:string,name:string,mimeType:string):SavedUpload {
    const relativePath=`${kind}/${randomUUID()}${extension}`,absolutePath=join(this.config.mediaRoot,relativePath)
    mkdirSync(join(this.config.mediaRoot,kind),{recursive:true})
    writeFileSync(absolutePath,body,{flag:'wx'})
    return {relativePath,absolutePath,originalFilename:name,mimeType,sizeBytes:body.length,checksum:createHash('sha256').update(body).digest('hex')}
  }
}
