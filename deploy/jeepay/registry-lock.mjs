import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const path=process.argv[2]
if(!path)throw new Error('Supply a copied package lock')
const original=JSON.parse(await readFile(path,'utf8'))
const normalized=structuredClone(original)
let count=0
function visit(value){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(key==='resolved'&&typeof item==='string'&&item.startsWith('https://registry.npmmirror.com/')){value[key]='https://registry.npmjs.org/'+item.slice('https://registry.npmmirror.com/'.length);count++}else visit(item)}}
visit(normalized)
function withoutResolved(value){if(Array.isArray(value))return value.map(withoutResolved);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='resolved').map(([key,item])=>[key,withoutResolved(item)]));return value}
if(JSON.stringify(withoutResolved(original))!==JSON.stringify(withoutResolved(normalized)))throw new Error('Dependency versions or integrity changed')
await writeFile(path,JSON.stringify(normalized,null,2)+'\n')
process.stdout.write(JSON.stringify({rewrittenTarballHosts:count,versionsAndIntegrityUnchanged:true,originalSemanticSha256:createHash('sha256').update(JSON.stringify(original)).digest('hex')})+'\n')

