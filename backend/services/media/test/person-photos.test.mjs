import { test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { fixture } from "./fixture.mjs"
import { hash } from "../dist/contracts.js"
import { MediaDataRights } from "../dist/data-rights.js"
import { createMediaApp } from "../dist/http.js"

test("an obsolete source sweep cannot revoke a concurrent renewed binding", async (t) => {
  const f = await fixture(t), a = f.actor(), x = await personPhoto(f, a)
  await f.store.bindPerson(a, x.draftId, [x.media.id])
  await f.pool.query("UPDATE media_person_grants SET created_at=clock_timestamp()-interval '17 minutes',last_bound_at=clock_timestamp()-interval '16 minutes' WHERE account_id=$1", [a])
  const original = f.store.dependencies.validPersonPhotos.bind(f.store.dependencies)
  let arrived, resume
  const queried = new Promise(resolve => { arrived = resolve }), held = new Promise(resolve => { resume = resolve })
  f.store.dependencies.validPersonPhotos = async (...args) => { const result = await original(...args); arrived(); await held; return result }
  const sweep = f.engine.reconcile()
  await queried
  const fresh = await f.store.bindPerson(a, x.draftId, [x.media.id])
  commit(f, a, x.draftId, fresh.media)
  resume(); await sweep
  f.store.dependencies.validPersonPhotos = original
  assert.equal((await f.store.get(a, x.media.id)).status, "ready")
  const proof = await f.store.readUrl(f.session(a), x.media.id, x.draftId, "person_photo")
  assert((await f.store.content(f.session(a), x.media.id, proof.readProof)).length > 0)
})

async function personPhoto(
  f,
  account,
  draftId = randomUUID(),
  complete = true,
) {
  f.personTargets.get(account).add(draftId)
  const input = {
    purpose: "person_photo",
    draftId,
    mimeType: "image/png",
    byteSize: f.bytes.length,
    sha256: hash(f.bytes),
  }
  const key = randomUUID(),
    x = await f.store.create(account, key, input)
  assert.equal((await f.store.create(account, key, input)).media.id, x.media.id)
  await f.store.upload(
    account,
    x.media.id,
    x.upload.id,
    randomUUID(),
    "image/png",
    f.bytes,
  )
  if (complete) {
    await f.store.complete(account, x.media.id, x.upload.id, randomUUID())
    await f.engine.run(await f.engine.claim())
  }
  return { ...x, media: await f.store.get(account, x.media.id), draftId }
}
const commit = (f, a, draft, media) => {
  f.personSources.get(a).clear()
  for (const m of media)
    f.personSources.get(a).add(`${draft}:${m.id}:${m.version}`)
}

test("person purpose has independent consent, draft ownership, post isolation and real HTTP routes", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    b = f.actor(),
    draft = randomUUID()
  f.accounts.get(a).photoStorage.allowed = false
  f.accounts.get(a).storyStorage.privateFeedAllowed = false
  const x = await personPhoto(f, a, draft)
  assert.equal(x.media.status, "ready")
  await assert.rejects(
    f.store.bindPerson(b, draft, [x.media.id]),
    (e) => e.code === "NOT_FOUND",
  )
  await assert.rejects(
    f.store.bind(a, randomUUID(), draft, [x.media.id]),
    (e) => e.code === "STORAGE_PERMISSION_REQUIRED",
  )
  f.accounts.get(a).storyStorage.privateFeedAllowed = true
  f.accounts.get(a).photoStorage.allowed = true
  await assert.rejects(
    f.store.bind(a, randomUUID(), draft, [x.media.id]),
    (e) => e.code === "MEDIA_NOT_READY",
  )
  const postPhoto = await f.ready(a)
  await assert.rejects(
    f.store.bindPerson(a, draft, [postPhoto.media.id]),
    (e) => e.code === "MEDIA_NOT_READY",
  )
  await assert.rejects(
    f.store.readUrl(f.session(a), x.media.id, draft, "person_photo"),
    (e) => e.code === "NOT_FOUND",
  )
  const bind = await f.store.bindPerson(a, draft, [x.media.id])
  assert(
    Date.parse(bind.expiresAt) > Date.now() &&
      Date.parse(bind.expiresAt) <= Date.now() + 61000,
  )
  commit(f, a, draft, bind.media)
  const app = await createMediaApp(
    { ...f.config, peopleToken: "c".repeat(64) },
    f.store,
  )
  await app.listen(0, "127.0.0.1")
  t.after(() => app.close())
  const origin = "http://127.0.0.1:" + app.getHttpServer().address().port
  const headers = {
    Cookie: "test=" + a,
    Origin: f.config.webOrigin,
    "X-Xijie-Expected-Session": a,
    "Content-Type": "application/json",
  }
  const response = await fetch(
    origin + "/v1/media/" + x.media.id + "/read-url",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        purpose: "person_photo",
        target: { kind: "person_draft", id: draft },
      }),
    },
  )
  assert.equal(response.status, 200)
  const proof = (await response.json()).data
  assert(
    (await f.store.content(f.session(a), x.media.id, proof.readProof)).length >
      0,
  )
  await assert.rejects(
    f.store.content(f.session(b), x.media.id, proof.readProof),
    (e) => e.code === "NOT_FOUND",
  )
  await assert.rejects(
    f.store.content(
      { ...f.session(a), sessionId: randomUUID() },
      x.media.id,
      proof.readProof,
    ),
    (e) => e.code === "NOT_FOUND",
  )
  await assert.rejects(
    f.store.remove(a, x.media.id, randomUUID(), x.media.version),
    (e) => e.code === "MEDIA_IN_USE",
  )
  f.accounts.get(a).personPhotoStorage = {
    allowed: false,
    authorizationVersion: 2,
  }
  await assert.rejects(
    f.store.content(f.session(a), x.media.id, proof.readProof),
    (e) => e.code === "PERSON_PHOTO_STORAGE_PERMISSION_REQUIRED",
  )
  assert.equal(f.accounts.get(a).photoStorage.allowed, true)
  f.accounts.get(a).personPhotoStorage = {
    allowed: true,
    authorizationVersion: 3,
  }
  await assert.rejects(
    f.store.content(f.session(a), x.media.id, proof.readProof),
    (e) => e.code === "NOT_FOUND",
  )
  const newProof = await f.store.readUrl(
    f.session(a),
    x.media.id,
    draft,
    "person_photo",
  )
  assert(
    (await f.store.content(f.session(a), x.media.id, newProof.readProof))
      .length > 0,
  )
})

