import { FormEvent, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, ListMusic, Music2, Play, RefreshCw, Search, Settings2, Upload, X } from 'lucide-react'
import { http } from '../api/http'
import { getApiErrorMessage } from '../api/error'
import { useAuthStore } from '../store/useAuthStore'
import { usePlayerStore, type PlayerSong } from '../store/usePlayerStore'
import { Dialog } from '../components/ui/Dialog'
import { listPlaylists } from '../api/playlists'
import { CreatePlaylistInline } from '../components/music/CreatePlaylistInline'
import { batchQualities, qualityNames, supportedQualities, trackKey as keyOf, type OnlineTrack as Track, type OnlineSource as Source } from '../lib/onlineMusic'
import './online-music.css'
import { collectPlaylist, submitTrackBatches } from '../lib/playlistPages'

const platformNames:Record<string,string>={all:'聚合',kw:'酷我',kg:'酷狗',tx:'QQ 音乐',wy:'网易云',mg:'咪咕'}
const words = {
  zh:{title:'在线曲库',sources:'音源设置',songs:'歌曲',playlists:'歌单',jobs:'下载任务',search:'搜索歌曲或歌单',latest:'拉取最新音源目录',import:'导入脚本',enable:'检测并启用',disable:'停用',choose:'选择音源',empty:'暂无内容',download:'下载所选',whole:'下载整单',all:'全选当前页',upload:'保存到云端',unknown:'暂无支持的音质',retry:'重试',cancel:'取消',back:'返回搜索',loading:'正在处理…',review:'查看脚本',installed:'已导入',copyright:'仅下载你有权保存和使用的内容',confirm:'启用后，此音源可以向公网请求音频地址。确认信任此脚本并启用？',more:'整单超过 200 首，请分页选择下载',queued:'等待下载',resolving:'解析地址',downloading:'下载中',importing:'正在入库',completed:'已入库',duplicate:'已存在',cancelled:'已取消',failed:'失败',ready:'未启用',enabled:'已启用',selected:'已选择',library:'打开歌曲'},
  en:{title:'Online library',sources:'Music sources',songs:'Songs',playlists:'Playlists',jobs:'Downloads',search:'Search songs or playlists',latest:'Refresh source catalogue',import:'Import script',enable:'Check and enable',disable:'Disable',choose:'Select source',empty:'No items',download:'Download selected',whole:'Download playlist',all:'Select page',upload:'Save to cloud',unknown:'No supported quality',retry:'Retry',cancel:'Cancel',back:'Back to search',loading:'Working…',review:'View script',installed:'Imported',copyright:'Only download content you are entitled to save and use',confirm:'This source can request audio URLs from public servers. Trust and enable this script?',more:'More than 200 tracks. Select tracks by page.',queued:'Queued',resolving:'Resolving',downloading:'Downloading',importing:'Importing',completed:'Imported',duplicate:'Already exists',cancelled:'Cancelled',failed:'Failed',ready:'Disabled',enabled:'Enabled',selected:'Selected',library:'Open song'},
  ja:{title:'オンライン曲庫',sources:'音源設定',songs:'曲',playlists:'プレイリスト',jobs:'ダウンロード',search:'曲・プレイリストを検索',latest:'最新の音源一覧を取得',import:'スクリプトを読み込む',enable:'確認して有効化',disable:'無効化',choose:'音源を選択',empty:'項目がありません',download:'選択した曲を保存',whole:'全曲を保存',all:'ページ内を全選択',upload:'クラウドに保存',unknown:'対応音質なし',retry:'再試行',cancel:'キャンセル',back:'検索に戻る',loading:'処理中…',review:'スクリプトを表示',installed:'読み込み済み',copyright:'保存・利用する権利のあるコンテンツのみダウンロードしてください',confirm:'この音源は公開サーバーへ通信します。スクリプトを信頼して有効にしますか？',more:'200曲を超えています。ページごとに選択してください。',queued:'待機中',resolving:'解析中',downloading:'ダウンロード中',importing:'登録中',completed:'登録済み',duplicate:'登録済みの曲',cancelled:'キャンセル済み',failed:'失敗',ready:'無効',enabled:'有効',selected:'選択済み',library:'曲を開く'},
}
async function api<T=any>(path:string,data?:unknown):Promise<T>{const result=data===undefined?await http.get(`/api/v1/online/${path}`,{timeout:180000}):await http.post(`/api/v1/online/${path}`,data,{timeout:60000});return result.data.data}

