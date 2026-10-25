import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const root=resolve(process.argv[2]||'.')
const {publicRequest}=await import(pathToFileURL(resolve(root,'backend/dist/online-network.js')))
const vendor=createRequire(import.meta.url)(resolve(root,'backend/vendor/lx/catalog.cjs'))
let trackIds=[]
vendor.setRequest(async(url,options)=>{
  const response=await publicRequest(url,options)
  const data=JSON.parse(response.body.toString())
  if(data.playlist?.trackIds)trackIds=data.playlist.trackIds.map(t=>t.id)
  console.log(JSON.stringify({url,trackCount:data.playlist?.trackCount,ids:data.playlist?.trackIds?.length,tracks:data.playlist?.tracks?.length,songs:data.songs?.length,privileges:data.privileges?.length}))
  return response
})
const result=await vendor.playlist('wy',process.argv[3],1)
console.log(JSON.stringify({total:result.total,returned:result.list.length,ids:result.list.map(t=>t.songmid)}))
const found=new Set(result.list.map(t=>t.songmid))
const missing=trackIds.filter(id=>!found.has(id))
if(missing.length){
  const url='https://music.163.com/api/song/detail?'+new URLSearchParams({ids:JSON.stringify(missing)})
  const response=await publicRequest(url)
  const data=JSON.parse(response.body.toString())
  console.log(JSON.stringify({fallbackCode:data.code,missing:missing.length,recovered:data.songs?.length,names:data.songs?.map(s=>s.name),sample:data.songs?.[0]}))
}
