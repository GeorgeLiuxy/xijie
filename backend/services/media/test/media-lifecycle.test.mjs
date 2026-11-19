import { test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { fixture } from "./fixture.mjs"
import { hash } from "../dist/contracts.js"
import { createMediaApp } from "../dist/http.js"

test('purge resumes from durable per-slot progress across short leases and never restarts from removed inputs',async t=>{
 const f=await fixture(t),a=f.actor(),x=await f.ready(a),row=await f.store.row(a,x.media.id)
 for(let i=0;i<8;i++){const key='staging/'+a+'/'+randomUUID();await f.storage.put(key,f.bytes,'image/png');await f.pool.query("INSERT INTO media_upload_slots(id,account_id,media_id,staging_key,state,expires_at,ended_at) VALUES($1,$2,$3,$4,'replaced',clock_timestamp()+interval '15 minutes',clock_timestamp())",[randomUUID(),a,x.media.id,key])}
 await f.store.remove(a,x.media.id,randomUUID(),row.version);const original=f.storage.delete.bind(f.storage),seen=new Map();f.storage.delete=async key=>{await original(key);seen.set(key,(seen.get(key)??0)+1);await f.pool.query("UPDATE media_jobs SET lease_until=lease_until-interval '15 seconds' WHERE account_id=$1 AND kind='purge' AND state='running'",[a])}
 for(let i=0;i<8;i++){await f.pool.query("UPDATE media_jobs SET retry_at=clock_timestamp()-interval '1 second' WHERE kind='purge'");const job=await f.engine.claim();if(!job)break;await f.engine.run(job);if((await f.store.get(a,x.media.id)).status==='deleted')break}
 assert.equal((await f.store.get(a,x.media.id)).status,'deleted');assert.equal((await f.storage.list('staging/'+a+'/')).length,0);assert.equal((await f.storage.list('ready/'+a+'/')).length,0);assert([...seen.values()].every(n=>n===1));assert.equal((await f.pool.query("SELECT count(*)::int n FROM media_upload_slots WHERE account_id=$1 AND input_deleted_at IS NULL",[a])).rows[0].n,0)
})

test('a stale upload attempt cannot delete the shared slot after its successor accepted the exact bytes',async t=>{
 const f=await fixture(t),a=f.actor(),x=await f.allocate(a),key=randomUUID(),original=f.storage.put.bind(f.storage);let entered,release;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r);let first=true
 f.storage.put=async(...args)=>{await original(...args);if(first){first=false;entered();await held}}
 const stale=f.store.upload(a,x.media.id,x.upload.id,key,'image/png',x.input);await started
 await f.pool.query("UPDATE media_upload_slots SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[x.upload.id]);await f.store.upload(a,x.media.id,x.upload.id,key,'image/png',x.input);release()
 await assert.rejects(stale,e=>e.code==='UPLOAD_SLOT_CHANGED');const slot=(await f.pool.query('SELECT * FROM media_upload_slots WHERE id=$1',[x.upload.id])).rows[0];assert.equal(slot.state,'uploaded');assert.equal(await f.storage.head(slot.staging_key),true)
 const completeKey=randomUUID(),receipts=await Promise.all(Array.from({length:3},()=>f.store.complete(a,x.media.id,x.upload.id,completeKey)));assert.equal(new Set(receipts.map(x=>x.version)).size,1);await f.engine.run(await f.engine.claim());assert.equal((await f.store.get(a,x.media.id)).status,'ready')
})

test('account erasure waits for the accepted upload IO to settle before deleting and completing its receipt',async t=>{
 const f=await fixture(t),a=f.actor(),x=await f.allocate(a),original=f.storage.put.bind(f.storage);let entered,release;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r)
 f.storage.put=async(...args)=>{await original(...args);entered();await held};const uploading=f.store.upload(a,x.media.id,x.upload.id,randomUUID(),'image/png',x.input);await started
 const {MediaDataRights}=await import('../dist/data-rights.js'),rights=new MediaDataRights(f.store),request=f.dataRequest(a,'delete_account');await assert.rejects(rights.erase(a,request),e=>e.code==='MEDIA_CLEANUP_PENDING');assert.equal((await f.pool.query('SELECT state FROM media_erase_receipts')).rows[0].state,'preparing');release();await assert.rejects(uploading,e=>e.code==='NOT_FOUND')
 assert.equal((await rights.erase(a,request)).alreadyErased,false);assert.equal((await f.storage.list('staging/'+a+'/')).length,0);assert.equal((await f.pool.query('SELECT state FROM media_erase_receipts')).rows[0].state,'completed')
})

