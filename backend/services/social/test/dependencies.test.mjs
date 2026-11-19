import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { test } from "node:test"
import { Dependencies } from "../dist/dependencies.js"
import { createInput } from "../dist/contracts.js"
test("People source decoder rejects foreign, gapped, unbounded, malformed and redirected authority", async (t) => {
  const accountId = randomUUID(),
    personId = randomUUID(),
    worldId = randomUUID(),
    otherWorld = randomUUID(),
    now = new Date().toISOString(),
    person = {
      id: personId,
      displayName: "合成角色",
      worldId: otherWorld,
      version: 2,
      accessVersion: 1,
      worldVersion: 2,
    },
    card = (id) => ({
      id,
      code: "test",
      displayName: "合成世界",
      enabled: true,
      catalogVersion: 1,
    }),
    movement = {
      id: randomUUID(),
      worldVersion: 2,
      personVersion: 2,
      fromWorld: card(worldId),
      toWorld: card(otherWorld),
      occurredAt: now,
      recordedAt: now,
    }
  let mode = "valid"
  const requests = []
  const server = createServer((req, res) => {
    requests.push({
      url: req.url,
      authorization: req.headers.authorization,
      account: req.headers["x-xijie-account-id"],
    })
    if (mode === "redirect") {
      res.writeHead(302, { Location: "/other" })
      return res.end()
    }
    if (mode === "outage") {
      res.writeHead(503)
      return res.end("{}")
    }
    res.setHeader("Content-Type", "application/json")
    if (mode === "json") {
      return res.end("{")
    }
    let value = req.url.includes("/world-movements")
      ? {
          accountId,
          person,
          items: [structuredClone(movement)],
          nextAfterVersion: 2,
          hasMore: false,
        }
      : { accountId, persons: [person] }
    if (mode === "foreign") value.accountId = randomUUID()
    if (mode === "gap") value.items[0].worldVersion = 4
    if (mode === "empty") value.items = []
    if (mode === "wrong-next") value.nextAfterVersion = 3
    if (mode === "wrong-horizon") value.person = { ...person, worldVersion: 1 }
    res.end(JSON.stringify({ data: value }))
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  t.after(() => new Promise((r) => server.close(r)))
  const origin = "http://127.0.0.1:" + server.address().port,
    deps = new Dependencies({
      serviceToken: "c".repeat(64),
      identityOrigin: origin,
      peopleOrigin: origin,
      sessionCookie: "test",
    })
  assert.deepEqual(await deps.persons(accountId), [person])
  const page = await deps.movements(accountId, personId, 1, 2, 100)
  assert.equal(page.items[0].id, movement.id)
  assert(
    requests.every(
      (r) =>
        r.authorization === "Bearer " + "c".repeat(64) &&
        r.account === accountId,
    ),
  )
  for (const invalid of [
    "foreign",
    "gap",
    "empty",
    "wrong-next",
    "wrong-horizon",
    "redirect",
    "outage",
    "json",
  ]) {
    mode = invalid
    await assert.rejects(deps.movements(accountId, personId, 1, 2, 100), {
      code: "DEPENDENCY_UNAVAILABLE",
    })
  }
})

test("UUID v7 identities and movement references pass the same real HTTP boundary as existing service IDs", async t => {
  const v7 = () => randomUUID().replace(/^(.{14})./, '$17')
  const accountId = v7(), personId = v7(), fromId = v7(), toId = v7(), movementId = v7()
  const person = { id: personId, displayName: 'UUID7合成角色', worldId: toId, version: 2, accessVersion: 1, worldVersion: 2 }
  const world = id => ({ id, code: 'test', displayName: '合成世界', enabled: true, catalogVersion: 1 })
  const at = new Date().toISOString()
  const movement = { id: movementId, worldVersion: 2, personVersion: 2, fromWorld: world(fromId), toWorld: world(toId), occurredAt: at, recordedAt: at }
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: req.url.includes('/world-movements')
      ? { accountId, person, items: [movement], nextAfterVersion: 2, hasMore: false }
      : { accountId, persons: [person] } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = 'http://127.0.0.1:' + server.address().port
  const deps = new Dependencies({ serviceToken: 'd'.repeat(64), identityOrigin: origin, peopleOrigin: origin, sessionCookie: 'test' })
  assert.equal(accountId[14], '7')
  assert.deepEqual(await deps.persons(accountId), [person])
  assert.deepEqual((await deps.movements(accountId, personId, 1, 2, 100)).items, [movement])
  assert.equal(createInput({ clientPostId: v7(), body: '合法v7意图' }).clientPostId[14], '7')
})

test('AI source HTTP distinguishes revoked authority and changed versions from credential outages',async t=>{
 const accountId=randomUUID(),personId=randomUUID(),memoryId=randomUUID();let status=409,code='SOURCE_CHANGED'
 const server=createServer((req,res)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code}}))})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
 const origin='http://127.0.0.1:'+server.address().port,deps=new Dependencies({serviceToken:'c'.repeat(64),memoriesOrigin:origin,peopleOrigin:origin})
 for(const method of [()=>deps.echoMemory(accountId,personId,memoryId,1,1),()=>deps.echoPerson(accountId,personId,1),()=>deps.echoWorld(accountId,personId,1)]){
  status=409;code='SOURCE_CHANGED';await assert.rejects(method,{status:409,code})
  status=403;code='AI_PERMISSION_REQUIRED';await assert.rejects(method,{status:403,code})
  code='INVALID_SERVICE_CREDENTIAL';await assert.rejects(method,{status:503,code:'DEPENDENCY_UNAVAILABLE'})
 }
})
