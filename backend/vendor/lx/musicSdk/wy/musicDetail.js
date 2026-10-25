import { httpFetch } from '../../request'
import { weapi } from './utils/crypto'
import { formatPlayTime, sizeFormate } from '../../index'
// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/module/song_detail.js

export default {
  getSinger(singers) {
    let arr = []
    singers?.forEach(singer => {
      arr.push(singer.name)
    })
    return arr.join('、')
  },
  filterList({ songs, privileges }) {
    // console.log(songs, privileges)
    const list = []
    songs.forEach((item, index) => {
      const types = []
      const _types = {}
      let size
      const privilege = privileges?.find(p => String(p.id) === String(item.id)) ?? {}

      if (privilege.maxBrLevel == 'hires') {
        size = item.hr ? sizeFormate(item.hr.size) : null
        types.push({ type: 'flac24bit', size })
        _types.flac24bit = {
          size,
        }
      }
      switch (privilege.maxbr) {
        case 999000:
          size = item.sq ? sizeFormate(item.sq.size) : null
          types.push({ type: 'flac', size })
          _types.flac = {
            size,
          }
        case 320000:
          size = item.h ? sizeFormate(item.h.size) : null
          types.push({ type: '320k', size })
          _types['320k'] = {
            size,
          }
        case 192000:
        case 128000:
          size = item.l ? sizeFormate(item.l.size) : null
          types.push({ type: '128k', size })
          _types['128k'] = {
            size,
          }
      }

      types.reverse()

      if (item.pc) {
        list.push({
          singer: item.pc.ar ?? '',
          name: item.pc.sn ?? '',
          albumName: item.pc.alb ?? '',
          albumId: item.al?.id,
          source: 'wy',
          interval: formatPlayTime(item.dt / 1000),
          songmid: item.id,
          img: item.al?.picUrl ?? '',
          lrc: null,
          otherSource: null,
          types,
          _types,
          typeUrl: {},
        })
      } else {
        list.push({
          singer: this.getSinger(item.ar),
          name: item.name ?? '',
          albumName: item.al?.name,
          albumId: item.al?.id,
          source: 'wy',
          interval: formatPlayTime(item.dt / 1000),
          songmid: item.id,
          img: item.al?.picUrl,
          lrc: null,
          otherSource: null,
          types,
          _types,
          typeUrl: {},
        })
      }
    })
    // console.log(list)
    return list
  },
  async getList(ids = [], retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'))

    const requestObj = httpFetch('https://music.163.com/weapi/v3/song/detail', {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
        origin: 'https://music.163.com',
      },
      form: weapi({
        c: '[' + ids.map(id => ('{"id":' + id + '}')).join(',') + ']',
        ids: '[' + ids.join(',') + ']',
      }),
    })
    const { body, statusCode } = await requestObj.promise
    if (statusCode != 200 || body.code !== 200) throw new Error('获取歌曲详情失败')
    // console.log(body)
    const songs = new Map((body.songs ?? []).map(song => [String(song.id), song]))
    const missing = ids.filter(id => !songs.has(String(id)))
    // Some overseas responses include all privileges but omit song metadata.
    // Recover only the missing IDs, without changing quality permissions.
    for (let offset = 0; offset < missing.length; offset += 100) {
      const batch = missing.slice(offset, offset + 100)
      const fallback = await httpFetch(`https://music.163.com/api/song/detail?${new URLSearchParams({ids:JSON.stringify(batch)})}`).promise
      if (fallback.statusCode !== 200 || fallback.body?.code !== 200 || !Array.isArray(fallback.body.songs)) throw new Error('补齐歌曲详情失败，请重试')
      const expected = new Set(batch.map(String))
      for (const song of fallback.body.songs) {
        if (!expected.has(String(song.id))) continue
        songs.set(String(song.id), {...song, ar:song.ar ?? song.artists, al:song.al ?? song.album, dt:song.dt ?? song.duration, h:song.h ?? song.hMusic, l:song.l ?? song.lMusic, sq:song.sq ?? song.sqMusic, hr:song.hr ?? song.hrMusic})
      }
    }
    return { source: 'wy', list: this.filterList({songs:ids.flatMap(id => songs.has(String(id)) ? [songs.get(String(id))] : []),privileges:body.privileges ?? []}) }
  },
}
// Modified by AnimeUta: recover omitted metadata by ID and retain tracks without privileges.
