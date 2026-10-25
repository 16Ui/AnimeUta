import {it,expect} from 'vitest'
import {mkdtempSync,rmSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {loadConfig} from './config.js'
import {openDatabase,runMigrations} from './db.js'
import {AuthService} from './auth.js'
import {buildApp} from './app.js'

it('edits playlist name and cover atomically, protects ownership, and restores automatic cover',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'playlist-edit-')),config={...loadConfig(dir),registrationMode:'open' as const}
  const db=openDatabase(config.databasePath);runMigrations(db)
  const auth=new AuthService(db,config),app=await buildApp(config,db,auth)
  try {
    const owner=await auth.register({email:'owner@example.com',password:'test-password-123'})
    const other=await auth.register({email:'other@example.com',password:'test-password-123'})
    const headers={authorization:`Bearer ${owner.token}`}
    const created=await app.inject({method:'POST',url:'/api/v1/me/playlists',headers,payload:{name:'Before',visibility:'public'}})
    const id=created.json().data.id,url=`/api/v1/playlists/${id}/edit`
    const edit=async(token:string,name:string,bytes?:Buffer,remove=false)=>{
      const form=new FormData();form.append('name',name);form.append('remove_cover',String(remove))
      if(bytes)form.append('cover',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'cover.png')
      const req=new Request('http://localhost',{method:'POST',body:form})
      return app.inject({method:'POST',url,headers:{authorization:`Bearer ${token}`,'content-type':req.headers.get('content-type')!},payload:Buffer.from(await req.arrayBuffer())})
    }
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP8sAAAAASUVORK5CYII=','base64')
    expect((await edit(other.token,'Forbidden',png)).statusCode).toBe(403)
    const updated=await edit(owner.token,'After',png)
    expect(updated.statusCode).toBe(200);expect(updated.json().data.name).toBe('After')
    const image=updated.json().data.coverUrl
    expect((await app.inject(image)).statusCode).toBe(200)
    const count=readdirSync(join(config.mediaRoot,'images')).length
    expect((await edit(owner.token,'Invalid',Buffer.from('not an image'))).statusCode).toBe(400)
    expect((await edit(owner.token,' ',png)).statusCode).toBe(400)
    expect(readdirSync(join(config.mediaRoot,'images')).length).toBe(count)
    expect(db.prepare('SELECT name FROM playlist WHERE id=?').get(id)?.name).toBe('After')
    expect((await edit(owner.token,'Renamed',undefined,true)).statusCode).toBe(200)
    expect(db.prepare('SELECT cover_url FROM playlist WHERE id=?').get(id)?.cover_url).toBeNull()
  }finally{await app.close();db.close();rmSync(dir,{recursive:true,force:true})}
})
