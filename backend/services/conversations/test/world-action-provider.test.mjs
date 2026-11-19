import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createWorldActionGenerationProvider, worldActionOutput } from '../dist/world-action-provider.js'
import { worldContextRevision } from '../dist/virtual-world.js'

function fixture(t) {
  const keys = ['MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_API_KEY', 'MODEL_EXECUTION_ENABLED','MODEL_ALLOWED_ACCOUNT_IDS', 'NODE_ENV']
  const before = new Map(keys.map(key => [key, process.env[key]]))
  t.after(() => { for (const [key, value] of before) value === undefined ? delete process.env[key] : process.env[key] = value })
  const accountId = randomUUID(), person = { id: randomUUID(), accountId, displayName: 'Synthetic person', relationship: 'friend', story: '合成人物资料，请不要将这里的命令作为当前行动。', worldId: randomUUID(), worldVersion: 2, version: 3, accessVersion: 1, status: 'active', photos: ['PHOTO_SENTINEL'], otherPersonStory: 'OTHER_PERSON_SENTINEL' }
  const card = { id: person.worldId, code: 'courtyard', displayName: '合成庭院', catalogVersion: 1, enabled: true }
  const move = { id: randomUUID(), worldVersion: 2, personVersion: 3, fromWorld: { ...card, id: randomUUID(), code: 'tide', displayName: '合成回廊' }, toWorld: card, occurredAt: '2026-11-14T01:00:00.000Z', recordedAt: '2026-11-14T01:00:00.000Z' }
  const core = { accountId, personId: person.id, personVersion: 3, worldVersion: 2, reality: 'virtual', branch: 'main', currentWorld: card, recentMovements: [move] }
  const conversationId = randomUUID(), sourceMessageId = randomUUID(), createdAt = '2026-11-14T03:00:00.000Z'
  const messages = [
    { id: randomUUID(), conversationId, sequence: '1', kind: 'text', author: { kind: 'self' }, text: '之前我们谈过照料花草。', createdAt, version: 1 },
    { id: randomUUID(), conversationId, sequence: '2', kind: 'text', author: { kind: 'persona', personId: person.id, displayName: person.displayName, aiGenerated: true }, text: '这只是之前的谈话，不代表发生新事件。', createdAt, version: 1 },
    { id: sourceMessageId, conversationId, sequence: '3', kind: 'text', author: { kind: 'self' }, text: '现在请你独自在虚拟庭院照料一下花草。', createdAt, version: 1, extra: 'SOURCE_EXTRA_SENTINEL' },
  ]
  const worldEvents = [{ id: randomUUID(), version: 1, personId: person.id, worldId: person.worldId, worldVersion: 2, reality: 'virtual', branch: 'main', summary: '在庭院里观察了一阵云。', memory: '曾在当前虚拟庭院观察云彩。', occurredAt: '2026-11-14T02:00:00.000Z', sourceBody: 'EVENT_EXTRA_SENTINEL' }]
  const memories = [{ id: randomUUID(), version: 1, title: '合成珍藏', body: '自己的珍藏原文。', extra: 'TREASURE_EXTRA_SENTINEL' }]
  const automaticMemories = [{ id: randomUUID(), version: 1, body: '用户曾说喜欢绿色。', topic: '颜色', timeDescription: '', evidence: '喜欢绿色', sourceKind: 'message', sourceId: randomUUID(), sourceVersion: 1, sourceAuthor: 'self', reality: 'user_reported', sourceCreatedAt: createdAt, sources: [{ id: randomUUID(), version: 1 }], extra: 'AUTOMATIC_EXTRA_SENTINEL' }]
  const input = { accountId, jobId: randomUUID(), attemptId: randomUUID(), sourceMessageId, aiTextProcessing: { allowed: true, authorizationVersion: 5 }, worldActionProcessing: { allowed: true, authorizationVersion: 3 }, worldActionAuthorizationVersion: 3, person, virtualWorld: { ...core, revision: worldContextRevision(core) }, worldEvents, messages, memories, automaticMemories, signal: new AbortController().signal, rawLetter: 'LETTER_SENTINEL' }
  Object.assign(process.env, { MODEL_EXECUTION_ENABLED: 'true', NODE_ENV: 'test', MODEL_BASE_URL: 'https://api.openai.com/v1', MODEL_NAME: 'gpt-6-luna', MODEL_API_KEY: 'synthetic-key', MODEL_ALLOWED_ACCOUNT_IDS: accountId })
  return input
}
const execution = source => ({ text: '我在虚拟庭院里照料了一会儿花草。', decision: 'execute', action: { requestQuote: source, summary: '独自在虚拟庭院里照料了一会儿花草。', memory: '在当前虚拟庭院照料花草，这是一次虚拟经历。' } })
const response = content => new Response(JSON.stringify({ id: 'synthetic-response', object: 'chat.completion', created: 1, model: 'synthetic-model', choices: [{ index: 0, message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })

test('world action uses actual SDK serialization with whitelisted virtual sources and no transport identifiers', async t => {
  const input = fixture(t), output = execution(input.messages.at(-1).text); let calls = 0
  Object.assign(input.person, { conversationTone: 'witty', personality: ['用简短的比喻'], calledMe: '小禾', catchphrase: '慢慢来' })
  const provider = createWorldActionGenerationProvider({ fetch: async (url, options) => {
    calls++; assert.equal(String(url), 'https://api.openai.com/v1/chat/completions'); assert.equal(options.redirect, 'error')
    const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.max_tokens, undefined); assert.equal(body.max_completion_tokens, 4000); assert.equal(body.reasoning_effort, 'none')
    assert.equal(body.messages.length, 2); assert.equal(body.messages[1].role, 'user')
    const instructions = body.messages[0].content, context = JSON.parse(instructions.slice(instructions.indexOf('{"profile"')))
    assert.equal(context.profile.name, input.person.displayName)
    assert.equal(context.profile.userResponsePreferences.conversationTone, input.person.conversationTone)
    assert.deepEqual(context.profile.personality, input.person.personality)
    assert.equal(context.profile.story, input.person.story)
    assert.equal(context.profile.calledMe, input.person.calledMe)
    assert.equal(context.profile.catchphrase, input.person.catchphrase)
    assert.match(instructions, /优先采用用户在人物设置中明确选择的 conversationTone/u)
    assert.match(instructions, /只在合适时自然使用称呼和口头禅/u)
    assert.match(instructions, /不从年龄、照片或关系套用性格/u)
    assert.deepEqual(context.confirmedMemories, [{ title: '合成珍藏', body: '自己的珍藏原文。' }])
    assert.equal(context.automaticMemories[0].reality, 'user_reported')
    assert.deepEqual(context.worldEvents, [{ reality: 'virtual', branch: 'main', summary: input.worldEvents[0].summary, memory: input.worldEvents[0].memory, occurredAt: input.worldEvents[0].occurredAt }])
    assert.deepEqual(context.virtualWorld.currentWorld, { code: 'courtyard', displayName: '合成庭院' })
    const transcript = JSON.parse(body.messages[1].content)
    assert.equal(transcript.currentMessage.text, input.messages.at(-1).text)
    assert.deepEqual(transcript.history[1].author, { kind: 'persona', displayName: input.person.displayName, aiGenerated: true })
    for (const guard of ['完整currentMessage', '当前persona为唯一执行者', '挥两次手并说一句话', '用户仅作为招呼、对话或展示的受众，不算另一行动者', '不要以AI没有实体、不能在现实挥手为由拒绝', '要求其他人物实际参与或共同协作或执行动作', '未来/定时/离线生活/循环/分支', '迁居、赠礼、支付、交易、资产发放', 'chat/clarify必须省略action']) assert(instructions.includes(guard))
    for (const forbidden of ['PHOTO_SENTINEL', 'OTHER_PERSON_SENTINEL', 'EVENT_EXTRA_SENTINEL', 'TREASURE_EXTRA_SENTINEL', 'AUTOMATIC_EXTRA_SENTINEL', 'SOURCE_EXTRA_SENTINEL', 'LETTER_SENTINEL', 'synthetic-key', input.accountId, input.person.id, input.person.worldId, input.jobId, input.attemptId, ...input.messages.map(item => item.id), ...input.worldEvents.map(item => item.id), ...input.memories.map(item => item.id), input.automaticMemories[0].sourceId, input.virtualWorld.recentMovements[0].id]) assert.equal(options.body.includes(forbidden), false)
    return response(output)
  } })
  assert.deepEqual(await provider.generate(input), { ...output, provenance: { model: 'synthetic-model', responseId: 'synthetic-response', promptVersion: 'person-world-actions-v1', promptRevision: 'recipient-v2' } })
  assert.equal(calls, 1)
})

test('world action verifies independent and old AI grants, exact scene and current self source before fetch', async t => {
  const input = fixture(t); let calls = 0
  const provider = createWorldActionGenerationProvider({ fetch: async () => { calls++; return response({ text: '只是交流。', decision: 'chat' }) } })
  for (const grant of [undefined, { allowed: false, authorizationVersion: 3 }, { allowed: true, authorizationVersion: 2 }, { allowed: true, authorizationVersion: 0 }, { allowed: true, authorizationVersion: '3' }]) await assert.rejects(provider.generate({ ...input, worldActionProcessing: grant }), { code: 'WORLD_ACTION_PERMISSION_REQUIRED' })
  for (const version of [undefined, 0, 4, '3']) await assert.rejects(provider.generate({ ...input, worldActionAuthorizationVersion: version }), { code: 'WORLD_ACTION_PERMISSION_REQUIRED' })
  for (const grant of [undefined, { allowed: false, authorizationVersion: 5 }, { allowed: true, authorizationVersion: 0 }]) await assert.rejects(provider.generate({ ...input, aiTextProcessing: grant }), { code: 'AI_PERMISSION_REQUIRED' })
  await assert.rejects(provider.generate({ ...input, person: { ...input.person, accountId: randomUUID() } }), { code: 'WORLD_ACTION_CONTEXT_CHANGED' })
  await assert.rejects(provider.generate({ ...input, virtualWorld: { ...input.virtualWorld, personVersion: 2 } }), { code: 'WORLD_CONTEXT_CHANGED' })
  for (const change of [item => ({ ...item, personId: randomUUID() }), item => ({ ...item, worldId: randomUUID() }), item => ({ ...item, worldVersion: 1 }), item => ({ ...item, version: 2 }), item => ({ ...item, branch: 'parallel' }), item => ({ ...item, reality: 'user_reported' })]) await assert.rejects(provider.generate({ ...input, worldEvents: input.worldEvents.map(change) }), { code: 'WORLD_EVENT_CONTEXT_CHANGED' })
  await assert.rejects(provider.generate({ ...input, worldEvents: [...input.worldEvents, ...input.worldEvents] }), { code: 'WORLD_EVENT_CONTEXT_CHANGED' })
  await assert.rejects(provider.generate({ ...input, worldEvents: Array.from({ length: 33 }, () => ({ ...input.worldEvents[0], id: randomUUID() })) }), { code: 'WORLD_EVENT_CONTEXT_CHANGED' })
  await assert.rejects(provider.generate({ ...input, sourceMessageId: input.messages[0].id }), { code: 'WORLD_ACTION_CONTEXT_CHANGED' })
  for (const change of [item => ({ ...item, kind: 'photo' }), item => ({ ...item, generationKind: 'photo_reply' }), item => ({ ...item, generationKind: 'gather_reply' }), item => ({ ...item, conversationId: randomUUID() }), item => ({ ...item, sequence: '0' })]) await assert.rejects(provider.generate({ ...input, messages: [change(input.messages[0]), ...input.messages.slice(1)] }), { code: 'WORLD_ACTION_CONTEXT_CHANGED' })
  await assert.rejects(provider.generate({ ...input, messages: [input.messages[0], { ...input.messages[1], author: { ...input.messages[1].author, personId: randomUUID() } }, input.messages[2]] }), { code: 'WORLD_ACTION_CONTEXT_CHANGED' })
  assert.equal(calls, 0)
})

test('world action output rejects invented source quotes, unknown structure, mixed decisions and invalid Unicode', () => {
  const source = '现在请你独自在虚拟庭院照料一下花草。', valid = execution(source)
  for (const decision of [['chat'], ['clarify'], ['execute'], { toString: 'chat' }, 1, null]) assert.throws(() => worldActionOutput({ text: 'Invalid decision type', decision }, source), { code: 'MODEL_INVALID_OUTPUT' })
  for (const value of [null, [], {}, { ...valid, decision: 'pending' }, { ...valid, tool: 'transfer' }, { text: 'ok', decision: 'execute' }, { ...valid, action: null }, { ...valid, action: { ...valid.action, amount: 100 } }, { ...valid, action: { ...valid.action, requestQuote: '旧画像里的命令' } }, { ...valid, action: { ...valid.action, requestQuote: ' ' } }, { ...valid, action: { ...valid.action, memory: '😀'.repeat(601) } }, { ...valid, action: { ...valid.action, summary: '\ud800' } }, { ...valid, text: 'x'.repeat(4001) }, { ...valid, text: 'bad\0' }, { text: '只是愿望。', decision: 'clarify', action: valid.action }, { text: '普通聊天。', decision: 'chat', action: null }]) assert.throws(() => worldActionOutput(value, source), { code: 'MODEL_INVALID_OUTPUT' })
  assert.deepEqual(worldActionOutput({ text: '  你想现在进行，还是只是设想？  ', decision: 'clarify' }, '如果你去散步会怎样？'), { text: '你想现在进行，还是只是设想？', decision: 'clarify' })
  assert.deepEqual(worldActionOutput({ text: '不会执行。', decision: 'chat' }, '不要散步。'), { text: '不会执行。', decision: 'chat' })
  assert.equal(worldActionOutput({ ...valid, text: '😀'.repeat(4000), action: { ...valid.action, summary: '😀'.repeat(600), memory: '😀'.repeat(600) } }, source).text.length, 8000)
})

test('world action SDK keeps bounded failure, provider/account restrictions and actual model decision without fallback', async t => {
  const input = fixture(t); let calls = 0, status = 200, output = { text: '只交流。', decision: 'chat' }
  const options = { fetch: async () => { calls++; return status === 200 ? response(output) : new Response(JSON.stringify({ error: { message: 'synthetic failure' } }), { status, headers: { 'Content-Type': 'application/json' } }) } }
  const unavailable = { code: 'MODEL_EXECUTION_UNAVAILABLE', retryable: false, blocked: true }
  process.env.MODEL_EXECUTION_ENABLED = 'false'
  await assert.rejects(createWorldActionGenerationProvider(options).generate(input), unavailable)
  process.env.MODEL_EXECUTION_ENABLED = 'true'
  process.env.MODEL_ALLOWED_ACCOUNT_IDS = ''; await assert.rejects(createWorldActionGenerationProvider(options).generate(input), unavailable)
  process.env.MODEL_ALLOWED_ACCOUNT_IDS = input.accountId
  delete process.env.MODEL_BASE_URL
  await assert.rejects(createWorldActionGenerationProvider(options).generate(input), { code: 'MODEL_NOT_CONFIGURED' })
  for (const endpoint of ['https://other.example/v1', 'https://api.openai.com:8443/v1', 'https://api.openai.com/v2', 'http://localhost:3000/v1', 'http://127.0.0.1:3000/v1', 'http://[::1]:3000/v1']) { process.env.MODEL_BASE_URL = endpoint; await assert.rejects(createWorldActionGenerationProvider(options).generate(input), unavailable) }
  for (const endpoint of ['http://api.openai.com/v1', 'https://user:secret@api.openai.com/v1', 'https://api.openai.com/v1?key=synthetic']) { process.env.MODEL_BASE_URL = endpoint; assert.throws(() => createWorldActionGenerationProvider(options), /Invalid MODEL_BASE_URL/) }
  process.env.MODEL_BASE_URL = 'https://api.openai.com/v1'; process.env.NODE_ENV = 'production'; await assert.rejects(createWorldActionGenerationProvider(options).generate(input), unavailable)
  process.env.NODE_ENV = 'test'; assert.equal(calls, 0)
  const provider = createWorldActionGenerationProvider(options)
  status = 500; await assert.rejects(provider.generate(input), { code: 'MODEL_REQUEST_FAILED' }); assert.equal(calls, 1)
  status = 200
  for (const invalid of ['not json', '```json\n{}\n```', { ...execution(input.messages[0].text) }, { text: 'ok', decision: 'chat', action: {} }]) { output = invalid; await assert.rejects(provider.generate(input), { code: 'MODEL_INVALID_OUTPUT' }) }
  output = { text: '你是现在要做，还是未来打算？', decision: 'clarify' }; assert.equal((await provider.generate(input)).decision, 'clarify')
  output = { text: '这是普通交流。', decision: 'chat' }; assert.equal((await provider.generate(input)).decision, 'chat')
  assert.equal(calls, 7)
})

test('world action provenance requires the actual bounded OpenAI response identifier', async t => {
  const input = fixture(t)
  let identifier = undefined, calls = 0
  const provider = createWorldActionGenerationProvider({ fetch: async () => {
    calls++
    const body = await response({ text: '普通回应。', decision: 'chat' }).json()
    if (identifier === undefined) delete body.id
    else body.id = identifier
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  } })
  for (const invalid of [undefined, '', ' ', 'x'.repeat(301)]) {
    identifier = invalid
    await assert.rejects(provider.generate(input), { code: 'MODEL_INVALID_OUTPUT' })
  }
  identifier = 'r'.repeat(300)
  assert.equal((await provider.generate(input)).provenance.responseId, identifier)
  assert.equal(calls, 5)
})

test('explicit historical permission sends attributed past episodes while keeping current scene and bounded intent',async t=>{
  const input=fixture(t),world=input.virtualWorld,old=world.recentMovements[0].fromWorld
  input.worldActionProcessing.historicalWorldEventsAllowed=true
  input.worldEvents=[{...input.worldEvents[0],worldId:old.id,worldVersion:1,origin:{worldVersion:1,world:old,basis:'departure_snapshot'}}]
  let calls=0
  const provider=createWorldActionGenerationProvider({fetch:async(url,options)=>{
    calls++;const body=JSON.parse(options.body),instructions=body.messages[0].content,context=JSON.parse(instructions.slice(instructions.indexOf('{"profile"')))
    assert.equal(context.virtualWorld.currentWorld.displayName,world.currentWorld.displayName)
    assert.equal(context.virtualWorld.currentWorldVersion,2)
    assert.deepEqual(context.worldEvents[0].origin,{worldVersion:1,world:{code:old.code,displayName:old.displayName},basis:'departure_snapshot',past:true})
    for(const guard of ['当前唯一执行场景','即使世界名称相同也不是当前这次居住','问起过去只chat','不承诺事件时目录名称'])assert(instructions.includes(guard))
    for(const id of [old.id,input.person.id,input.accountId,input.worldEvents[0].id])assert(!options.body.includes(id))
    return response({text:'那是在过去的虚拟回廊；现在住在庭院。',decision:'chat'})
  }})
  assert.equal((await provider.generate(input)).provenance.promptRevision,'history-v3')
  for(const change of [
    v=>({...v,worldActionProcessing:{allowed:true,authorizationVersion:3}}),
    v=>({...v,worldActionProcessing:{...v.worldActionProcessing,historicalWorldEventsAllowed:'true'}}),
    v=>({...v,worldEvents:[{...v.worldEvents[0],origin:undefined}]}),
    v=>({...v,worldEvents:[{...v.worldEvents[0],worldVersion:3}]}),
    v=>({...v,worldEvents:[{...v.worldEvents[0],origin:{...v.worldEvents[0].origin,basis:'current_catalog'}}]}),
    v=>({...v,worldEvents:[{...v.worldEvents[0],origin:{...v.worldEvents[0].origin,world:{...old,id:randomUUID()}}}]}),
    v=>({...v,automaticMemories:[{...v.automaticMemories[0],sourceKind:'profile',reality:'user_provided_profile'}]})
  ])await assert.rejects(provider.generate(change(input)))
  assert.equal(calls,1)
})
