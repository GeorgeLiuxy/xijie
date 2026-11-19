import { test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { fixture } from "./fixture.mjs"
import { hash } from "../dist/contracts.js"
import { MediaDataRights } from "../dist/data-rights.js"
import { createMediaApp } from "../dist/http.js"
const code = (value, ...codes) => value && codes.includes(value.code)

test("real S3 staging and actual Sharp verify rotate and strip metadata into an immutable private WebP", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    x = await f.ready(a),
    row = await f.store.row(a, x.media.id),
    bytes = await f.storage.get(row.object_key),
    meta = await sharp(bytes).metadata()
  assert.equal(x.media.mimeType, "image/webp")
  assert.equal(x.media.width, 5)
  assert.equal(x.media.height, 8)
  assert.equal(meta.format, "webp")
  assert.equal(meta.exif, undefined)
  assert.equal(meta.orientation, undefined)
  assert.equal(hash(bytes), row.sha256)
  assert(bytes.length <= 1048576)
  assert(!("object_key" in x.media))
  assert(!("input_sha256" in x.media))
  assert.equal(
    await f.storage.head(
      (
        await f.pool.query(
          "SELECT staging_key FROM media_upload_slots WHERE account_id=$1",
          [a],
        )
      ).rows[0].staging_key,
    ),
    false,
  )
})

test("upload declarations, slot replacement and exact intent retries cannot replace a verified image", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    x = await f.allocate(a),
    old = x.upload.id
  await assert.rejects(
    f.store.upload(
      a,
      x.media.id,
      old,
      randomUUID(),
      "image/png",
      Buffer.from("bad"),
    ),
    (e) => code(e, "MEDIA_UPLOAD_MISMATCH"),
  )
  const next = await f.store.newSlot(
    a,
    x.media.id,
    randomUUID(),
    x.media.version,
  )
  await assert.rejects(
    f.store.upload(a, x.media.id, old, randomUUID(), "image/png", x.input),
    (e) => code(e, "UPLOAD_SLOT_CHANGED"),
  )
  const uploadKey = randomUUID()
  await f.store.upload(
    a,
    x.media.id,
    next.upload.id,
    uploadKey,
    "image/png",
    x.input,
  )
  await f.store.upload(
    a,
    x.media.id,
    next.upload.id,
    uploadKey,
    "image/png",
    x.input,
  )
  const key = randomUUID()
  const first = await f.store.complete(a, x.media.id, next.upload.id, key),
    again = await f.store.complete(a, x.media.id, next.upload.id, key)
  assert.equal(first.version, again.version)
  assert.equal(
    (await f.pool.query("SELECT count(*)::int n FROM media_jobs")).rows[0].n,
    1,
  )
  await f.engine.run(await f.engine.claim())
  assert.equal((await f.store.get(a, x.media.id)).status, "ready")
  await assert.rejects(
    f.store.upload(
      a,
      x.media.id,
      next.upload.id,
      uploadKey,
      "image/png",
      x.input,
    ),
    (e) => code(e, "UPLOAD_SLOT_CHANGED"),
  )
  await assert.rejects(
    f.store.newSlot(a, x.media.id, randomUUID(), first.version),
    (e) => code(e, "VERSION_CONFLICT", "MEDIA_STATE_CHANGED"),
  )
})

