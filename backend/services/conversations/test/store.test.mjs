import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { fork } from "node:child_process"
import { once } from "node:events"
import { test } from "node:test"
import { fixture, text, eventually } from "./fixture.mjs"
import { textInput } from "../dist/contracts.js"
import { ConversationStore } from "../dist/store.js"
import { GenerationEngine } from "../dist/engine.js"
import { REPLY_QUEUE } from "../dist/queue.js"
import { createGenerationProvider, GenerationError } from "../dist/provider.js"

test("conversations persist text and protect queue, history, account and task state", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    b = f.account()
  const first = await f.store.ensure(a.id, a.person.id, randomUUID())
  const cid = first.conversation.id
  assert.equal(first.created, true)
  assert.equal(
    (await f.store.ensure(a.id, a.person.id, randomUUID())).conversation.id,
    cid,
  )
  await assert.rejects(f.store.ensure(b.id, a.person.id, randomUUID()), {
    code: "NOT_FOUND",
  })
  assert.equal((await f.store.summaries(b.id))[0].conversationId, null)
  assert.throws(
    () =>
      textInput({
        clientMessageId: randomUUID(),
        kind: "text",
        text: "\ud800",
      }),
    { code: "INVALID_ARGUMENT" },
  )
  assert.throws(() => textInput({ ...text(), author: { kind: "persona" } }), {
    code: "INVALID_ARGUMENT",
  })
  assert.equal(
    [...textInput({ ...text(), text: " 😀 ".trim() }).text].length,
    1,
  )
  let accepted
  await t.test(
    "stable client intent and transport keys persist one message, job, event and real pg-boss enqueue",
    async () => {
      const input = textInput({
          ...text(),
          text: "  Original line.\nSecond line.  ",
        }),
        key = randomUUID()
      accepted = await f.store.send(a.id, cid, key, input, randomUUID())
      assert.equal(accepted.message.text, "Original line.\nSecond line.")
      assert.equal(accepted.message.sequence, "1")
      assert.equal(accepted.message.generationJobId, accepted.generationJobId)
      assert.deepEqual(
        await f.store.send(a.id, cid, key, input, randomUUID()),
        accepted,
      )
      assert.deepEqual(
        await f.store.send(a.id, cid, randomUUID(), input, randomUUID()),
        accepted,
      )
      await assert.rejects(
        f.store.send(
          a.id,
          cid,
          key,
          { ...input, text: "changed" },
          randomUUID(),
        ),
        { code: "IDEMPOTENCY_CONFLICT" },
      )
      await assert.rejects(
        f.store.send(
          a.id,
          cid,
          randomUUID(),
          { ...input, text: "changed" },
          randomUUID(),
        ),
        { code: "IDEMPOTENCY_CONFLICT" },
      )
      const counts = await f.pool.query(
        `SELECT (SELECT count(*)::int FROM messages) AS messages,(SELECT count(*)::int FROM generation_jobs) AS jobs,(SELECT count(*)::int FROM outbox_events) AS events,(SELECT count(*)::int FROM ${f.queueSchema}.job) AS queued`,
      )
      assert.deepEqual(counts.rows[0], {
        messages: 1,
        jobs: 1,
        events: 1,
        queued: 1,
      })
      await assert.rejects(
        f.store.messages(b.id, cid, "older", undefined, 20),
        { code: "NOT_FOUND" },
      )
      await assert.rejects(f.store.getJob(b.id, accepted.generationJobId), {
        code: "NOT_FOUND",
      })
    },
  )
  await t.test(
    "concurrent messages receive distinct bigint sequences and enqueue failure rolls back domain data",
    async () => {
      const sent = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          f.store.send(
            a.id,
            cid,
            randomUUID(),
            text("Concurrent " + i),
            randomUUID(),
          ),
        ),
      )
      assert.deepEqual(sent.map((row) => row.message.sequence).sort(), [
        "2",
        "3",
        "4",
        "5",
      ])
      const before = await f.pool.query(
        "SELECT count(*)::int AS total FROM messages",
      )
      const broken = new ConversationStore(f.pool, f.dependencies, {
        async send(db) {
          await db.query("SELECT 1")
          throw new Error("Injected queue rejection")
        },
      })
      await assert.rejects(
        broken.send(
          a.id,
          cid,
          randomUUID(),
          text("must roll back"),
          randomUUID(),
        ),
        /Injected/,
      )
      assert.deepEqual(
        (await f.pool.query("SELECT count(*)::int AS total FROM messages"))
          .rows,
        before.rows,
      )
      assert.equal(
        (
          await f.pool.query(
            "SELECT last_sequence FROM conversations WHERE id=$1",
            [cid],
          )
        ).rows[0].last_sequence,
        "5",
      )
      assert.deepEqual(
        (await f.store.messages(a.id, cid, "older", undefined, 2)).map(
          (row) => row.sequence,
        ),
        ["5", "4"],
      )
      assert.deepEqual(
        (await f.store.messages(a.id, cid, "newer", "2", 20)).map(
          (row) => row.sequence,
        ),
        ["3", "4", "5"],
      )
    },
  )
  await t.test(
    "provider output uses actual persisted context and commits exactly one reply; terminal replay does nothing",
    async () => {
      let calls = 0
      const engine = new GenerationEngine(f.store, {
        async generate(input) {
          calls++
          assert.equal(input.accountId, a.id)
          assert.equal(input.messages.at(-1).text, accepted.message.text)
          return {
            text: "Controlled fixture output, not a real model response.",
          }
        },
      })
      await engine.run(accepted.generationJobId)
      await engine.run(accepted.generationJobId)
      assert.equal(calls, 1)
      const job = await f.store.getJob(a.id, accepted.generationJobId)
      assert.equal(job.state, "succeeded")
      assert.equal(job.replyIds.length, 1)
      const reply = (
        await f.store.messages(a.id, cid, "older", undefined, 20)
      ).find((row) => row.id === job.replyIds[0])
      assert.equal(reply.author.displayName, a.person.displayName)
      assert.equal(reply.author.aiGenerated, true)
      assert.equal(reply.replyToMessageId, accepted.message.id)
    },
  )
  await t.test(
    "cancel, source deletion and authorization change prevent late output",
    async () => {
      for (const mode of ["cancel", "delete", "revoke", "remove-person"]) {
        const input = text("Barrier " + mode),
          sent = await f.store.send(
            a.id,
            cid,
            randomUUID(),
            input,
            randomUUID(),
          )
        let release, reached
        const gate = new Promise((resolve) => {
            release = resolve
          }),
          started = new Promise((resolve) => {
            reached = resolve
          })
        const engine = new GenerationEngine(f.store, {
          async generate() {
            reached()
            await gate
            return { text: "Must not be committed" }
          },
        })
        const run = engine.run(sent.generationJobId)
        await started
        if (mode === "cancel")
          await f.store.cancel(
            a.id,
            sent.generationJobId,
            randomUUID(),
            randomUUID(),
          )
        if (mode === "delete")
          await f.store.removeMessage(
            a.id,
            cid,
            sent.message.id,
            randomUUID(),
            1,
            randomUUID(),
          )
        if (mode === "revoke") {
          f.accounts.get(a.id).storyStorage.allowed = false
          f.accounts.get(a.id).storyStorage.authorizationVersion++
        }
        if (mode === "remove-person") f.people.delete(a.person.id)
        release()
        await run
        const raw = await f.store.findJob(sent.generationJobId)
        assert.equal(raw.reply_id, null)
        assert.equal(
          raw.state,
          mode === "cancel" || mode === "delete" ? "canceled" : "blocked",
        )
        if (mode === "delete")
          await assert.rejects(
            f.store.send(a.id, cid, randomUUID(), input, randomUUID()),
            { code: "NOT_FOUND" },
          )
        if (mode === "revoke") {
          f.accounts.get(a.id).storyStorage.allowed = true
          f.accounts.get(a.id).storyStorage.authorizationVersion++
        }
        if (mode === "remove-person") {
          await assert.rejects(f.store.getJob(a.id, sent.generationJobId), {
            code: "NOT_FOUND",
          })
          await assert.rejects(
            f.store.messages(a.id, cid, "older", undefined, 20),
            { code: "NOT_FOUND" },
          )
          f.people.set(a.person.id, a.person)
        }
      }
    },
  )
  await t.test(
    "retry preserves the business job and expired attempts cannot write after a new claim",
    async (t) => {
      const f=await fixture(t),a=f.account(),cid=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id
      const sent = await f.store.send(
        a.id,
        cid,
        randomUUID(),
        text("Retry message"),
        randomUUID(),
      )
      const failed = new GenerationEngine(f.store, {
        async generate() {
          throw new GenerationError("MODEL_NOT_CONFIGURED", true)
        },
      })
      await failed.run(sent.generationJobId)
      assert.equal(
        (await f.store.getJob(a.id, sent.generationJobId)).failure.code,
        "MODEL_NOT_CONFIGURED",
      )
      const key = randomUUID(),
        retried = await f.store.retry(
          a.id,
          sent.generationJobId,
          key,
          randomUUID(),
        )
      assert.equal(retried.id, sent.generationJobId)
      assert.equal(retried.state, "queued")
      assert.deepEqual(
        await f.store.retry(a.id, sent.generationJobId, key, randomUUID()),
        retried,
      )
      const claim = await f.store.claim(sent.generationJobId)
      await f.pool.query(
        "UPDATE generation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [sent.generationJobId],
      )
      const replacement = await f.store.claim(sent.generationJobId)
      const context = await f.store.context(replacement)
      assert.notEqual(claim.attempt_id, replacement.attempt_id)
      assert.equal(
        await f.store.complete(claim, "Late old attempt", "Fixture", context),
        false,
      )
      assert.equal(
        await f.store.complete(
          replacement,
          "Accepted current attempt",
          "Fixture",
          context,
        ),
        true,
      )
      assert.equal(
        (await f.store.getJob(a.id, sent.generationJobId)).replyIds.length,
        1,
      )
      const replay = await f.store.retry(
        a.id,
        sent.generationJobId,
        key,
        randomUUID(),
      )
      assert.equal(replay.state, "succeeded")
      assert.equal(replay.replyIds.length, 1)
    },
  )
  await t.test(
    "an output arriving after its lease expires becomes a retryable failure rather than an orphaned running job",
    async () => {
      const sent = await f.store.send(
        a.id,
        cid,
        randomUUID(),
        text("Lease expiry without replacement"),
        randomUUID(),
      )
      const engine = new GenerationEngine(f.store, {
        async generate() {
          await f.pool.query(
            "UPDATE generation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
            [sent.generationJobId],
          )
          return { text: "Expired result must not be committed" }
        },
      })
      await engine.run(sent.generationJobId)
      const result = await f.store.getJob(a.id, sent.generationJobId)
      assert.equal(result.state, "failed")
      assert.equal(result.failure.code, "MODEL_TIMEOUT")
      assert.equal(result.failure.retryable, true)
      assert.deepEqual(result.replyIds, [])
    },
  )
  await t.test(
    "removing an older non-source message after context was read blocks the dependent response",
    async () => {
      const older = await f.store.send(
        a.id,
        cid,
        randomUUID(),
        text("Older message used as context"),
        randomUUID(),
      )
      const newer = await f.store.send(
        a.id,
        cid,
        randomUUID(),
        text("Later source message"),
        randomUUID(),
      )
      let reached, release
      const started = new Promise((resolve) => {
          reached = resolve
        }),
        gate = new Promise((resolve) => {
          release = resolve
        })
      const engine = new GenerationEngine(f.store, {
        async generate(input) {
          assert.equal(
            input.messages.some((item) => item.id === older.message.id),
            true,
          )
          reached()
          await gate
          return {
            text: "Must not retain a response based on removed context.",
          }
        },
      })
      const run = engine.run(newer.generationJobId)
      await started
      await f.store.removeMessage(
        a.id,
        cid,
        older.message.id,
        randomUUID(),
        1,
        randomUUID(),
      )
      release()
      await run
      const result = await f.store.getJob(a.id, newer.generationJobId)
      assert.equal(result.state, "blocked")
      assert.equal(result.failure.code, "CONTEXT_REVOKED")
      assert.deepEqual(result.replyIds, [])
    },
  )
  await t.test(
    "real queue dispatcher executes the persisted job and the missing model never produces a fake reply",
    async (t) => {
      const f=await fixture(t),a=f.account(),cid=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id
      const sent = await f.store.send(
        a.id,
        cid,
        randomUUID(),
        text("Queue dispatch"),
        randomUUID(),
      )
      const engine = new GenerationEngine(f.store, {
        async generate() {
          throw new GenerationError("MODEL_NOT_CONFIGURED", true)
        },
      })
      await f.queue.work((id) => engine.run(id))
      await eventually(async () =>
        ["failed", "blocked", "succeeded"].includes(
          (await f.store.findJob(sent.generationJobId)).state,
        ),
      )
      const result = await f.store.getJob(a.id, sent.generationJobId)
      assert.equal(result.state, "failed")
      assert.equal(result.failure.code, "MODEL_NOT_CONFIGURED")
      assert.deepEqual(result.replyIds, [])
      const provider = createGenerationProvider()
      if (!process.env.MODEL_BASE_URL)
        await assert.rejects(provider.generate({ accountId: a.id, aiTextProcessing: f.accounts.get(a.id).aiTextProcessing }), {
          code: "MODEL_NOT_CONFIGURED",
        })
    },
  )
})

