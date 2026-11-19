import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { SocialStore } from "../dist/store.js"
import { notFound, unavailable } from "../dist/contracts.js"
export async function fixture(t) {
  const connectionString = process.env.XIJIE_TEST_DATABASE_URL
  if (!connectionString)
    throw new Error("Set XIJIE_TEST_DATABASE_URL to an isolated test database")
  const schema = "social_test_" + randomUUID().replaceAll("-", ""),
    admin = new pg.Pool({ connectionString })
  await admin.query("CREATE SCHEMA " + schema)
  const pool = new pg.Pool({
    connectionString,
    options: "-c search_path=" + schema,
    application_name:schema,
  })
  t.after(async () => {
    await pool.end()
    await admin.query("DROP SCHEMA " + schema + " CASCADE")
    await admin.end()
  })
  await pool.query(
    await readFile(new URL("../db/001_social.sql", import.meta.url), "utf8"),
  )
  await pool.query(await readFile(new URL("../db/002_memory_echo.sql",import.meta.url),"utf8"))
  await pool.query(await readFile(new URL("../db/003_private_post_media.sql",import.meta.url),"utf8"))
  const accounts = new Map(),
    people = new Map(),
    histories = new Map(),
    requests = new Map()
  let outage = false
  const deps = {
    async account(id) {
      if (!accounts.has(id)) throw notFound()
      return structuredClone(accounts.get(id))
    },
    async persons(id) {
      if (outage) throw unavailable()
      return structuredClone(people.get(id) ?? [])
    },
    async movements(accountId, personId, afterVersion, throughVersion, limit) {
      if (outage) throw unavailable()
      const person = (people.get(accountId) ?? []).find(
        (p) => p.id === personId,
      )
      if (!person) throw notFound()
      const items = (histories.get(personId) ?? [])
        .filter(
          (m) =>
            m.worldVersion > afterVersion && m.worldVersion <= throughVersion,
        )
        .slice(0, limit)
      const nextAfterVersion = items.at(-1)?.worldVersion ?? afterVersion
      return structuredClone({
        accountId,
        person,
        items,
        nextAfterVersion,
        hasMore: nextAfterVersion < throughVersion,
      })
    },
    async dataRequest(id) {
      if (!requests.has(id)) throw notFound()
      return structuredClone(requests.get(id))
    },
    async session(cookie, expected) {
      const id = cookie.replace("test=", ""),
        a = accounts.get(id)
      if (!a || (expected && expected !== id)) throw notFound()
      return {
        accountId: id,
        sessionId: id,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        storyStorage: a.storyStorage,
      }
    },
  }
  const account = () => {
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
    })
    people.set(id, [])
    return id
  }
  const card = (name) => ({
    id: randomUUID(),
    code: name,
    displayName: name,
    catalogVersion: 1,
    enabled: true,
  })
  const makePerson = (a) => {
    const worlds = [card("courtyard"), card("tide")],
      person = {
        id: randomUUID(),
        displayName: "合成旅人",
        worldId: worlds[0].id,
        version: 1,
        accessVersion: 1,
        worldVersion: 1,
      }
    people.get(a).push(person)
    histories.set(person.id, [])
    return {
      person,
      worlds,
      move() {
        const from = worlds.find((w) => w.id === person.worldId),
          to = worlds.find((w) => w.id !== person.worldId)
        person.worldId = to.id
        person.version++
        person.worldVersion++
        const at = new Date().toISOString(),
          m = {
            id: randomUUID(),
            worldVersion: person.worldVersion,
            personVersion: person.version,
            fromWorld: from,
            toWorld: to,
            occurredAt: at,
            recordedAt: at,
          }
        histories.get(person.id).push(m)
        return m
      },
    }
  }
  const request = (a, kind = "export") => {
    const id = randomUUID()
    requests.set(id, {
      requestId: id,
      accountId: a,
      kind,
      scope: "account_data",
      status: "processing",
      accountStatus: kind === "export" ? "active" : "deletion_pending",
      accountAccessVersion: 1,
    })
    return id
  }
  return {
    pool,
    deps,
    accounts,
    people,
    histories,
    requests,
    account,
    makePerson,
    request,
    store: new SocialStore(pool, deps),
    outage(value) {
      outage = value
    },
  }
}
export const post = (body = "合成私人日常") => ({
  clientPostId: randomUUID(),
  body,
})
export const comment = (body = "合成手动评论", replyToCommentId) => ({
  clientCommentId: randomUUID(),
  body,
  ...(replyToCommentId ? { replyToCommentId } : {}),
})