test("ordered nine-photo binding is atomic, prebinding alone is unreadable and same post retry is idempotent", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    b = f.actor(),
    intent = randomUUID(),
    images = []
  for (let i = 0; i < 9; i++) images.push(await f.ready(a, intent))
  const other = await f.ready(b),
    post = randomUUID(),
    ids = images.map((x) => x.media.id)
  await assert.rejects(
    f.store.bind(a, post, intent, [ids[0], other.media.id]),
    (e) => code(e, "NOT_FOUND"),
  )
  assert.equal(
    (await f.pool.query("SELECT count(*)::int n FROM media_use_grants")).rows[0]
      .n,
    0,
  )
  const bound = await f.store.bind(a, post, intent, ids)
  assert.deepEqual(
    bound.media.map((x) => x.id),
    ids,
  )
  assert.deepEqual(
    (
      await f.pool.query(
        "SELECT position FROM media_use_grants WHERE account_id=$1 ORDER BY position",
        [a],
      )
    ).rows.map((x) => x.position),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  )
  assert.deepEqual(await f.store.bind(a, post, intent, ids), bound)
  await assert.rejects(f.store.readUrl(f.session(a), ids[0], post), (e) =>
    code(e, "NOT_FOUND"),
  )
  f.commit(a, post, bound.media)
  const proof = await f.store.readUrl(f.session(a), ids[0], post)
  assert.equal(proof.mode, "authorized_stream")
  assert.equal(proof.url, "/v1/media/" + ids[0] + "/content")
  assert.equal(
    hash(await f.store.content(f.session(a), ids[0], proof.readProof)),
    (await f.store.row(a, ids[0])).sha256,
  )
  await assert.rejects(
    f.store.content(f.session(b), ids[0], proof.readProof),
    (e) => code(e, "NOT_FOUND"),
  )
  f.sources.get(a).clear()
  await assert.rejects(
    f.store.content(f.session(a), ids[0], proof.readProof),
    (e) => code(e, "NOT_FOUND"),
  )
  await f.store.release(a, post)
  for (let i = 0; i < 12; i++) {
    const job = await f.engine.claim()
    if (!job) break
    await f.engine.run(job)
  }
  assert.equal((await f.store.get(a, ids[0])).status, "deleted")
  assert.equal((await f.storage.list("ready/" + a + "/")).length, 0)
})

test("photo withdrawal rejects reads and work, explicit regrant reopens ready originals without reviving old slots or tasks", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    x = await f.ready(a),
    post = randomUUID(),
    binding = await f.store.bind(a, post, x.intent, [x.media.id])
  f.commit(a, post, binding.media)
  const proof = await f.store.readUrl(f.session(a), x.media.id, post),
    pending = await f.allocate(a)
  await f.store.upload(
    a,
    pending.media.id,
    pending.upload.id,
    randomUUID(),
    "image/png",
    pending.input,
  )
  await f.store.complete(a, pending.media.id, pending.upload.id, randomUUID())
  const stale = await f.engine.claim()
  f.accounts.get(a).photoStorage = { allowed: false, authorizationVersion: 2 }
  await assert.rejects(
    f.store.content(f.session(a), x.media.id, proof.readProof),
    (e) => code(e, "PHOTO_STORAGE_PERMISSION_REQUIRED"),
  )
  f.accounts.get(a).photoStorage = { allowed: true, authorizationVersion: 3 }
  const fresh = await f.store.readUrl(f.session(a), x.media.id, post)
  assert.equal(
    hash(await f.store.content(f.session(a), x.media.id, fresh.readProof)),
    (await f.store.row(a, x.media.id)).sha256,
  )
  await assert.rejects(
    f.store.content(f.session(a), x.media.id, proof.readProof),
    (e) => code(e, "NOT_FOUND"),
  )
  await f.engine.run(stale)
  assert.equal((await f.store.get(a, pending.media.id)).status, "rejected")
  assert.equal(
    (await f.storage.list("ready/" + a + "/" + pending.media.id + "/")).length,
    0,
  )
  const allocated = await f.allocate(a)
  f.accounts.get(a).photoStorage.authorizationVersion = 4
  await assert.rejects(
    f.store.upload(
      a,
      allocated.media.id,
      allocated.upload.id,
      randomUUID(),
      "image/png",
      allocated.input,
    ),
    (e) => code(e, "AUTHORIZATION_CHANGED"),
  )
})

