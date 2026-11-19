import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {verifyReferralFacts,validateReferralReferences} from './referrals.mjs'
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const t0='2026-11-15T00:00:00.000Z',t1='2026-11-15T00:01:00.000Z',t2='2026-11-15T00:02:00.000Z',t3='2026-11-15T00:03:00.000Z',t4='2026-11-15T00:04:00.000Z',t5='2026-11-15T00:05:00.000Z'
const names=['referral_links','referral_commands','referral_join_intents','referral_auth_bindings','referral_attributions','referral_reward_receipts']
function fixture(){return{
 accounts:[{id:'host',registration_id:'host-registration',status:'active',registered_at:t0},{id:'guest',registration_id:'guest-registration-not-attempt-or-event',status:'active',registered_at:t3}],
 links:[{id:'link',account_id:'host',campaign:'first-memory-v1',version:1,created_at:t1,rules_accepted_at:t1,revoked_at:null,public_name_valid:true,token_shape_valid:true}],
 commands:[{account_id:'host',operation:'create',idempotency_key:'create-key',link_id:'link',created_at:t1,fingerprint_valid:true}],
 intents:[{id:'intent',link_id:'link',campaign:'first-memory-v1',created_at:t2,expires_at:'2026-11-16T00:02:00.000Z',rules_accepted_at:t2,closed_at:t3,consumed_account_id:'guest',consumed_at:t3,browser_binding_valid:true}],
 bindings:[{attempt_id:'auth-attempt',intent_id:'intent',attempt_exists:true,same_browser:true,purpose:'sign_in',state:'completed',created_at:t2}],
 attributions:[{id:'attribution',link_id:'link',intent_id:'intent',inviter_account_id:'host',invitee_account_id:'guest',registration_id:'guest-registration-not-attempt-or-event',campaign:'first-memory-v1',registered_at:t3,state:'awaiting_memory',receipt_id:null,qualified_at:null,rewarded_at:null}],
 receipts:[],registrations:[{event_id:'registration-event',account_id:'guest',aggregate_type:'account',aggregate_id:'guest',aggregate_version:1,schema_version:1,occurred_at:t3,payload_account_id:'guest',registered_at:t3,referral_attribution_id:'attribution'}],awards:[],giftReceipts:[],milestones:[]
}}
function granted(acked=true){const f=fixture(),p={id:'attribution',campaign:'first-memory-v1',inviterAccountId:'host',inviteeAccountId:'guest',registeredAt:t3},q={eventId:'memory-confirmation-event',confirmedAt:t4,confirmedSeq:'9007199254740993',origin:'manual'}
 f.awards=[{id:'award',referral_id:p.id,campaign:p.campaign,inviter_account_id:'host',invitee_account_id:'guest',inviter_access_version:1,invitee_access_version:1,registered_at:t3,qualification_event_id:q.eventId,qualified_at:t4,confirmed_seq:q.confirmedSeq,qualification_origin:q.origin,request_hash:digest({referral:p,qualification:q}),created_at:t4}]
 f.giftReceipts=[{account_id:'host',referral_id:p.id,receipt_id:'award',role:'host',qualified_at:t4},{account_id:'guest',referral_id:p.id,receipt_id:'award',role:'guest',qualified_at:t4}]
 f.milestones=[{event_id:q.eventId,account_id:'guest',confirmed_at:t4,confirmed_seq:q.confirmedSeq,origin:q.origin,qualifies:true}]
 if(acked){Object.assign(f.attributions[0],{state:'rewarded',receipt_id:'award',qualified_at:t4,rewarded_at:t5});f.receipts=[{account_id:'host',attribution_id:p.id,receipt_id:'award',role:'inviter',qualified_at:t4,rewarded_at:t5},{account_id:'guest',attribution_id:p.id,receipt_id:'award',role:'invitee',qualified_at:t4,rewarded_at:t5}]}
 return f
}

test('registration proof uses the account registration identity, original intent and authoritative event, not attempt or event IDs',()=>{
 assert.equal(verifyReferralFacts(fixture()).attributionCount,1)
 for(const change of [f=>f.attributions[0].registration_id='auth-attempt',f=>f.attributions[0].registration_id='registration-event',f=>f.attributions[0].inviter_account_id='guest',f=>f.attributions[0].registered_at=t2,f=>f.registrations[0].referral_attribution_id='other',f=>f.registrations[0].payload_account_id='host',f=>f.registrations=[],f=>f.intents[0].consumed_account_id='host',f=>f.intents[0].expires_at=t3,f=>f.bindings[0].same_browser=false,f=>f.bindings[0].purpose='switch',f=>f.commands[0].fingerprint_valid=false]){const f=fixture();change(f);assert.throws(()=>verifyReferralFacts(f),/differs/)}
})

test('pre-quarantine and closed operational state preserve the same accepted attribution and reward facts',()=>{
 const f=granted(),before=verifyReferralFacts(f);for(const a of f.accounts)a.status='restricted';Object.assign(f.links[0],{version:2,revoked_at:t5});f.bindings=[]
 const after=verifyReferralFacts(f);assert.equal(after.rewardedAttributionCount,before.rewardedAttributionCount);assert.equal(after.identityReceiptCount,2);assert.equal(after.bindingCount,0)
 const unused={...f.intents[0],id:'unused',created_at:t2,consumed_account_id:null,consumed_at:null,closed_at:t5};f.intents.push(unused);assert.equal(verifyReferralFacts(f).intentCount,2)
 f.intents=f.intents.filter(r=>r.id!=='intent');assert.throws(()=>verifyReferralFacts(f),/differs/)
})

