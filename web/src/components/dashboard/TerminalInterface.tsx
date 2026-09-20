import { useEffect, useRef, useState } from "react"
import { Terminal as TerminalIcon, Play, AlertCircle, CheckCircle2, ChevronRight } from "lucide-react"

type CommandResult = {
  id: string
  cmd: string
  args: string[]
  exit_code?: number
  stdout?: string
  stderr?: string
  error?: string
  running: boolean
}

export function TerminalInterface() {
  const [history, setHistory] = useState<CommandResult[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [history])

  async function execute(cmdString: string) {
    if (!cmdString.trim() || busy) return
    
    // Naive split just for UI representation, app.py uses Bash so we just pass bash -c
    const id = String(Date.now())
    setHistory(h => [...h, { id, cmd: "bash", args: ["-c", cmdString], running: true }])
    setInput("")
    setBusy(true)

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "bash", args: ["-c", cmdString] }),
      })
      
      const data = await res.json()
      
      setHistory(h => h.map(item => 
        item.id === id 
          ? { ...item, running: false, exit_code: data.exit_code, stdout: data.stdout, stderr: data.stderr } 
          : item
      ))
    } catch (e) {
      setHistory(h => h.map(item => 
        item.id === id 
          ? { ...item, running: false, error: String(e) } 
          : item
      ))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e] font-mono text-sm text-zinc-300">
      <div className="flex items-center gap-2 border-b border-[#333] bg-[#252525] px-4 py-3 text-zinc-400">
        <TerminalIcon className="size-4" />
        <span className="font-semibold tracking-wide">JARVIS SECURE TERMINAL</span>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5"><div className="size-2 rounded-full bg-green-500"></div> Connected to Host</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-6 space-y-1 text-zinc-500">
          <div>Jarvis X OS (v2.0) Terminal Access.</div>
          <div>All commands execute directly on the local machine via /api/execute.</div>
        </div>

        {history.map(item => (
          <div key={item.id} className="mb-6">
            <div className="flex items-center gap-2 text-zinc-100">
              <span className="text-emerald-500">jarvis@local:~$</span>
              <span className="font-semibold">{item.args[1]}</span>
            </div>
            
            {item.running ? (
              <div className="mt-2 text-zinc-500 animate-pulse">Executing...</div>
            ) : item.error ? (
              <div className="mt-2 text-red-400 flex items-start gap-2 bg-red-950/30 p-3 rounded">
                <AlertCircle className="size-4 mt-0.5" />
                <div>{item.error}</div>
              </div>
            ) : (
              <div className="mt-2 rounded bg-black/40 p-3 ring-1 ring-white/10">
                {item.exit_code !== 0 && (
                  <div className="mb-2 text-red-400 flex items-center gap-2">
                    <AlertCircle className="size-4" /> Process exited with code {item.exit_code}
                  </div>
                )}
                {item.stdout && <pre className="whitespace-pre-wrap text-zinc-300">{item.stdout}</pre>}
                {item.stderr && <pre className="whitespace-pre-wrap text-red-300 mt-2">{item.stderr}</pre>}
                {!item.stdout && !item.stderr && item.exit_code === 0 && (
                  <div className="text-zinc-500 flex items-center gap-2">
                    <CheckCircle2 className="size-4" /> Command completed with no output.
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-[#333] bg-[#252525] p-3">
        <div className="flex items-center gap-2">
          <ChevronRight className="size-5 text-emerald-500" />
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                execute(input)
              }
            }}
            placeholder="Enter shell command..."
            disabled={busy}
            className="flex-1 bg-transparent px-2 py-2 text-zinc-100 outline-none placeholder:text-zinc-600"
            autoFocus
          />
          <button 
            onClick={() => execute(input)} 
            disabled={busy || !input.trim()}
            className="rounded bg-emerald-600 px-4 py-2 text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            <Play className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
