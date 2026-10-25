import { afterEach, expect, it, vi } from 'vitest'
import * as network from './online-network.js'
import { searchOnlineUsers, onlineUserPlaylists } from './online-users.js'
afterEach(()=>vi.restoreAllMocks())
function mock(body:unknown) { return vi.spyOn(network,'publicRequest').mockResolvedValue({statusCode:200,headers:{},body:Buffer.from(JSON.stringify(body))}) }
it('searches nicknames and keeps user IDs with paginated results',async()=>{
  const req=mock({code:200,result:{userprofileCount:31,userprofiles:[{userId:123,nickname:'Miku',avatarUrl:'http://example.com/a.jpg'}]}})
  const result=await searchOnlineUsers('wy',' Miku ',2)
  expect(result[0]).toMatchObject({total:31,limit:30,list:[{id:'123',name:'Miku',img:'https://example.com/a.jpg',source:'wy'}]})
  expect(new URL(String(req.mock.calls[0][0])).searchParams.get('offset')).toBe('30')
})
it('distinguishes created and collected playlists and preserves upstream pagination',async()=>{
  mock({code:200,more:true,playlist:[{id:1,name:'Owned',trackCount:113,creator:{userId:123}},{id:2,name:'Saved',trackCount:1,creator:{userId:456}}]})
  const result=await onlineUserPlaylists('wy','123',1)
  expect(result.hasMore).toBe(true)
  expect(result.list).toMatchObject([{id:'1',owned:true,total:113},{id:'2',owned:false}])
})
it('rejects unsupported platforms, invalid user IDs, pages and empty queries before networking',async()=>{
  const req=mock({code:200})
  await expect(searchOnlineUsers('tx','Miku',1)).rejects.toThrow()
  await expect(searchOnlineUsers('wy',' ',1)).rejects.toThrow()
  await expect(onlineUserPlaylists('wy','https://example.com',1)).rejects.toThrow()
  await expect(onlineUserPlaylists('wy','1',0)).rejects.toThrow()
  expect(req).not.toHaveBeenCalled()
})
it('does not mistake an upstream failure for an empty user library',async()=>{
  mock({code:403})
  await expect(onlineUserPlaylists('wy','1',1)).rejects.toThrow('用户歌单暂不可用')
})
