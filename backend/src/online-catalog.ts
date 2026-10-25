import { createRequire } from 'node:module'
import { AsyncLocalStorage } from 'node:async_hooks'
import { publicRequest } from './online-network.js'
import { assertApp } from './errors.js'
const vendor = createRequire(import.meta.url)('../vendor/lx/catalog.cjs')
const scope = new AsyncLocalStorage<{count:number;signal:AbortSignal}>()
vendor.setRequest((url:string,options:any)=>{
  const budget=scope.getStore()
  if(!budget || ++budget.count>24) throw new Error('平台请求次数超限')
  return publicRequest(url,{...options,signal:AbortSignal.any([budget.signal,...(options.signal?[options.signal]:[])])})
})
const bounded=<T>(fn:()=>Promise<T>,signal?:AbortSignal)=>scope.run({count:0,signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])])},fn)
export const platforms = ['kw', 'kg', 'tx', 'wy', 'mg']

export async function searchOnline(source: string, kind: string, keyword: string, page: number) {
  assertApp(source === 'all' || platforms.includes(source), 400, 'invalid_platform', '不支持的平台')
  assertApp(['songs','playlists'].includes(kind) && keyword.trim().length > 0 && keyword.length <= 120 && Number.isInteger(page) && page > 0 && page <= 100, 400, 'invalid_search', '搜索参数不正确')
  const results = []
  // Sequential platform requests bound resource usage on small cloud instances.
  for (const platform of source === 'all' ? platforms : [source]) {
    try {
      const result = await bounded(()=>vendor.search(platform, kind, keyword, page)) as any
      results.push({source:platform, ...result, list:(result.list ?? []).map((item: any)=>({...item,source:platform}))})
    } catch { results.push({source:platform,list:[],error:'该平台搜索暂不可用'}) }
  }
  return results
}

export async function onlinePlaylist(source: string, id: string, page: number) {
  assertApp(platforms.includes(source) && id.length > 0 && id.length <= 500 && Number.isSafeInteger(page) && page > 0, 400, 'invalid_playlist', '歌单参数不正确')
  const result = await bounded(()=>vendor.playlist(source, id, page)) as any
  return {...result, total:Number(result.total), limit:Math.max(1,Number(result.limit)), list:(result.list ?? []).map((item: any)=>({...item,source}))}
}

export const catalogueLyrics=(track:any,signal:AbortSignal):Promise<any>=>bounded(()=>vendor.lyric(track),signal)
export const cataloguePicture=(track:any,signal:AbortSignal):Promise<any>=>bounded(()=>vendor.picture(track),signal)
