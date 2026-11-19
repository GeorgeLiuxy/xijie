import 'reflect-metadata'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import pg from 'pg'
import {PeopleStore} from '../dist/store.js'
import {personFields} from '../dist/contracts.js'
import {exportPeople,erasePeople} from '../dist/data-rights.js'
test('structured user profile fields have independent bounds, authority, versioning and rights',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='people_profile_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 await admin.query('CREATE SCHEMA '+schema);t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of(await readdir(new URL('../db/',import.meta.url))).filter(n=>/^\d+.*\.sql$/.test(n)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const store=new PeopleStore(pool),account=randomUUID(),world=(await store.worlds(undefined,1))[0],draft=await store.create(account,1,randomUUID(),{displayName:'合成人物',relationship:'朋友',story:'独立故事原文'})
 const preview=await store.createPreview(account,draft.id,1,randomUUID(),draft.version,{worldPreferenceId:world.id,previousPreviewId:null}),initial=await store.confirm(account,draft.id,1,randomUUID(),draft.version,{previewId:preview.id,worldId:world.id},randomUUID())
 assert.deepEqual(initial.personality,[]);assert.deepEqual(initial.life,[]);assert.deepEqual(initial.unknowns,[]);assert.equal(initial.catchphrase,null)
 const withoutClues = await store.create(account, 1, randomUUID(), {
   displayName: '稳重', relationship: '爷爷', story: '她说话很慢？我们常去湖边散步。\n性格：未知',
 })
 const basePreview = await store.createPreview(account, withoutClues.id, 1, randomUUID(), withoutClues.version, { worldPreferenceId: world.id, previousPreviewId: null })
 const base = await store.getPreview(account, withoutClues.id, basePreview.id, 1)
 assert.equal(base.suggestedPersonality, undefined)
 assert.equal(base.suggestedCatchphrase, undefined)

 await t.test('explicit clues match the current preview and are confirmed with the same story version', async () => {
   const source = '性格：温和、风趣、温和；说话方式：常先听完，再说自己的看法。\n她说话很轻。\nSpeaking style: Uses short sentences.\n口头禅：「慢慢来；先喝茶。」'
   const edited = await store.update(account, withoutClues.id, 1, randomUUID(), withoutClues.version, { story: source, conversationTone: 'quiet' })
   const stale = await store.getPreview(account, edited.id, basePreview.id, 1)
   assert.equal(stale.status, 'stale')
   assert.equal(stale.suggestedPersonality, undefined)
   assert.equal(stale.suggestedCatchphrase, undefined)
   const created = await store.createPreview(account, edited.id, 1, randomUUID(), edited.version, { worldPreferenceId: world.id, previousPreviewId: null })
   const current = await store.getPreview(account, edited.id, created.id, 1)
   const expected = ['温和', '风趣', '常先听完，再说自己的看法。', '她说话很轻', 'Uses short sentences.']
   assert.deepEqual(current.suggestedPersonality, expected)
   assert.equal(current.suggestedCatchphrase, '慢慢来；先喝茶。')
   assert.deepEqual(current.sourceRefs, [{ kind: 'draft_story', id: edited.id, version: edited.version }])
   await assert.rejects(store.confirm(account, edited.id, 1, randomUUID(), edited.version, { previewId: stale.id, worldId: world.id }, randomUUID()), { code: 'CONFLICT' })
   const key = randomUUID()
   const input = { previewId: current.id, worldId: world.id }
   const confirmed = await store.confirm(account, edited.id, 1, key, edited.version, input, randomUUID())
   assert.deepEqual(confirmed.personality, expected)
   assert.equal(confirmed.catchphrase, current.suggestedCatchphrase)
   assert.equal(confirmed.conversationTone, 'quiet')
   assert.equal(confirmed.story, source)
   assert.deepEqual(await store.getPerson(account, confirmed.id), confirmed)
   assert.deepEqual(await store.confirm(account, edited.id, 1, key, edited.version, input, randomUUID()), confirmed)
 })
 const input=personFields({personality:[' 温和 '],life:['喜欢早晨散步'],unknowns:['不确定最爱的颜色'],catchphrase:'慢慢来'}),key=randomUUID()
 const saved=await store.updatePerson(account,initial.id,key,initial.version,input,randomUUID());assert.equal(saved.story,'独立故事原文');assert.equal(saved.version,2);assert.deepEqual(saved.personality,['温和']);assert.deepEqual(saved.life,['喜欢早晨散步'])
 assert.deepEqual(await store.updatePerson(account,initial.id,key,1,input,randomUUID()),saved);await assert.rejects(store.updatePerson(account,initial.id,key,1,{life:['别的']},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(store.updatePerson(randomUUID(),initial.id,randomUUID(),2,input,randomUUID()),{code:'NOT_FOUND'})
 const current=await store.personContext(account,initial.id);assert.deepEqual(current.unknowns,['不确定最爱的颜色']);assert.equal((await store.socialAiPerson(account,initial.id)).catchphrase,'慢慢来')
 const exported=await exportPeople(pool,account,'account_data'),exportedInitial=exported.data.persons.find(person=>person.id===initial.id);assert.deepEqual(exportedInitial.life,saved.life);assert.equal(exportedInitial.story,'独立故事原文')
 for(const body of [{personality:Array(31).fill('a')},{personality:['a'.repeat(201)]},{life:Array(101).fill('a')},{life:['a'.repeat(1001)]},{unknowns:Array(31).fill('a')},{unknowns:['a'.repeat(501)]},{catchphrase:'a'.repeat(501)},{life:[null]},{life:[{}]},{life:[' ']},{life:['\ud800']}])assert.throws(()=>personFields(body),{code:'INVALID_ARGUMENT'})
 for(const sql of ["UPDATE persons SET personality=ARRAY[NULL::text] WHERE id=$1","UPDATE persons SET life=array_fill('x'::text,ARRAY[101]) WHERE id=$1","UPDATE persons SET catchphrase='  ' WHERE id=$1"])await assert.rejects(pool.query(sql,[initial.id]),{code:'23514'})
 const cleared=await store.updatePerson(account,initial.id,randomUUID(),2,personFields({personality:[],life:[],unknowns:[],catchphrase:null}),randomUUID());assert.equal(cleared.story,'独立故事原文');assert.equal(cleared.catchphrase,null)
 await erasePeople(pool,account,randomUUID());assert.equal((await pool.query('SELECT 1 FROM persons WHERE account_id=$1',[account])).rowCount,0)
})
