import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { ConversationStore } from "../dist/store.js"
import { ConversationQueue } from "../dist/queue.js"
import { ConversationError } from "../dist/contracts.js"

export async function fixture(t) {
  const connectionString = process.env.XIJIE_TEST_DATABASE_URL
  if (!connectionString)
    throw new Error(
      "Set XIJIE_TEST_DATABASE_URL to a PostgreSQL integration test database.",
    )
  const suffix = randomUUID().replaceAll("-", ""),
    schema = "chat_test_" + suffix,
    queueSchema = "chat_queue_" + suffix
  const admin = new pg.Pool({ connectionString })
  await admin.query("CREATE SCHEMA " + schema)
  const pool = new pg.Pool({
    connectionString,
    options: "-c search_path=" + schema,
  })
  await pool.query(
    await readFile(
      new URL("../db/001_conversations.sql", import.meta.url),
      "utf8",
    ),
  )
  await pool.query(await readFile(new URL('../db/002_ai_text_authorization.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/003_data_rights.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/004_automatic_memory_sources.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/005_virtual_world_context.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/006_gift_cards.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/007_gift_card_integrity.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/008_received_gift_cards.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/009_letters.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/010_gather.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/011_chat_photos.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/012_world_actions.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/013_story_life.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/014_text_input_mode.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/015_voice_calls.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../db/017_letter_memory_source.sql', import.meta.url), 'utf8'))
  const queue = await new ConversationQueue(
    connectionString,
    queueSchema,
  ).start()
  t.after(async () => {
    await queue.stop()
    await pool.end()
    await admin.query("DROP SCHEMA " + queueSchema + " CASCADE")
    await admin.query("DROP SCHEMA " + schema + " CASCADE")
    await admin.end()
  })
  const accounts = new Map(),
    people = new Map(),
    sessions = new Map()
  const dependencies = {
    async session(cookie, expected) {
      const credential = /xijie_dev_session=([^;]+)/.exec(cookie)?.[1]
      const session = sessions.get(credential)
      if (!session || (expected && expected !== session.sessionId))
        throw new ConversationError(401, "UNAUTHENTICATED", "Sign in")
      return session
    },
    async account(accountId) {
      const value = accounts.get(accountId)
      if (!value) throw new ConversationError(404, "NOT_FOUND", "Missing")
      return structuredClone(value)
    },
    async person(accountId, id) {
      const value = people.get(id)
      if (!value || value.accountId !== accountId)
        throw new ConversationError(404, "NOT_FOUND", "Missing")
      return structuredClone(value)
    },
    async persons(accountId) {
      return [...people.values()]
        .filter((value) => value.accountId === accountId)
        .map((value) => structuredClone(value))
    },
  }
  function account() {
    const id = randomUUID(),
      sessionId = randomUUID(),
      credential = randomUUID().replaceAll("-", "").padEnd(43, "x")
    accounts.set(id, {
      accountId: id,
      status: "active",
      accessVersion: 1,
      storyStorage: { allowed: true, authorizationVersion: 1 },
      aiTextProcessing: { allowed: true, authorizationVersion: 1 },
    })
    sessions.set(credential, {
      accountId: id,
      sessionId,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      storyStorage: accounts.get(id).storyStorage,
      aiTextProcessing: accounts.get(id).aiTextProcessing,
    })
    const person = {
      id: randomUUID(),
      accountId: id,
      status: "active",
      displayName: "Synthetic friend",
      relationship: "friend",
      story: "Synthetic story, no real person data.",
      worldId: randomUUID(),
      version: 1,
      accessVersion: 1,
    }
    people.set(person.id, person)
    return { id, person, sessionId, credential }
  }
  return {
    pool,
    queue,
    schema,
    queueSchema,
    store: new ConversationStore(pool, dependencies, queue),
    dependencies,
    accounts,
    people,
    sessions,
    account,
  }
}
export const text = (value = "Test message") => ({
  clientMessageId: randomUUID(),
  kind: "text",
  text: value,
  inputMode: "typed",
})
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export async function eventually(work) {
  for (let i = 0; i < 60; i++) {
    if (await work()) return
    await sleep(100)
  }
  assert.fail("Condition did not complete")
}
