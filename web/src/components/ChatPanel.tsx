import { useEffect, useRef, useState } from "react"
import { Loader2, Send, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MicButton } from "@/components/MicButton"
import { askJarvis, type AskResponse, type Tier } from "@/lib/api"

interface Message {
  role: "user" | "jarvis"
  text: string
  audio?: string | null
}

export function ChatPanel({ tier }: { tier: Tier }) {
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [speak, setSpeak] = useState(false)
  const [busy, setBusy] = useState(false)
  const scrollEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ block: "end" })
  }, [messages])

  async function send() {
    if (!input.trim() || busy) return
    const question = input.trim()
    setMessages((m) => [...m, { role: "user", text: question }])
    setInput("")
    setBusy(true)
    try {
      const res: AskResponse = await askJarvis(question, tier, speak)
      setMessages((m) => [...m, { role: "jarvis", text: res.response, audio: res.audio }])
      if (res.audio) new Audio(res.audio).play()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex h-full flex-1 flex-col gap-4 p-4">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono-hud text-sm text-muted-foreground">
              Ask Jarvis anything to begin.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ms-auto max-w-[70ch] rounded-[7px] border border-hud-accent/30 bg-hud-accent/15 p-3 text-foreground"
                : "max-w-[70ch] rounded-[7px] border border-hud-accent-dim/25 bg-card p-3 text-foreground"
            }
          >
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="max-w-[70ch] rounded-[7px] border border-hud-accent-dim/25 bg-card p-3">
            <div className="flex items-center gap-2 font-mono-hud text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-hud-accent" aria-hidden="true" />
              <span>processing</span>
            </div>
          </div>
        )}
        <div ref={scrollEndRef} />
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Ask Jarvis..."
          className="flex-1 rounded-[3px]"
        />
        <div className="flex flex-col gap-2">
          <Button
            onClick={send}
            disabled={busy}
            size="icon"
            className={busy ? "rounded-[3px] hud-pulse-processing" : "rounded-[3px]"}
            aria-label="Send message"
            title="Send message"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
          </Button>
          <Button
            variant={speak ? "default" : "outline"}
            size="icon"
            className="rounded-[3px]"
            onClick={() => setSpeak((s) => !s)}
            aria-pressed={speak}
            aria-label={speak ? "Voice reply on" : "Voice reply off"}
            title={speak ? "Voice reply on" : "Voice reply off"}
          >
            {speak ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
          </Button>
          <MicButton onText={(text) => setInput((prev) => (prev ? prev + " " + text : text))} />
        </div>
      </div>
    </main>
  )
}