test('lost reward acknowledgement is valid but fake rewarded state, missing party or later milestone is rejected',()=>{
 assert.equal(verifyReferralFacts(granted(false)).giftAwardCount,1);assert.equal(verifyReferralFacts(granted()).identityReceiptCount,2)
 for(const change of [f=>f.awards=[],f=>f.giftReceipts.pop(),f=>f.receipts.pop(),f=>f.receipts[0].receipt_id='other',f=>f.awards[0].request_hash='bad',f=>f.milestones[0].origin='shared_contribution',f=>f.milestones[0].account_id='host',f=>f.milestones.push({event_id:'earlier',account_id:'guest',confirmed_at:t3,confirmed_seq:'1',origin:'manual',qualifies:true}),f=>f.awards[0].confirmed_seq='9007199254740992']){const f=granted();change(f);assert.throws(()=>verifyReferralFacts(f),/differs/)}
})

test('one surviving private receipt remains valid after counterparty erasure without reconstructing erased identities',()=>{
 const f=granted();f.attributions=[];f.intents=[];f.links=[];f.commands=[];f.bindings=[];f.awards=[];f.receipts=f.receipts.filter(r=>r.account_id==='guest');f.giftReceipts=f.giftReceipts.filter(r=>r.account_id==='guest');f.accounts[0].status='deleted'
 const result=verifyReferralFacts(f);assert.equal(result.survivingPrivateReceiptCount,1);assert(!JSON.stringify(result).includes('host'))
 f.giftReceipts=[];assert.throws(()=>verifyReferralFacts(f),/differs/)
 const both=granted();both.attributions=[];both.intents=[];both.awards=[];both.bindings=[];assert.throws(()=>verifyReferralFacts(both),/differs/)
})

function runtime(f,{schema=names,giftsSchema=['referral_reward_awards','referral_reward_receipts']}={}){const seen=[];return{seen,async query(target,sql){seen.push({domain:target.domain,sql});if(sql.includes('information_schema'))return(target.domain==='identity'?schema:giftsSchema).map(table_name=>({table_name}));if(target.domain==='gifts')return sql.includes('referral_reward_awards')?f.awards:f.giftReceipts;if(target.domain==='memories')return f.milestones;if(sql.includes('public.referral_commands'))return f.commands;if(sql.includes('public.referral_auth_bindings'))return f.bindings;if(sql.includes('public.referral_links'))return f.links;if(sql.includes('public.referral_join_intents'))return f.intents;if(sql.includes('public.referral_attributions'))return f.attributions;if(sql.includes('public.referral_reward_receipts'))return f.receipts;if(sql.includes('public.outbox_events'))return f.registrations;if(sql.includes('public.accounts'))return f.accounts;throw Error('Unexpected synthetic read')}}}

test('metadata adapter validates all domains without fetching token, public name, browser hash or original memory text',async()=>{
 const f=granted(),r=runtime(f),result=await validateReferralReferences(r,[{domain:'identity'},{domain:'gifts'},{domain:'memories'}]);assert.equal(result.verified,true)
 for(const {sql}of r.seen){assert(!/SELECT\s+\*/i.test(sql));assert(!/payload\s+FROM/i.test(sql));assert(!/SELECT[^;]*\bbody\b/i.test(sql))}
 const links=r.seen.find(x=>x.sql.startsWith('SELECT id,account_id,campaign')).sql;assert(links.includes('AS public_name_valid'));assert(links.includes('AS token_shape_valid'))
 const commands=r.seen.find(x=>x.sql.includes('FROM public.referral_commands')).sql;assert(commands.includes('sha256(convert_to('));assert(commands.includes('AS fingerprint_valid'))
 const gift=r.seen.find(x=>x.domain==='gifts'&&x.sql.includes('confirmed_seq')).sql;assert(gift.includes('confirmed_seq::text'))
 assert(Object.values(result).every(v=>['boolean','number'].includes(typeof v)))
})

test('legacy absence is explicit; partial six-table schema and missing earned-benefit dependencies fail closed',async()=>{
 assert.equal((await validateReferralReferences({},[])).reason,'legacy_without_identity')
 assert.equal((await validateReferralReferences(runtime(fixture(),{schema:[]}),[{domain:'identity'}])).reason,'legacy_without_referrals')
 await assert.rejects(validateReferralReferences(runtime(fixture(),{schema:names.slice(0,5)}),[{domain:'identity'}]),/differs/)
 assert.equal((await validateReferralReferences(runtime(fixture()),[{domain:'identity'}])).verified,true)
 await assert.rejects(validateReferralReferences(runtime(granted()),[{domain:'identity'}]),/differs/)
 await assert.rejects(validateReferralReferences(runtime(granted()),[{domain:'identity'},{domain:'gifts'}]),/differs/)
 await assert.rejects(validateReferralReferences(runtime(granted(),{giftsSchema:['referral_reward_awards']}),[{domain:'identity'},{domain:'gifts'},{domain:'memories'}]),/differs/)
})
