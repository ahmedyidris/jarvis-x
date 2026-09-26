// The Station tab's client for /api/station (code/station/api.py).
//
// Not apiFetch: that throws "<url> failed: <status>" and drops the server's
// reason, and here the reason IS the message -- "kill switch engaged",
// "model unavailable: All providers failed ...", or a 404 meaning app.py
// has not mounted the station yet. Same token header as apiFetch.
import { API_TOKEN } from "@/lib/api"

export type StationTier = "local" | "fast" | "smart" | "quality"

export interface StationAgent {
  id: string
  name: string
  role: string
  tier: StationTier
  busy: boolean
  current: string | null
  queued: number
  last_active: number | null
}

export interface StationTurn {
  ts: number
  role: "user" | "agent" | "error"
  text: string
  kind?: "chat" | "task"
  task_id?: string
  provider?: string
  model?: string
}

export interface StationTask {
  task_id: string
  status: "queued" | "running" | "done" | "failed" | "stopped"
  text?: string
  error?: string
  provider?: string
  model?: string
  created: number
  updated: number
}

export class StationError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> | undefined) }
  if (API_TOKEN) headers["X-Jarvis-Token"] = API_TOKEN
  if (opts.body) headers["Content-Type"] = "application/json"
  const res = await fetch(url, { ...opts, headers })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (typeof body?.detail === "string") detail = body.detail
    } catch { /* not JSON: keep the status */ }
    throw new StationError(res.status, detail)
  }
  return res.json() as Promise<T>
}

export function listAgents() {
  return call<{ agents: StationAgent[]; stopped: boolean }>("/api/station/agents")
}

export function chat(id: string, message: string) {
  return call<StationTurn>(`/api/station/agents/${encodeURIComponent(id)}/chat`, {
    method: "POST", body: JSON.stringify({ message }),
  })
}

export function transcript(id: string, limit = 100) {
  return call<{ turns: StationTurn[] }>(`/api/station/agents/${encodeURIComponent(id)}/transcript?limit=${limit}`)
}

export function queueTask(id: string, task: string) {
  return call<{ task_id: string; status: string }>(`/api/station/agents/${encodeURIComponent(id)}/task`, {
    method: "POST", body: JSON.stringify({ task }),
  })
}

export function listTasks(id: string, limit = 20) {
  return call<{ tasks: StationTask[] }>(`/api/station/agents/${encodeURIComponent(id)}/tasks?limit=${limit}`)
}
