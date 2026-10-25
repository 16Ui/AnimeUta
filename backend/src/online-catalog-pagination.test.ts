import { it, expect, vi } from 'vitest'
import { onlinePlaylist } from './online-catalog.js'
import * as network from './online-network.js'
it('requests QQ playlist page offsets rather than passing page as retry count',async()=>{
  const request=vi.spyOn(network,'publicRequest').mockResolvedValue({statusCode:200,headers:{},body:Buffer.from(JSON.stringify({code:0,req_1:{code:0,data:{songlist:[],total_song_num:12000,dirinfo:{title:'Test',desc:'',listennum:0}}}}))})
  try {
    const result=await onlinePlaylist('tx','12345',101)
    expect(result.total).toBe(12000)
    expect(result.limit).toBe(100)
    const options=request.mock.calls[0]?.[1]
    expect(JSON.parse(String(options?.body)).req_1.param).toMatchObject({song_begin:10000,song_num:100})
  } finally {request.mockRestore()}
})
