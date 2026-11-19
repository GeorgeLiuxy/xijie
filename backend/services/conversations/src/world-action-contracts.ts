import type {WorldStage} from './virtual-world.js'
// Virtual events remain a distinct source from user-reported automatic memory.
// The event version is immutable; ordering uses the store's separate sequence.
export type WorldEventRef = {
  id: string
  version: 1
  personId: string
  worldId: string
  worldVersion: number
  reality: 'virtual'
  branch: 'main'
}

export type WorldEventMemory = WorldEventRef & {
  summary: string
  memory: string
  occurredAt: string
  // A residency-stage snapshot is not an assertion of the catalog at event time.
  origin?: WorldStage
}

export type WorldAction = { requestQuote: string; summary: string; memory: string }
export type WorldActionDecision =
  | { text: string; decision: 'chat' | 'clarify'; action?: never }
  | { text: string; decision: 'execute'; action: WorldAction }
export type WorldActionProvenance = {
  model: string
  responseId: string
  promptVersion: 'person-world-actions-v1'
  // Absent on the original wording, including already saved model decisions.
  promptRevision?: 'recipient-v2' | 'history-v3'
}
export type WorldActionResult = WorldActionDecision & { provenance: WorldActionProvenance }