test("simultaneous create retries with the same request identity return one media and one upload slot", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    key = randomUUID(),
    input = {
      clientPostId: randomUUID(),
      mimeType: "image/png",
      byteSize: f.bytes.length,
      sha256: hash(f.bytes),
    }
  const results = await Promise.all(
    Array.from({ length: 4 }, () => f.store.create(a, key, input)),
  )
  assert.equal(new Set(results.map((x) => x.media.id)).size, 1)
  assert.equal(new Set(results.map((x) => x.upload.id)).size, 1)
  assert.equal(
    (await f.pool.query("SELECT count(*)::int n FROM media_objects")).rows[0].n,
    1,
  )
  assert.equal(
    (await f.pool.query("SELECT count(*)::int n FROM media_upload_slots"))
      .rows[0].n,
    1,
  )
})

test("source reconciliation rotates past fifty valid oldest images without changing their versions", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    base = await f.ready(a),
    seed = await f.store.row(a, base.media.id),
    bytes = await f.storage.get(seed.object_key),
    ids = Array.from({ length: 51 }, () => randomUUID()).sort()
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i],
      intent = randomUUID(),
      post = randomUUID(),
      key = "ready/" + a + "/" + id + "/" + randomUUID()
    await f.storage.put(key, bytes, "image/webp")
    await f.pool.query(
      "INSERT INTO media_objects(id,account_id,client_post_id,purpose,status,declared_mime,declared_bytes,input_sha256,mime_type,byte_size,sha256,width,height,object_key,account_access_version,storage_authorization_version,photo_authorization_version,verified_at) VALUES($1,$2,$3,'post_attachment','ready','image/png',$4,$5,'image/webp',$6,$7,$8,$9,$10,1,1,1,clock_timestamp())",
      [
        id,
        a,
        intent,
        f.bytes.length,
        hash(f.bytes),
        bytes.length,
        hash(bytes),
        seed.width,
        seed.height,
        key,
      ],
    )
    await f.pool.query(
      "INSERT INTO media_use_grants(account_id,media_id,client_post_id,post_id,position,media_version,confirmed_at) VALUES($1,$2,$3,$4,1,1,clock_timestamp())",
      [a, id, intent, post],
    )
    if (i < 50) f.commit(a, post, [{ id, version: 1 }])
  }
  await f.pool.query(
    "UPDATE media_objects SET last_source_checked_at=clock_timestamp() WHERE id=$1",
    [base.media.id],
  )
  await f.engine.reconcile()
  assert.equal((await f.store.get(a, ids[50])).status, "ready")
  await f.engine.reconcile()
  assert.equal((await f.store.get(a, ids[50])).status, "revoked")
  for (const id of ids.slice(0, 50))
    assert.equal((await f.store.get(a, id)).version, 1)
})

test("temporary input deletion retries durably while the completed image remains readable", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    original = f.storage.delete.bind(f.storage)
  let fail = true
  f.storage.delete = async (key) => {
    if (fail && key.startsWith("staging/")) {
      fail = false
      throw Error("Synthetic temporary delete outage")
    }
    return original(key)
  }
  const x = await f.ready(a),
    slot = (
      await f.pool.query("SELECT * FROM media_upload_slots WHERE media_id=$1", [
        x.media.id,
      ])
    ).rows[0]
  assert.equal(await f.storage.head(slot.staging_key), true)
  assert.equal(slot.input_deleted_at, null)
  const post = randomUUID(),
    bound = await f.store.bind(a, post, x.intent, [x.media.id])
  f.commit(a, post, bound.media)
  const proof = await f.store.readUrl(f.session(a), x.media.id, post)
  assert(
    (await f.store.content(f.session(a), x.media.id, proof.readProof)).length >
      0,
  )
  await f.engine.reconcile()
  assert.equal(await f.storage.head(slot.staging_key), false)
  assert(
    (
      await f.pool.query(
        "SELECT input_deleted_at FROM media_upload_slots WHERE id=$1",
        [slot.id],
      )
    ).rows[0].input_deleted_at,
  )
  assert.equal((await f.store.get(a, x.media.id)).status, "ready")
})

