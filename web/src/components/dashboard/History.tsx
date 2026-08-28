import { useEffect, useState } from "react"
import { Search, MessageSquare, RefreshCw } from "lucide-react"

type Entry = {
  timestamp: string
  user_input: string
  response?: string
  model?: string
  latency_ms?: number
}

export function History() {
  const [rows, setRows] = useState<Entry[]>([])
  const [q, setQ] = useState("")
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const r = await fetch("/api/history?limit=100")
      if (!r.ok) throw new Error("HTTP " + r.status)
      const d = await r.json()
      setRows(Array.isArray(d) ? d : (d.conversations || []))
    } catch (e) {
      setErr(String(e))
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const shown = rows.filter(r =>
    !q || (r.user_input || "").toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 size-4 text-zinc-600" />
          <input
            dir="auto"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search conversations..."
            className="w-full rounded border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-3
                       text-sm text-zinc-100 placeholder-zinc-600 outline-none
                       focus:border-red-700"
          />
        </div>
        <button onClick={load}
          className="rounded bg-zinc-900 px-3 text-zinc-400 hover:text-red-400">
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="mb-2 text-xs text-zinc-600">
        {loading ? "loading..." : `${shown.length} of ${rows.length} conversations`}
      </div>

      {err && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          Could not load history: {err}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto">
        {!loading && !err && shown.length === 0 && (
          <div className="py-10 text-center text-sm text-zinc-600">
            No conversations match.
          </div>
        )}
        {shown.map((r, i) => (
          <div key={r.timestamp + i}
               className="rounded border border-zinc-800 bg-zinc-950 p-3
                          transition hover:border-red-900/60">
            <div dir="auto" className="flex items-start gap-2 text-sm text-zinc-100">
              <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-red-600" />
              <span className="truncate">{r.user_input}</span>
            </div>
            {r.response && (
              <div dir="auto" className="mt-1 line-clamp-2 pl-6 text-xs text-zinc-400">
                {r.response}
              </div>
            )}
            <div className="mt-1 pl-6 font-mono text-[10px] text-zinc-600">
              {new Date(r.timestamp).toLocaleString()}
              {r.model ? ` · ${r.model}` : ""}
              {r.latency_ms ? ` · ${(r.latency_ms / 1000).toFixed(1)}s` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
