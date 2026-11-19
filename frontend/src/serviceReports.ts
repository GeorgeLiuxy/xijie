export type ReportTarget = {
  subjectType: "message" | "post" | "comment" | "contribution"
  subjectId: string
}
export type ContentReport = {
  id: string
  status: "open" | "reviewing" | "resolved"
  version: number
  createdAt: string
  resolvedAt?: string
  resolution?: string
}
export type ReportContext = {
  accountId: string
  sessionId: string
  onUnauthorized: () => void
}
export class ContentReportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}
type Intent = {
  key: string
  body: ReportTarget & { reason: string; note: string }
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export function createReportClient(context: ReportContext) {
  let active = true,
    epoch = 0,
    busy = false
  const controllers = new Set<AbortController>(),
    prefix = "xijie.content-report." + context.accountId + "."
  const location = (target: ReportTarget) =>
    prefix + target.subjectType + "." + target.subjectId
  function pending(target: ReportTarget): Intent | undefined {
    try {
      const value = sessionStorage.getItem(location(target))
      if (value === null) return
      const v = JSON.parse(value)
      if (
        !v ||
        !uuid.test(v.key) ||
        v.body?.subjectType !== target.subjectType ||
        v.body?.subjectId !== target.subjectId ||
        !["harmful", "privacy", "impersonation", "spam", "other"].includes(
          v.body.reason,
        ) ||
        typeof v.body.note !== "string" ||
        [...v.body.note].length > 500
      )
        throw Error()
      return v
    } catch {
      throw new ContentReportError(503, "RECOVERY_STORAGE_UNAVAILABLE")
    }
  }
  function remember(target: ReportTarget, intent?: Intent) {
    try {
      if (intent)
        sessionStorage.setItem(location(target), JSON.stringify(intent))
      else sessionStorage.removeItem(location(target))
    } catch {
      throw new ContentReportError(503, "RECOVERY_STORAGE_UNAVAILABLE")
    }
  }
  async function request(path: string, intent?: Intent) {
    const generation = epoch,
      c = new AbortController()
    controllers.add(c)
    const check = () => {
      if (!active || generation !== epoch || c.signal.aborted)
        throw new DOMException("Canceled", "AbortError")
    }
    try {
      check()
      const r = await fetch("/v1/content-reports" + path, {
        method: intent ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: c.signal,
        headers: {
          "X-Xijie-Expected-Session": context.sessionId,
          ...(intent
            ? {
                "Content-Type": "application/json",
                "Idempotency-Key": intent.key,
              }
            : {}),
        },
        ...(intent ? { body: JSON.stringify(intent.body) } : {}),
      })
      check()
      const v = await r.json()
      check()
      if (!r.ok) {
        if (r.status === 401) context.onUnauthorized()
        throw new ContentReportError(r.status, v?.error?.code ?? "UNAVAILABLE")
      }
      return v
    } finally {
      controllers.delete(c)
    }
  }
  const valid = (v: any): ContentReport => {
    if (
      !v ||
      !uuid.test(v.id) ||
      !["open", "reviewing", "resolved"].includes(v.status) ||
      !Number.isSafeInteger(v.version) ||
      v.version < 1 ||
      !Number.isFinite(Date.parse(v.createdAt)) ||
      (v.resolution !== undefined && typeof v.resolution !== "string")
    )
      throw new ContentReportError(502, "INVALID_RESPONSE")
    return v
  }
  return {
    activate() {
      active = true
    },
    dispose() {
      active = false
      epoch++
      controllers.forEach((c) => c.abort())
      controllers.clear()
    },
    pending,
    async submit(target: ReportTarget, reason: string, note: string) {
      if (busy) throw new ContentReportError(409, "IN_PROGRESS")
      busy = true
      try {
        if (
          !uuid.test(target.subjectId) ||
          !["message", "post", "comment", "contribution"].includes(target.subjectType) ||
          !["harmful", "privacy", "impersonation", "spam", "other"].includes(
            reason,
          ) ||
          [...note].length > 500 ||
          /\p{C}/u.test(note.replace(/[\n\r\t]/g, ""))
        )
          throw new ContentReportError(400, "INVALID_ARGUMENT")
        let intent = pending(target)
        const body = { ...target, reason, note: note.trim() }
        if (intent && JSON.stringify(intent.body) !== JSON.stringify(body))
          throw new ContentReportError(409, "REPORT_PENDING")
        if (!intent) {
          intent = { key: crypto.randomUUID(), body }
          remember(target, intent)
        }
        let result: ContentReport
        try { result = valid((await request("", intent)).data) }
        catch (error) {
          // The server rejected this input before accepting a report. Editing is safe.
          if (error instanceof ContentReportError && error.status === 400 && error.code === 'INVALID_ARGUMENT') remember(target)
          throw error
        }
        remember(target)
        return result
      } finally {
        busy = false
      }
    },
    async list(cursor?: string) {
      if (cursor && !uuid.test(cursor))
        throw new ContentReportError(400, "INVALID_ARGUMENT")
      const v = await request("?limit=20" + (cursor ? "&cursor=" + cursor : ""))
      if (
        !Array.isArray(v.data) ||
        (v.meta?.nextCursor !== null && !uuid.test(v.meta?.nextCursor))
      )
        throw new ContentReportError(502, "INVALID_RESPONSE")
      return {
        data: v.data.map(valid),
        nextCursor: v.meta.nextCursor as string | null,
      }
    },
  }
}
