import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { allowedQualities, runSource } from './online-runtime.js'
import { isPublicAddress, publicRequest } from './online-network.js'
import { openDatabase, runMigrations } from './db.js'
import { OnlineSources } from './online-sources.js'
import { OnlineDownloads } from './online-downloads.js'
import { loadConfig } from './config.js'
import { SongService } from './songs.js'
import { MediaService } from './media.js'
import { AuthService } from './auth.js'
import { buildApp } from './app.js'
import * as network from './online-network.js'
import * as catalogue from './online-catalog.js'
import { ZipFile } from 'yazl'

const source=`lx.on(lx.EVENT_NAMES.request, async ({action}) => action==='musicUrl'?'https://example.com/audio.mp3':null); lx.send(lx.EVENT_NAMES.inited,{status:true,sources:{kw:{actions:['musicUrl'],qualitys:['128k','320k']}}});`

describe('online source isolation',()=>{
  it.each(['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fe80::1','0.0.0.0'])('blocks private address %s',address=>expect(isPublicAddress(address)).toBe(false))
  it('accepts public IPs',()=>expect(isPublicAddress('8.8.8.8')).toBe(true))
  it('blocks unsafe protocols and credentials',async()=>{
    await expect(publicRequest('file:///etc/passwd')).rejects.toThrow()
    await expect(publicRequest('http://user:pass@example.com/')).rejects.toThrow()
    await expect(publicRequest('http://example.com:8080/')).rejects.toThrow()
  })
  it('does not invent qualities',()=>{
    expect(allowedQualities({kw:{actions:['musicUrl'],qualitys:['128k','320k','flac']}},{source:'kw',types:[{type:'128k'}]})).toEqual(['128k'])
    expect(allowedQualities({kw:{actions:['musicUrl'],qualitys:['flac']}},{source:'kw'})).toEqual([])
  })
  it('reads capabilities and calls isolated source handlers',async()=>{
    expect(await runSource(source)).toEqual({kw:{actions:['musicUrl'],qualitys:['128k','320k']}})
    expect(await runSource(source,{source:'kw',action:'musicUrl',info:{type:'128k'}})).toBe('https://example.com/audio.mp3')
  })
  it('does not expose Node capabilities',async()=>{
    await expect(runSource(`if(typeof process!=='undefined'||typeof require!=='undefined')throw new Error('escape'); ${source}`)).resolves.toBeTruthy()
  })
  it('interrupts infinite scripts',async()=>{await expect(runSource('while(true){}')).rejects.toBeTruthy()})
  it('rejects network during capability inspection',async()=>{await expect(runSource(`lx.request('https://example.com',{},()=>{});${source}`)).rejects.toBeTruthy()})
})

