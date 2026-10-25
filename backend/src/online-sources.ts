import { createHash } from 'node:crypto'
import type { SqliteDatabase } from './db.js'
import { assertApp, AppError } from './errors.js'
import { fromBuffer } from 'yauzl'
import { publicJson, publicRequest } from './online-network.js'
import { runSource, qualityOrder, type SourceCapabilities } from './online-runtime.js'

const repository = 'Macrohard0001/lx-ikun-music-sources'
interface CatalogFile { path: string; size: number; sha: string }
interface Catalog { commit: string; date: string; batch: string; files: CatalogFile[]; warning?: string }
export interface OnlineSource { id: number; name: string; code: string; checksum: string; origin: string; capabilities_json: string; enabled: number }

export class OnlineSources {
  private catalog?: Catalog
  private refreshedAt = 0
  private refreshing: Promise<Catalog> | undefined
  private archiveFiles = new Map<string, Buffer>()
  constructor(private readonly db: SqliteDatabase) {
    const saved=db.prepare('SELECT catalog_json,refreshed_at FROM online_catalog_cache WHERE id=1').get()
    if(saved){try{this.catalog=JSON.parse(String(saved.catalog_json));this.refreshedAt=Number(saved.refreshed_at)}catch{/* Ignore an invalid cache. */}}
  }

  private persistCatalog(){
    this.db.prepare('INSERT INTO online_catalog_cache(id,catalog_json,refreshed_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET catalog_json=excluded.catalog_json,refreshed_at=excluded.refreshed_at').run(JSON.stringify(this.catalog),this.refreshedAt)
  }

  async refresh(): Promise<Catalog> {
    if (this.catalog && Date.now() - this.refreshedAt < 60_000) return this.catalog
    if (this.refreshing) return this.refreshing
    this.refreshing = this.fetchCatalog().catch(async () => {
      try { return await this.fetchArchive() } catch {
        if (this.catalog) return {...this.catalog, warning:'GitHub 暂时不可用，当前显示上次成功获取的目录，并非最新检查结果'}
        throw new AppError(502,'catalog_unavailable','GitHub 目录暂时不可用（访问受限或网络超时），请稍后重试，也可导入本地音源脚本')
      }
    }).finally(() => { this.refreshing = undefined })
    return this.refreshing
  }