test('graceful Worker shutdown requeues the same business task and restart completes it',async t=>{
 const f=await fixture(t),a=f.account(),cid=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id
 const sent=await f.store.send(a.id,cid,randomUUID(),text('Synthetic graceful shutdown'),randomUUID())
 const child=fork(new URL('./crash-worker.mjs',import.meta.url),[],{silent:true,execArgv:[],env:{...process.env,CHAT_CRASH_SCHEMA:f.schema,CHAT_CRASH_QUEUE_SCHEMA:f.queueSchema,CHAT_CRASH_CONTEXT:JSON.stringify({account:f.accounts.get(a.id),person:a.person})}})
 t.after(()=>child.kill('SIGKILL'))
 await once(child,'message')
 const original=await f.store.findJob(sent.generationJobId),exited=once(child,'exit')
 child.send({shutdown:true});await exited
 const released=await f.store.findJob(sent.generationJobId)
 assert.equal(released.state,'queued');assert.equal(released.failure_code,null)
 const engine=new GenerationEngine(f.store,{async generate(){return {text:'Controlled fixture after graceful restart.'}}})
 await f.queue.work(id=>engine.run(id))
 await eventually(async()=>(await f.store.findJob(sent.generationJobId)).state==='succeeded')
 const recovered=await f.store.findJob(sent.generationJobId)
 assert.notEqual(recovered.attempt_id,original.attempt_id);assert.equal(recovered.attempt_count,2)
})

