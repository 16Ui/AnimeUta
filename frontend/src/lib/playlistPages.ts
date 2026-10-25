import { trackKey, type OnlineTrack } from './onlineMusic'

export async function collectPlaylist(fetchPage:(page:number)=>Promise<{list:OnlineTrack[];total:number;limit:number}>, progress?:(count:number,total:number)=>void) {
  const tracks:OnlineTrack[]=[],seen=new Set<string>()
  let expected=0,received=0
  for(let page=1;;page++) {
    const data=await fetchPage(page)
    if(!Array.isArray(data.list)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.limit)||data.limit<=0) throw new Error('平台返回的歌单分页信息不完整，请重试')
    expected=Math.max(expected,data.total)
    let fresh=0
    for(const track of data.list) {
      const key=trackKey(track)
      if(!seen.has(key)){seen.add(key);tracks.push(track);fresh++}
    }
    received+=data.list.length
    progress?.(tracks.length,expected)
    // Page position, not filtered result length, determines the end of a playlist.
    if(page*data.limit>=expected) return {tracks,total:expected,missing:Math.max(0,expected-received),duplicates:received-tracks.length}
    if(data.list.length>0&&!fresh) throw new Error(`平台重复返回同一页，已读取 ${tracks.length} / ${expected} 首，未按整单提交，请重试`)
  }
}

export async function submitTrackBatches<T,R>(items:T[],submit:(batch:T[])=>Promise<R[]>,progress?:(count:number)=>void) {
  const results:R[]=[]
  for(let offset=0;offset<items.length;offset+=100) {
    try {results.push(...await submit(items.slice(offset,offset+100)))}
    catch(error){throw new Error(`已提交 ${offset} / ${items.length} 首，剩余未提交。可重试，已入队歌曲不会重复下载。${error instanceof Error?error.message:''}`)}
    progress?.(Math.min(offset+100,items.length))
  }
  return results
}
