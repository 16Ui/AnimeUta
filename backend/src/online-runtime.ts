import { getQuickJS } from 'quickjs-emscripten'
import { createHash, randomBytes } from 'node:crypto'
import { publicRequest } from './online-network.js'

export type SourceCapabilities = Record<string, { actions: string[]; qualitys: string[] }>
export const qualityOrder = ['128k', '320k', 'flac', 'flac24bit', 'flac32bit', 'hires', 'master']

export function allowedQualities(caps: SourceCapabilities, track: any): string[] {
  const source = caps[track.source]
  if (!source?.actions.includes('musicUrl')) return []
  const declared = Array.isArray(track.types) ? track.types.map((item: any) => item.type) : []
  return qualityOrder.filter((quality) => source.qualitys.includes(quality) && declared.includes(quality))
}

// No Node globals, filesystem, environment, modules or direct sockets enter this VM.
export async function runSource(code: string, invocation?: { source: string; action: string; info: unknown }, signal?: AbortSignal): Promise<any> {
  const quickjs = await getQuickJS()
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(32 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  const deadline = Date.now() + 15_000
  let cpuDeadline = Date.now() + 500
  runtime.setInterruptHandler(() => Date.now() > Math.min(cpuDeadline, deadline) || Boolean(signal?.aborted))
  const ctx = runtime.newContext()
  const abort = new AbortController()
  const pending = new Set<Promise<void>>()
  let requests = 0
  let done = false
  let value: unknown
  let failure = ''
  const bind = (name: string, fn: (...args: any[]) => any) => {
    const handle = ctx.newFunction(name, fn)
    ctx.setProp(ctx.global, name, handle)
    handle.dispose()
  }
  bind('__done', (result) => { value = JSON.parse(ctx.getString(result)); done = true })
  bind('__fail', (error) => { failure = ctx.getString(error).slice(0, 300); done = true })
  bind('__hash', (text, algorithm) => {
    const name = ctx.getString(algorithm)
    if (!['md5', 'sha1', 'sha256', 'sha512'].includes(name)) throw new Error('不支持的摘要算法')
    return ctx.newString(createHash(name).update(ctx.getString(text)).digest('hex'))
  })
  bind('__bytes', (text, encoding) => {
    const enc = ctx.getString(encoding)
    if (!['utf8', 'utf-8', 'hex', 'base64'].includes(enc)) throw new Error('不支持的编码')
    return ctx.newString(JSON.stringify([...Buffer.from(ctx.getString(text), enc as BufferEncoding)]))
  })
  bind('__encode', (bytes, encoding) => {
    const enc = ctx.getString(encoding)
    if (!['utf8', 'utf-8', 'hex', 'base64'].includes(enc)) throw new Error('不支持的编码')
    return ctx.newString(Buffer.from(JSON.parse(ctx.getString(bytes))).toString(enc as BufferEncoding))
  })
  bind('__random', (size) => ctx.newString(JSON.stringify([...randomBytes(Math.min(4096, Math.max(0, ctx.getNumber(size))))])))
  bind('__request', (payload) => {
    if (!invocation) throw new Error('能力检测阶段不允许网络访问')
    if (++requests > 16) throw new Error('音源请求次数超限')
    const input = JSON.parse(ctx.getString(payload))
    const promise = ctx.newPromise()
    const task = (async () => {
      try {
        const opts = input.options ?? {}
        let body = opts.body
        const headers = { ...opts.headers }
        if (opts.form) { body = new URLSearchParams(opts.form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded' }
        else if (body && typeof body !== 'string') { body = JSON.stringify(body); headers['content-type'] = 'application/json' }
        const response = await publicRequest(String(input.url), { method: String(opts.method ?? 'GET').toUpperCase(), headers, ...(body ? { body } : {}), maxBytes: 2 * 1024 * 1024, signal: AbortSignal.any([abort.signal, ...(signal ? [signal] : [])]) })
        let responseBody: any = response.body.toString('utf8')
        try { responseBody = JSON.parse(responseBody) } catch { /* Text responses are valid. */ }
        const result = ctx.newString(JSON.stringify({ statusCode: response.statusCode, headers: response.headers, body: responseBody }))
        promise.resolve(result); result.dispose()
      } catch (error) {
        const result = ctx.newString(error instanceof Error ? error.message : '音源请求失败')
        promise.reject(result); result.dispose()
      }
    })()
    pending.add(task)
    void task.finally(() => pending.delete(task))
    return promise.handle
  })
  const bootstrap = `
    globalThis.window = globalThis;
    const handlers = {};
    let initialized;
    globalThis.console = {log(){},warn(){},error(){},info(){},debug(){}};
    globalThis.setTimeout = (fn) => { Promise.resolve().then(fn); return 0; };
    globalThis.clearTimeout = () => {};
    const bytes = (s, e='utf8') => new Uint8Array(JSON.parse(__bytes(String(s), e)));
    globalThis.lx = {
      version: '2.12.2', env: 'desktop', currentScriptInfo: {},
      EVENT_NAMES: {inited:'inited',request:'request',updateAlert:'updateAlert'},
      on(event, fn) { handlers[event] = fn; },
      send(event, data) { if(event === 'inited') initialized = data; },
      request(url, options, callback) {
        __request(JSON.stringify({url,options})).then(raw => { const r=JSON.parse(raw); callback(null,r,r.body); }, e => callback(new Error(String(e))));
        return () => {};
      },
      utils: {
        buffer: {from:bytes,bufToString:(b,e='utf8')=>__encode(JSON.stringify(Array.from(b)),e)},
        crypto: {md5:s=>__hash(s,'md5'),sha256:s=>__hash(s,'sha256'),randomBytes:n=>new Uint8Array(JSON.parse(__random(n)))}
      }
    };
  `
  try {
    ctx.unwrapResult(ctx.evalCode(bootstrap + '\n' + code)).dispose()
    const invocationJson = JSON.stringify(invocation ?? null)
    ctx.unwrapResult(ctx.evalCode(`Promise.resolve().then(async()=>{
      if (!initialized || initialized.status === false) throw new Error('音源未成功声明能力，或需要未支持的运行接口');
      const call=${invocationJson};
      if(!call) return initialized.sources;
      const capability=initialized.sources?.[call.source];
      if(!capability?.actions?.includes(call.action)) throw new Error('音源未声明该功能');
      if(call.action==='musicUrl'&&!capability.qualitys?.includes(call.info.type)) throw new Error('音源未声明该音质');
      if(typeof handlers.request !== 'function') throw new Error('音源未注册请求处理器');
      return await handlers.request(call);
    }).then(v=>__done(JSON.stringify(v??null)),e=>__fail(String(e)));`)).dispose()
    while (!done && Date.now() <= deadline && !signal?.aborted) {
      cpuDeadline = Date.now() + 100
      const result = runtime.executePendingJobs(100)
      if (result.error) { failure = JSON.stringify(ctx.dump(result.error)); result.error.dispose(); break }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    if (failure) throw new Error(failure)
    if (!done) throw new Error(signal?.aborted ? '任务已取消' : '音源运行超时')
    return value
  } finally {
    abort.abort()
    await Promise.allSettled(pending)
    ctx.dispose()
    runtime.dispose()
  }
}
