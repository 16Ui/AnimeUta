import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import ipaddr from 'ipaddr.js'

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast' } catch { return false }
}

export interface NetworkOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  maxBytes?: number
  signal?: AbortSignal
  onProgress?: (received: number, total: number) => void
}

// Pin the validated DNS result to the socket, including every redirect.
export async function publicRequest(input: string, options: NetworkOptions = {}, redirects = 0): Promise<{ body: Buffer; statusCode: number; headers: http.IncomingHttpHeaders }> {
  const url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('不允许访问该网络地址')
  if (redirects > 4) throw new Error('重定向次数过多')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = await lookup(host, { all: true })
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error('禁止访问内网或保留地址')
  const address = addresses[0]!
  const headers: Record<string, string> = { 'user-agent': 'AnimeUta/1.0', 'accept-encoding': 'identity' }
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (/^(host|connection|content-length|transfer-encoding|cookie|authorization|proxy-.*)$/i.test(key)) continue
    if (typeof value === 'string' && !/[\r\n]/.test(value)) headers[key] = value
  }
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024
  const response = await new Promise<{ body: Buffer; statusCode: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: options.method === 'POST' ? 'POST' : 'GET', headers,
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(options.signal ? [options.signal] : [])]),
      lookup: ((_hostname: string, opts: unknown, callback: Function) => {
        if (typeof opts === 'object' && opts && 'all' in opts && opts.all) callback(null, [address])
        else callback(null, address.address, address.family)
      }) as never,
    }, (res) => {
      res.on('error', reject)
      const statusCode = res.statusCode ?? 500
      if ([301, 302, 303, 307, 308].includes(statusCode)) { res.resume(); resolve({ body: Buffer.alloc(0), statusCode, headers: res.headers }); return }
      const total = Number(res.headers['content-length']) || 0
      if (total > maxBytes) { res.destroy(new Error('响应文件超过大小限制')); return }
      const chunks: Buffer[] = []
      let received = 0
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > maxBytes) { res.destroy(new Error('响应文件超过大小限制')); return }
        chunks.push(chunk)
        options.onProgress?.(received, total)
      })
      res.on('end', () => resolve({ body: Buffer.concat(chunks), statusCode, headers: res.headers }))
    })
    req.on('error', reject)
    req.end(options.body)
  })
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    if (!response.headers.location) throw new Error('重定向缺少地址')
    return publicRequest(new URL(response.headers.location, url).href, { ...options, method: 'GET', headers: {} }, redirects + 1)
  }
  return response
}

export async function publicJson(url: string): Promise<any> {
  const result = await publicRequest(url)
  if (result.statusCode !== 200) throw new Error(`远端服务返回 ${result.statusCode}`)
  return JSON.parse(result.body.toString('utf8'))
}