test("purge survives more than five failed storage attempts and completes once storage recovers", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    x = await f.ready(a),
    r = await f.store.row(a, x.media.id)
  await f.store.remove(a, x.media.id, randomUUID(), r.version)
  const original = f.storage.delete.bind(f.storage)
  let failures = 6
  f.storage.delete = async (key) => {
    if (failures-- > 0) throw Error("Synthetic object delete outage")
    return original(key)
  }
  for (let i = 0; i < 7; i++) {
    await f.pool.query(
      "UPDATE media_jobs SET retry_at=clock_timestamp()-interval '1 second' WHERE kind='purge'",
    )
    const job = await f.engine.claim()
    assert(job)
    await f.engine.run(job)
  }
  assert.equal((await f.store.get(a, x.media.id)).status, "deleted")
  const job = (
    await f.pool.query(
      "SELECT attempt_count,state FROM media_jobs WHERE kind='purge'",
    )
  ).rows[0]
  assert.equal(job.attempt_count, 7)
  assert.equal(job.state, "succeeded")
  assert.equal(await f.storage.head(r.object_key), false)
})

test("real Nest routes preserve JSON, binary upload, session/origin/role checks and immediate source revocation", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    app = await createMediaApp(f.config, f.store)
  await app.listen(0, "127.0.0.1")
  t.after(() => app.close())
  const origin = "http://127.0.0.1:" + app.getHttpServer().address().port,
    headers = {
      Cookie: "test=" + a,
      Origin: f.config.webOrigin,
      "X-Xijie-Expected-Session": a,
      "Idempotency-Key": randomUUID(),
      "Content-Type": "application/json",
    },
    input = {
      purpose: "post_attachment",
      target: { kind: "post_intent", id: randomUUID() },
      mimeType: "image/png",
      byteSize: f.bytes.length,
      sha256: hash(f.bytes),
    }
  let response = await fetch(origin + "/v1/media", {
    method: "POST",
    headers: { ...headers, Origin: "https://not-allowed.example" },
    body: JSON.stringify(input),
  })
  assert.equal(response.status, 403)
  response = await fetch(origin + "/v1/media", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  })
  assert.equal(response.status, 201)
  const x = (await response.json()).data
  assert.deepEqual(x.upload.requiredHeaders, { "Content-Type": "image/png" })
  response = await fetch(origin + x.upload.url, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "image/png",
      "Idempotency-Key": randomUUID(),
    },
    body: f.bytes,
  })
  assert.equal(response.status, 200)
  response = await fetch(origin + "/v1/media/" + x.media.id + "/complete", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ uploadSlotId: x.upload.id }),
  })
  assert.equal(response.status, 202)
  assert.equal((await response.json()).data.status, "verifying")
  await f.engine.run(await f.engine.claim())
  const post = randomUUID(),
    bindingPath =
      origin + "/internal/v1/social/posts/" + post + "/media-bindings",
    body = { clientPostId: input.target.id, mediaIds: [x.media.id] }
  response = await fetch(bindingPath, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + f.config.serviceToken,
      "Content-Type": "application/json",
      "X-Xijie-Account-Id": a,
    },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 403)
  response = await fetch(bindingPath, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + f.config.socialToken,
      "Content-Type": "application/json",
      "X-Xijie-Account-Id": a,
    },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 200)
  const bound = (await response.json()).data
  f.commit(a, post, bound.media)
  response = await fetch(origin + "/v1/media/" + x.media.id + "/read-url", {
    method: "POST",
    headers,
    body: JSON.stringify({
      purpose: "post_attachment",
      target: { kind: "post", id: post },
    }),
  })
  assert.equal(response.status, 200)
  const grant = (await response.json()).data
  response = await fetch(origin + grant.url, {
    headers: {
      Cookie: "test=" + a,
      "X-Xijie-Expected-Session": a,
      "X-Media-Read-Proof": grant.readProof,
    },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(response.headers.get("Content-Type"), "image/webp")
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff")
  assert((await response.arrayBuffer()).byteLength > 0)
  f.sources.get(a).clear()
  response = await fetch(origin + grant.url, {
    headers: {
      Cookie: "test=" + a,
      "X-Xijie-Expected-Session": a,
      "X-Media-Read-Proof": grant.readProof,
    },
  })
  assert.equal(response.status, 404)
})
