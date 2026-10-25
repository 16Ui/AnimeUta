export const qualityNames: Record<string, string> = {'128k':'128 kbps','320k':'320 kbps',flac:'FLAC',flac24bit:'FLAC 24-bit',flac32bit:'FLAC 32-bit',hires:'Hi-Res',master:'Master'}
export type OnlineTrack = {source:string;songmid:string|number;name:string;singer?:string;albumName?:string;img?:string;types?:{type:string}[];id?:string;total?:number}
export type OnlineSource = {id:number;name:string;checksum:string;origin:string;enabled:boolean;capabilities:Record<string,{actions:string[];qualitys:string[]}>}
export const trackKey = (track:OnlineTrack)=>`${track.source}:${track.songmid??track.id}`
export function supportedQualities(source:OnlineSource|undefined,track:OnlineTrack){
  const cap=source?.capabilities[track.source]
  return cap?.actions.includes('musicUrl')?Object.keys(qualityNames).filter(q=>cap.qualitys.includes(q)&&track.types?.some(t=>t.type===q)):[]
}
export function batchQualities(source:OnlineSource|undefined,tracks:OnlineTrack[]){
  return Object.keys(qualityNames).map(quality=>({quality,count:tracks.filter(track=>supportedQualities(source,track).includes(quality)).length})).filter(item=>item.count>0)
}
