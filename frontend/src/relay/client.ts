import type { Flight } from "./types"

export async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch("/api/relay/" + path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  })
  if (!response.ok) throw new Error(String(response.status))
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new Error("offline")
  return response.json()
}
export function relayUrl(id = "") {
  return new URL(
    import.meta.env.BASE_URL + "relay" + (id ? "/" + id : ""),
    location.origin,
  ).href
}
export const homeFlight = () => request<{ flight: Flight | null; ticket: Flight | null }>("home")
