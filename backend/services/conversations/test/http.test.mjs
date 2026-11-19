import "reflect-metadata"
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { test } from "node:test"
import { NestFactory } from "@nestjs/core"
import { fixture, text } from "./fixture.mjs"
import { ConversationStore } from "../dist/store.js"
import { Dependencies } from "../dist/dependencies.js"
import {
  ConversationErrors,
  ConversationsModule,
  conversationHeaders,
} from "../dist/http.js"

test("original-client HTTP contract enforces authenticated ownership, cursors and command preconditions", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    b = f.account(),
    token = randomBytes(32).toString("hex")
  const downstream = createServer((request, response) => {
    void (async () => {
      assert.equal(request.headers.authorization, "Bearer " + token)
      const url = new URL(request.url, "http://localhost")
      let value
      if (url.pathname === "/internal/v1/session-context")
        value = await f.dependencies.session(request.headers.cookie || "")
      else if (url.pathname.startsWith("/internal/v1/accounts/"))
        value = await f.dependencies.account(url.pathname.split("/")[4])
      else if (url.pathname === "/internal/v1/persons")
        value = await f.dependencies.persons(
          request.headers["x-xijie-account-id"],
        )
      else
        value = await f.dependencies.person(
          request.headers["x-xijie-account-id"],
          url.pathname.split("/")[4],
        )
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ data: value }))
    })().catch((error) => {
      response.writeHead(error.status || 500, {
        "Content-Type": "application/json",
      })
      response.end(JSON.stringify({ error: { code: error.code } }))
    })
  })
  await new Promise((resolve) => downstream.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => downstream.close(resolve)))
  const dependencyOrigin = "http://127.0.0.1:" + downstream.address().port
  const config = {
    databaseUrl: "test",
    host: "127.0.0.1",
    port: 3103,
    webOrigin: "http://127.0.0.1:5184",
    identityOrigin: dependencyOrigin,
    peopleOrigin: dependencyOrigin,
    serviceToken: token,
    sessionCookie: "xijie_dev_session",
    queueSchema: f.queueSchema,
  }
  const dependencies = new Dependencies(config)
  const store = new ConversationStore(f.pool, dependencies, f.queue)
  const app = await NestFactory.create(
    ConversationsModule.register(config, store),
    { logger: false },
  )
  app.getHttpAdapter().getInstance().disable("x-powered-by")
  app.use(conversationHeaders)
  app.useGlobalFilters(new ConversationErrors())
  await app.listen(0, "127.0.0.1")
  t.after(() => app.close())
  const origin = await app.getUrl()
  const headers = {
    Origin: config.webOrigin,
    Cookie: "xijie_dev_session=" + a.credential,
    "X-Xijie-Expected-Session": a.sessionId,
  }
  async function request(
    path,
    { method = "GET", body, key = randomUUID(), ...override } = {},
  ) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...headers,
        ...(method !== "GET" ? { "Idempotency-Key": key } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...override.headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    return { response, status: response.status, json: await response.json() }
  }
  assert.equal(
    (await request("/v1/conversations", { headers: { Cookie: "" } })).status,
    401,
  )
  assert.equal(
    (
      await request("/v1/conversations", {
        headers: { "X-Xijie-Expected-Session": randomUUID() },
      })
    ).status,
    401,
  )
  assert.equal(
    (
      await request("/v1/conversations", {
        method: "POST",
        body: { kind: "direct", personId: a.person.id },
        headers: { Origin: "https://wrong.test" },
      })
    ).status,
    403,
  )
  const created = await request("/v1/conversations", {
    method: "POST",
    body: { kind: "direct", personId: a.person.id },
  })
  assert.equal(created.status, 201)
  assert.equal(created.response.headers.get("etag"), '"v1"')
  const cid = created.json.data.id
  assert.equal(
    (
      await request("/v1/conversations", {
        method: "POST",
        body: { kind: "direct", personId: a.person.id },
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await request("/v1/conversations/" + cid, {
        headers: {
          Cookie: "xijie_dev_session=" + b.credential,
          "X-Xijie-Expected-Session": b.sessionId,
        },
      })
    ).status,
    404,
  )
  const input = text("First user message"),
    sent = await request("/v1/conversations/" + cid + "/messages", {
      method: "POST",
      body: input,
    })
  assert.equal(sent.status, 202)
  assert.equal(sent.json.data.message.author.kind, "self")
  assert.equal(
    sent.json.data.message.generationJobId,
    sent.json.data.generationJobId,
  )
  await request("/v1/conversations/" + cid + "/messages", {
    method: "POST",
    body: text("Second message"),
  })
  const page = await request("/v1/conversations/" + cid + "/messages?limit=1")
  assert.deepEqual(
    page.json.data.map((row) => row.sequence),
    ["2"],
  )
  assert.equal(typeof page.json.meta.nextCursor, "string")
  assert.equal(typeof page.json.meta.afterCursor, "string")
  const older = await request(
    "/v1/conversations/" +
      cid +
      "/messages?limit=1&cursor=" +
      encodeURIComponent(page.json.meta.nextCursor),
  )
  assert.deepEqual(
    older.json.data.map((row) => row.sequence),
    ["1"],
  )
  const newer = await request(
    "/v1/conversations/" +
      cid +
      "/messages?limit=1&direction=newer&cursor=" +
      encodeURIComponent(page.json.meta.afterCursor),
  )
  assert.deepEqual(newer.json.data, [])
  assert.equal(
    (
      await request(
        "/v1/conversations/" +
          cid +
          "/messages?limit=2&cursor=" +
          encodeURIComponent(page.json.meta.nextCursor),
      )
    ).status,
    400,
  )
  assert.equal(
    (
      await request(
        "/v1/conversations/" +
          cid +
          "/messages?direction=newer&limit=1&cursor=" +
          encodeURIComponent(page.json.meta.nextCursor),
      )
    ).status,
    400,
  )
  const other = await request("/v1/conversations", {
    method: "POST",
    body: { kind: "direct", personId: b.person.id },
  })
  assert.equal(other.status, 404)
  const list = await request("/v1/conversations")
  assert.equal(list.json.data[0].lastMessage.preview, "Second message")
  assert.equal(list.json.data[0].lastMessage.author.kind, "self")
  const messageId = sent.json.data.message.id,
    path = "/v1/conversations/" + cid + "/messages/" + messageId
  assert.equal((await request(path, { method: "DELETE" })).status, 428)
  assert.equal(
    (await request(path, { method: "DELETE", headers: { "If-Match": '"v9"' } }))
      .status,
    412,
  )
  const removeKey = randomUUID(),
    removed = await request(path, {
      method: "DELETE",
      key: removeKey,
      headers: { "If-Match": '"v1"' },
    })
  assert.equal(removed.status, 200)
  assert.equal(removed.json.data.version, 2)
  assert.deepEqual(
    (
      await request(path, {
        method: "DELETE",
        key: removeKey,
        headers: { "If-Match": '"v1"' },
      })
    ).json.data,
    removed.json.data,
  )
  assert.equal(
    (
      await request("/v1/conversations/" + cid + "/messages", {
        method: "POST",
        body: input,
      })
    ).status,
    404,
  )
  const canceled = await request(
    "/v1/generation-jobs/" + sent.json.data.generationJobId,
  )
  assert.equal(canceled.json.data.state, "canceled")
  f.people.delete(a.person.id)
  for (const url of [
    "/v1/conversations/" + cid,
    "/v1/conversations/" + cid + "/messages",
    "/v1/generation-jobs/" + sent.json.data.generationJobId,
  ])
    assert.equal((await request(url)).status, 404)
  assert.deepEqual((await request("/v1/conversations")).json.data, [])
})
