import { apiFetch, API_TOKEN } from "@/lib/api"

export type Vertical = "letters" | "economic_facts" | "commodities_macro" | "geopolitical_risk"

export const VERTICALS: Vertical[] = ["letters", "economic_facts", "commodities_macro", "geopolitical_risk"]

export interface SystemHealth {
  disk_free_gb: number
  disk_total_gb: number
  load_average: { "1m": number; "5m": number; "15m": number }
  memory_used_mb: number | null
  memory_total_mb: number | null
}

export interface AgentLoopStatus {
  scheduler_running: boolean | null
  note: string
}

export interface TestStatus {
  available: boolean
  file?: string
  passed?: number
  failed?: number
  note?: string
}

export interface GenerationJob {
  vertical: string
  status: "running" | "done" | "failed" | "timeout" | "error"
  started_at?: string
  finished_at?: string
  output_tail?: string
  error?: string
}

export interface DashboardOverview {
  timestamp: string
  kill_switch_stopped: boolean
  system: SystemHealth
  agent_loop: AgentLoopStatus
  tests: TestStatus
  jobs: Record<string, GenerationJob>
}

export interface TestHistoryEntry {
  date: string
  passed: number
  failed: number
}

export interface VerticalFact {
  filename: string
  topic: string | null
  source_name: string | null
  source_url: string | null
  generated_at: string
}

export interface VerticalStatus {
  fact_count: number
  facts: VerticalFact[]
  next_scheduled_refresh: null
}

export interface VideoEntry {
  filename: string
  size_mb: number
  rendered_at: string
  url: string
}

export interface VideoStatus {
  video_count: number
  videos: VideoEntry[]
}

export interface DashboardConfig {
  constitution_preview: string
  guidelines_preview: string
  voice_per_vertical: Record<Vertical, string>
  api_token_configured: boolean
  self_debug_loop_status: string
}

export async function getOverview(): Promise<DashboardOverview> {
  return (await apiFetch("/api/dashboard/overview")).json()
}

export async function getTestHistory(): Promise<TestHistoryEntry[]> {
  const data = await (await apiFetch("/api/dashboard/tests/history")).json()
  return data.history
}

export async function getVerticals(): Promise<Record<Vertical, VerticalStatus>> {
  return (await apiFetch("/api/dashboard/verticals")).json()
}

export async function getVideos(): Promise<Record<Vertical, VideoStatus>> {
  return (await apiFetch("/api/dashboard/videos")).json()
}

export async function getContent(vertical: Vertical, filename: string): Promise<Record<string, unknown>> {
  return (await apiFetch(`/api/dashboard/content/${vertical}/${filename}`)).json()
}

export async function updateContent(
  vertical: Vertical,
  filename: string,
  update: { narration_script?: string; on_screen_text?: string; image_prompt?: string }
): Promise<Record<string, unknown>> {
  return (
    await apiFetch(`/api/dashboard/content/${vertical}/${filename}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    })
  ).json()
}

export async function triggerGenerate(vertical: Vertical): Promise<{ job_id: string; status: string }> {
  return (await apiFetch(`/api/dashboard/generate/${vertical}`, { method: "POST" })).json()
}

export async function triggerRunTests(): Promise<{ status: string }> {
  return (await apiFetch("/api/dashboard/run-tests", { method: "POST" })).json()
}

export async function getConfig(): Promise<DashboardConfig> {
  return (await apiFetch("/api/dashboard/config")).json()
}

// WebSocket URL for live overview updates. Native browser WebSocket can't
// send custom headers, so the token (if configured) goes as a query param
// instead -- app.py's /ws/dashboard accepts either.
export function dashboardWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  const base = `${proto}//${window.location.host}/ws/dashboard`
  return API_TOKEN ? `${base}?token=${encodeURIComponent(API_TOKEN)}` : base
}

export interface LiveDataItem {
  id: string
  label: string
  value: number | null
  headline?: string | null
  unit: string | null
  changePercent24h: number | null
  origin: string
  live: boolean
  note: string | null
  asOf: string | null
  error: string | null
}

export interface LiveDataSnapshot {
  timestamp?: string
  live_count?: number
  total?: number
  items: LiveDataItem[]
  error?: string
}

export async function getLiveData(): Promise<LiveDataSnapshot> {
  return (await apiFetch("/api/dashboard/live-data")).json()
}
