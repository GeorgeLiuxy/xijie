import assert from "node:assert/strict"
import { randomUUID, createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import vm from "node:vm"
import ts from "../../node_modules/typescript/lib/typescript.js"
const code = ts.transpileModule(
  await readFile(
    new URL("../src/servicePersonVoices.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText
const response = (data) =>
    new Response(JSON.stringify({ data }), {
      headers: { "Content-Type": "application/json" },
    }),
  deny = (code, status = 409, details) =>
    new Response(JSON.stringify({ error: { code, details } }), { status }),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
const scope = () => ({
  accountId: randomUUID(),
  sessionId: randomUUID(),
  draftId: randomUUID(),
  onUnauthorized() {},
})
async function harness(fetch, map = new Map(), local = new Map()) {
  const storage = (store) => ({
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
      key: (index) => [...store.keys()][index] ?? null,
      get length() { return store.size },
    }),
    listeners = new Map(),
    sandbox = vm.createContext({
      fetch,
      crypto: globalThis.crypto,
      Headers,
      Response,
      Blob,
      AbortController,
      AbortSignal,
      DOMException,
      URL,
      Uint8Array,
      ArrayBuffer,
      ReadableStream,
      sessionStorage: storage(map),
      localStorage: storage(local),
      location: { origin: "https://app.test" },
      window: {
        addEventListener: (n, f) => {
          const set = listeners.get(n) ?? new Set()
          set.add(f)
          listeners.set(n, set)
        },
        removeEventListener: (n, f) => listeners.get(n)?.delete(f),
      },
    }),
    module = new vm.SourceTextModule(code, { context: sandbox })
  await module.link(() => assert.fail("Unexpected import"))
  await module.evaluate()
  return {
    api: module.namespace,
    map,
    erase(accountId) {
      for (const fn of listeners.get("xijie:private-drafts-erased") ?? [])
        fn({ detail: { accountId } })
    },
  }
}
function backend(
  context,
  { loseCreate = false, losePut = false, expire = false } = {},
) {
  const id = randomUUID(),
    slot = randomUUID(),
    calls = [],
    bytes = new Uint8Array(48),
    ready = {
      id,
      version: 3,
      status: "ready",
      target: { kind: "person_draft", id: context.draftId },
      mimeType: "audio/wav",
      byteSize: bytes.length,
      sha256: sha(bytes),
      durationMs: 1,
    }
  let state = "awaiting_upload",
    uploaded = false,
    created = false,
    createLost = false,
    putLost = false,
    renewed = false,
    deleteLost = false
  const voice = () =>
      state === "ready"
        ? ready
        : {
            id,
            version:
              state === "awaiting_upload" ? 1 : state === "verifying" ? 2 : 4,
            status: state,
            target: ready.target,
          },
    upload = () => ({
      id: slot,
      url: "/v1/person-voices/" + id + "/uploads/" + slot,
      method: "PUT",
      expiresAt: "2099-01-01T00:00:00Z",
      mimeType: "audio/webm",
      state: uploaded ? "uploaded" : "active",
    })
  const fetch = async (path, init = {}) => {
    calls.push({
      path,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
      key: init.headers.get("Idempotency-Key"),
      match: init.headers.get("If-Match"),
    })
    assert.equal(
      init.headers.get("X-Xijie-Expected-Session"),
      context.sessionId,
    )
    if (path === "/v1/person-voices") {
      created = true
      if (loseCreate && !createLost) {
        createLost = true
        throw Error("lost create")
      }
      return response({ voice: voice(), upload: upload() })
    }
    if (path.startsWith("/v1/person-voices/create-commands/"))
      return created ? response({ state: "accepted", voice: voice() }) : deny("NOT_FOUND", 404)
    if (path === upload().url) {
      if (expire && !renewed) return deny("UPLOAD_EXPIRED")
      uploaded = true
      if (losePut && !putLost) {
        putLost = true
        throw Error("lost upload")
      }
      return response(voice())
    }
    if (path === "/v1/person-voices/" + id + "/upload-slots") {
      renewed = true
      uploaded = true
      return response({ voice: voice(), upload: upload() })
    }
    if (path === "/v1/person-voices/" + id + "/complete") {
      if (!uploaded) return deny("UPLOAD_INCOMPLETE")
      state = "verifying"
      return response(voice())
    }
    if (path === "/v1/person-voices/" + id + "/read-proof")
      return response({
        proof: "owned-proof",
        expiresAt: "2099-01-01T00:00:00Z",
      })
    if (path === "/v1/person-voices/" + id + "/content")
      return new Response(bytes, {
        headers: {
          "Content-Type": "audio/wav",
          "Content-Length": String(bytes.length),
        },
      })
    if (path === "/v1/person-voices/" + id && init.method === "DELETE") {
      state = "deleted"
      if (!deleteLost) {
        deleteLost = true
        throw Error("lost delete")
      }
      return response(voice())
    }
    if (path === "/v1/person-voices/" + id) return response(voice())
    throw Error("Unexpected " + path)
  }
  return {
    fetch,
    calls,
    ready,
    id,
    file: new Blob([new Uint8Array(100)], { type: "audio/webm;codecs=opus" }),
    setReady() {
      state = "ready"
    },
    get created() {
      return created
    },
  }
}
test("real upload bytes and accepted canonical readiness precede People binding; only binding acknowledgment clears retry metadata", async () => {
  const c = scope(),
    b = backend(c),
    h = await harness(b.fetch),
    client = h.api.createPersonVoiceClient(c)
  const v = await client.save(b.file)
  assert.equal(v.status, "verifying")
  assert.equal(h.map.size, 1)
  assert.throws(
    () => client.acknowledgeBound(b.id),
    (e) => e.code === "VOICE_BINDING_UNCONFIRMED",
  )
  b.setReady()
  assert.equal((await client.read(b.id)).status, "ready")
  client.acknowledgeBound(b.id)
  assert.equal(h.map.size, 0)
  assert.equal(b.calls.filter((r) => r.method === "PUT").length, 1)
  assert.equal(b.calls.find((r) => r.method === "PUT").body.byteLength, 100)
  assert.equal(b.calls.find((r) => r.path.endsWith("/complete")).match, '"v1"')
  client.dispose()
})
test("lost allocation retries its exact metadata/key across remount and rejects replacing the original file", async () => {
  const c = scope(),
    b = backend(c, { loseCreate: true }),
    map = new Map()
  let h = await harness(b.fetch, map),
    client = h.api.createPersonVoiceClient(c)
  await assert.rejects(client.save(b.file))
  client.dispose()
  h = await harness(b.fetch, map)
  client = h.api.createPersonVoiceClient({ ...c, sessionId: c.sessionId })
  await assert.rejects(
    client.save(new Blob([new Uint8Array(101)], { type: "audio/webm" })),
    (e) => e.code === "VOICE_ORIGINAL_FILE_REQUIRED",
  )
  await client.save(b.file)
  const creates = b.calls.filter((r) => r.path === "/v1/person-voices")
  assert.equal(creates.length, 2)
  assert.equal(creates[0].key, creates[1].key)
  assert.deepEqual(creates[0].body, creates[1].body)
  client.dispose()
})
test("lost PUT completes accepted original bytes after remount without requiring a second recording or allocating another asset", async () => {
  const c = scope(),
    b = backend(c, { losePut: true }),
    map = new Map()
  let h = await harness(b.fetch, map),
    client = h.api.createPersonVoiceClient(c)
  await assert.rejects(client.save(b.file))
  client.dispose()
  h = await harness(b.fetch, map)
  client = h.api.createPersonVoiceClient(c)
  assert.equal((await client.save()).status, "verifying")
  assert.equal(b.calls.filter((r) => r.path === "/v1/person-voices").length, 1)
  assert.equal(b.calls.filter((r) => r.method === "PUT").length, 1)
  client.dispose()
})
test("only a definite expired slot uses a permanent renewal sub-intent, and already accepted bytes are not reuploaded", async () => {
  const c = scope(),
    b = backend(c, { expire: true }),
    h = await harness(b.fetch),
    client = h.api.createPersonVoiceClient(c)
  assert.equal((await client.save(b.file)).status, "verifying")
  assert.equal(
    b.calls.filter((r) => r.path.endsWith("/upload-slots")).length,
    1,
  )
  assert.equal(b.calls.filter((r) => r.method === "PUT").length, 1)
  assert.equal(b.calls.filter((r) => r.path === "/v1/person-voices").length, 1)
  client.dispose()
})
test("playback proves exact canonical type, byte count and digest; an owner erasure fences late private content", async () => {
  const c = scope(),
    b = backend(c),
    h = await harness(b.fetch),
    client = h.api.createPersonVoiceClient(c)
  assert.equal((await client.playback(b.ready)).size, 48)
  h.erase(c.accountId)
  await assert.rejects(client.playback(b.ready), (e) => e.name === "AbortError")
  const bad = await harness(async (path, init) =>
      path.endsWith("read-proof")
        ? response({ proof: "proof", expiresAt: "2099-01-01T00:00:00Z" })
        : new Response(new Uint8Array(48).fill(1), {
            headers: { "Content-Type": "audio/wav", "Content-Length": "48" },
          }),
    ),
    other = bad.api.createPersonVoiceClient(c)
  await assert.rejects(
    other.playback(b.ready),
    (e) => e.code === "INVALID_AUDIO_CONTENT",
  )
  other.dispose()
})
test("unknown deletion preserves its exact version/key and clears only a real deleted receipt", async () => {
  const c = scope(),
    b = backend(c),
    h = await harness(b.fetch),
    client = h.api.createPersonVoiceClient(c)
  await assert.rejects(client.remove(b.ready))
  assert.equal(h.map.size, 1)
  assert.equal((await client.remove(b.ready)).status, "deleted")
  assert.equal(h.map.size, 0)
  const deletes = b.calls.filter((r) => r.method === "DELETE")
  assert.equal(deletes[0].key, deletes[1].key)
  assert.equal(deletes[0].match, deletes[1].match)
  client.dispose()
})
test("corrupt, erased or different-account recovery metadata cannot issue another mutation", async () => {
  let count = 0
  const c = scope(),
    map = new Map([
      ["xijie.person-voice.intent." + c.accountId + "." + c.draftId, "{}"],
    ]),
    h = await harness(async () => {
      count++
      return response({})
    }, map),
    client = h.api.createPersonVoiceClient(c)
  await assert.rejects(
    client.save(new Blob(["x"], { type: "audio/wav" })),
    (e) => e.code === "VOICE_RECOVERY_STORAGE_UNAVAILABLE",
  )
  assert.equal(count, 0)
  const other = h.api.createPersonVoiceClient({ ...c, accountId: randomUUID() })
  assert.equal(other.pending, undefined)
  client.dispose()
  other.dispose()
  const erased = await harness(
    async () => {
      count++
    },
    new Map(),
    new Map([["xijie.private-drafts-erased." + c.accountId, "1"]]),
  )
  await assert.rejects(
    erased.api.createPersonVoiceClient(c).save(),
    (e) => e.code === "ACCOUNT_ERASED",
  )
  assert.equal(count, 0)
})
test("discard resolves a lost allocation through its original owner command, and keeps both journals until actual deletion acknowledgment", async () => {
  const c = scope(), b = backend(c, { loseCreate: true }), map = new Map()
  let h = await harness(b.fetch, map), client = h.api.createPersonVoiceClient(c)
  await assert.rejects(client.save(b.file))
  client.dispose()
  h = await harness(b.fetch, map)
  client = h.api.createPersonVoiceClient(c)
  await assert.rejects(client.discard(), /lost delete/)
  assert.equal(map.size, 2)
  assert.equal(client.pendingDeletions.length, 1)
  await client.retryDeletions()
  assert.equal(client.pendingDeletions.length, 0)
  await client.discard()
  assert.equal(map.size, 0)
  assert.equal(b.calls.filter(r => r.path === "/v1/person-voices").length, 1)
  const deletes = b.calls.filter(r => r.method === "DELETE")
  assert.equal(deletes[0].key, deletes[1].key)
  client.dispose()
})
test("a started binding cannot be discarded and retry cleanup refuses any currently bound id before mutations", async () => {
  const c = scope(), b = backend(c), h = await harness(b.fetch), client = h.api.createPersonVoiceClient(c)
  await client.save(b.file)
  b.setReady()
  await client.read(b.id)
  client.markBinding(b.id)
  await assert.rejects(client.discard(), e => e.code === "VOICE_BINDING_UNCONFIRMED")
  assert.equal(b.calls.filter(r => r.method === "DELETE").length, 0)
  await assert.rejects(client.remove(b.ready))
  const count = b.calls.length
  await assert.rejects(client.retryDeletions([b.id]), e => e.code === "VOICE_STILL_BOUND")
  assert.equal(b.calls.length, count)
  client.dispose()
})
test("only a definite trusted newer version rotates deletion intent; unknown retry after reload keeps that exact child key", async () => {
  const c = scope(), b = backend(c), calls = [], map = new Map()
  let stage = 0
  const fetch = async (path, init) => {
    calls.push({ path, key: init.headers.get("Idempotency-Key"), match: init.headers.get("If-Match") })
    if (stage++ === 0) return deny("VERSION_CONFLICT", 412, { currentVersion: 5 })
    if (stage === 2) throw Error("unknown delete")
    return response({ id: b.id, version: 6, status: "deleted", target: b.ready.target })
  }
  let h = await harness(fetch, map), client = h.api.createPersonVoiceClient(c)
  await assert.rejects(client.remove(b.ready), /unknown delete/)
  client.dispose()
  h = await harness(fetch, map)
  client = h.api.createPersonVoiceClient(c)
  assert.equal(client.pendingDeletions[0].version, 5)
  await client.retryDeletions()
  assert.equal(map.size, 0)
  assert.notEqual(calls[0].key, calls[1].key)
  assert.equal(calls[1].key, calls[2].key)
  assert.equal(calls[2].match, '"v5"')
  client.dispose()
})
test("caller cancellation fences proof, cancels a stalled private body, and never returns playable bytes", async () => {
  const c = scope(), b = backend(c), controller = new AbortController()
  let started, canceled = false
  const bodyStarted = new Promise(resolve => { started = resolve })
  const h = await harness(async path => path.endsWith("read-proof")
    ? response({ proof: "owned-proof", expiresAt: "2099-01-01T00:00:00Z" })
    : new Response(new ReadableStream({ start() { started() }, cancel() { canceled = true } }), {
      headers: { "Content-Type": "audio/wav", "Content-Length": "48" },
    }))
  const client = h.api.createPersonVoiceClient(c)
  const result = client.playback(b.ready, controller.signal)
  await bodyStarted
  controller.abort()
  await assert.rejects(result, e => e.name === "AbortError")
  assert.equal(canceled, true)
  const count = h.map.size
  await assert.rejects(client.playback(b.ready, controller.signal), e => e.name === "AbortError")
  assert.equal(h.map.size, count)
  client.dispose()
})
test("pending deletions are strictly scoped and corrupted metadata fails closed", async () => {
  const c = scope(), id = randomUUID(), other = randomUUID(), map = new Map([
    ["xijie.person-voice.delete." + c.accountId + "." + c.draftId + "." + id, JSON.stringify({ key: randomUUID(), version: 3 })],
    ["xijie.person-voice.delete." + other + "." + c.draftId + "." + randomUUID(), "{}"],
  ])
  const h = await harness(async () => assert.fail("No mutation"), map), client = h.api.createPersonVoiceClient(c)
  assert.equal(client.pendingDeletions.length, 1)
  assert.equal(client.pendingDeletions[0].id, id)
  map.set("xijie.person-voice.delete." + c.accountId + "." + c.draftId + ".bad", "{}")
  assert.throws(() => client.pendingDeletions, e => e.code === "VOICE_RECOVERY_STORAGE_UNAVAILABLE")
  await assert.rejects(client.retryDeletions(), e => e.code === "VOICE_RECOVERY_STORAGE_UNAVAILABLE")
  client.dispose()
})
