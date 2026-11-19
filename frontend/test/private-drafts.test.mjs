import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
test('verified local erasure prevents same-account conversation and letter drafts from returning from module memory',async()=>{
 const data=new Map(),listeners=new Map(),storage={get length(){return data.size},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},window={localStorage:storage,sessionStorage:storage,addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn)},dispatchEvent(e){for(const fn of listeners.get(e.type)??[])fn(e);return true}}
 const context=vm.createContext({window,localStorage:storage,sessionStorage:storage,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail}},console})
 const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 const chat=new vm.SourceTextModule(compile(await readFile(new URL('../src/conversationHistory.ts',import.meta.url),'utf8')),{context});await chat.link(()=>new vm.SyntheticModule(['useCallback','useRef','useState'],function(){this.setExport('useCallback',v=>v);this.setExport('useRef',v=>({current:v}));this.setExport('useState',v=>[typeof v==='function'?v():v,()=>{}])},{context}));await chat.evaluate()
 const rights=new vm.SourceTextModule(compile(await readFile(new URL('../src/auth/dataRightsClient.ts',import.meta.url),'utf8')),{context});await rights.link(()=>assert.fail('Unexpected runtime import'));await rights.evaluate()
 const account=randomUUID(),other=randomUUID(),owner='account.'+account,otherOwner='account.'+other
 chat.namespace.useConversationDraft(owner,'one',true)[1]('PRIVATE_CHAT_A');chat.namespace.useConversationDraft(owner,'two',false)[1]('PRIVATE_MEMORY_A');chat.namespace.useConversationDraft(otherOwner,'one',true)[1]('OTHER_CHAT_B')
 const source=await readFile(new URL('../src/person.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('person.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),handler=ast.statements.find(node=>ts.isIfStatement(node)&&node.getText(ast).includes('private-drafts-erased')&&node.getText(ast).includes('letterDrafts'))
 assert(handler);const letters=vm.runInContext(compile('const letterDrafts=new Map();\n'+handler.getText(ast)+'\nletterDrafts'),context);letters.set(JSON.stringify([owner,['server',randomUUID()]]),{value:{text:'PRIVATE_LETTER_A'}});letters.set(JSON.stringify([otherOwner,['server',randomUUID()]]),{value:{text:'OTHER_LETTER_B'}})
 rights.namespace.clearPrivateOperationDrafts(account)
 assert.equal(chat.namespace.useConversationDraft(owner,'one',true)[0],'');assert.equal(chat.namespace.useConversationDraft(owner,'two',false)[0],'');assert.equal(chat.namespace.useConversationDraft(otherOwner,'one',true)[0],'OTHER_CHAT_B');assert.equal(letters.size,1);assert.match([...letters.values()][0].value.text,/OTHER_LETTER_B/)
})
