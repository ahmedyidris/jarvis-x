import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, Loader2, ListTodo, OctagonX, RefreshCw, Send } from "lucide-react"
import {
  chat, listAgents, listTasks, queueTask, transcript, StationError,
  type StationAgent, type StationTask, type StationTurn,
} from "@/lib/station-api"

// The Station tab (handoff Priority 3): one card per agent in
// config/agents.yaml, and a desk for the selected one -- its transcript, a box
// to talk or queue a task, and where its queued work stands. Agents write text
// only; nothing here can make one run a tool.

const POLL_MS = 3000

const TIER_LABEL: Record<string, string> = {
  local: "local", fast: "fast", smart: "smart", quality: "quality",
}

const TASK_STYLE: Record<StationTask["status"], string> = {
  queued: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  running: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  stopped: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
}

function when(ts: number | null | undefined) {
  if (!ts) return ""
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function Station() {
  const [agents, setAgents] = useState<StationAgent[]>([])
  const [stopped, setStopped] = useState(false)
  const [loadErr, setLoadErr] = useState<StationError | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [turns, setTurns] = useState<StationTurn[]>([])
  const [tasks, setTasks] = useState<StationTask[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const refreshAgents = useCallback(async () => {
    try {
      const d = await listAgents()
      setAgents(d.agents)
      setStopped(d.stopped)
      setLoadErr(null)
      setSelected(s => s ?? d.agents[0]?.id ?? null)
    } catch (e) {
      setLoadErr(e instanceof StationError ? e : new StationError(0, String(e)))
    }
  }, [])

  const refreshDesk = useCallback(async (id: string) => {
    try {
      const [t, k] = await Promise.all([transcript(id), listTasks(id)])
      setTurns(t.turns)
      setTasks(k.tasks.slice().reverse())
    } catch { /* the agents poll reports the error */ }
  }, [])

  useEffect(() => {
    refreshAgents()
    const t = setInterval(refreshAgents, POLL_MS)
    return () => clearInterval(t)
  }, [refreshAgents])

  useEffect(() => {
    if (!selected) return
    refreshDesk(selected)
    const t = setInterval(() => refreshDesk(selected), POLL_MS)
    return () => clearInterval(t)
  }, [selected, refreshDesk])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [turns.length, sending])

  async function send(kind: "chat" | "task") {
    const text = input.trim()
    if (!text || !selected || sending) return
    setNotice(null)
    setSending(true)
    try {
      if (kind === "chat") {
        setTurns(t => [...t, { ts: Date.now() / 1000, role: "user", text, kind: "chat" }])
        setInput("")
        await chat(selected, text)
      } else {
        await queueTask(selected, text)
        setInput("")
        setNotice("Task queued. It runs in the background; the answer lands in the transcript.")
      }
    } catch (e) {
      setNotice(e instanceof StationError ? e.message : String(e))
    } finally {
      setSending(false)
      refreshDesk(selected)
      refreshAgents()
    }
  }

  const current = agents.find(a => a.id === selected) ?? null

  if (loadErr && agents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-lg border border-[#e5e5e5] p-5 text-sm dark:border-[#2e2e2e]">
          <div className="mb-2 font-semibold">Station unavailable</div>
          {loadErr.status === 404 ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              The Station backend is not mounted in app.py yet. It needs two lines (see
              docs/STATION.md), then a restart of hermes-api.
            </p>
          ) : (
            <p className="text-zinc-600 dark:text-zinc-400">{loadErr.message}</p>
          )}
          <button onClick={refreshAgents}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#efefed] px-3 py-1.5 text-xs font-medium dark:bg-[#2d2d2d]">
            <RefreshCw className="size-3.5" /> Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold tracking-tight">Station</div>
          <div className="text-xs text-zinc-500">
            {agents.length} agents · text only · free tiers, falling back to local
          </div>
        </div>
      </div>

      {stopped && (
        <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800
                        dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <OctagonX className="size-4 shrink-0" />
          Kill switch engaged. No agent will run, and queued tasks are marked stopped rather than run later.
        </div>
      )}

      {/* Roster */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {agents.map(a => (
          <button key={a.id} onClick={() => setSelected(a.id)}
            className={`rounded-lg border p-3 text-left transition ${
              a.id === selected
                ? "border-orange-700 bg-[#fbf7f4] dark:bg-[#2a2522]"
                : "border-[#e5e5e5] hover:border-zinc-400 dark:border-[#2e2e2e] dark:hover:border-zinc-600"}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Bot className="size-4 shrink-0 text-orange-700" />
                <span className="truncate font-medium">{a.name}</span>
              </div>
              <span className="rounded bg-[#efefed] px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-[#2d2d2d] dark:text-zinc-400">
                {TIER_LABEL[a.tier] ?? a.tier}
              </span>
            </div>
            <div className="mt-1 truncate text-xs text-zinc-500">{a.role}</div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className={`size-1.5 rounded-full ${a.busy ? "animate-pulse bg-orange-600" : "bg-emerald-600"}`} />
              {a.busy ? "working" : "idle"}
              {a.queued > 0 && ` · ${a.queued} queued`}
              {a.last_active ? ` · last ${when(a.last_active)}` : ""}
            </div>
          </button>
        ))}
      </div>

      {/* Desk for the selected agent */}
      {current && (
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-[#e5e5e5] dark:border-[#2e2e2e]">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {turns.length === 0 && !sending && (
                <div className="py-10 text-center text-sm text-zinc-500">
                  Nothing with {current.name} yet. Say something, or queue a task.
                </div>
              )}
              {turns.map((t, i) => (
                <div key={`${t.ts}-${i}`} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div dir="auto"
                    className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                      t.role === "user"
                        ? "bg-[#efefed] dark:bg-[#2d2d2d]"
                        : t.role === "error"
                          ? "border border-red-300 text-red-800 dark:border-red-900 dark:text-red-300"
                          : "border border-[#e5e5e5] dark:border-[#2e2e2e]"}`}>
                    {t.kind === "task" && t.role === "user" && (
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">task</div>
                    )}
                    {t.role === "error" ? `Failed: ${t.text}` : t.text}
                    <div className="mt-1 font-mono text-[10px] text-zinc-500">
                      {when(t.ts)}
                      {t.provider ? ` · ${t.provider}${t.model ? `/${t.model}` : ""}` : ""}
                    </div>
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 className="size-4 animate-spin" /> {current.name} is thinking…
                </div>
              )}
              <div ref={endRef} />
            </div>

            {notice && <div className="border-t border-[#e5e5e5] px-3 py-2 text-xs text-zinc-600 dark:border-[#2e2e2e] dark:text-zinc-400">{notice}</div>}

            <div className="flex items-end gap-2 border-t border-[#e5e5e5] p-2 dark:border-[#2e2e2e]">
              <textarea dir="auto" value={input} rows={2} maxLength={8000}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send("chat") } }}
                placeholder={`Message ${current.name}… (Enter to send, Shift+Enter for a new line)`}
                disabled={stopped}
                className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-[#e5e5e5] bg-transparent px-3 py-2 text-sm outline-none
                           focus:border-orange-700 disabled:opacity-50 dark:border-[#2e2e2e]" />
              <div className="flex flex-col gap-1">
                <button onClick={() => send("chat")} disabled={!input.trim() || sending || stopped}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-orange-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                  <Send className="size-3.5" /> Send
                </button>
                <button onClick={() => send("task")} disabled={!input.trim() || sending || stopped}
                  title="Queue it and come back later -- the answer lands in the transcript"
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#efefed] px-3 py-1.5 text-xs font-medium disabled:opacity-40 dark:bg-[#2d2d2d]">
                  <ListTodo className="size-3.5" /> Task
                </button>
              </div>
            </div>
          </div>

          <div className="hidden w-64 shrink-0 flex-col rounded-lg border border-[#e5e5e5] lg:flex dark:border-[#2e2e2e]">
            <div className="border-b border-[#e5e5e5] px-3 py-2 text-xs font-semibold text-zinc-500 dark:border-[#2e2e2e]">
              TASKS
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {tasks.length === 0 && <div className="p-2 text-xs text-zinc-500">No tasks yet.</div>}
              {tasks.map(k => (
                <div key={k.task_id} className="rounded-md border border-[#e5e5e5] p-2 text-xs dark:border-[#2e2e2e]">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TASK_STYLE[k.status] ?? ""}`}>{k.status}</span>
                    <span className="font-mono text-[10px] text-zinc-500">{when(k.updated)}</span>
                  </div>
                  {k.text && <div dir="auto" className="mt-1 line-clamp-3 text-zinc-700 dark:text-zinc-300">{k.text}</div>}
                  {k.error && <div className="mt-1 text-red-700 dark:text-red-400">{k.error}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