export default function OnlineMusicPage({settings=false}:{settings?:boolean}) {
  const {i18n}=useTranslation(),language=i18n.resolvedLanguage?.slice(0,2)
  const w=words[language==='en'?'en':language==='ja'?'ja':'zh']
  const currentUser=useAuthStore(s=>s.currentUser),owner=currentUser?.role==='owner',cache=useQueryClient()
  const token=useAuthStore(s=>s.token)
  const playlistsQuery=useQuery({queryKey:['playlists',token],queryFn:()=>listPlaylists(token!),enabled:!!token&&!settings})
  const [targetPlaylist,setTargetPlaylist]=useState('')
  const [addSelection,setAddSelection]=useState<{keys?:string[];ids?:number[]}|null>(null)
  const [selectedJobs,setSelectedJobs]=useState<Set<number>>(new Set())
  const [tab,setTab]=useState<'songs'|'playlists'|'users'|'jobs'>('songs'),[platform,setPlatform]=useState('all'),[query,setQuery]=useState(''),[page,setPage]=useState(1)
  const [onlineUser,setOnlineUser]=useState<{id:string;source:string;name:string}|null>(null)
  const [userPage,setUserPage]=useState(1)
  const [results,setResults]=useState<any[]>([]),[playlist,setPlaylist]=useState<{id:string;source:string;name:string}|null>(null),[tracks,setTracks]=useState<Track[]>([]),[hasMore,setHasMore]=useState(false)
  const [selected,setSelected]=useState<Set<string>>(new Set()),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [catalog,setCatalog]=useState<{commit:string;date:string;batch:string;warning?:string;files:{path:string;size:number}[]}|null>(null),[script,setScript]=useState<string|null>(null)
  const [download,setDownload]=useState<{source:Source;tracks:Track[]}|null>(null),[downloadQuality,setDownloadQuality]=useState(''),[skipUnsupported,setSkipUnsupported]=useState(false)
  const text=(zh:string,en:string,ja:string)=>language==='en'?en:language==='ja'?ja:zh
  const sourceQuery=useQuery({queryKey:['online-sources',currentUser?.id],queryFn:()=>api<{selectedId:number|null;items:Source[]}>('sources')})
  const jobQuery=useQuery({queryKey:['online-downloads',currentUser?.id],queryFn:()=>api<any[]>('downloads'),enabled:!settings&&tab==='jobs',refetchInterval:2500})
  const active=sourceQuery.data?.items.find(s=>s.id===sourceQuery.data.selectedId&&s.enabled)
  const supported=(track:Track)=>supportedQualities(active,track)
  const options=download?batchQualities(download.source,download.tracks):[]
  const eligible=download?.tracks.filter(track=>supportedQualities(download.source,track).includes(downloadQuality))??[]
  const missing=(download?.tracks.length??0)-eligible.length
  const action=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await fn()}catch(e){setError(getApiErrorMessage(e,String(e)))}finally{setBusy(false)}}
  const reload=async()=>{await cache.invalidateQueries({queryKey:['online-sources']});await cache.invalidateQueries({queryKey:['online-downloads']})}
  const search=async(p=1)=>{
    const data=await api<any[]>(`search?${new URLSearchParams({source:tab==='users'?'wy':platform,kind:tab==='users'?'users':tab==='playlists'?'playlists':'songs',q:query,page:String(p)})}`)
    setResults(data);setTracks(data.flatMap(r=>r.list));setPage(p);setPlaylist(null);setOnlineUser(null);setSelected(new Set());setHasMore(data.some(r=>Number(r.total)>p*Number(r.limit||30)))
  }
  const openUser=async(item:{id:string;source:string;name:string},p=1)=>{
    const data=await api(`user-playlists?${new URLSearchParams({source:item.source,id:String(item.id),page:String(p)})}`)
    setOnlineUser(item);setUserPage(p);setPlaylist(null);setResults([]);setTracks(data.list);setPage(p);setSelected(new Set());setHasMore(data.hasMore)
  }
  const openPlaylist=async(item:{id:string;source:string;name:string},p=1)=>{
    const data=await api(`playlist?${new URLSearchParams({source:item.source,id:String(item.id),page:String(p)})}`)
    setPlaylist(item);setTracks(data.list||[]);setPage(p);setSelected(new Set());setHasMore(Number(data.total)>p*Number(data.limit||data.list?.length||30))
  }
  const prepareDownload=(items:Track[])=>{
    if(!active)throw new Error(w.choose)
    const unique=[...new Map(items.map(track=>[keyOf(track),track])).values()]
    const options=batchQualities(active,unique)
    if(!options.length)throw new Error(w.unknown)
    setDownload({source:active,tracks:unique});setTargetPlaylist('');setDownloadQuality((options.find(item=>item.count===unique.length)??options[0]).quality);setSkipUnsupported(false)
  }
  const enqueue=async()=>{
    if(!download||!eligible.length||(missing&&!skipUnsupported))return
    const result=await submitTrackBatches(eligible.map(track=>({track,quality:downloadQuality})),items=>api<any[]>('downloads',{sourceId:download.source.id,...(targetPlaylist?{playlistId:Number(targetPlaylist)}:{}),items}),count=>setNotice(`正在提交 ${count} / ${eligible.length} 首`))
    const duplicates=result.filter((job:any)=>job.duplicate).length
    setDownload(null);setSelected(new Set());setNotice(`${w.jobs}: ${result.length-duplicates} · ${w.duplicate}: ${duplicates}`);setTab('jobs');await reload()
  }
  const preview=async(track:Track)=>{
    if(!active)throw new Error(w.choose)
    const song=await api<PlayerSong>('preview',{sourceId:active.id,track})
    usePlayerStore.getState().playNow(song,{type:'custom',name:w.title})
  }
  const whole=async(addOnly=false)=>{
    if(!playlist)return
    const result=await collectPlaylist(p=>api(`playlist?${new URLSearchParams({source:playlist.source,id:playlist.id,page:String(p)})}`),(count,total)=>setNotice(`正在读取歌单 ${count} / ${total} 首`))
    setNotice(`歌单标注 ${result.total} 首 · 可读取 ${result.tracks.length} 首 · 重复 ${result.duplicates} 首 · 平台未返回 ${result.missing} 首`)
    if(addOnly){setTargetPlaylist('');setAddSelection({keys:result.tracks.map(keyOf)})}else prepareDownload(result.tracks)
  }
  const addToPlaylist=async()=>{
    if(!targetPlaylist||!addSelection)return
    const result=addSelection.keys
      ?await api('downloaded/add-to-playlist',{playlistId:Number(targetPlaylist),keys:addSelection.keys})
      :(await http.post(`/api/v1/playlists/${targetPlaylist}/songs/batch`,{song_ids:addSelection.ids})).data.data
    setNotice(`已加入 ${result.added} 首，已在歌单中 ${result.existing} 首${result.missing?`，未下载跳过 ${result.missing} 首`:''}`)
    setAddSelection(null);setSelectedJobs(new Set());await cache.invalidateQueries({queryKey:['playlists']});await cache.invalidateQueries({queryKey:['playlist-detail']})
  }
  const playlistSelect=<label>{text('加入歌单','Add to playlist','プレイリストに追加')}<select aria-label="目标歌单" value={targetPlaylist} disabled={busy} onChange={e=>setTargetPlaylist(e.target.value)}><option value="">{addSelection?'请选择歌单':'不加入歌单'}</option>{playlistsQuery.data?.map(p=><option key={p.id} value={p.id}>{p.name} · {p.visibility==='public'?'公共':'私人'}</option>)}</select>{playlistsQuery.isError&&<span role="alert">歌单加载失败，请重试</span>}<Link to="/playlists">管理歌单</Link></label>
  const submit=(event:FormEvent)=>{event.preventDefault();void action(()=>search())}
  return <div className="online-page">
    <header className="online-heading"><div><h1>{settings?w.sources:w.title}</h1><p>{language==='en'?'Cloud public library':language==='ja'?'クラウド共有曲庫':'云端公共曲库'}</p></div><Link className="online-icon" title={settings?w.title:w.sources} to={settings?'/online':'/account/sources'}>{settings?<Music2 size={21}/>:<Settings2 size={21}/>}</Link></header>
    {(error||sourceQuery.error)&&<p className="online-error" role="alert">{error||getApiErrorMessage(sourceQuery.error,'加载失败')}</p>}
    {notice&&<p role="status" className="online-notice">{notice}</p>}
    {busy&&<p role="status" className="online-notice">{w.loading}</p>}
    {settings?<>
      <div className="online-toolbar">
        {owner&&<><button disabled={busy} onClick={()=>void action(async()=>setCatalog(await api('catalog')))}><RefreshCw size={17}/>{w.latest}</button>
          <label className="online-upload"><Upload size={17}/>{w.import}<input type="file" accept=".js" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void action(async()=>{if(file.size>2*1024*1024)throw new Error('最大 2 MB');await api('sources/import',{name:file.name,code:await file.text()});await reload()})}}/></label></>}
      </div>
      <section className="online-source-list">{sourceQuery.data?.items.map(source=><article key={source.id} className="online-source-row"><div><strong>{source.name}</strong><small>{source.enabled?w.enabled:w.ready} · SHA256 {source.checksum.slice(0,12)}</small><small>{Object.entries(source.capabilities).map(([s,c])=>`${platformNames[s]}: ${c.qualitys.map(q=>qualityNames[q]||q).join(', ')}`).join(' / ')}</small></div><div className="online-actions">
        {owner&&<><button disabled={busy} onClick={()=>void action(async()=>{const r=await http.get(`/api/v1/online/sources/${source.id}/code`,{responseType:'text'});setScript(r.data)})}>{w.review}</button><button disabled={busy} onClick={()=>{if(!source.enabled&&!window.confirm(w.confirm))return;void action(async()=>{await api(`sources/${source.id}/enabled`,{enabled:!source.enabled});await reload()})}}>{source.enabled?w.disable:w.enable}</button></>}
        <button disabled={busy||!source.enabled||active?.id===source.id} onClick={()=>void action(async()=>{await api('sources/select',{id:source.id});setSelected(new Set());await reload()})}>{active?.id===source.id?w.selected:w.choose}</button>
      </div></article>)}{!sourceQuery.data?.items.length&&<p className="online-empty">{w.empty}</p>}</section>
      {catalog&&<section><h2>{catalog.batch} · {catalog.date.slice(0,10)}</h2>{catalog.files.map(file=><article key={file.path} className="online-source-row"><div><strong>{file.path.split('/').pop()}</strong><small>{file.path} · {Math.ceil(file.size/1024)} KB</small></div><button disabled={busy} onClick={()=>void action(async()=>{await api('sources/install',{path:file.path,commit:catalog.commit});setNotice(w.installed);await reload()})}><Download size={17}/>{w.import}</button></article>)}</section>}
      {catalog?.warning&&<p role="status" className="online-error">{catalog.warning}</p>}
      <Dialog open={script!==null} onClose={()=>setScript(null)} title={w.review}><pre className="online-script">{script}</pre></Dialog>
    </>:<>
      <nav className="online-tabs">{(['songs','playlists','users','jobs'] as const).map(t=><button key={t} disabled={busy} aria-current={tab===t?'page':undefined} onClick={()=>{setTab(t);setTracks([]);setResults([]);setPlaylist(null);setOnlineUser(null);setPage(1);setSelected(new Set());setHasMore(false)}}>{t==='users'?text('用户','Users','ユーザー'):w[t]}</button>)}</nav>
      {tab==='jobs'&&<div className="online-toolbar"><label><input type="checkbox" checked={!!jobQuery.data?.some(j=>j.song_id)&&jobQuery.data.filter(j=>j.song_id).every(j=>selectedJobs.has(j.song_id))} onChange={e=>setSelectedJobs(new Set(e.target.checked?jobQuery.data?.filter(j=>j.song_id).map(j=>Number(j.song_id)):[]))}/>全选已入库</label><button disabled={busy||!selectedJobs.size} onClick={()=>{setTargetPlaylist('');setAddSelection({ids:[...selectedJobs]})}}><ListMusic size={18}/>加入歌单 ({selectedJobs.size})</button></div>}
      {tab==='jobs'?<section>{jobQuery.data?.map(job=><article className="online-job" key={job.id}><div>{job.song_id&&<label><input type="checkbox" aria-label={`选择 ${job.name}`} checked={selectedJobs.has(job.song_id)} onChange={e=>setSelectedJobs(old=>{const next=new Set(old);e.target.checked?next.add(job.song_id):next.delete(job.song_id);return next})}/></label>}<strong>{job.name}</strong><small>{job.singer} · {qualityNames[job.quality]} · {w[job.state as keyof typeof w]??job.state}</small><progress max={job.total||undefined} value={job.total?job.received:undefined}/><small>{(job.received/1048576).toFixed(1)} MB{job.total?` / ${(job.total/1048576).toFixed(1)} MB`:''}</small>{job.error&&<small className="online-error">{job.error}</small>}</div><div className="online-actions">{['queued','resolving','downloading','importing'].includes(job.state)&&<button title={w.cancel} disabled={busy} onClick={()=>void action(async()=>{await api(`downloads/${job.id}/cancel`,{});await reload()})}><X size={18}/></button>}{['failed','cancelled'].includes(job.state)&&<button title={w.retry} disabled={busy} onClick={()=>void action(async()=>{await api(`downloads/${job.id}/retry`,{});await reload()})}><RefreshCw size={18}/></button>}{job.song_id&&<Link to={`/song/${job.song_id}`}>{w.library}</Link>}</div></article>)}{!jobQuery.data?.length&&<p className="online-empty">{w.empty}</p>}</section>:<>
        <form className="online-search" onSubmit={submit}><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==='users'?text('搜索网易云用户昵称','Search NetEase nickname','NetEaseのニックネームを検索'):w.search} maxLength={120}/><select aria-label="Platform" value={tab==='users'?'wy':platform} disabled={busy||tab==='users'} onChange={e=>setPlatform(e.target.value)}>{Object.entries(platformNames).map(([id,name])=><option key={id} value={id}>{id==='all'&&language==='en'?'All':name}</option>)}</select><button type="submit" disabled={busy||!query.trim()} title={w.search}><Search size={19}/></button></form>
        <div className="online-toolbar"><select aria-label={w.choose} value={active?.id??''} disabled={busy} onChange={e=>void action(async()=>{await api('sources/select',{id:Number(e.target.value)});setSelected(new Set());await reload()})}><option value="" disabled>{w.choose}</option>{sourceQuery.data?.items.filter(s=>s.enabled).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><Link to="/account/sources" title={w.sources} className="online-icon"><Settings2 size={18}/></Link></div>
        {results.filter(r=>r.error).map(r=><p className="online-error" key={r.source}>{platformNames[r.source]}: {r.error}</p>)}
        {onlineUser&&!playlist&&<div className="online-toolbar"><button title={w.back} disabled={busy} onClick={()=>void action(()=>search())}><ArrowLeft size={18}/></button><h2>{onlineUser.name} · {text('公开歌单','Public playlists','公開プレイリスト')}</h2></div>}
        {playlist&&<div className="online-toolbar"><button title={onlineUser?text('返回用户歌单','Back to user playlists','ユーザーに戻る'):w.back} disabled={busy} onClick={()=>void action(()=>onlineUser?openUser(onlineUser,userPage):search())}><ArrowLeft size={18}/></button><h2>{playlist.name}</h2><button disabled={busy||!active} onClick={()=>void action(()=>whole())}><Download size={17}/>{w.whole}</button><button disabled={busy} onClick={()=>void action(()=>whole(true))}><ListMusic size={17}/>整单已下载歌曲加入歌单</button></div>}
        {(tab==='songs'||playlist)&&<div className="online-toolbar"><button disabled={busy||!selected.size} onClick={()=>{setTargetPlaylist('');setAddSelection({keys:tracks.filter(t=>selected.has(keyOf(t))).map(keyOf)})}}><ListMusic size={17}/>已下载所选加入歌单</button></div>}
        {(tab==='songs'||playlist)&&<div className="online-toolbar"><label><input type="checkbox" disabled={busy} checked={tracks.length>0&&tracks.every(t=>selected.has(keyOf(t)))} onChange={e=>setSelected(new Set(e.target.checked?tracks.map(keyOf):[]))}/>{w.all}</label><button disabled={busy||!selected.size||!active} onClick={()=>void action(async()=>prepareDownload(tracks.filter(t=>selected.has(keyOf(t)))))}><Download size={17}/>{w.download} ({selected.size})</button></div>}
        <section>{tracks.map((track,index)=>tab==='users'&&!onlineUser?<button className="online-playlist online-user" key={`${track.source}:${track.id}`} disabled={busy} onClick={()=>void action(()=>openUser({id:String(track.id),source:track.source,name:track.name}))}>{track.img&&<img src={track.img} referrerPolicy="no-referrer" alt=""/>}<span><strong>{track.name}</strong><small>网易云 · ID {track.id}</small></span><ChevronRight size={18}/></button>:(tab==='playlists'||onlineUser)&&!playlist?<button className="online-playlist" key={`${track.source}:${track.id}:${index}`} disabled={busy} onClick={()=>void action(()=>openPlaylist({id:String(track.id),source:track.source,name:track.name}))}>{track.img?<img src={track.img} referrerPolicy="no-referrer" alt=""/>:<ListMusic size={30}/>}<span><strong>{track.name}</strong><small>{platformNames[track.source]} · {track.total??''}{onlineUser?` · ${(track as Track & {owned:boolean}).owned?text('创建','Created','作成'):text('收藏','Saved','保存')}`:''}</small></span><ChevronRight size={18}/></button>:<article className="online-track" key={`${keyOf(track)}:${index}`}>
          <input type="checkbox" aria-label={track.name} disabled={busy} checked={selected.has(keyOf(track))} onChange={e=>setSelected(old=>{const next=new Set(old);e.target.checked?next.add(keyOf(track)):next.delete(keyOf(track));return next})}/>
          {track.img?<img src={track.img} referrerPolicy="no-referrer" alt=""/>:<div className="online-art"><Music2 size={22}/></div>}
          <div className="online-track-name"><strong>{track.name}</strong><small>{track.singer} · {track.albumName} · {platformNames[track.source]}</small></div>
          <button title={text('试听并加入播放列表','Play and add to queue','試聴してキューに追加')} disabled={busy||!supported(track).length} onClick={()=>void action(()=>preview(track))}><Play size={18}/></button>
          <button title={w.download} disabled={busy||!supported(track).length} onClick={()=>void action(async()=>prepareDownload([track]))}><Download size={18}/></button>
        </article>)}</section>
        {!tracks.length&&<p className="online-empty">{w.empty}</p>}
        <div className="online-toolbar"><button title="Previous" disabled={busy||page<=1} onClick={()=>void action(()=>playlist?openPlaylist(playlist,page-1):onlineUser?openUser(onlineUser,page-1):search(page-1))}><ChevronLeft size={18}/></button><span>{page}</span><button title="Next" disabled={busy||!hasMore} onClick={()=>void action(()=>playlist?openPlaylist(playlist,page+1):onlineUser?openUser(onlineUser,page+1):search(page+1))}><ChevronRight size={18}/></button></div>
        <p className="online-footnote">{w.copyright}</p>
      </>}
    </>}
    <Dialog open={download!==null} onClose={()=>{if(!busy)setDownload(null)}} title={text('下载到公共曲库','Download to public library','共有曲庫にダウンロード')}>
      <div className="online-download-options">
        <p>{download?.tracks.length} {w.songs} · {download?.source.name}</p>
        {notice&&<p role="status">{notice}</p>}
        {playlistSelect}
        <CreatePlaylistInline disabled={busy} onCreated={p=>setTargetPlaylist(String(p.id))}/>
        <label>{text('统一音质','Quality for all tracks','一括音質')}<select aria-label={text('统一音质','Quality for all tracks','一括音質')} value={downloadQuality} disabled={busy} onChange={e=>{setDownloadQuality(e.target.value);setSkipUnsupported(false)}}>{options.map(option=><option key={option.quality} value={option.quality}>{qualityNames[option.quality]} · {option.count}/{download?.tracks.length}</option>)}</select></label>
        {missing>0&&<><p className="online-error">{missing} {text('首不支持所选音质','tracks do not support this quality','曲はこの音質に対応していません')}</p><details><summary>{text('查看歌曲','View tracks','曲を表示')}</summary>{download?.tracks.filter(track=>!eligible.includes(track)).map(track=><p key={keyOf(track)}>{track.name}</p>)}</details><label><input type="checkbox" checked={skipUnsupported} disabled={busy} onChange={e=>setSkipUnsupported(e.target.checked)}/>{text('跳过不支持的歌曲','Skip unsupported tracks','非対応の曲をスキップ')}</label></>}
        {error&&<p role="alert" className="online-error">{error}</p>}
        <button disabled={busy||!eligible.length||Boolean(missing&&!skipUnsupported)} onClick={()=>void action(enqueue)}><Download size={18}/>{busy?w.loading:`${w.download} (${eligible.length})`}</button>
      </div>
    </Dialog>
    <Dialog open={addSelection!==null} onClose={()=>{if(!busy)setAddSelection(null)}} title="加入歌单"><div className="online-download-options">{playlistSelect}<CreatePlaylistInline disabled={busy} onCreated={p=>setTargetPlaylist(String(p.id))}/>{error&&<p role="alert" className="online-error">{error}</p>}<button disabled={busy||!targetPlaylist} onClick={()=>void action(addToPlaylist)}><ListMusic size={18}/>确认加入</button></div></Dialog>
  </div>
}
