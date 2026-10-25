import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Save } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { http, resolveMediaUrl } from '../../api/http'
import { getApiErrorMessage } from '../../api/error'
import type { PlaylistItem } from '../../types/playlist'

export function EditPlaylistDialog({playlist,onClose}:{playlist:PlaylistItem;onClose:()=>void}) {
  const cache=useQueryClient()
  const [name,setName]=useState(playlist.name),[file,setFile]=useState<File|null>(null)
  const [preview,setPreview]=useState(''),[removeCover,setRemoveCover]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{if(!file){setPreview('');return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file])
  const image=preview||(!removeCover&&playlist.coverUrl?resolveMediaUrl(playlist.coverUrl):'')
  const save=async()=>{
    if(busy||!name.trim())return
    setBusy(true);setError('')
    try {
      const data=new FormData();data.append('name',name.trim());data.append('remove_cover',String(removeCover));if(file)data.append('cover',file)
      await http.post(`/api/v1/playlists/${playlist.id}/edit`,data,{timeout:60000})
      await cache.invalidateQueries({queryKey:['playlists']});await cache.invalidateQueries({queryKey:['playlist-detail',playlist.id]});onClose()
    }catch(e){setError(getApiErrorMessage(e,'保存歌单失败'))}finally{setBusy(false)}
  }
  return <Dialog open onClose={()=>{if(!busy)onClose()}} title="编辑歌单"><form className="grid gap-5 p-5" onSubmit={e=>{e.preventDefault();void save()}}>
    <label className="grid gap-2 text-sm text-zinc-400">歌单名称<input className="account-input" value={name} maxLength={120} disabled={busy} onChange={e=>setName(e.target.value)} required/></label>
    <div className="flex flex-wrap items-center gap-4"><div className="grid h-32 w-32 shrink-0 place-items-center overflow-hidden rounded-md bg-zinc-800">{image?<img src={image} alt="封面预览" className="h-full w-full object-cover"/>:<ImagePlus size={32}/>}</div><div className="grid gap-3"><label className="secondary-button cursor-pointer"><ImagePlus size={16}/>选择封面<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={e=>{const next=e.target.files?.[0];e.target.value='';if(!next)return;if(next.size>5*1024*1024){setError('封面不能超过 5 MB');return}setError('');setFile(next);setRemoveCover(false)}}/></label><button type="button" className="secondary-button" disabled={busy} onClick={()=>{setFile(null);setRemoveCover(true)}}>使用歌曲封面</button></div></div>
    {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
    <div className="flex justify-end gap-3"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy||!name.trim()}><Save size={16}/>{busy?'保存中…':'保存'}</button></div>
  </form></Dialog>
}
