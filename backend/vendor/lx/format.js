export const decodeName = value => String(value ?? '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')
export const formatPlayTime = s => `${Math.floor(Number(s)/60)}:${String(Math.floor(Number(s)%60)).padStart(2,'0')}`
export const sizeFormate = size => `${(Number(size)/1024/1024).toFixed(2)} MB`
export const formatPlayCount = count => String(count ?? '')
export const dateFormat = value => new Date(value).toISOString().slice(0,10)
