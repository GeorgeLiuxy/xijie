// Deterministic evidence matching ported from the approved atlas/memorySearch.ts.
// Preserve negative predicates and single-clause evidence; generated stories are never indexed.
import type {PersonContext,WorldContext} from './dependencies.js'
import type {SearchHit} from './contracts.js'
export type SearchMemory={id:string;person_id:string;title:string;body:string;version:number}
const han=/\p{Script=Han}/u
const englishFillers=new Set('a an and are at by did do does find for from he her him his i in is it me my of on or our person she that the their them there this to was we who with would you'.split(' '))
const chineseFillers=/帮我找|我想找|我记得|我想起|我记起|那个人|的那位|那位|那个|是谁|的人|经常|总是|曾经|我们|我的|[我你她他的在]/gu
const negation=/从来没(?:有)?|从未|从不|没有|[不没](?=爱|喜欢|来|去|在|等|接|会|想|能|是|愿|要|擅长|记得|曾|见|下棋)|\b(?:no longer|not|never|cannot|without)\b|n['’]t\b/iu
const clauseBreak=/[,，;；。.!！？?]|但是|不过|却|但|\b(?:but|however)\b/iu
export const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
function terms(text:string){const result=new Set<string>();for(const match of text.replace(chineseFillers,' ').matchAll(/\p{Script=Han}+|[\p{Script=Latin}\p{N}]+|\p{L}+/gu)){const word=match[0];if(han.test(word)){const chars=[...word];for(let i=1;i<chars.length;i++)result.add(chars[i-1]+chars[i])}else if(!englishFillers.has(word))result.add(word)}return result}
// Bounded candidate selection only. The established evidenceScore still makes the final decision.
export const evidenceTerms=(text:string)=>[...terms(normalize(text))].slice(0,64)
function phrase(line:string,q:string){return han.test(q)?line.includes(q):(' '+line+' ').includes(' '+q+' ')}
function overlap(line:string,q:string,queryTerms:Set<string>){const value=normalize(line);if(value===q||queryTerms.size&&phrase(value,q))return 85;if(!queryTerms.size)return 0;const words=terms(value);let hits=0;for(const word of queryTerms)if(words.has(word))hits++;const coverage=hits/queryTerms.size;return coverage>=0.6?40+30*coverage:0}
function negativeTail(text:string){const cue=negation.exec(text);return cue?normalize(text.slice(cue.index+cue[0].length).replace(/的人[？?。!！]?$/u,'')):null}
export function evidenceScore(line:string,query:string){const q=normalize(query),queryTerms=terms(q),predicate=negativeTail(query.trim());if(predicate===null&&!negation.test(line))return overlap(line,q,queryTerms);let score=0;for(const clause of line.split(clauseBreak)){const tail=negativeTail(clause);if(predicate===null&&tail===null)score=Math.max(score,overlap(clause,q,queryTerms));if(predicate&&tail!==null&&(han.test(predicate)?tail.startsWith(predicate):(tail+' ').startsWith(predicate+' ')))score=85}return score}
function lines(text:string){return text.match(/[^。！？!?\n]+[。！？!?]?/gu)?.map(value=>value.trim()).filter(Boolean)??[]}
const englishWorlds:Record<string,string>={courtyard:'Sunlit Courtyard',tide:'Tidal Arcade',isles:'Prism Isles'}
export function searchHits(people:PersonContext[],worlds:WorldContext[],memories:SearchMemory[],query:string,locale='zh-CN'):SearchHit[]{
 const q=normalize(query);if(!q)return []
 const worldById=new Map(worlds.filter(world=>world.enabled).map(world=>[world.id,world])),ranked:{hit:SearchHit;score:number}[]=[]
 for(const person of people){
  const names=[person.displayName,person.realName].filter((name):name is string=>!!name);let score=0,evidence=''
  for(const name of names){const value=normalize(name);const current=value===q?120:(han.test(q)?value.includes(q):(' '+value).includes(' '+q))?105:0;if(current>score){score=current;evidence=name}}
  if(person.relationship&&phrase(normalize(person.relationship),q)&&score<100){score=100;evidence=person.relationship}
  const world=worldById.get(person.worldId)
  if(world&&[world.displayName,englishWorlds[world.code],world.code].filter(Boolean).some(name=>normalize(name)===q)&&score<95){score=95;evidence=world.displayName}
  for(const line of [person.story,person.place,person.birthMonthDay,person.yearsText].filter((line):line is string=>!!line).flatMap(lines)){const current=evidenceScore(line,query);if(current>score){score=current;evidence=line}}
  if(score)ranked.push({hit:{kind:'person',id:person.id,personId:person.id,worldId:person.worldId,worldCode:world?.code,title:person.displayName,excerpt:evidence},score})
 }
 const peopleById=new Map(people.map(person=>[person.id,person]))
 for(const memory of memories){const person=peopleById.get(memory.person_id);if(!person)continue;let score=0,evidence='';for(const line of lines(memory.body)){const current=evidenceScore(line,query);if(current>score){score=current;evidence=line}}if(!negation.test(memory.body)){const titleScore=evidenceScore(memory.title,query);if(titleScore>score||titleScore===score&&normalize(memory.title)===q){score=titleScore;evidence=memory.title}}
  if(score)ranked.push({hit:{kind:'memory',id:memory.id,memoryId:memory.id,personId:person.id,worldId:person.worldId,worldCode:worldById.get(person.worldId)?.code,title:memory.title,excerpt:evidence,version:memory.version},score})
 }
 const exactName=ranked.some(item=>item.hit.kind==='person'&&item.score===120)
 const filtered=exactName?ranked.filter(item=>item.score===120):ranked
 if(!exactName)for(const world of worldById.values()){
  const code='ely'+String(worlds.findIndex(value=>value.id===world.id)+1).padStart(2,'0'),codeQuery=q.replace(/[^a-z0-9]/g,'')
  if([world.displayName,englishWorlds[world.code],world.code].filter(Boolean).some(name=>normalize(name).includes(q))||/^ely\d+$/.test(codeQuery)&&codeQuery===code)filtered.push({hit:{kind:'world',id:world.id,worldId:world.id,worldCode:world.code,title:locale==='en'?englishWorlds[world.code]??world.displayName:world.displayName},score:90})
 }
 return filtered.sort((a,b)=>b.score-a.score||a.hit.kind.localeCompare(b.hit.kind)||a.hit.id.localeCompare(b.hit.id)).map(value=>value.hit)
}