test("independent data-rights export contains real canonical bytes under revoked photo permission and omits deleted source photos", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    x = await f.ready(a),
    post = randomUUID(),
    binding = await f.store.bind(a, post, x.intent, [x.media.id])
  f.commit(a, post, binding.media)
  f.accounts.get(a).photoStorage = { allowed: false, authorizationVersion: 2 }
  const rights = new MediaDataRights(f.store),
    request = f.dataRequest(a),
    snapshot = await rights.export(a, request, "account_data")
  assert.equal(snapshot.domain, "media")
  assert.equal(snapshot.data.media.length, 1)
  assert.equal(snapshot.revision, hash(JSON.stringify(snapshot.data)))
  assert.equal(
    hash(Buffer.from(snapshot.data.media[0].bytesBase64, "base64")),
    snapshot.data.media[0].sha256,
  )
  assert.equal(snapshot.data.bindings[0].postId, post)
  assert(!JSON.stringify(snapshot).includes("object_key"))
  assert(!JSON.stringify(snapshot).includes(f.config.s3SecretKey))
  f.sources.get(a).clear()
  assert.equal(
    (await rights.export(a, request, "account_data")).data.media.length,
    0,
  )
})

test("erasure fences first, retries failed object deletion and finishes only after all actual keys and owned rows are gone", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    x = await f.ready(a),
    rights = new MediaDataRights(f.store),
    request = f.dataRequest(a, "delete_account")
  let fail = true
  const original = f.storage.delete.bind(f.storage)
  f.storage.delete = async (key) => {
    if (fail) {
      fail = false
      throw Error("Synthetic storage unavailable")
    }
    return original(key)
  }
  await assert.rejects(rights.erase(a, request))
  assert.equal(
    (await f.pool.query("SELECT state FROM media_erase_receipts")).rows[0]
      .state,
    "preparing",
  )
  await assert.rejects(f.store.get(a, x.media.id), (e) => code(e, "NOT_FOUND"))
  assert.equal((await f.storage.list("ready/" + a + "/")).length, 1)
  const receipt = await rights.erase(a, request)
  assert.equal(receipt.alreadyErased, false)
  assert.equal((await rights.erase(a, request)).alreadyErased, true)
  assert.equal((await f.storage.list("ready/" + a + "/")).length, 0)
  for (const table of [
    "media_objects",
    "media_upload_slots",
    "media_use_grants",
    "media_jobs",
    "media_commands",
  ])
    assert.equal(
      (await f.pool.query("SELECT count(*)::int n FROM " + table)).rows[0].n,
      0,
    )
  await assert.rejects(
    f.store.create(a, randomUUID(), {
      clientPostId: randomUUID(),
      mimeType: "image/png",
      byteSize: f.bytes.length,
      sha256: hash(f.bytes),
    }),
    (e) => code(e, "NOT_FOUND"),
  )
})

test("canceled or expired worker attempt performs zero canonical object writes and malformed files are truly rejected", async (t) => {
  const f = await fixture(t),
    a = f.actor(),
    x = await f.allocate(a)
  await f.store.upload(
    a,
    x.media.id,
    x.upload.id,
    randomUUID(),
    "image/png",
    x.input,
  )
  await f.store.complete(a, x.media.id, x.upload.id, randomUUID())
  const job = await f.engine.claim()
  await f.pool.query(
    "UPDATE media_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [job.id],
  )
  await f.engine.run(job)
  assert.equal((await f.storage.list("ready/" + a + "/")).length, 0)
  const malformed = await f.allocate(
    a,
    randomUUID(),
    Buffer.from("not a decodable PNG"),
  )
  await f.store.upload(
    a,
    malformed.media.id,
    malformed.upload.id,
    randomUUID(),
    "image/png",
    malformed.input,
  )
  await f.store.complete(
    a,
    malformed.media.id,
    malformed.upload.id,
    randomUUID(),
  )
  let next
  for (let i = 0; i < 3; i++) {
    const found = await f.engine.claim()
    if (found?.media_id === malformed.media.id) {
      next = found
      break
    }
    if (found) await f.engine.run(found)
  }
  assert(next)
  await f.engine.run(next)
  assert.equal((await f.store.get(a, malformed.media.id)).status, "rejected")
  assert.equal(
    (await f.store.get(a, malformed.media.id)).failureCode,
    "MEDIA_INVALID_IMAGE",
  )
})