test('repeated killed deliveries exhaust the real queue and reconcile the stranded domain task',async t=>{
 const f=await fixture(t),a=f.account(),cid=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id
 const sent=await f.store.send(a.id,cid,randomUUID(),text('Synthetic bounded crash exhaustion'),randomUUID())
 for(let i=0;i<4;i++){
  const child=fork(new URL('./crash-worker.mjs',import.meta.url),[],{silent:true,execArgv:[],env:{...process.env,CHAT_CRASH_SCHEMA:f.schema,CHAT_CRASH_QUEUE_SCHEMA:f.queueSchema,CHAT_CRASH_CONTEXT:JSON.stringify({account:f.accounts.get(a.id),person:a.person}),CHAT_CRASH_BEFORE_CLAIM:i===3?'true':'false'}})
  t.after(()=>child.kill('SIGKILL'))
  const timeout=setTimeout(()=>child.kill('SIGKILL'),10000)
  const [notice]=await once(child,'message');assert.equal(notice.stage,i===3?'fetched':'model-started')
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;clearTimeout(timeout)
  await f.pool.query("UPDATE generation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[sent.generationJobId])
  await f.pool.query('UPDATE '+f.queueSchema+".job SET started_on=clock_timestamp()-interval '2 minutes' WHERE data->>'jobId'=$1",[sent.generationJobId])
  await eventually(async()=>{
   await f.queue.boss.supervise()
   const [physical]=await f.queue.boss.findJobs(REPLY_QUEUE,{data:{jobId:sent.generationJobId}})
   return physical.state===(i===3?'failed':'retry')
  })
 }
 assert.equal((await f.store.findJob(sent.generationJobId)).state,'running')
 await f.store.reconcileDeliveries()
 const result=await f.store.getJob(a.id,sent.generationJobId)
 assert.equal(result.state,'failed');assert.equal(result.failure.code,'DELIVERY_EXHAUSTED');assert.equal(result.failure.retryable,false);assert.deepEqual(result.replyIds,[])
})

test("a killed worker is redelivered by pg-boss and completes through a fresh fenced attempt", async (t) => {
  const f = await fixture(t),
    a = f.account(),
    conversation = await f.store.ensure(a.id, a.person.id, randomUUID())
  const sent = await f.store.send(
    a.id,
    conversation.conversation.id,
    randomUUID(),
    text("Synthetic process-crash recovery"),
    randomUUID(),
  )
  const child = fork(new URL("./crash-worker.mjs", import.meta.url), [], {
    silent: true,
    execArgv: [],
    env: {
      ...process.env,
      CHAT_CRASH_SCHEMA: f.schema,
      CHAT_CRASH_QUEUE_SCHEMA: f.queueSchema,
      CHAT_CRASH_CONTEXT: JSON.stringify({
        account: f.accounts.get(a.id),
        person: a.person,
      }),
    },
  })
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL")
  })
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10000)
  t.after(() => clearTimeout(timeout))
  const [notice] = await once(child, "message")
  assert.equal(notice.stage, "model-started")
  const original = await f.store.findJob(sent.generationJobId)
  assert.equal(original.state, "running")
  const exited = once(child, "exit")
  child.kill("SIGKILL")
  await exited
  clearTimeout(timeout)
  // Advance only this isolated test's persisted expiry timestamps to avoid a 60-second wait.
  await f.pool.query(
    "UPDATE generation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [sent.generationJobId],
  )
  await f.pool.query(
    "UPDATE " +
      f.queueSchema +
      ".job SET started_on=clock_timestamp()-interval '2 minutes' WHERE data->>'jobId'=$1",
    [sent.generationJobId],
  )
  const engine = new GenerationEngine(f.store, {
    async generate() {
      return { text: "Controlled fixture after process recovery." }
    },
  })
  await f.queue.work((id) => engine.run(id))
  await eventually(async () => {
    await f.queue.boss.supervise()
    return (await f.store.findJob(sent.generationJobId)).state === "succeeded"
  })
  const recovered = await f.store.findJob(sent.generationJobId)
  assert.notEqual(recovered.attempt_id, original.attempt_id)
  assert.equal(recovered.attempt_count, 2)
  assert.equal(
    (await f.store.getJob(a.id, sent.generationJobId)).replyIds.length,
    1,
  )
  assert.equal(
    await f.store.complete(
      original,
      "Dead worker late result",
      "Fixture",
      await f.store.context(original),
    ),
    false,
  )
})
