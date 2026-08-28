import { useEffect, useRef, useState } from "react"
import { Send, Mic, Volume2, Square, Loader2 } from "lucide-react"

type Msg = { id: string; role: "user" | "jarvis"; text: string; audio?: string | null }

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem("jarvisx.settings") || "{}")
  } catch { return {} }
}

export function ChatInterface() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const recRef = useRef<MediaRecorder | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [msgs])

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
        body: JSON.stringify({
          question: text,
          tier: s.tier || "quality",
          speak: true,
        }),
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
    <div className="flex h-full flex-col bg-black">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <div className="text-2xl font-bold text-red-600">JARVIS X</div>
              <div className="mt-1 text-sm text-zinc-500">
                اسألني أي حاجة &middot; Ask me anything
              </div>
            </div>
          </div>
        )}
        {msgs.map(m => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${
              m.role === "user"
                ? "bg-red-700 text-white"
                : "border border-red-900/60 bg-zinc-950 text-zinc-100"}`}>
              <div dir="auto" className="whitespace-pre-wrap">{m.text}</div>
              {m.audio && (
                <button onClick={() => new Audio(m.audio!).play()}
                        className="mt-2 flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                  <Volume2 className="size-3.5" /> play
                </button>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" /> thinking&hellip;
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-red-900/60 p-3">
        <div className="flex gap-2">
          <button onClick={toggleMic} disabled={busy && !recording}
            className={`rounded px-3 ${recording ? "bg-red-700 text-white" : "bg-zinc-900 text-zinc-400 hover:text-red-400"}`}
            title={recording ? "Stop and send" : "Speak"}>
            {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
          </button>
          <input
            dir="auto"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") send(input) }}
            placeholder="اكتب هنا..."
            disabled={busy}
            className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-2
                       text-sm text-zinc-100 placeholder-zinc-600 outline-none
                       focus:border-red-700"
          />
          <button onClick={() => send(input)} disabled={busy || !input.trim()}
            className="rounded bg-red-700 px-4 text-white disabled:opacity-40">
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
