import { randomUUID, randomBytes } from "node:crypto"

import { readFile, readdir } from "node:fs/promises"

import pg from "pg"

import { CreateBucketCommand, DeleteBucketCommand } from "@aws-sdk/client-s3"

import sharp from "sharp"

import { readConfig } from "../dist/config.js"

import { S3Storage } from "../dist/storage.js"

import { MediaStore } from "../dist/store.js"

import { MediaEngine } from "../dist/engine.js"

import { missing, hash } from "../dist/contracts.js"

export async function fixture(t) {
  const base = readConfig(),
    schema = "media_test_" + randomUUID().replaceAll("-", ""),
    admin = new pg.Pool({
      connectionString: process.env.XIJIE_TEST_DATABASE_URL,
    }),
    pool = new pg.Pool({
      connectionString: process.env.XIJIE_TEST_DATABASE_URL,

      options: "-c search_path=" + schema,

      max: 4,
    }),
    config = {
      ...base,

      s3Bucket: "xijie-media-test-" + randomUUID().replaceAll("-", ""),

      proofKey: randomBytes(32).toString("hex"),
      giftsToken: randomBytes(32).toString('hex'),
      conversationsToken:randomBytes(32).toString('hex'),
    },
    storage = new S3Storage(config),
    accounts = new Map(),
    sources = new Map(),
    personSources = new Map(),
    personTargets = new Map(),
    giftTargets = new Map(),
    giftSources = new Map(),
    conversationTargets=new Map(),conversationSources=new Map(),photoReplySources=new Map(),
    requests = new Map()

  await admin.query("CREATE SCHEMA " + schema)

  for (const name of (await readdir(new URL("../db/", import.meta.url)))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await pool.query(
      await readFile(new URL("../db/" + name, import.meta.url), "utf8"),
    )

  await storage.client.send(
    new CreateBucketCommand({ Bucket: config.s3Bucket }),
  )

  t.after(async () => {
    for (const Key of await storage.list("")) await storage.delete(Key)

    await storage.client.send(
      new DeleteBucketCommand({ Bucket: config.s3Bucket }),
    )

    storage.close()

    await pool.end()

    await admin.query("DROP SCHEMA " + schema + " CASCADE")

    await admin.end()
  })

  const dependencies = {
    async account(id) {
      if (!accounts.has(id)) throw missing()

      return structuredClone(accounts.get(id))
    },

    async session(cookie, expected) {
      const id = cookie.replace("test=", ""),
        a = accounts.get(id)

      if (!a || (expected !== undefined && expected !== id)) throw missing()

      return {
        accountId: id,

        sessionId: id,

        expiresAt: new Date(Date.now() + 60000).toISOString(),

        storyStorage: a.storyStorage,

        photoStorage: a.photoStorage,

        personPhotoStorage: a.personPhotoStorage,
        giftStorage:a.giftStorage,giftPhotoStorage:a.giftPhotoStorage,
        chatPhotoStorage:a.chatPhotoStorage,chatImageReplies:a.chatImageReplies,
      }
    },

    async validPosts(id, refs) {
      return refs.filter((r) =>
        sources.get(id)?.has(r.postId + ":" + r.mediaId + ":" + r.version),
      )
    },

    async personTarget(id, draftId) {
      if (!personTargets.get(id)?.has(draftId)) throw missing()
    },

    async validPersonPhotos(id, refs) {
      return refs.filter((r) =>
        personSources
          .get(id)
          ?.has(r.draftId + ":" + r.mediaId + ":" + r.version),
      )
    },
    async giftTarget(id,deliveryId){const target=giftTargets.get(id)?.get(deliveryId);if(!target)throw missing();return structuredClone(target)},
    async validGiftPhotos(id,refs){return refs.filter(r=>giftSources.get(id)?.has(r.deliveryId+':'+r.photoVersion+':'+r.mediaId+':'+r.version))},
    async conversationTarget(id,conversationId){const target=conversationTargets.get(id)?.get(conversationId);if(!target)throw missing();return structuredClone(target)},
    async validConversationPhotos(id,refs){return refs.filter(r=>conversationSources.get(id)?.has(r.conversationId+':'+r.clientMessageId+':'+r.messageVersion+':'+r.mediaId+':'+r.version))},
    async photoReplySource(id,jobId,attemptId){const value=photoReplySources.get(id+':'+jobId+':'+attemptId);if(!value)throw missing();return structuredClone(value)},

    async dataRequest(id) {
      if (!requests.has(id)) throw missing()

      return structuredClone(requests.get(id))
    },
  }

  const store = new MediaStore(pool, dependencies, storage, config),
    engine = new MediaEngine(store)

  const actor = () => {
    const id = randomUUID()

    accounts.set(id, {
      accountId: id,

      status: "active",

      accessVersion: 1,

      storyStorage: {
        allowed: true,

        authorizationVersion: 1,

        privateFeedAllowed: true,
      },

      photoStorage: { allowed: true, authorizationVersion: 1 },

      personPhotoStorage: { allowed: true, authorizationVersion: 1 },
      giftStorage:{allowed:true,authorizationVersion:1},giftPhotoStorage:{allowed:true,authorizationVersion:1},
      chatPhotoStorage:{allowed:true,authorizationVersion:1},chatImageReplies:{allowed:true,authorizationVersion:1},
    })

    sources.set(id, new Set())

    personSources.set(id, new Set())

    personTargets.set(id, new Set())
    giftTargets.set(id,new Map());giftSources.set(id,new Set())
    conversationTargets.set(id,new Map());conversationSources.set(id,new Set())

    return id
  }

  const session = (id) => ({
    accountId: id,

    sessionId: id,

    expiresAt: new Date(Date.now() + 60000).toISOString(),

    storyStorage: accounts.get(id).storyStorage,

    photoStorage: accounts.get(id).photoStorage,

    personPhotoStorage: accounts.get(id).personPhotoStorage,
    giftStorage:accounts.get(id).giftStorage,giftPhotoStorage:accounts.get(id).giftPhotoStorage,
    chatPhotoStorage:accounts.get(id).chatPhotoStorage,chatImageReplies:accounts.get(id).chatImageReplies,
  })

  const bytes = await sharp({
    create: { width: 8, height: 5, channels: 3, background: "#416b73" },
  })

    .withMetadata({ orientation: 6 })

    .png()

    .toBuffer()

  const allocate = async (id, intent = randomUUID(), input = bytes) => ({
    ...(await store.create(id, randomUUID(), {
      clientPostId: intent,

      mimeType: "image/png",

      byteSize: input.length,

      sha256: hash(input),
    })),

    intent,

    input,
  })

  const ready = async (id, intent = randomUUID()) => {
    const x = await allocate(id, intent)

    await store.upload(
      id,

      x.media.id,

      x.upload.id,

      randomUUID(),

      "image/png",

      x.input,
    )

    await store.complete(id, x.media.id, x.upload.id, randomUUID())

    const j = await engine.claim()

    if (!j || j.media_id !== x.media.id)
      throw Error("Expected isolated verify dispatch")

    await engine.run(j)

    const value = await store.get(id, x.media.id)

    if (value.status !== "ready")
      throw Error("Actual canonical processing did not complete")

    return { ...x, media: value }
  }

  const commit = (id, postId, media) => {
    for (const m of media)
      sources.get(id).add(postId + ":" + m.id + ":" + m.version)
  }

  const dataRequest = (id, kind = "export") => {
    const requestId = randomUUID()

    requests.set(requestId, {
      accountId: id,

      requestId,

      kind,

      scope: "account_data",

      accountStatus: kind === "export" ? "active" : "deletion_pending",

      accountAccessVersion: 2,
    })

    return requestId
  }

  return {
    pool,

    store,

    storage,

    engine,

    config,

    accounts,

    sources,

    personSources,

    personTargets,
    giftTargets,giftSources,
    conversationTargets,conversationSources,photoReplySources,

    requests,

    actor,

    session,

    allocate,

    ready,

    commit,

    dataRequest,

    bytes,
  }
}
