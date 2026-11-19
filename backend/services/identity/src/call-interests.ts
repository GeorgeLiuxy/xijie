import type { IdentityStore } from './store.js'

export class CallInterestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

export function callInterestInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CallInterestError(400, 'INVALID_ARGUMENT')
  const input = body as Record<string, unknown>
  if (Object.keys(input).length !== 3 || (input.kind !== 'voice' && input.kind !== 'video')
    || typeof input.registered !== 'boolean' || typeof input.version !== 'number'
    || !Number.isSafeInteger(input.version) || input.version < 1 || input.version > 2147483647) {
    throw new CallInterestError(400, 'INVALID_ARGUMENT')
  }
  return { kind: input.kind, registered: input.registered, version: input.version } as const
}

type InterestRow = {
  call_interest_version: number
  voice_call_interest_at: Date | null
  video_call_interest_at: Date | null
}

const fields = 'call_interest_version,voice_call_interest_at,video_call_interest_at'
function view(row: InterestRow) {
  return {
    version: row.call_interest_version,
    voice: row.voice_call_interest_at?.toISOString() ?? null,
    video: row.video_call_interest_at?.toISOString() ?? null,
  }
}

export class CallInterestStore {
  constructor(private readonly identity: IdentityStore) {}

  read(sessionHash: string, expectedSession: string) {
    return this.identity.withLockedSession(sessionHash, expectedSession, async (db, session) => {
      const result = await db.query<InterestRow>('SELECT '+fields+' FROM accounts WHERE id=$1', [session.accountId])
      return view(result.rows[0])
    })
  }

  update(sessionHash: string, expectedSession: string, input: ReturnType<typeof callInterestInput>) {
    return this.identity.withLockedSession(sessionHash, expectedSession, async (db, session) => {
      const current = (await db.query<InterestRow>('SELECT '+fields+' FROM accounts WHERE id=$1', [session.accountId])).rows[0]
      const column = input.kind === 'voice' ? 'voice_call_interest_at' : 'video_call_interest_at'
      if (Boolean(current[column]) === input.registered) return view(current)
      // A delayed registration request must never undo a newer cancellation.
      if (current.call_interest_version !== input.version) throw new CallInterestError(412, 'VERSION_CONFLICT')
      const updated = await db.query<InterestRow>(
        'UPDATE accounts SET '+column+'=CASE WHEN $2::boolean THEN clock_timestamp() ELSE NULL END,'
        +'call_interest_version=call_interest_version+1 WHERE id=$1 RETURNING '+fields,
        [session.accountId, input.registered],
      )
      return view(updated.rows[0])
    })
  }
}
