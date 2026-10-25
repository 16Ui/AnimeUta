import kwMusic from './musicSdk/kw/musicSearch'
import kwList from './musicSdk/kw/songList'
import kgMusic from './musicSdk/kg/musicSearch'
import kgList from './musicSdk/kg/songList'
import txMusic from './musicSdk/tx/musicSearch'
import txList from './musicSdk/tx/songList'
import wyMusic from './musicSdk/wy/musicSearch'
import wyList from './musicSdk/wy/songList'
import mgMusic from './musicSdk/mg/musicSearch'
import mgList from './musicSdk/mg/songList'
import kwLyric from './musicSdk/kw/lyric'
import kwPic from './musicSdk/kw/pic'
import wyLyric from './musicSdk/wy/lyric'
import txLyric from './musicSdk/tx/lyric'
import mgLyric from './musicSdk/mg/lyric'
export { setRequest } from './request.js'
const providers = {kw:{music:kwMusic,list:kwList},kg:{music:kgMusic,list:kgList},tx:{music:txMusic,list:txList},wy:{music:wyMusic,list:wyList},mg:{music:mgMusic,list:mgList}}
export async function search(source, kind, text, page) {
  const adapter = Object.create(providers[source][kind === 'playlists' ? 'list' : 'music'])
  return adapter.search(text, page, 30)
}
export async function playlist(source, id, page) {
  if(source === 'tx') {
    const adapter = Object.create(providers.tx.list)
    return adapter.getListDetail2(await adapter.getListId(id), 0, page)
  }
  return Object.create(providers[source].list).getListDetail(id, page)
}
export async function lyric(track) {
  const result=track.source==='wy'?wyLyric(track.songmid):track.source==='kw'?kwLyric.getLyric(track,false):({tx:txLyric,mg:mgLyric})[track.source]?.getLyric(track)
  return result?.promise ? await result.promise : await result
}
export async function picture(track) { return track.img || (track.source==='kw'?await kwPic.getPic(track):null) }
