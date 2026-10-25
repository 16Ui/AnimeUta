import { build } from 'esbuild'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = resolve(root,'vendor/lx')
await build({entryPoints:[resolve(vendor,'entry.js')],outfile:resolve(vendor,'catalog.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{
  name:'animeuta-adapters',setup(b){
    b.onResolve({filter: /request$/},()=>({path:resolve(vendor,'request.js')}))
    b.onResolve({filter: /^(\.\.\/)+index$|^@renderer\/utils$/},()=>({path:resolve(vendor,'format.js')}))
    b.onResolve({filter: /^@renderer\/utils\/musicSdk\//},a=>({path:resolve(vendor,a.path.replace('@renderer/utils/','')+'.js')}))
  }
}]})
