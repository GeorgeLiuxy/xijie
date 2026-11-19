import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readReferralsConfig} from '../services/identity/dist/referrals-config.js'
import {albumConfig} from '../services/social/dist/albums-config.js'
test('growth production release requires independent explicit switches and HTTPS origins',()=>{
 const names=['NODE_ENV','REFERRALS_ENABLED','REFERRALS_PRODUCTION_APPROVED','REFERRALS_TOKEN_KEY','REFERRALS_PUBLIC_ORIGIN','SHARED_ALBUMS_ENABLED','SHARED_ALBUMS_PRODUCTION_APPROVED','SHARED_ALBUMS_TOKEN_KEY','XIJIE_MEMORIES_SERVICE_TOKEN','XIJIE_MEMORIES_URL','XIJIE_GIFTS_URL'],old=Object.fromEntries(names.map(k=>[k,process.env[k]]))
 try{
  Object.assign(process.env,{NODE_ENV:'production',REFERRALS_ENABLED:'true',REFERRALS_TOKEN_KEY:'1'.repeat(64),REFERRALS_PUBLIC_ORIGIN:'https://app.example.test',SHARED_ALBUMS_ENABLED:'true',SHARED_ALBUMS_TOKEN_KEY:'2'.repeat(64),XIJIE_MEMORIES_SERVICE_TOKEN:'3'.repeat(64),XIJIE_MEMORIES_URL:'https://memories.example.test',XIJIE_GIFTS_URL:'https://gifts.example.test'})
  delete process.env.REFERRALS_PRODUCTION_APPROVED;delete process.env.SHARED_ALBUMS_PRODUCTION_APPROVED
  assert.throws(()=>readReferralsConfig('https://app.example.test'),/PRODUCTION_APPROVED/);assert.throws(()=>albumConfig('https://app.example.test'),/PRODUCTION_APPROVED/)
  process.env.REFERRALS_PRODUCTION_APPROVED='true';process.env.SHARED_ALBUMS_PRODUCTION_APPROVED='true'
  assert.equal(readReferralsConfig('https://app.example.test').enabled,true);assert.equal(albumConfig('https://app.example.test').enabled,true)
  process.env.REFERRALS_PUBLIC_ORIGIN='http://127.0.0.1';assert.throws(()=>readReferralsConfig('https://app.example.test'),/ORIGIN/)
  assert.throws(()=>albumConfig('http://127.0.0.1'),/HTTPS/);process.env.XIJIE_GIFTS_URL='http://127.0.0.1';assert.throws(()=>albumConfig('https://app.example.test'),/origin/)
 }finally{for(const[k,v]of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v}
})
