import "reflect-metadata"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { NestFactory } from "@nestjs/core"
import { SocialModule, SocialErrors, socialHeaders } from "../dist/http.js"
import { fixture } from "./fixture.mjs"
test("original-client HTTP uses account ownership, exact idempotency, signed pages and policy purpose rather than AI", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    b = f.account(),
    web = "http://127.0.0.1:5184",
    config = {
      webOrigin: web,
      serviceToken: "a".repeat(64),
      dataRightsToken: "b".repeat(64),
    }
  const app = await NestFactory.create(SocialModule.register(config, f.store), {
    logger: false,
  })
  app.use(socialHeaders)
  app.useGlobalFilters(new SocialErrors())
  await app.listen(0, "127.0.0.1")
  t.after(() => app.close())
  const origin = "http://127.0.0.1:" + app.getHttpServer().address().port
  const call = async (
    path,
    { method = "GET", body, account = a, headers = {} } = {},
  ) => {
    const r = await fetch(origin + path, {
      method,
      headers: {
        Cookie: "test=" + account,
        Origin: web,
        "X-Xijie-Expected-Session": account,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    return { status: r.status, headers: r.headers, ...(await r.json()) }
  }
  const input = {
      clientPostId: randomUUID(),
      body: "从原发布框发出的合成日常",
    },
    key = randomUUID(),
    written = await call("/v1/posts", {
      method: "POST",
      body: input,
      headers: { "Idempotency-Key": key },
    })
  assert.equal(written.status, 201)
  assert.equal(written.headers.get("cache-control"), "no-store")
  assert.equal(written.headers.get("etag"), '"v1"')
  const id = written.data.id
  assert.equal(
    (
      await call("/v1/posts", {
        method: "POST",
        body: input,
        headers: { "Idempotency-Key": key },
      })
    ).data.id,
    id,
  )
  assert.equal(
    (
      await call("/v1/posts", {
        method: "POST",
        body: input,
        headers: { "Idempotency-Key": key, Origin: "https://wrong.invalid" },
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await call("/v1/posts", {
        method: "POST",
        body: { ...input, clientPostId:randomUUID(), mediaIds: [randomUUID()] },
        headers: { "Idempotency-Key": randomUUID() },
      })
    ).error.code,
    "MEDIA_NOT_AVAILABLE",
  )
  assert.equal((await call("/v1/posts/" + id, { account: b })).status, 404)
  assert.equal(
    (
      await call("/v1/posts", {
        method: "POST",
        body: { ...input, author: { kind: "system" } },
        headers: { "Idempotency-Key": randomUUID() },
      })
    ).status,
    422,
  )
  await call("/v1/posts", {
    method: "POST",
    body: { clientPostId: randomUUID(), body: "第二条合成日常" },
    headers: { "Idempotency-Key": randomUUID() },
  })
  const first = await call("/v1/feed?limit=1")
  assert.equal(first.data.length, 1)
  assert(first.meta.nextCursor)
  const second = await call(
    "/v1/feed?limit=1&cursor=" + encodeURIComponent(first.meta.nextCursor),
  )
  assert.equal(second.data.length, 1)
  assert.notEqual(second.data[0].id, first.data[0].id)
  assert.equal(
    (
      await call(
        "/v1/feed?limit=2&cursor=" + encodeURIComponent(first.meta.nextCursor),
      )
    ).status,
    422,
  )
  assert.equal(
    (
      await call(
        "/v1/feed?limit=1&cursor=" + encodeURIComponent(first.meta.nextCursor),
        { account: b },
      )
    ).status,
    422,
  )
  assert.equal(
    (
      await call("/v1/posts/" + id, {
        method: "DELETE",
        headers: { "Idempotency-Key": randomUUID() },
      })
    ).status,
    428,
  )
  const reaction = await call("/v1/posts/" + id + "/reactions/me", {
    method: "PUT",
    body: { active: true },
    headers: { "Idempotency-Key": randomUUID() },
  })
  assert.equal(reaction.data.active, true)
  const commented = await call("/v1/posts/" + id + "/comments", {
    method: "POST",
    body: { clientCommentId: randomUUID(), body: "手动评论" },
    headers: { "Idempotency-Key": randomUUID() },
  })
  assert.equal(commented.status, 201)
  assert.equal(commented.data.author.kind, "self")
  f.accounts.get(a).storyStorage.privateFeedAllowed = false
  assert.equal(
    (await call("/v1/feed")).error.code,
    "STORAGE_PERMISSION_REQUIRED",
  )
  const rid = f.request(a)
  assert.equal(
    (
      await call(
        "/internal/v1/accounts/" +
          a +
          "/data-export?requestId=" +
          rid +
          "&scope=account_data",
        { headers: { Authorization: "Bearer " + config.serviceToken } },
      )
    ).status,
    403,
  )
  const exported = await call(
    "/internal/v1/accounts/" +
      a +
      "/data-export?requestId=" +
      rid +
      "&scope=account_data",
    { headers: { Authorization: "Bearer " + config.dataRightsToken } },
  )
  assert.equal(exported.status, 200)
  assert.equal(exported.data.domain, "social")
  const removed = await call("/v1/posts/" + id, {
    method: "DELETE",
    headers: { "Idempotency-Key": randomUUID(), "If-Match": '"v3"' },
  })
  assert.equal(removed.status, 200)
})
