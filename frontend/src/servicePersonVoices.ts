export type ReadyPersonVoice = {
  id: string
  version: number
  durationMs: number
  mimeType: "audio/wav"
  byteSize: number
  sha256: string
}
export type PersonVoiceContext = {
  accountId: string
  sessionId: string
  draftId: string
  onUnauthorized: () => void
}
export type PersonVoice = {
  id: string
  version: number
  status: "awaiting_upload" | "verifying" | "ready" | "rejected" | "revoked" | "deleted"
  target: { kind: "person_draft"; id: string }
  durationMs?: number
  mimeType?: string
  byteSize?: number
  sha256?: string
  failureCode?: string
}
type Upload = {
  id: string
  url: string
  method: "PUT"
  expiresAt: string
  mimeType: string
  state?: "active" | "uploading" | "uploaded" | "completed"
}
type FileRef = { mimeType: string; byteSize: number; sha256: string }
type Intent = {
  format: 1
  file: FileRef
  createKey: string
  uploadKey: string
  completeKey: string
  voiceId?: string
  upload?: Upload
  completeVersion?: number
  renewKey?: string
  renewVersion?: number
  renewFor?: string
  bindingStarted?: boolean
}
export class PersonVoiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: { currentVersion?: number },
  ) {
    super(code)
  }
}
const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  hex = /^[a-f0-9]{64}$/
const inputLimit = 8 * 1024 * 1024,
  outputLimit = 1440044,
  types = ["audio/wav", "audio/mpeg", "audio/ogg", "audio/webm", "audio/mp4"]
