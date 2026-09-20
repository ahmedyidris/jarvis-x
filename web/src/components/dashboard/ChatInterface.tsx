import { useEffect, useRef, useState } from "react"
import { Send, Mic, Volume2, Square, Loader2, Bot, Paperclip } from "lucide-react"

type Msg = { id: string; role: "user" | "jarvis"; text: string; audio?: string | null }

function loadSettings() {
  try { return JSON.parse(localStorage.getItem("jarvisx.settings") || "{}") }
  catch { return {} }
}

export function ChatInterface() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [msgs])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  async function send(text: string) {
    if (!text.trim() || busy) return
    const s = loadSettings()
    setMsgs(m => [...m, { id: String(Date.now()), role: "user", text }])
    setInput("")
    setBusy(true)
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, tier: s.tier || "quality", speak: true }),
      })
      const data = await res.json()
      setMsgs(m => [...m, {
        id: String(Date.now() + 1), role: "jarvis",
        text: data.response, audio: data.audio,
      }])
      if (data.audio && s.autoPlay !== false) new Audio(data.audio).play().catch(() => {})
    } catch (e) {
      setMsgs(m => [...m, {
        id: String(Date.now() + 1), role: "jarvis",
        text: "Request failed: " + String(e),
      }])
    } finally { setBusy(false) }
  }

  async function toggleMic() {
    if (recording) { recRef.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks: Blob[] = []
      rec.ondataavailable = e => chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false)
        setBusy(true)
        try {
          const fd = new FormData()
          fd.append("audio", new Blob(chunks, { type: "audio/wav" }), "in.wav")
          const r = await fetch("/api/transcribe", { method: "POST", body: fd })
          const { text } = await r.json()
          if (text && text.trim()) await send(text)
          else setBusy(false)
        } catch { setBusy(false) }
      }
      recRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      alert("Microphone unavailable in this context.")
    }
  }

  return (
    <div className="flex h-full flex-col items-center">
      <div className="w-full max-w-4xl flex-1 space-y-6 overflow-y-auto px-6 py-8">
        {msgs.length === 0 && (
          <div className="mt-20 flex flex-col items-center justify-center text-center">
            <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-orange-700/10 text-orange-700 dark:bg-orange-700/20">
              <Bot className="size-8" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">
              Good morning.
            </h1>
            <p className="mt-2 text-zinc-500">How can I help you today?</p>
          </div>
        )}

        {msgs.map(m => (
          <div key={m.id} className={`flex gap-4 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "jarvis" && (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-700 text-white">
                <Bot className="size-5" />
              </div>
            )}
            
            <div className={`max-w-[85%] text-base leading-relaxed ${
              m.role === "user" 
                ? "rounded-2xl bg-[#f4f4f4] px-5 py-3 text-zinc-900 dark:bg-[#2d2d2d] dark:text-zinc-100" 
                : "pt-1 text-zinc-800 dark:text-zinc-200"
            }`}>
              <div dir="auto" className="whitespace-pre-wrap">{m.text}</div>
              {m.audio && (
                <button onClick={() => new Audio(m.audio!).play()}
                        className="mt-3 flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
                  <Volume2 className="size-3.5" /> Play Response
                </button>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-4 justify-start">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-700/50 text-white">
              <Bot className="size-5" />
            </div>
            <div className="flex items-center pt-1 text-sm font-medium text-zinc-500">
              <Loader2 className="mr-2 size-4 animate-spin" /> Thinking...
            </div>
          </div>
        )}
        <div ref={endRef} className="h-4" />
      </div>

      <div className="w-full max-w-4xl p-6 pt-0">
        <div className="relative flex flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm focus-within:border-zinc-300 focus-within:ring-1 focus-within:ring-zinc-300 dark:border-zinc-700 dark:bg-[#2d2d2d] dark:focus-within:border-zinc-600 dark:focus-within:ring-zinc-600">
          <textarea
            ref={textareaRef}
            dir="auto"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            placeholder="Message Jarvis..."
            disabled={busy}
            className="max-h-[200px] min-h-[56px] w-full resize-none rounded-2xl bg-transparent px-4 py-4 text-base text-zinc-900 placeholder:text-zinc-500 focus:outline-none dark:text-zinc-100"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1">
              <button className="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300">
                <Paperclip className="size-5" />
              </button>
              <button onClick={toggleMic} disabled={busy && !recording}
                className={`flex size-8 items-center justify-center rounded-lg transition ${
                  recording 
                    ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" 
                    : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                }`}
                title={recording ? "Stop and send" : "Speak"}>
                {recording ? <Square className="size-4" /> : <Mic className="size-5" />}
              </button>
            </div>
            <button onClick={() => send(input)} disabled={busy || !input.trim()}
              className="flex size-8 items-center justify-center rounded-lg bg-black text-white transition hover:bg-zinc-800 disabled:opacity-30 dark:bg-white dark:text-black dark:hover:bg-zinc-200">
              <Send className="size-4" />
            </button>
          </div>
        </div>
        <div className="mt-3 text-center text-xs text-zinc-400">
          Jarvis X can execute local scripts and process audio. AI models can make mistakes.
        </div>
      </div>
    </div>
  )
}
