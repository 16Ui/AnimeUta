import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { createPlaylist } from '../../api/playlists'
import { getApiErrorMessage } from '../../api/error'
import { useAuthStore } from '../../store/useAuthStore'
import type { PlaylistItem } from '../../types/playlist'

export function CreatePlaylistInline({onCreated,disabled=false}:{onCreated:(playlist:PlaylistItem)=>void;disabled?:boolean}) {
  const token=useAuthStore(s=>s.token),cache=useQueryClient()
  const [open,setOpen]=useState(false),[name,setName]=useState(''),[visibility,setVisibility]=useState('public')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const create=async()=>{
    if(!token||busy||!name.trim())return
    setBusy(true);setError('')
    try {
      const playlist=await createPlaylist(token,{name:name.trim(),visibility})
      await cache.invalidateQueries({queryKey:['playlists']})
      setName('');setOpen(false);onCreated(playlist)
    }catch(e){setError(getApiErrorMessage(e,'创建歌单失败'))}finally{setBusy(false)}
  }
  return <div className="min-w-0 max-w-full text-sm">
    {!open?<button type="button" className="secondary-button" disabled={disabled} onClick={()=>{setError('');setOpen(true)}}><Plus size={16}/>新建歌单</button>:<div className="grid min-w-0 gap-3 py-2">
      <label className="grid gap-1 text-zinc-400">歌单名称<input autoFocus className="account-input min-w-0 w-full" maxLength={120} value={name} disabled={busy} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void create()}}}/></label>
      <label className="grid gap-1 text-zinc-400">可见范围<select className="account-input min-w-0 w-full" value={visibility} disabled={busy} onChange={e=>setVisibility(e.target.value)}><option value="public">公共歌单</option><option value="private">私人歌单</option></select></label>
      {error&&<p role="alert" className="text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className="primary-button" disabled={busy||!name.trim()||disabled} onClick={()=>void create()}>{busy?'创建中…':'创建并选择'}</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>setOpen(false)}>取消</button></div>
    </div>}
  </div>
}
