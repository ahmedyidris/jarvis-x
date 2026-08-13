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

export async function askJarvis(question: string, tier: Tier, speak: boolean): Promise<AskResponse> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, tier, speak }),
  })
  if (!res.ok) throw new Error(`ask failed: ${res.status}`)
  return res.json()
}

export async function getHistory(limit = 20): Promise<HistoryEntry[]> {
  const res = await fetch(`/api/history?limit=${limit}`)
  const data = await res.json()
  return data.conversations
}

export async function getKillswitch(): Promise<boolean> {
  const res = await fetch("/api/killswitch")
  const data = await res.json()
  return data.stopped
}

export async function setKillswitch(stopped: boolean): Promise<boolean> {
  const res = await fetch("/api/killswitch", {
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
  const res = await fetch("/api/transcribe", { method: "POST", body: form })
  const data = await res.json()
  return data.text
}
