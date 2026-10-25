let request
export const setRequest = fn => { request = fn }
export const httpFetch = (url, options = {}) => {
  const controller = new AbortController()
  const headers = {...options.headers}
  let body = options.body
  if(options.form) {body = new URLSearchParams(options.form).toString(); headers['content-type']='application/x-www-form-urlencoded'}
  else if(body && typeof body !== 'string') {body=JSON.stringify(body); headers['content-type']='application/json'}
  const promise = request(url, {method:String(options.method||'GET').toUpperCase(),headers,body,signal:controller.signal}).then(r=>{
    let body = r.body
    if(options.responseType !== 'buffer') {body=body.toString('utf8');try{body=JSON.parse(body)}catch{}}
    if(r.statusCode>=400) throw new Error(`平台服务返回 ${r.statusCode}`)
    return {...r,body,raw:r.body}
  })
  return {promise, cancelHttp:()=>controller.abort()}
}