const mime = (v: string) => {
  const plain = v.toLowerCase().split(";")[0].trim()
  return plain === "audio/x-wav"
    ? "audio/wav"
    : plain === "audio/mp3"
      ? "audio/mpeg"
      : plain === "audio/x-m4a"
        ? "audio/mp4"
        : plain === "application/ogg"
          ? "audio/ogg"
          : plain
}
const digest = async (bytes: ArrayBuffer) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("")
export function readyPersonVoice(v: unknown): ReadyPersonVoice {
  const value = v as ReadyPersonVoice
  if (
    !value ||
    !uuid.test(value.id) ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    value.mimeType !== "audio/wav" ||
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize < 46 ||
    value.byteSize > outputLimit ||
    (value.byteSize - 44) % 2 !== 0 ||
    !hex.test(value.sha256) ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 1 ||
    value.durationMs > 30000
  )
    throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
  return value
}
export function createPersonVoiceClient(context: PersonVoiceContext) {
  if (
    ![context.accountId, context.sessionId, context.draftId].every((id) =>
      uuid.test(id),
    )
  )
    throw new PersonVoiceError(400, "INVALID_ARGUMENT")
  const key =
      "xijie.person-voice.intent." + context.accountId + "." + context.draftId,
    deletePrefix =
      "xijie.person-voice.delete." +
      context.accountId +
      "." +
      context.draftId +
      ".",
    controllers = new Set<AbortController>()
  let active = true,
    epoch = 0,
    busy = false,
    lastReady: ReadyPersonVoice | undefined
  function check(captured = epoch) {
    if (!active || captured !== epoch)
      throw new DOMException("Canceled", "AbortError")
    try {
      if (
        localStorage.getItem(
          "xijie.private-drafts-erased." + context.accountId,
        ) === "1"
      )
        throw new PersonVoiceError(401, "ACCOUNT_ERASED")
    } catch (e) {
      if (e instanceof PersonVoiceError) throw e
      throw new PersonVoiceError(503, "VOICE_RECOVERY_STORAGE_UNAVAILABLE")
    }
  }
  function upload(v: any, id: string): Upload {
    if (
      !v ||
      !uuid.test(v.id) ||
      v.method !== "PUT" ||
      typeof v.url !== "string" ||
      !v.url.startsWith("/v1/person-voices/" + id + "/uploads/") ||
      !Number.isFinite(Date.parse(v.expiresAt)) ||
      !types.includes(mime(v.mimeType)) ||
      (v.state !== undefined &&
        !["active", "uploading", "uploaded", "completed"].includes(v.state))
    )
      throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
    const u = new URL(v.url, location.origin)
    if (
      u.origin !== location.origin ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/v1/person-voices/" + id + "/uploads/" + v.id
    )
      throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
    return v
  }
  function voice(v: any): PersonVoice {
    if (
      !v ||
      !uuid.test(v.id) ||
      !Number.isSafeInteger(v.version) ||
      v.version < 1 ||
      v.target?.kind !== "person_draft" ||
      v.target.id !== context.draftId ||
      ![
        "awaiting_upload",
        "verifying",
        "ready",
        "rejected",
        "revoked",
        "deleted",
      ].includes(v.status)
    )
      throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
    if (v.status === "ready") lastReady = readyPersonVoice(v)
    return v
  }
  function load(): Intent | undefined {
    check()
    try {
      const raw = sessionStorage.getItem(key)
      if (raw === null) return
      const v = JSON.parse(raw)
      if (
        !v ||
        v.format !== 1 ||
        !types.includes(v.file?.mimeType) ||
        !hex.test(v.file?.sha256) ||
        !Number.isSafeInteger(v.file.byteSize) ||
        v.file.byteSize < 1 ||
        v.file.byteSize > inputLimit ||
        ![v.createKey, v.uploadKey, v.completeKey].every(
          (x) => typeof x === "string" && uuid.test(x),
        ) ||
        (v.voiceId !== undefined && !uuid.test(v.voiceId)) ||
        (v.renewKey !== undefined && !uuid.test(v.renewKey)) ||
        (v.renewFor !== undefined && !uuid.test(v.renewFor)) ||
        (v.bindingStarted !== undefined && typeof v.bindingStarted !== "boolean") ||
        [v.completeVersion, v.renewVersion].some(
          (n) =>
            n !== undefined &&
            (!Number.isSafeInteger(n) || n < 1 || n > 2147483647),
        )
      )
        throw Error()
      if (v.upload) {
        if (!v.voiceId) throw Error()
        upload(v.upload, v.voiceId)
      }
      return v
    } catch {
      throw new PersonVoiceError(503, "VOICE_RECOVERY_STORAGE_UNAVAILABLE")
    }
  }
  function save(intent?: Intent) {
    check()
    try {
      if (intent) sessionStorage.setItem(key, JSON.stringify(intent))
      else sessionStorage.removeItem(key)
    } catch {
      throw new PersonVoiceError(503, "VOICE_RECOVERY_STORAGE_UNAVAILABLE")
    }
  }
  async function request(
    path: string,
    init: RequestInit = {},
    version?: number,
    command?: string,
  ) {
    check()
    const captured = epoch,
      c = new AbortController(),
      signal = AbortSignal.any([c.signal, AbortSignal.timeout(20000), ...(init.signal ? [init.signal] : [])])
    controllers.add(c)
    const release = () => {
        controllers.delete(c)
        c.abort()
      },
      headers = new Headers(init.headers)
    headers.set("X-Xijie-Expected-Session", context.sessionId)
    if (version !== undefined) headers.set("If-Match", '"v' + version + '"')
    if (command) headers.set("Idempotency-Key", command)
    let response: Response | undefined
    try {
      signal.throwIfAborted()
      response = await fetch(path, {
        ...init,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal,
      })
      signal.throwIfAborted()
      check(captured)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        check(captured)
        if (response.status === 401) context.onUnauthorized()
        throw new PersonVoiceError(
          response.status,
          error?.error?.code ?? "VOICE_UNAVAILABLE",
          Number.isSafeInteger(error?.error?.details?.currentVersion)
            ? { currentVersion: error.error.details.currentVersion }
            : undefined,
        )
      }
      return { response, captured, release, signal }
    } catch (error) {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
      release()
      throw error
    }
  }
  async function json(
    path: string,
    method = "GET",
    body?: object,
    version?: number,
    command?: string,
    signal?: AbortSignal,
  ) {
    const { response, captured, release } = await request(
      path,
      {
        method,
        signal,
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      },
      version,
      command,
    )
    try {
      const v = await response.json()
      signal?.throwIfAborted()
      check(captured)
      if (v?.data === undefined)
        throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
      return v.data
    } finally {
      release()
    }
  }
  async function fileData(file: Blob) {
    check()
    if (
      !file ||
      file.size < 1 ||
      file.size > inputLimit ||
      !types.includes(mime(file.type))
    )
      throw new PersonVoiceError(422, "INVALID_AUDIO")
    const captured = epoch,
      bytes = await file.arrayBuffer()
    check(captured)
    const sha256 = await digest(bytes)
    check(captured)
    return {
      bytes,
      ref: { mimeType: mime(file.type), byteSize: bytes.byteLength, sha256 },
    }
  }
  async function allocated(data: any, intent: Intent) {
    const v = voice(data?.voice)
    intent.voiceId = v.id
    if (data.upload) intent.upload = upload(data.upload, v.id)
    save(intent)
    return v
  }
  async function complete(intent: Intent, current: PersonVoice) {
    if (!intent.upload)
      throw new PersonVoiceError(503, "VOICE_RECOVERY_STORAGE_UNAVAILABLE")
    intent.completeVersion ??= current.version
    save(intent)
    const v = voice(
      await json(
        "/v1/person-voices/" + current.id + "/complete",
        "POST",
        { uploadSlotId: intent.upload.id },
        intent.completeVersion,
        intent.completeKey,
      ),
    )
    if (v.id !== current.id)
      throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
    return v
  }
  function terminal(v: PersonVoice) {
    if (["rejected", "revoked", "deleted"].includes(v.status))
      throw new PersonVoiceError(
        409,
        v.failureCode ?? "VOICE_" + v.status.toUpperCase(),
      )
  }
  async function eraseVoice(id: string, version: number) {
    check()
    if (!uuid.test(id) || !Number.isSafeInteger(version) || version < 1)
      throw new PersonVoiceError(400, "INVALID_ARGUMENT")
    const storageKey = deletePrefix + id
    let operation: { key: string; version: number }
    try {
      const stored = sessionStorage.getItem(storageKey)
      operation = stored
        ? JSON.parse(stored)
        : { key: crypto.randomUUID(), version }
      if (
        !uuid.test(operation.key) ||
        !Number.isSafeInteger(operation.version) ||
        operation.version < 1
      )
        throw Error()
      sessionStorage.setItem(storageKey, JSON.stringify(operation))
    } catch {
      throw new PersonVoiceError(503, "VOICE_RECOVERY_STORAGE_UNAVAILABLE")
    }
    for (let attempt = 0; attempt < 3; attempt++)
      try {
        const result = voice(
          await json(
            "/v1/person-voices/" + id,
            "DELETE",
            {},
            operation.version,
            operation.key,
          ),
        )
        if (result.id !== id || result.status !== "deleted")
          throw new PersonVoiceError(409, "VOICE_DELETION_PENDING")
        check()
        sessionStorage.removeItem(storageKey)
        return result
      } catch (error) {
        const current =
          error instanceof PersonVoiceError &&
          error.status === 412 &&
          error.code === "VERSION_CONFLICT"
            ? error.details?.currentVersion
            : undefined
        if (
          typeof current !== "number" ||
          !Number.isSafeInteger(current) ||
          current <= operation.version ||
          current > 2147483647
        )
          throw error
        operation = { key: crypto.randomUUID(), version: current }
        check()
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(operation))
        } catch {
          throw new PersonVoiceError(503, "VOICE_RECOVERY_STORAGE_UNAVAILABLE")
        }
      }
    throw new PersonVoiceError(409, "VOICE_DELETION_PENDING")
  }
  function pendingDeletions(): readonly { id: string; version: number }[] {
    check()
    try {
      const entries: { id: string; version: number }[] = []
      for (let index = 0; index < sessionStorage.length; index++) {
        const storageKey = sessionStorage.key(index)
        if (!storageKey?.startsWith(deletePrefix)) continue
        const id = storageKey.slice(deletePrefix.length)
        const operation = JSON.parse(sessionStorage.getItem(storageKey) ?? "null")
        if (!uuid.test(id) || !operation || !uuid.test(operation.key) ||
          !Number.isSafeInteger(operation.version) || operation.version < 1 || operation.version > 2147483647)
          throw Error()
        entries.push(Object.freeze({ id, version: operation.version }))
      }
      return Object.freeze(entries)
    } catch {
      throw new PersonVoiceError(503, "VOICE_RECOVERY_STORAGE_UNAVAILABLE")
    }
  }
  function onErased(event: Event) {
    if (
      (event as CustomEvent<{ accountId: string }>).detail?.accountId ===
      context.accountId
    )
      dispose()
  }
  function activate() {
    active = true
    window.addEventListener("xijie:private-drafts-erased", onErased)
  }
  function dispose() {
    active = false
    epoch++
    controllers.forEach((c) => c.abort())
    controllers.clear()
    window.removeEventListener("xijie:private-drafts-erased", onErased)
  }
  activate()
  return {
    activate,
    dispose,
    get pending() {
      return load()
    },
    get pendingDeletions() {
      return pendingDeletions()
    },
    async retryDeletions(excludedIds: readonly string[] = []) {
      check()
      if (!excludedIds.every((id) => uuid.test(id)))
        throw new PersonVoiceError(400, "INVALID_ARGUMENT")
      const pending = pendingDeletions()
      if (pending.some(({ id }) => excludedIds.includes(id)))
        throw new PersonVoiceError(409, "VOICE_STILL_BOUND")
      for (const { id, version } of pending) await eraseVoice(id, version)
    },
    async read(id: string) {
      if (!uuid.test(id)) throw new PersonVoiceError(400, "INVALID_ARGUMENT")
      const v = voice(await json("/v1/person-voices/" + id))
      if (v.id !== id) throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
      return v
    },
    async save(file?: Blob) {
      if (busy) throw new PersonVoiceError(409, "VOICE_IN_PROGRESS")
      busy = true
      try {
        let intent = load()
        const source = file ? await fileData(file) : undefined
        if (
          intent &&
          source &&
          JSON.stringify(intent.file) !== JSON.stringify(source.ref)
        )
          throw new PersonVoiceError(409, "VOICE_ORIGINAL_FILE_REQUIRED")
        if (!intent) {
          if (!source)
            throw new PersonVoiceError(409, "VOICE_ORIGINAL_FILE_REQUIRED")
          intent = {
            format: 1,
            file: source.ref,
            createKey: crypto.randomUUID(),
            uploadKey: crypto.randomUUID(),
            completeKey: crypto.randomUUID(),
          }
          save(intent)
        }
        let current = intent.voiceId
          ? voice(await json("/v1/person-voices/" + intent.voiceId))
          : await allocated(
              await json(
                "/v1/person-voices",
                "POST",
                {
                  ...intent.file,
                  target: { kind: "person_draft", id: context.draftId },
                },
                undefined,
                intent.createKey,
              ),
              intent,
            )
        if (current.id !== intent.voiceId)
          throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
        terminal(current)
        if (current.status === "awaiting_upload") {
          if (!intent.upload)
            throw new PersonVoiceError(
              503,
              "VOICE_RECOVERY_STORAGE_UNAVAILABLE",
            )
          if (!["uploaded", "completed"].includes(intent.upload.state ?? "")) {
            if (!source) {
              try {
                current = await complete(intent, current)
              } catch (error) {
                if (
                  error instanceof PersonVoiceError &&
                  error.status === 409 &&
                  !["IDEMPOTENCY_CONFLICT", "UPLOAD_IN_PROGRESS"].includes(
                    error.code,
                  )
                )
                  throw new PersonVoiceError(
                    409,
                    "VOICE_ORIGINAL_FILE_REQUIRED",
                  )
                throw error
              }
            } else {
              try {
                const { response, captured, release } = await request(
                  intent.upload.url,
                  {
                    method: "PUT",
                    headers: { "Content-Type": intent.file.mimeType },
                    body: source.bytes,
                  },
                  current.version,
                  intent.uploadKey,
                )
                try {
                  const data = await response.json()
                  check(captured)
                  current = voice(data?.data)
                  if (current.id !== intent.voiceId)
                    throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
                } finally {
                  release()
                }
              } catch (error) {
                if (
                  !(
                    error instanceof PersonVoiceError &&
                    error.code === "UPLOAD_EXPIRED"
                  )
                )
                  throw error
                const oldSlot = intent.upload.id
                if (intent.renewFor !== oldSlot) {
                  intent.renewKey = crypto.randomUUID()
                  intent.renewVersion = current.version
                  intent.renewFor = oldSlot
                }
                save(intent)
                current = await allocated(
                  await json(
                    "/v1/person-voices/" + current.id + "/upload-slots",
                    "POST",
                    {},
                    intent.renewVersion,
                    intent.renewKey,
                  ),
                  intent,
                )
                if (intent.upload?.id !== oldSlot) {
                  intent.uploadKey = crypto.randomUUID()
                  intent.completeKey = crypto.randomUUID()
                  intent.completeVersion = undefined
                  save(intent)
                }
                if (
                  !intent.upload ||
                  !["uploaded", "completed"].includes(intent.upload.state ?? "")
                )
                  throw new PersonVoiceError(409, "VOICE_UPLOAD_RENEWED")
              }
            }
          }
          if (current.status === "awaiting_upload")
            current = await complete(intent, current)
        }
        terminal(current)
        return current
      } finally {
        busy = false
      }
    },
    markBinding(id: string) {
      const intent = load()
      if (!intent || intent.voiceId !== id || lastReady?.id !== id)
        throw new PersonVoiceError(409, "VOICE_BINDING_UNCONFIRMED")
      intent.bindingStarted = true
      save(intent)
    },
    acknowledgeBound(id: string) {
      const intent = load()
      if (!intent || intent.voiceId !== id || lastReady?.id !== id)
        throw new PersonVoiceError(409, "VOICE_BINDING_UNCONFIRMED")
      save()
    },
    async discard(confirmedUnbound = false) {
      const intent = load()
      if (!intent) return
      if (intent.bindingStarted && !confirmedUnbound)
        throw new PersonVoiceError(409, "VOICE_BINDING_UNCONFIRMED")
      let data: any
      try {
        data = await json(
          "/v1/person-voices/create-commands/" + intent.createKey,
        )
      } catch (error) {
        if (
          error instanceof PersonVoiceError &&
          error.status === 404 &&
          !intent.voiceId &&
          !intent.bindingStarted
        ) {
          save()
          return
        }
        throw error
      }
      const v = data?.voice
      if (
        data?.state !== "accepted" ||
        !v ||
        !uuid.test(v.id) ||
        !Number.isSafeInteger(v.version) ||
        v.version < 1 ||
        v.target?.kind !== "person_draft" ||
        v.target.id !== context.draftId ||
        (intent.voiceId !== undefined && intent.voiceId !== v.id)
      )
        throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
      if (v.status !== "deleted") await eraseVoice(v.id, v.version)
      save()
    },
    async forgetRejected() {
      const intent = load()
      if (!intent?.voiceId)
        throw new PersonVoiceError(409, "VOICE_RESULT_UNKNOWN")
      const v = voice(await json("/v1/person-voices/" + intent.voiceId))
      if (!["rejected", "revoked", "deleted"].includes(v.status))
        throw new PersonVoiceError(409, "VOICE_RESULT_UNKNOWN")
      save()
    },
    async remove(ready: ReadyPersonVoice) {
      readyPersonVoice(ready)
      return eraseVoice(ready.id, ready.version)
    },
    async playback(ready: ReadyPersonVoice, callerSignal?: AbortSignal) {
      readyPersonVoice(ready)
      callerSignal?.throwIfAborted()
      const proof = await json(
        "/v1/person-voices/" + ready.id + "/read-proof",
        "POST",
        {},
        ready.version,
        crypto.randomUUID(),
        callerSignal,
      )
      if (
        typeof proof?.proof !== "string" ||
        proof.proof.length > 4000 ||
        !Number.isFinite(Date.parse(proof.expiresAt))
      )
        throw new PersonVoiceError(502, "INVALID_VOICE_RESPONSE")
      callerSignal?.throwIfAborted()
      const { response, captured, release, signal } = await request(
        "/v1/person-voices/" + ready.id + "/content",
        { headers: { "X-Media-Read-Proof": proof.proof }, signal: callerSignal },
      )
      try {
        if (
          response.headers.get("Content-Type")?.split(";")[0].trim() !==
            "audio/wav" ||
          Number(response.headers.get("Content-Length")) !== ready.byteSize
        )
          throw new PersonVoiceError(502, "INVALID_AUDIO_CONTENT")
        const reader = response.body?.getReader()
        if (!reader) throw new PersonVoiceError(502, "INVALID_AUDIO_CONTENT")
        const canceled = () => { void reader.cancel(signal.reason).catch(() => {}) }
        signal.addEventListener("abort", canceled, { once: true })
        const chunks: Uint8Array[] = []
        let length = 0
        try {
        while (true) {
          signal.throwIfAborted()
          const chunk = await reader.read()
          signal.throwIfAborted()
          check(captured)
          if (chunk.done) break
          length += chunk.value.byteLength
          if (length > ready.byteSize) {
            await reader.cancel()
            throw new PersonVoiceError(502, "INVALID_AUDIO_CONTENT")
          }
          chunks.push(chunk.value)
        }
        if (length !== ready.byteSize)
          throw new PersonVoiceError(502, "INVALID_AUDIO_CONTENT")
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const part of chunks) {
          bytes.set(part, offset)
          offset += part.byteLength
        }
        if ((await digest(bytes.buffer)) !== ready.sha256)
          throw new PersonVoiceError(502, "INVALID_AUDIO_CONTENT")
        signal.throwIfAborted()
        check(captured)
        return new Blob([bytes], { type: "audio/wav" })
        } finally {
          signal.removeEventListener("abort", canceled)
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      } finally {
        release()
      }
    },
  }
}
