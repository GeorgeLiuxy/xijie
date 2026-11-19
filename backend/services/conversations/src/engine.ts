import { ConversationError } from "./contracts.js"
import type { ConversationStore } from "./store.js"
import { GenerationError, type GenerationProvider } from "./provider.js"
import type {MemoryUse} from './dependencies.js'
import {sameVirtualWorldUse,virtualWorldUse} from './virtual-world.js'
import type {WorldActionResult,WorldEventRef} from './world-action-contracts.js'
import {needsCurrentSelfHarmSupport,SELF_HARM_SUPPORT_REQUIRED} from './conversation-safety.js'
export class GenerationEngine {
  private readonly active = new Set<AbortController>()
  private stopping=false
  constructor(
    private readonly store: ConversationStore,
    private readonly provider: GenerationProvider,
  ) {}
  async run(id: string) {
    if(this.stopping)throw new Error('Conversation worker is stopping')
    const current = await this.store.claim(id)
    if (!current) return
    if(this.stopping){await this.store.release(current);throw new Error('Conversation worker stopped while claiming')}
    const controller = new AbortController()
    this.active.add(controller)
    let checking = false
    const monitor = setInterval(() => {
      if (checking) return
      checking = true
      void this.store
        .findJob(id)
        .then((value) => {
          if (
            !value ||
            value.state !== "running" ||
            value.attempt_id !== current.attempt_id
          )
            controller.abort()
        })
        .catch(() => controller.abort())
        .finally(() => {
          checking = false
        })
    }, 250).unref()
    const timeout = setTimeout(() => controller.abort(), 35000).unref()
    try {
      const before = await this.store.snapshot(
        current.account_id,
        current.person_id,
      )
      if (!this.store.validSnapshot(current, before)) {
        await this.store.fail(
          current,
          this.store.snapshotFailure(current,before),
          false,
          "blocked",
        )
        return
      }
      const world=await this.store.dependencies.virtualWorld?.(current.account_id,current.person_id)
      if(world&&(world.personVersion!==current.person_version||world.currentWorld.id!==before.person.worldId||before.person.worldVersion!==undefined&&world.worldVersion!==before.person.worldVersion)){
        await this.store.fail(current,'WORLD_CONTEXT_CHANGED',false,'blocked');return
      }
      const worldUse=world?virtualWorldUse(world):undefined
      const historyAllowed=Boolean(current.world_action_authorization_version&&before.account.worldActionProcessing?.historicalWorldEventsAllowed===true)
      const messages = await this.store.context(current,world,historyAllowed)
      const source = messages.find(value=>value.id===current.source_message_id)
      const query = source?.text ?? ''
      if(source?.author.kind==='self'&&needsCurrentSelfHarmSupport(query)){
        await this.store.fail(current,SELF_HARM_SUPPORT_REQUIRED,false,'blocked')
        return
      }
      if(current.world_action_authorization_version&&!world)throw new ConversationError(409,'WORLD_EVENT_CONTEXT_CHANGED','The current virtual world is unavailable.')
      const eventRefs=new Map<string,WorldEventRef>()
      for(const value of messages)for(const ref of value.worldEventContextRefs??[])eventRefs.set(ref.id,ref)
      const actionContext=current.world_action_authorization_version?await this.store.worldActions.context(current,world!,query,[...eventRefs.values()],historyAllowed):undefined
      const memories = await this.store.dependencies.memories?.(current.account_id,current.person_id,query) ?? []
      const retrievedAutomatic=await this.store.dependencies.automaticMemories?.(current.account_id,current.person_id,query)??[]
      const automaticMemories=historyAllowed?retrievedAutomatic.filter(memory=>memory.sourceKind==='message'):retrievedAutomatic
      const references=new Map<string,MemoryUse>()
      const inherited=messages.flatMap(value=>(value as typeof value&{memoryContextRefs?:MemoryUse[]}).memoryContextRefs??[])
      for(const reference of [...memories.map(value=>({kind:'cherished' as const,id:value.id,version:value.version})),...inherited,...(actionContext?.memoryUses??[]),...automaticMemories.map(value=>({kind:'automatic' as const,id:value.id,version:value.version,sourceKind:value.sourceKind,sourceId:value.sourceId,sourceVersion:value.sourceVersion,sources:value.sources}))]){
        const key=reference.kind+':'+reference.id,previous=references.get(key)
        if(previous&&previous.version!==reference.version){await this.store.fail(current,'MEMORY_CONTEXT_CHANGED',false,'blocked');return}
        references.set(key,reference)
      }
      const memoryUses=[...references.values()],automaticRefs=memoryUses.filter(value=>value.kind==='automatic').map(value=>({id:value.id,version:value.version}))
      if(actionContext&&memoryUses.length>64){await this.store.fail(current,'MEMORY_CONTEXT_CHANGED',false,'blocked');return}
      if(automaticRefs.length>32){await this.store.fail(current,'MEMORY_CONTEXT_CHANGED',false,'blocked');return}
      // Reading history/memories is asynchronous; validate again after those reads.
      if(actionContext){
        const inputs=await this.store.pool.query<{id:string;version:number}>('SELECT id,version FROM messages WHERE account_id=$1 AND conversation_id=$2 AND id=ANY($3::uuid[]) AND removed_at IS NULL',[current.account_id,current.conversation_id,messages.map(m=>m.id)])
        const versions=new Map(inputs.rows.map(m=>[m.id,m.version]))
        if(messages.some(m=>versions.get(m.id)!==m.version)||!await this.store.worldActions.valid(current,world!,actionContext.refs,historyAllowed)||actionContext.revision!==await this.store.worldActions.revision(current)){
          await this.store.fail(current,'WORLD_EVENT_CONTEXT_CHANGED',false,'blocked');return
        }
      }
      const beforeModel = await this.store.snapshot(current.account_id, current.person_id)
      if (!this.store.validSnapshot(current, beforeModel)) {
        await this.store.fail(current, this.store.snapshotFailure(current,beforeModel), false, 'blocked')
        return
      }
      const output = await this.provider.generate({
        jobId: id,
        attemptId: current.attempt_id!,
        accountId: current.account_id,
        aiTextProcessing: beforeModel.account.aiTextProcessing,
        person: beforeModel.person,
        messages,
        memories,
        automaticMemories,
        virtualWorld:world,
        ...(actionContext?{sourceMessageId:current.source_message_id,worldActionProcessing:beforeModel.account.worldActionProcessing!,worldActionAuthorizationVersion:current.world_action_authorization_version!,worldEvents:actionContext.events}:{}),
        signal: controller.signal,
      })
      if (controller.signal.aborted)
        throw new GenerationError("MODEL_TIMEOUT", true)
      if(Boolean(actionContext)!==('decision'in output&&'provenance'in output))throw new GenerationError('MODEL_INVALID_OUTPUT',true)
      const after = await this.store.snapshot(
        current.account_id,
        current.person_id,
      )
      if (!this.store.validSnapshot(current, after)) {
        await this.store.fail(
          current,
          this.store.snapshotFailure(current,after),
          false,
          "blocked",
        )
        return
      }
      const latestMemories = await this.store.dependencies.memories?.(current.account_id,current.person_id,query) ?? []
      const memoryVersions = (values:typeof memories) => JSON.stringify(values.map(value=>[value.id,value.version]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))
      if (memoryVersions(memories)!==memoryVersions(latestMemories)) {
        await this.store.fail(current,'MEMORY_CONTEXT_CHANGED',false,'blocked')
        return
      }
      // Validate only what this response actually used; unrelated new extraction is harmless.
      if(automaticRefs.length&&(!this.store.dependencies.validateAutomaticMemories||!await this.store.dependencies.validateAutomaticMemories(current.account_id,current.person_id,automaticRefs))){
        await this.store.fail(current,'MEMORY_CONTEXT_CHANGED',false,'blocked');return
      }
      if(worldUse){
        const latest=await this.store.dependencies.virtualWorld?.(current.account_id,current.person_id)
        if(!latest||latest.personVersion!==current.person_version||!sameVirtualWorldUse(worldUse,latest)){
          await this.store.fail(current,'WORLD_CONTEXT_CHANGED',false,'blocked');return
        }
      }
      if (controller.signal.aborted)
        throw new GenerationError("MODEL_TIMEOUT", true)
      // Expiry without a replacement must become a visible failure before the queue is acknowledged.
      if (
        !(await this.store.complete(
          current,
          output.text,
          after.person.displayName,
          messages,
          memoryUses,
          worldUse,
          actionContext?{output:output as WorldActionResult,context:actionContext}:undefined,
        ))
      )
        await this.store.fail(current, "MODEL_TIMEOUT", true)
    } catch (error) {
      if(this.stopping){
        await this.store.release(current)
        // Reject the physical dispatch so pg-boss redelivers it after restart.
        throw new Error('Conversation worker stopped during generation')
      }
      const active = await this.store.findJob(id)
      if (
        !active ||
        active.state !== "running" ||
        active.attempt_id !== current.attempt_id
      )
        return
      if (error instanceof ConversationError && ['AI_PERMISSION_REQUIRED','WORLD_ACTION_PERMISSION_REQUIRED'].includes(error.code))
        await this.store.fail(current, error.code, false, 'blocked')
      else if (
        error instanceof ConversationError &&
        (error.code === "CONTEXT_REVOKED"||error.code==='WORLD_EVENT_CONTEXT_CHANGED')
      )
        await this.store.fail(current, error.code, false, "blocked")
      else if (
        error instanceof ConversationError &&
        (error.status === 404 || error.status === 403 || error.status === 401)
      )
        await this.store.fail(
          current,
          "AUTHORIZATION_CHANGED",
          false,
          "blocked",
        )
      else if (controller.signal.aborted)
        await this.store.fail(current, "MODEL_TIMEOUT", true)
      else if (error instanceof GenerationError)
        await this.store.fail(
          current,
          error.code,
          error.retryable,
          error.blocked ? "blocked" : "failed",
        )
      else
        await this.store.fail(
          current,
          controller.signal.aborted
            ? "MODEL_TIMEOUT"
            : "DEPENDENCY_UNAVAILABLE",
          true,
        )
    } finally {
      clearInterval(monitor)
      clearTimeout(timeout)
      this.active.delete(controller)
    }
  }
  stop() {
    this.stopping=true
    for (const controller of this.active) controller.abort()
  }
}
