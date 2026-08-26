export type Tier = "local" | "quality"

export interface AskResponse {
  question: string
  response: string
  tier: Tier
  model: string
  voice: string | null
  audio: string | null
}

export interface HistoryEntry {
  timestamp: string
  user_input: string
  response: string
  model: string
  latency_ms: number
  voice_id: string | null
}

// Only set when the backend has JARVIS_API_TOKEN configured (see app.py) --
// unset by default, so this is a no-op until you opt in on both sides.
// Exported: the native browser WebSocket API can't send custom headers, so
// dashboard-api.ts's WebSocket connection needs this to pass the token as
// a query param instead (app.py's /ws/dashboard accepts either).
export const API_TOKEN = import.meta.env.VITE_JARVIS_API_TOKEN as string | undefined

// Exported so other modules (e.g. dashboard-api.ts) reuse the same
// token/error-handling behavior instead of duplicating it.
export async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> | undefined) }
  if (API_TOKEN) headers["X-Jarvis-Token"] = API_TOKEN
  const res = await fetch(url, { ...opts, headers })
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`)
  return res
}

export async function askJarvis(question: string, tier: Tier, speak: boolean): Promise<AskResponse> {
  const res = await apiFetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, tier, speak }),
  })
  return res.json()
}

export async function getHistory(limit = 20): Promise<HistoryEntry[]> {
  const res = await apiFetch(`/api/history?limit=${limit}`)
  const data = await res.json()
  return data.conversations
}

export async function getKillswitch(): Promise<boolean> {
  const res = await apiFetch("/api/killswitch")
  const data = await res.json()
  return data.stopped
}

export async function setKillswitch(stopped: boolean): Promise<boolean> {
  const res = await apiFetch("/api/killswitch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopped }),
  })
  const data = await res.json()
  return data.stopped
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData()
  form.append("audio", blob, "recording.wav")
  const res = await apiFetch("/api/transcribe", { method: "POST", body: form })
  const data = await res.json()
  return data.text
}

// === DECISION INSPECTOR ===

export interface DecisionDetail {
  id: string
  timestamp: string
  question: string
  tier: Tier
  model: string
  reasoning: string
  sources: { name: string; value: string; age_ms: number }[]
  output: string
  latency_ms: number
}

export async function getDecision(id: string): Promise<DecisionDetail> {
  const res = await apiFetch(`/api/decision/${id}`)
  return res.json()
}

// === OUTPUT LIBRARY ===

export interface OutputEntry {
  id: string
  timestamp: string
  question: string
  response: string
  model: string
  tier: Tier
}

export interface OutputQuery {
  from_date?: string
  to_date?: string
  model?: string
  tier?: Tier
  search?: string
  limit?: number
}

export async function queryOutputs(filters: OutputQuery): Promise<OutputEntry[]> {
  const params = new URLSearchParams()
  if (filters.from_date) params.append("from_date", filters.from_date)
  if (filters.to_date) params.append("to_date", filters.to_date)
  if (filters.model) params.append("model", filters.model)
  if (filters.tier) params.append("tier", filters.tier)
  if (filters.search) params.append("search", filters.search)
  if (filters.limit) params.append("limit", String(filters.limit))
  
  const res = await apiFetch(`/api/outputs/query?${params}`)
  return res.json()
}

// === VERTICAL CONTROLS ===

export interface VerticalStatus {
  name: string
  enabled: boolean
  last_run?: string
  next_run?: string
  schedule?: string
}

export async function getVerticalStatus(): Promise<VerticalStatus[]> {
  const res = await apiFetch("/api/verticals/status")
  return res.json()
}

export async function pauseVertical(name: string): Promise<VerticalStatus> {
  const res = await apiFetch(`/api/verticals/${name}/pause`, { method: "POST" })
  return res.json()
}

export async function resumeVertical(name: string): Promise<VerticalStatus> {
  const res = await apiFetch(`/api/verticals/${name}/resume`, { method: "POST" })
  return res.json()
}