  private async fetchArchive(): Promise<Catalog> {
    const response = await publicRequest(`https://codeload.github.com/${repository}/zip/refs/heads/main`, {maxBytes:40*1024*1024})
    assertApp(response.statusCode===200,502,'catalog_unavailable','仓库压缩包下载失败')
    const archive = await new Promise<{commit:string;files:Map<string,Buffer>}>((resolve,reject)=>{
      fromBuffer(response.body,{lazyEntries:true},(error,zip)=>{
        if(error||!zip){reject(error);return}
        const commit=String(zip.comment).trim(),files=new Map<string,Buffer>()
        let bytes=0,count=0
        zip.on('error',reject)
        zip.on('end',()=>resolve({commit,files}))
        zip.on('entry',entry=>{
          if(++count>10000){zip.close();reject(new Error('Archive too large'));return}
          const path=entry.fileName.split('/').slice(1).join('/')
          if(!/^[vV]\d{6}\/.+\.js$/.test(path)||entry.uncompressedSize>2*1024*1024){zip.readEntry();return}
          bytes+=entry.uncompressedSize
          if(bytes>60*1024*1024){zip.close();reject(new Error('Archive too large'));return}
          zip.openReadStream(entry,(error,stream)=>{
            if(error||!stream){zip.close();reject(error);return}
            const chunks:Buffer[]=[]
            stream.on('error',error=>{zip.close();reject(error)})
            stream.on('data',chunk=>chunks.push(chunk))
            stream.on('end',()=>{files.set(path,Buffer.concat(chunks));zip.readEntry()})
          })
        })
        zip.readEntry()
      })
    })
    assertApp(/^[a-f0-9]{40}$/.test(archive.commit),502,'invalid_repository','仓库快照版本校验失败')
    const batch=[...archive.files.keys()].map(path=>path.split('/')[0]!).sort((a,b)=>b.slice(1).localeCompare(a.slice(1)))[0]
    assertApp(batch,502,'invalid_repository','仓库中没有音源批次')
    this.archiveFiles=new Map([...archive.files].filter(([path])=>path.startsWith(`${batch}/`)))
    this.catalog={commit:archive.commit,date:'',batch,files:[...this.archiveFiles].map(([path,body])=>({path,size:body.length,sha:createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex')}))}
    this.refreshedAt=Date.now()
    this.persistCatalog()
    return this.catalog
  }

  private async fetchCatalog(): Promise<Catalog> {
    const commit = await publicJson(`https://api.github.com/repos/${repository}/commits/main`)
    assertApp(/^[a-f0-9]{40}$/.test(commit.sha), 502, 'invalid_repository', '仓库版本信息无效')
    const tree = await publicJson(`https://api.github.com/repos/${repository}/git/trees/${commit.sha}?recursive=1`)
    assertApp(!tree.truncated && Array.isArray(tree.tree), 502, 'invalid_repository', '仓库文件目录不完整')
    const batch = tree.tree.filter((item: any) => item.type === 'tree' && /^[vV]\d{6}$/.test(item.path)).map((item: any) => item.path as string).sort((a: string, b: string) => b.slice(1).localeCompare(a.slice(1)))[0]
    assertApp(batch, 502, 'invalid_repository', '仓库中没有音源批次')
    const files = tree.tree.filter((item: any) => item.type === 'blob' && item.path.startsWith(`${batch}/`) && item.path.endsWith('.js') && item.size > 0 && item.size <= 2 * 1024 * 1024).map((item: any) => ({ path: String(item.path), size: Number(item.size), sha: String(item.sha) }))
    this.catalog = { commit: commit.sha, date: commit.commit.committer.date, batch, files }
    this.archiveFiles.clear()
    this.refreshedAt = Date.now()
    this.persistCatalog()
    return this.catalog
  }

  list(userId: number) {
    const rows = this.db.prepare('SELECT id,name,checksum,origin,capabilities_json,enabled,created_at FROM online_source ORDER BY id DESC').all() as unknown as OnlineSource[]
    const selection = this.db.prepare('SELECT source_id FROM online_source_selection WHERE user_id=?').get(userId) as { source_id: number } | undefined
    return { selectedId: selection?.source_id ?? null, items: rows.map(({ capabilities_json, enabled, ...row }) => ({ ...row, enabled: Boolean(enabled), capabilities: JSON.parse(capabilities_json) })) }
  }

  async install(path: string, commit: string) {
    const catalog = await this.refresh()
    assertApp(commit === catalog.commit, 409, 'catalog_changed', '目录已更新，请刷新后重新选择')
    const entry = catalog.files.find((file) => file.path === path)
    assertApp(entry, 400, 'invalid_source', '不在当前音源目录中')
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    const cached=this.archiveFiles.get(path)
    const result = cached ? {statusCode:200,body:cached} : await publicRequest(`https://raw.githubusercontent.com/${repository}/${commit}/${encoded}`, { maxBytes: 2 * 1024 * 1024 }).catch(()=>{throw new AppError(502,'source_fetch_failed','音源下载失败，请稍后重试')})
    assertApp(result.statusCode === 200, 502, 'source_fetch_failed', '音源文件下载失败')
    const checksum = createHash('sha1').update(`blob ${result.body.length}\0`).update(result.body).digest('hex')
    assertApp(checksum === entry.sha, 502, 'source_integrity_failed', '音源文件校验失败')
    return this.import(path.split('/').pop()!, result.body.toString('utf8'), `https://github.com/${repository}/blob/${commit}/${encoded}`)
  }

  import(name: string, code: string, origin = 'local_upload') {
    assertApp(name.trim() && name.length <= 160 && Buffer.byteLength(code) <= 2 * 1024 * 1024 && code.trim(), 400, 'invalid_source', '音源名称或文件大小不正确')
    const checksum = createHash('sha256').update(code).digest('hex')
    const existing = this.db.prepare('SELECT id FROM online_source WHERE checksum=?').get(checksum)
    if (existing) return existing
    const result = this.db.prepare('INSERT INTO online_source(name,code,checksum,origin) VALUES (?,?,?,?)').run(name.trim(), code, checksum, origin)
    return { id: Number(result.lastInsertRowid) }
  }

  get(id: number): OnlineSource {
    const row = this.db.prepare('SELECT * FROM online_source WHERE id=?').get(id) as unknown as OnlineSource | undefined
    assertApp(row, 404, 'source_not_found', '音源不存在')
    return row
  }

  async enable(id: number, enabled: boolean) {
    const row = this.get(id)
    if (!enabled) { this.db.prepare('UPDATE online_source SET enabled=0 WHERE id=?').run(id); return }
    const raw = await runSource(row.code)
    const capabilities: SourceCapabilities = {}
    for (const source of ['kw', 'kg', 'tx', 'wy', 'mg']) {
      const cap = raw?.[source]
      if (!Array.isArray(cap?.actions) || !Array.isArray(cap?.qualitys)) continue
      capabilities[source] = { actions: cap.actions.filter((action: string) => ['musicUrl', 'lyric', 'pic'].includes(action)), qualitys: qualityOrder.filter((q) => cap.qualitys.includes(q)) }
    }
    assertApp(Object.values(capabilities).some((cap) => cap.actions.includes('musicUrl') && cap.qualitys.length), 400, 'source_incompatible', '音源没有声明可用的音频解析能力')
    this.db.prepare('UPDATE online_source SET enabled=1, capabilities_json=? WHERE id=?').run(JSON.stringify(capabilities), id)
  }

  select(userId: number, id: number) {
    assertApp(this.get(id).enabled, 400, 'source_disabled', '音源未启用')
    this.db.prepare('INSERT INTO online_source_selection(user_id,source_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET source_id=excluded.source_id').run(userId, id)
  }
}
