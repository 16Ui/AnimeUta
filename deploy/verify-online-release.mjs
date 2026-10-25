import { pathToFileURL } from 'node:url'
process.loadEnvFile('/opt/animeuta/shared/backend.env')
const base=pathToFileURL('/opt/animeuta/current/backend/dist/')
const {loadConfig}=await import(new URL('config.js',base))
const {openDatabase}=await import(new URL('db.js',base))
const {OnlineSources}=await import(new URL('online-sources.js',base))
const {OnlinePreview}=await import(new URL('online-preview.js',base))
const {searchOnline,onlinePlaylist}=await import(new URL('online-catalog.js',base))
const db=openDatabase(loadConfig().databasePath),sources=new OnlineSources(db)
try {
  const catalog=await sources.refresh()
  console.log('CATALOG',catalog.batch,catalog.files.length,catalog.warning||'fresh')
  const file=catalog.files.find(file=>file.path.endsWith('/xinghai-music-sourcev2.3.11.js'))
  if(!file)throw new Error('Verified source is not in current catalogue')
  const source=await sources.install(file.path,catalog.commit)
  await sources.enable(Number(source.id),true)
  const owner=db.prepare("SELECT id FROM app_user WHERE role='owner' AND status='active' ORDER BY id LIMIT 1").get()
  if(!owner)throw new Error('Owner missing')
  if(!sources.list(owner.id).selectedId)sources.select(owner.id,Number(source.id))
  const result=await searchOnline('all','songs','初音ミク',1)
  console.log('SEARCH',JSON.stringify(result.map(r=>({source:r.source,count:r.list.length,error:r.error}))))
  const lists=await searchOnline('kw','playlists','初音ミク',1)
  if(lists[0]?.list[0]){const list=await onlinePlaylist('kw',String(lists[0].list[0].id),1);console.log('PLAYLIST',list.list.length,list.total)}
  const track=result.find(r=>r.source==='kw')?.list.find(t=>t.types?.some(q=>q.type==='128k'))
  if(!track)throw new Error('No preview candidate')
  const preview=new OnlinePreview(sources)
  try{const song=await preview.resolve(owner.id,Number(source.id),track);console.log('PREVIEW_OK',song.durationSeconds)}finally{preview.close()}
  console.log('ONLINE_ACCEPTANCE_OK')
}finally{db.close()}
