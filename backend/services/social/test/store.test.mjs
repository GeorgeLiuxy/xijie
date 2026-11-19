import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { fixture, post, comment } from "./fixture.mjs"
import { SocialDataRights } from "../dist/data-rights.js"
import { digest } from "../dist/contracts.js"
test("private posts persist once and scope, exact intents, deletion and authorization remain independent of AI", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    b = f.account(),
    input = post(),
    key = randomUUID(),
    p = await f.store.create(a, key, input)
  assert.equal(p.body, input.body)
  assert.equal(p.author.kind, "self")
  assert.equal((await f.store.create(a, key, input)).id, p.id)
  assert.equal((await f.store.create(a, randomUUID(), input)).id, p.id)
  assert.equal(
    (await f.pool.query("SELECT count(*)::int n FROM posts")).rows[0].n,
    1,
  )
  await assert.rejects(
    f.store.create(a, key, { ...input, body: "另一个文本" }),
    { code: "IDEMPOTENCY_CONFLICT" },
  )
  await assert.rejects(f.store.detail(b, p.id), { code: "NOT_FOUND" })
  const authority = f.accounts.get(a)
  authority.storyStorage.privateFeedAllowed = false
  await assert.rejects(f.store.feed(a, {}, undefined, 20), {
    code: "STORAGE_PERMISSION_REQUIRED",
  })
  await assert.rejects(f.store.create(a, randomUUID(), post()), {
    code: "STORAGE_PERMISSION_REQUIRED",
  })
  const removed = await f.store.remove(a, p.id, randomUUID(), p.version)
  assert.equal(removed.version, 2)
  authority.storyStorage.privateFeedAllowed = true
  await assert.rejects(f.store.create(a, key, input), { code: "NOT_FOUND" })
  await assert.rejects(f.store.detail(a, p.id), { code: "NOT_FOUND" })
  assert.deepEqual(await f.store.feed(a, {}, undefined, 20), [])
})
test("desired reaction state is concurrency-safe, no-op does not change version, old key replay reads current state", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    p = await f.store.create(a, randomUUID(), post()),
    key = randomUUID()
  await Promise.all(
    Array.from({ length: 6 }, () => f.store.react(a, p.id, key, true)),
  )
  const first = await f.store.detail(a, p.id)
  assert.equal(first.reactionCount, 1)
  assert.equal(first.version, 2)
  await f.store.react(a, p.id, randomUUID(), true)
  assert.equal((await f.store.detail(a, p.id)).version, 2)
  await f.store.react(a, p.id, randomUUID(), false)
  const replay = await f.store.react(a, p.id, key, true)
  assert.deepEqual(replay, { active: false, reactionCount: 0, postVersion: 3 })
  await assert.rejects(
    f.pool.query("UPDATE posts SET reaction_count=4 WHERE id=$1", [p.id]),
    { code: "23514" },
  )
})
test("comments preserve parent scope, deterministic previews, full pagination and current replay after deletion", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    p = await f.store.create(a, randomUUID(), post()),
    other = await f.store.create(a, randomUUID(), post("另一日常")),
    first = await f.store.comment(a, p.id, randomUUID(), comment())
  await assert.rejects(
    f.store.comment(a, other.id, randomUUID(), comment("跨动态回复", first.id)),
    { code: "NOT_FOUND" },
  )
  for (let i = 0; i < 4; i++)
    await f.store.comment(
      a,
      p.id,
      randomUUID(),
      comment("合成评论" + i, first.id),
    )
  let summary = await f.store.detail(a, p.id)
  assert.equal(summary.commentCount, 5)
  assert.equal(summary.commentPreview.length, 3)
  const page1 = await f.store.comments(a, p.id, undefined, 2),
    page2 = await f.store.comments(
      a,
      p.id,
      { at: page1[1].createdAt, id: page1[1].id },
      10,
    )
  assert.equal(page1.length + page2.length, 5)
  const intent = comment("随后移除"),
    key = randomUUID(),
    c = await f.store.comment(a, p.id, key, intent)
  await f.store.removeComment(a, p.id, c.id, randomUUID(), c.version)
  await assert.rejects(f.store.comment(a, p.id, key, intent), {
    code: "NOT_FOUND",
  })
  await f.store.removeComment(a, p.id, first.id, randomUUID(), first.version)
  summary = await f.store.detail(a, p.id)
  assert.equal(summary.commentCount, 4)
  assert(
    (await f.store.comments(a, p.id, undefined, 10)).every(
      (c) => c.id !== first.id,
    ),
  )
  await assert.rejects(
    f.pool.query(
      "UPDATE post_comments SET status='active',removed_at=NULL WHERE id=$1",
      [first.id],
    ),
    { code: "23514" },
  )
})
test("committed movement projections handle ABA and histories beyond eight without creating AI content", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    s = f.makePerson(a)
  assert.deepEqual(await f.store.feed(a, {}, undefined, 100), [])
  for (let i = 0; i < 12; i++) s.move()
  const feed = await f.store.feed(a, {}, undefined, 100)
  assert.equal(feed.length, 12)
  assert(
    feed.every(
      (p) =>
        p.kind === "world_notice" &&
        p.author.kind === "system" &&
        p.personId === s.person.id,
    ),
  )
  assert.equal(new Set(feed.map((p) => p.sourceMovementId)).size, 12)
  assert.equal(
    (
      await f.pool.query(
        "SELECT last_projected_world_version FROM social_person_sync",
      )
    ).rows[0].last_projected_world_version,
    13,
  )
  assert.equal(
    (await f.store.feed(a, { personId: s.person.id }, undefined, 100)).length,
    12,
  )
  await Promise.all([
    f.store.feed(a, {}, undefined, 100),
    f.store.feed(a, {}, undefined, 100),
  ])
  assert.equal(
    (await f.pool.query("SELECT count(*)::int n FROM posts")).rows[0].n,
    12,
  )
  await assert.rejects(
    f.pool.query("UPDATE posts SET source_hash=repeat('a',64) WHERE id=$1", [
      feed[0].id,
    ]),
    { code: "23514" },
  )
})
test("removed people and dependency outages never expose cached world facts or their interactions", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    s = f.makePerson(a)
  s.move()
  const p = (await f.store.feed(a, {}, undefined, 10))[0]
  await f.store.comment(a, p.id, randomUUID(), comment())
  await f.store.react(a, p.id, randomUUID(), true)
  f.outage(true)
  await assert.rejects(f.store.feed(a, {}, undefined, 10), {
    code: "DEPENDENCY_UNAVAILABLE",
  })
  await assert.rejects(f.store.detail(a, p.id), {
    code: "DEPENDENCY_UNAVAILABLE",
  })
  f.outage(false)
  f.people.set(a, [])
  assert.deepEqual(await f.store.feed(a, {}, undefined, 10), [])
  await assert.rejects(f.store.detail(a, p.id), { code: "NOT_FOUND" })
  await assert.rejects(f.store.comments(a, p.id, undefined, 10), {
    code: "NOT_FOUND",
  })
  await assert.rejects(f.store.react(a, p.id, randomUUID(), false), {
    code: "NOT_FOUND",
  })
  const snapshot = await new SocialDataRights(f.store).export(
    a,
    f.request(a),
    "account_data",
  )
  assert.deepEqual(snapshot.data.posts, [])
  assert.deepEqual(snapshot.data.comments, [])
})
test("strict source collision rolls back its page and never advances the committed cursor", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    s = f.makePerson(a)
  s.move()
  await f.store.feed(a, {}, undefined, 10)
  await f.pool.query(
    "UPDATE social_person_sync SET last_projected_world_version=1 WHERE person_id=$1",
    [s.person.id],
  )
  f.histories.get(s.person.id)[0].fromWorld.displayName = "矛盾的来源快照"
  await assert.rejects(f.store.feed(a, {}, undefined, 10), {
    code: "DEPENDENCY_UNAVAILABLE",
  })
  assert.equal(
    (
      await f.pool.query(
        "SELECT last_projected_world_version FROM social_person_sync",
      )
    ).rows[0].last_projected_world_version,
    1,
  )
})
test("raw SQL rejects absent request hashes and source hashes rather than allowing CHECK NULL", async (t) => {
  const f = await fixture(t),
    a = f.account()
  await f.store.create(a, randomUUID(), post())
  await assert.rejects(
    f.pool.query(
      "INSERT INTO posts(account_id,kind,body,client_post_id) VALUES($1,'user','无摘要',$2)",
      [a, randomUUID()],
    ),
    { code: "23514" },
  )
    const source = f.makePerson(a), movement = source.move()
    await assert.rejects(
    f.pool.query(
      "INSERT INTO posts(account_id,kind,body,person_id,world_id,source_movement_id,source_world_version,source_movement) VALUES($1,'world_notice','',$2,$3,$4,2,$5)",
        [a, source.person.id, movement.toWorld.id, movement.id, movement],
    ),
    { code: "23514" },
  )
})
test("stable export includes current facts and interactions; erasure fences all payloads and stale synchronizers", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    s = f.makePerson(a)
  s.move()
  await f.store.feed(a, {}, undefined, 10)
  const p = await f.store.create(a, randomUUID(), post())
  await f.store.comment(a, p.id, randomUUID(), comment())
  await f.store.react(a, p.id, randomUUID(), true)
  const rights = new SocialDataRights(f.store),
    rid = f.request(a),
    one = await rights.export(a, rid, "account_data"),
    two = await rights.export(a, rid, "account_data")
  assert.equal(one.revision, two.revision)
  assert.equal(one.revision, digest(one.data))
  assert.equal(one.data.posts.length, 2)
  assert.equal(one.data.comments.length, 1)
  const del = f.request(a, "delete_account"),
    erased = await rights.erase(a, del)
  assert.equal(erased.alreadyErased, false)
  assert.equal((await rights.erase(a, del)).alreadyErased, true)
  for (const table of [
    "posts",
    "post_comments",
    "post_reactions",
    "social_commands",
    "social_person_sync",
    "outbox_events",
  ])
    assert.equal(
      (await f.pool.query("SELECT count(*)::int n FROM " + table)).rows[0].n,
      0,
    )
  await assert.rejects(f.store.create(a, randomUUID(), post()), {
    code: "NOT_FOUND",
  })
  await assert.rejects(f.store.feed(a, {}, undefined, 10), {
    code: "NOT_FOUND",
  })
  await assert.rejects(
    f.pool.query(
      "INSERT INTO social_person_sync(account_id,person_id,person_access_version) VALUES($1,$2,1)",
      [a, s.person.id],
    ),
    { code: "42501" },
  )
})
test("a formerly valid cached movement is revalidated against its exact source for read, interaction and export", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    s = f.makePerson(a)
  s.move()
  const p = (await f.store.feed(a, {}, undefined, 10))[0],
    rights = new SocialDataRights(f.store),
    rid = f.request(a)
  f.histories.set(s.person.id, [])
  for (const action of [
    () => f.store.feed(a, {}, undefined, 10),
    () => f.store.detail(a, p.id),
    () => f.store.comments(a, p.id, undefined, 10),
    () => f.store.comment(a, p.id, randomUUID(), comment()),
    () => rights.export(a, rid, "account_data"),
  ])
    await assert.rejects(action(), { code: "DEPENDENCY_UNAVAILABLE" })
  assert.equal(
    (await f.pool.query("SELECT count(*)::int n FROM post_comments")).rows[0].n,
    0,
  )
})
test("erasure during source I/O rejects the late projection and RR readers cannot reuse a pre-erasure snapshot", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    s = f.makePerson(a),
    rights = new SocialDataRights(f.store),
    p = await f.store.create(a, randomUUID(), post()),
    old = await f.pool.connect()
  try {
    await old.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
    await old.query("SELECT * FROM posts WHERE id=$1", [p.id])
    s.move()
    const original = f.deps.movements,
      request = f.request(a, "delete_account")
    let erased = false
    f.deps.movements = async (...args) => {
      const result = await original(...args)
      if (!erased) {
        erased = true
        await rights.erase(a, request)
      }
      return result
    }
    await assert.rejects(f.store.feed(a, {}, undefined, 10), {
      code: "NOT_FOUND",
    })
    assert.equal(
      (await f.pool.query("SELECT count(*)::int n FROM posts")).rows[0].n,
      0,
    )
    assert.equal(
      (await f.pool.query("SELECT count(*)::int n FROM social_person_sync"))
        .rows[0].n,
      0,
    )
    await assert.rejects(f.store.gate(old, a), { code: "40001" })
  } finally {
    await old.query("ROLLBACK")
    old.release()
  }
})
test("authority changes during feed response fail closed instead of truncating a signed page into a false end", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    s = f.makePerson(a)
  s.move()
  await f.store.feed(a, {}, undefined, 10)
  const original = f.deps.persons
  let reads = 0
  f.deps.persons = async (...args) => {
    if (++reads === 3) f.people.set(a, [])
    return original(...args)
  }
  await assert.rejects(f.store.feed(a, {}, undefined, 1), {
    code: "DEPENDENCY_UNAVAILABLE",
  })
})