describe('online source and queue persistence',()=>{
  it('uses a pinned GitHub archive when the directory API is rate limited',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'animeuta-catalog-'))
    const config=loadConfig(directory),db=openDatabase(config.databasePath)
    runMigrations(db)
    const zip=new ZipFile(),chunks:Buffer[]=[]
    zip.addBuffer(Buffer.from(source),'repo-main/V260817/source.js')
    const body=new Promise<Buffer>(resolve=>{zip.outputStream.on('data',chunk=>chunks.push(chunk));zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)))})
    zip.end({comment:'a'.repeat(40)})
    const json=vi.spyOn(network,'publicJson').mockRejectedValue(new Error('403'))
    const request=vi.spyOn(network,'publicRequest').mockResolvedValue({body:await body,statusCode:200,headers:{}})
    try{
      const sources=new OnlineSources(db),catalog=await sources.refresh()
      expect(catalog.commit).toBe('a'.repeat(40));expect(catalog.files).toHaveLength(1)
      const installed=await sources.install(catalog.files[0]!.path,catalog.commit)
      expect(sources.get(Number(installed.id)).code).toBe(source)
      expect(request).toHaveBeenCalledTimes(1)
    }finally{json.mockRestore();request.mockRestore();db.close();rmSync(directory,{recursive:true,force:true})}
  })
  it('imports shared songs and lyrics for ordinary users and deduplicates across users',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'animeuta-online-e2e-'))
    const config={...loadConfig(directory),registrationMode:'open' as const},db=openDatabase(config.databasePath)
    runMigrations(db)
    const auth=new AuthService(db,config),app=await buildApp(config,db,auth)
    const pcm=Buffer.alloc(16044)
    pcm.write('RIFF');pcm.writeUInt32LE(16036,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(8000,24);pcm.writeUInt32LE(16000,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(16000,40)
    const net=vi.spyOn(network,'publicRequest').mockResolvedValue({body:pcm,statusCode:200,headers:{'content-type':'audio/wav'}})
    const lyrics=vi.spyOn(catalogue,'catalogueLyrics').mockResolvedValue({lyric:'[00:00.00]テスト'})
    const pic=vi.spyOn(catalogue,'cataloguePicture').mockResolvedValue(null)
    try{
      const owner=await auth.register({email:'owner@example.com',password:'test-password-123'})
      const member=await auth.register({email:'member@example.com',password:'test-password-123'})
      const sources=new OnlineSources(db),installed=sources.import('fixture',source) as {id:number}
      await sources.enable(installed.id,true)
      const headers={authorization:`Bearer ${member.token}`}
      const playlistResponse=await app.inject({method:'POST',url:'/api/v1/me/playlists',headers,payload:{name:'Shared downloads',visibility:'public'}})
      const playlistId=playlistResponse.json().data.id
      const track={source:'kw',songmid:'1',name:'Fixture',types:[{type:'128k'}]}
      expect((await app.inject({method:'POST',url:'/api/v1/online/preview',payload:{sourceId:installed.id,track}})).statusCode).toBe(401)
      const preview=await app.inject({method:'POST',url:'/api/v1/online/preview',headers,payload:{sourceId:installed.id,track}})
      expect(preview.statusCode).toBe(200)
      expect(preview.json().data.id).toBeLessThan(0)
      expect(db.prepare('SELECT count(*) AS n FROM song').get()?.n).toBe(0)
      const range=await app.inject({url:preview.json().data.audioUrl,headers:{range:'bytes=0-3'}})
      expect(range.statusCode).toBe(206);expect(range.body).toBe('RIFF')
      expect((await app.inject({url:'/api/v1/online/preview/unknown'})).statusCode).toBe(410)
      const added=await app.inject({method:'POST',url:'/api/v1/online/downloads',headers,payload:{sourceId:installed.id,playlistId,items:[{track,quality:'128k'}]}})
      expect(added.statusCode).toBe(200)
      await vi.waitFor(()=>expect(db.prepare('SELECT state FROM online_download WHERE id=1').get()?.state).toBe('completed'),{timeout:5000})
      expect(db.prepare('SELECT visibility,submitted_by FROM song').get()).toMatchObject({visibility:'shared',submitted_by:member.user.id})
      expect(db.prepare('SELECT visibility,review_status FROM lyric').get()).toMatchObject({visibility:'shared',review_status:'approved'})
      expect((await app.inject({url:'/api/v1/songs/1',headers:{authorization:`Bearer ${owner.token}`}})).statusCode).toBe(200)
      expect(db.prepare('SELECT original_text FROM lyric').get()?.original_text).toContain('テスト')
      await app.inject({method:'POST',url:'/api/v1/online/downloads',headers:{authorization:`Bearer ${owner.token}`},payload:{sourceId:installed.id,items:[{track:{...track,songmid:'2'},quality:'128k'}]}})
      await vi.waitFor(()=>expect(db.prepare('SELECT state FROM online_download WHERE id=2').get()?.state).toBe('duplicate'),{timeout:5000})
      expect(db.prepare('SELECT count(*) AS n FROM song').get()?.n).toBe(1)
      expect(db.prepare('SELECT song_id FROM playlist_song WHERE playlist_id=?').all(playlistId)).toEqual([{song_id:1}])
      const second=await app.inject({method:'POST',url:'/api/v1/me/playlists',headers:{authorization:`Bearer ${owner.token}`},payload:{name:'Another',visibility:'public'}})
      const secondId=second.json().data.id
      const duplicate=await app.inject({method:'POST',url:'/api/v1/online/downloads',headers,payload:{sourceId:installed.id,playlistId:secondId,items:[{track,quality:'128k'}]}})
      expect(duplicate.statusCode).toBe(200)
      expect(db.prepare('SELECT song_id FROM playlist_song WHERE playlist_id=?').all(secondId)).toEqual([{song_id:1}])
      const batch=await app.inject({method:'POST',url:'/api/v1/online/downloaded/add-to-playlist',headers,payload:{playlistId:secondId,keys:['kw:1','kw:2']}})
      expect(batch.json().data).toEqual({added:0,existing:1,missing:0})
    }finally{await app.close();net.mockRestore();lyrics.mockRestore();pic.mockRestore();db.close();rmSync(directory,{recursive:true,force:true})}
  })
  it('imports disabled, selects only enabled, pins jobs and isolates users',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'animeuta-online-'))
    const config=loadConfig(directory),db=openDatabase(config.databasePath)
    runMigrations(db)
    for(const id of [1,2])db.prepare("INSERT INTO app_user(id,email,password_hash,password_salt,display_name,role) VALUES (?,?,'hash','salt','Test','user')").run(id,`${id}@example.com`)
    const sources=new OnlineSources(db),media=new MediaService(db,config),songs=new SongService(db,config,media),queue=new OnlineDownloads(db,config,sources,songs,media)
    vi.spyOn(queue,'start').mockImplementation(()=>{})
    try{
      const imported=sources.import('fixture.js',source) as {id:number}
      expect(sources.import('duplicate.js',source)).toEqual(imported)
      expect(()=>sources.select(1,imported.id)).toThrow()
      await sources.enable(imported.id,true)
      sources.select(1,imported.id)
      expect(sources.list(2).selectedId).toBeNull()
      const track={source:'kw',songmid:'1',name:'Test',types:[{type:'128k'}]}
      expect(()=>queue.enqueue(1,imported.id,[{track,quality:'flac'}])).toThrow()
      const jobs=queue.enqueue(1,imported.id,[{track,quality:'128k'}])
      const publicList=Number(db.prepare("INSERT INTO playlist(user_id,name,visibility) VALUES (1,'Shared','shared')").run().lastInsertRowid)
      const privateList=Number(db.prepare("INSERT INTO playlist(user_id,name,visibility) VALUES (2,'Private','private')").run().lastInsertRowid)
      queue.enqueue(2,imported.id,[{track,quality:'128k'}],publicList)
      queue.enqueue(2,imported.id,[{track,quality:'128k'}],privateList)
      expect(db.prepare('SELECT count(*) AS n FROM online_download_playlist').get()?.n).toBe(2)
      expect(()=>queue.enqueue(1,imported.id,[{track,quality:'128k'}],privateList)).toThrow()
      expect(queue.enqueue(1,imported.id,[{track,quality:'128k'}])[0]?.duplicate).toBe(true)
      expect(queue.enqueue(2,imported.id,[{track,quality:'128k'}])[0]?.duplicate).toBe(true)
      expect(queue.list(2)).toHaveLength(0)
      expect(()=>queue.cancel(2,Number(jobs[0]!.id))).toThrow()
      queue.cancel(1,Number(jobs[0]!.id));queue.retry(1,Number(jobs[0]!.id))
      expect(queue.list(1)[0]?.state).toBe('queued')
      const large=Array.from({length:2001},(_,i)=>({track:{...track,songmid:`large-${i}`},quality:'128k'}))
      expect(queue.enqueue(1,imported.id,large)).toHaveLength(2001)
      expect(queue.list(1)).toHaveLength(2002)
      queue.cancel(1,Number(jobs[0]!.id))
      expect(()=>queue.retry(1,Number(jobs[0]!.id))).not.toThrow()
      await sources.enable(imported.id,false)
      expect(()=>queue.enqueue(1,imported.id,[{track,quality:'128k'}])).toThrow()
    }finally{await queue.stop();db.close();rmSync(directory,{recursive:true,force:true})}
  })
  it('protects source management and source code with owner authorization',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'animeuta-online-auth-'))
    const config={...loadConfig(directory),registrationMode:'open' as const},db=openDatabase(config.databasePath)
    runMigrations(db)
    const auth=new AuthService(db,config),app=await buildApp(config,db,auth)
    try{
      const owner=await auth.register({email:'owner@example.com',password:'test-password-123'})
      const user=await auth.register({email:'user@example.com',password:'test-password-123'})
      expect((await app.inject('/api/v1/online/sources')).statusCode).toBe(401)
      expect((await app.inject({method:'POST',url:'/api/v1/online/sources/import',headers:{authorization:`Bearer ${user.token}`},payload:{name:'test',code:source}})).statusCode).toBe(403)
      const result=await app.inject({method:'POST',url:'/api/v1/online/sources/import',headers:{authorization:`Bearer ${owner.token}`},payload:{name:'test',code:source}})
      expect(result.statusCode).toBe(200)
      expect((await app.inject({url:`/api/v1/online/sources/${result.json().data.id}/code`,headers:{authorization:`Bearer ${user.token}`}})).statusCode).toBe(403)
      const list=await app.inject({url:'/api/v1/online/sources',headers:{authorization:`Bearer ${user.token}`}})
      expect(list.body).not.toContain('lx.on')
    }finally{await app.close();db.close();rmSync(directory,{recursive:true,force:true})}
  })
})
