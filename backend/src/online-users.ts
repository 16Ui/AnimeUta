import { publicRequest } from './online-network.js'
import { assertApp } from './errors.js'

const limit = 30
const image = (url:unknown) => typeof url==='string' && /^https?:\/\//.test(url)?url.replace(/^http:/,'https:'):''
async function request(path: string, params: Record<string,string>) {
  const response = await publicRequest(`https://music.163.com/api/${path}?${new URLSearchParams(params)}`, {signal:AbortSignal.timeout(20000)})
  const body = JSON.parse(response.body.toString())
  assertApp(response.statusCode === 200 && body.code === 200, 502, 'user_catalog_unavailable', '用户歌单暂不可用，请稍后重试')
  return body
}
function validate(source:string,page:number) {
  assertApp(source === 'wy',400,'unsupported_user_platform','当前仅支持搜索网易云用户')
  assertApp(Number.isSafeInteger(page)&&page>0&&page<=10000,400,'invalid_page','页码不正确')
}
export async function searchOnlineUsers(source:string,keyword:string,page:number) {
  validate(source,page)
  assertApp(keyword.trim().length>0&&keyword.length<=120,400,'invalid_search','请输入用户昵称')
  const body=await request('search/get',{s:keyword.trim(),type:'1002',limit:String(limit),offset:String((page-1)*limit)})
  const result=body.result??{}
  return [{source,limit,total:Number(result.userprofileCount??0),list:(result.userprofiles??[]).map((u:any)=>({id:String(u.userId),name:u.nickname,img:image(u.avatarUrl),signature:u.signature??'',source}))}]
}
export async function onlineUserPlaylists(source:string,id:string,page:number) {
  validate(source,page)
  assertApp(/^\d{1,20}$/.test(id),400,'invalid_user','用户 ID 不正确')
  const body=await request('user/playlist',{uid:id,limit:String(limit),offset:String((page-1)*limit)})
  const list=(body.playlist??[]).map((p:any)=>({id:String(p.id),name:p.name,img:image(p.coverImgUrl),total:p.trackCount,source,owned:String(p.creator?.userId)===id,creator:p.creator?.nickname??''}))
  return {list,limit,hasMore:body.more===true}
}