test("additive prebind does not revoke current photos; replacement invalidates old proofs and safely cleans source-invalid objects", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    x = await personPhoto(f, a),
    y = await personPhoto(f, a, x.draftId)
  const initial = await f.store.bindPerson(a, x.draftId, [x.media.id])
  commit(f, a, x.draftId, initial.media)
  const proof = await f.store.readUrl(
    f.session(a),
    x.media.id,
    x.draftId,
    "person_photo",
  )
  const replacement = await f.store.bindPerson(a, x.draftId, [y.media.id])
  await f.engine.reconcile()
  assert(
    (await f.store.content(f.session(a), x.media.id, proof.readProof)).length >
      0,
  )
  commit(f, a, x.draftId, replacement.media)
  await assert.rejects(
    f.store.content(f.session(a), x.media.id, proof.readProof),
    (e) => e.code === "NOT_FOUND",
  )
  await f.pool.query(
    "UPDATE media_person_grants SET created_at=clock_timestamp()-interval '17 minutes',last_bound_at=clock_timestamp()-interval '16 minutes' WHERE account_id=$1",
    [a],
  )
  await f.engine.reconcile()
  assert.equal((await f.store.get(a, x.media.id)).status, "revoked")
  assert.equal((await f.store.get(a, y.media.id)).status, "ready")
  await f.engine.run(await f.engine.claim())
  assert.equal(
    (await f.storage.list("ready/" + a + "/" + x.media.id + "/")).length,
    0,
  )
  assert.equal(
    (await f.storage.list("ready/" + a + "/" + y.media.id + "/")).length,
    1,
  )
  f.personSources.get(a).clear()
  f.personTargets.get(a).clear()
  await f.engine.reconcile()
  await f.engine.run(await f.engine.claim())
  assert.equal((await f.storage.list("ready/" + a + "/")).length, 0)
})

test("person photo byte export survives consent withdrawal, omits removed refs and erasure removes both purpose domains", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    x = await personPhoto(f, a),
    y = await personPhoto(f, a, x.draftId)
  const bind = await f.store.bindPerson(a, x.draftId, [y.media.id, x.media.id])
  commit(f, a, x.draftId, bind.media)
  const rights = new MediaDataRights(f.store),
    request = f.dataRequest(a)
  f.accounts.get(a).personPhotoStorage = {
    allowed: false,
    authorizationVersion: 2,
  }
  const exported = await rights.export(a, request, "account_data")
  assert.equal(exported.data.media.length, 2)
  assert.equal(exported.data.personBindings.length, 2)
  for (const m of exported.data.media) {
    assert.equal(hash(Buffer.from(m.bytesBase64, "base64")), m.sha256)
    assert.equal(m.draftId, x.draftId)
    assert.equal(m.purpose, "person_photo")
  }
  commit(f, a, x.draftId, bind.media.slice(0, 1))
  assert.equal(
    (await rights.export(a, request, "account_data")).data.media.length,
    1,
  )
  await rights.erase(a, f.dataRequest(a, "delete_account"))
  for (const table of [
    "media_objects",
    "media_person_grants",
    "media_upload_slots",
    "media_jobs",
    "media_commands",
  ])
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM " + table + " WHERE account_id=$1",
          [a],
        )
      ).rows[0].n,
      0,
    )
  assert.equal((await f.storage.list("ready/" + a + "/")).length, 0)
  assert.equal((await f.storage.list("staging/" + a + "/")).length, 0)
})

test("revoked or removed-target in-flight person photos cannot finish after regrant or source removal", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    x = await personPhoto(f, a, randomUUID(), false)
  f.accounts.get(a).personPhotoStorage = {
    allowed: true,
    authorizationVersion: 3,
  }
  await assert.rejects(
    f.store.complete(a, x.media.id, x.upload.id, randomUUID()),
    (e) => e.code === "AUTHORIZATION_CHANGED",
  )
  const y = await personPhoto(f, a, randomUUID(), false)
  await f.store.complete(a, y.media.id, y.upload.id, randomUUID())
  f.personTargets.get(a).delete(y.draftId)
  await f.engine.run(await f.engine.claim())
  assert.equal((await f.store.get(a, y.media.id)).status, "rejected")
  assert.equal(
    (await f.storage.list("ready/" + a + "/" + y.media.id + "/")).length,
    0,
  )
})
