import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"
import { wishes, type Wish, type ReturnParcel, type Flight } from "../src/relay/types"

type Seat = { actor: string; wish?: Wish; parcel?: ReturnParcel }
type StoredFlight = ReturnParcel & { id: string; message?: string; seats: Seat[] }
const limit = 4
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i
const namespace = createHash("sha256")
  .update(resolve("."))
  .digest("hex")
  .slice(0, 14)
// Keep browser identifiers outside the Vite public filesystem.
const directory = join(tmpdir(), "elysium-relay-" + namespace)
function load(id: string | undefined): StoredFlight | null {
  if (!id || !uuid.test(id)) return null
  try {
    return JSON.parse(readFileSync(join(directory, id + ".json"), "utf8"))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
    throw e
  }
}
function save(f: StoredFlight) {
  mkdirSync(directory, { recursive: true })
  const filename = join(directory, f.id + ".json")
  writeFileSync(filename + ".part", JSON.stringify(f), { mode: 0o600 })
  renameSync(filename + ".part", filename)
}
function snapshot(f: StoredFlight, actor: string): Flight {
  const slot = f.seats.findIndex((s) => s.actor === actor)
  return {
    id: f.id,
    world: f.world,
    gift: f.gift,
    message: f.message ?? "",
    wishes: f.seats.map(seat => seat.wish ?? null),
    count: f.seats.length,
    capacity: limit,
    seat: slot === -1 ? null : slot,
    returnParcel: f.seats[slot]?.parcel ?? null,
  }
}
function parcel(body: Record<string, unknown>): ReturnParcel | undefined {
  const { world, gift } = body
  if (
    (world === "isles" || world === "tide" || world === "courtyard") &&
    (gift === "ball" || gift === "cloth")
  )
    return { world, gift }
}
function cookie(req: IncomingMessage, name: string) {
  return req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + "="))
    ?.slice(name.length + 1)
}
function send(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  })
  res.end(JSON.stringify(payload))
}
const cookieOptions =
  "; Path=/api/relay; HttpOnly; SameSite=Lax; Max-Age=2592000"
// A single preview process owns these files. Validation, slot allocation and
// atomic replacement run without an await between reading and committing.
async function handler(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? "").split("?")[0]
  const isPost = req.method === "POST"
  if (!isPost && req.method !== "GET")
    return send(res, 405, { error: "method" })
  let body: Record<string, unknown> = {}
  if (isPost) {
    const origin = req.headers.origin
    if (
      req.headers["sec-fetch-site"] === "cross-site" ||
      (origin && new URL(origin).host !== req.headers.host)
    )
      return send(res, 403, { error: "origin" })
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return send(res, 415, { error: "format" })
    req.setEncoding("utf8")
    let data = ""
    for await (const chunk of req) {
      data += chunk
      if (data.length > 1200) return send(res, 413, { error: "size" })
    }
    try {
      body = JSON.parse(data)
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw Error()
    } catch {
      return send(res, 400, { error: "invalid" })
    }
  }
  let actor = cookie(req, "xj-relay-id")
  const cookies: string[] = []
  if (!actor || !uuid.test(actor)) {
    actor = randomUUID()
    cookies.push("xj-relay-id=" + actor + cookieOptions)
    res.setHeader("Set-Cookie", cookies)
  }
  if (path === "/home" && !isPost) {
    const own = load(cookie(req, "xj-relay-flight"))
    const helped = load(cookie(req, "xj-relay-ticket"))
    return send(res, 200, {
      ticket: helped && helped.seats.slice(1).some(s=>s.actor === actor) ? snapshot(helped, actor) : null,
      flight: own?.seats[0]?.actor === actor ? snapshot(own, actor) : null,
    })
  }
  if (path === "/new" && isPost) {
    const pick = parcel(body)
    if (
      !pick ||
      typeof body.id !== "string" ||
      !uuid.test(body.id) ||
      (body.message !== undefined &&
        (typeof body.message !== "string" || body.message.length > 60))
    )
      return send(res, 400, { error: "invalid" })
    let f = load(body.id)
    if (f && f.seats[0].actor !== actor)
      return send(res, 409, { error: "unavailable" })
    if (!f) {
      const current = load(cookie(req, "xj-relay-flight"))
      if (
        current &&
        current.seats[0].actor === actor &&
        current.seats.length < limit
      )
        f = current
      else {
        f = {
          id: body.id,
          ...pick,
          message: typeof body.message === "string" ? body.message.trim() : "",
          seats: [{ actor }],
        }
        save(f)
      }
    }
    cookies.push("xj-relay-flight=" + f.id + cookieOptions)
    res.setHeader("Set-Cookie", cookies)
    return send(res, 200, snapshot(f, actor))
  }
  const [, id, action] = path.split("/")
  const f = load(id)
  if (!f) return send(res, 404, { error: "missing" })
  if (!isPost && !action) return send(res, 200, snapshot(f, actor))
  const seat = f.seats.find((s) => s.actor === actor)
  if (isPost && action === "fuel") {
    if (!seat && f.seats.length < limit) {
      const wish = body.wish
      if (wish !== undefined && (typeof wish !== "string" || !Object.prototype.hasOwnProperty.call(wishes, wish))) {
        return send(res, 400, { error: "wish" })
      }
      f.seats.push({ actor, wish: wish as Wish | undefined })
      save(f)
    }
  } else if (isPost && action === "redeem") {
    const pick = parcel(body)
    if (!pick || !seat || seat === f.seats[0])
      return send(res, 403, { error: "no-ticket" })
    if (!seat.parcel) {
      seat.parcel = pick
      save(f)
    }
  } else return send(res, 404, { error: "missing" })
  const result = snapshot(f, actor)
  if (result.seat !== null && result.seat > 0) {
    cookies.push("xj-relay-ticket=" + f.id + cookieOptions)
    res.setHeader("Set-Cookie", cookies)
  }
  return send(res, 200, result)
}
export function relayService(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse) => {
    void handler(req, res).catch(() => send(res, 500, { error: "service" }))
  }
  return {
    name: "elysium-shared-departures",
    configureServer(server) {
      server.middlewares.use("/api/relay", middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/relay", middleware)
    },
  }
}
