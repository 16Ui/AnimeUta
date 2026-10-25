import { describe, it, expect } from 'vitest'
import { collectPlaylist, submitTrackBatches } from '../../frontend/src/lib/playlistPages'
const track=(id:number)=>({source:'kw',songmid:id,name:String(id)})
describe('complete playlist downloads',()=>{
  it('reads beyond 2000 songs and 100 pages',async()=>{
    const result=await collectPlaylist(async page=>({total:2101,limit:20,list:Array.from({length:Math.min(20,2101-(page-1)*20)},(_,i)=>track((page-1)*20+i))}))
    expect(result.tracks).toHaveLength(2101)
    expect(result.missing).toBe(0)
  })
  it('continues after short and empty pages, reports unavailable tracks',async()=>{
    const result=await collectPlaylist(async page=>({total:6,limit:2,list:page===1?[track(1)]:page===2?[]:[track(5),track(6)]}))
    expect(result.tracks.map(t=>t.songmid)).toEqual([1,5,6])
    expect(result.missing).toBe(3)
  })
  it('refuses repeated pages instead of silently downloading a partial playlist',async()=>{
    await expect(collectPlaylist(async()=>({total:10,limit:2,list:[track(1),track(2)]}))).rejects.toThrow('重复返回')
  })
  it('submits every item in bounded requests',async()=>{
    const sizes:number[]=[]
    const result=await submitTrackBatches(Array.from({length:2101},(_,i)=>i),async batch=>{sizes.push(batch.length);return batch})
    expect(result).toHaveLength(2101)
    expect(Math.max(...sizes)).toBe(100)
    expect(sizes.at(-1)).toBe(1)
  })
  it('reports how far a partial submission got',async()=>{
    await expect(submitTrackBatches(Array.from({length:201},(_,i)=>i),async batch=>{if(batch[0]===100)throw new Error('offline');return batch})).rejects.toThrow('已提交 100 / 201')
  })
})
