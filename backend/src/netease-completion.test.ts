import { it, expect, vi } from 'vitest'
import { onlinePlaylist } from './online-catalog.js'
import * as network from './online-network.js'
const song=(id:number)=>({id,name:`Song ${id}`,ar:[],al:{name:'Album'},dt:1000,l:{size:2000}})
it('recovers omitted metadata by ID and keeps playlist order and real qualities',async()=>{
  const request=vi.spyOn(network,'publicRequest').mockImplementation(async url=>{
    const data=String(url).includes('/api/linux/forward')?{code:200,playlist:{trackIds:[{id:1},{id:2},{id:3}],tracks:[],creator:{nickname:'Test'}},privileges:[]}
      :String(url).includes('/weapi/')?{code:200,songs:[song(2)],privileges:[{id:3,maxbr:320000},{id:1,maxbr:128000},{id:2,maxbr:128000}]}
      :{code:200,songs:[{id:3,name:'Three',artists:[{name:'Artist'}],album:{name:'Legacy',picUrl:'https://example.com/cover.jpg'},duration:9000,lMusic:{size:1000}},song(1),song(999)]}
    return {statusCode:200,headers:{},body:Buffer.from(JSON.stringify(data))}
  })
  try {
    const result=await onlinePlaylist('wy','123',1)
    expect(result.list.map((s:any)=>s.songmid)).toEqual([1,2,3])
    expect(result.list[2]).toMatchObject({name:'Three',singer:'Artist',albumName:'Legacy'})
    expect(result.list[0].types.map((t:any)=>t.type)).toEqual(['128k'])
    expect(result.list[2].types.map((t:any)=>t.type)).toEqual(['128k','320k'])
    expect(String(request.mock.calls[2]?.[0])).toContain('ids=%5B1%2C3%5D')
  }finally{request.mockRestore()}
})
it('keeps tracks with missing privilege metadata without inventing qualities',async()=>{
  const request=vi.spyOn(network,'publicRequest').mockImplementation(async url=>({statusCode:200,headers:{},body:Buffer.from(JSON.stringify(String(url).includes('/api/linux/forward')?{code:200,playlist:{trackIds:[{id:1}],tracks:[],creator:{nickname:'Test'}},privileges:[]}:{code:200,songs:[song(1)],privileges:[]}))}))
  try{const result=await onlinePlaylist('wy','123',1);expect(result.list).toHaveLength(1);expect(result.list[0].types).toEqual([]);expect(request).toHaveBeenCalledTimes(2)}finally{request.mockRestore()}
})
