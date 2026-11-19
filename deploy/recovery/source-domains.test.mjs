import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateSourceDomains} from './recovery.mjs'
test('recovery accepts exact legacy five through seven and current eight domains without inventing missing services',()=>{
 const old=['identity','people','conversations','memories','logto'],six=[...old,'social'],current=[...six,'media']
 assert.deepEqual(validateSourceDomains(old),old.sort())
 assert.deepEqual(validateSourceDomains(six),six.sort())
 assert.deepEqual(validateSourceDomains(current),current.sort())
 assert.deepEqual(validateSourceDomains([...current,'gifts']),[...current,'gifts'].sort())
 for(const invalid of [old.slice(0,4),[...old,'people'],[...old,'media'],[...current,'unknown'],['social'],[],[...old,undefined]])assert.throws(()=>validateSourceDomains(invalid),/database set mismatch/)
})
