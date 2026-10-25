import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
const source=readFileSync(new URL('../src/lib/onlineMusic.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText
const {batchQualities}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
test('batch quality only lists real support and reports unsupported track counts',()=>{
  const source={capabilities:{kw:{actions:['musicUrl'],qualitys:['128k','320k','flac']}}}
  const tracks=[{source:'kw',types:[{type:'128k'},{type:'flac'}]},{source:'kw',types:[{type:'128k'}]},{source:'kg',types:[{type:'flac'}]}]
  assert.deepEqual(batchQualities(source,tracks),[{quality:'128k',count:2},{quality:'flac',count:1}])
  assert.deepEqual(batchQualities(undefined,tracks),[])
})
