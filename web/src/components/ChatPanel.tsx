import { useState } from "react"
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
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[70ch] rounded p-3 ${
              m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            {m.text}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
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
          className="flex-1"
        />
        <div className="flex flex-col gap-2">
          <Button onClick={send} disabled={busy}>
            {busy ? "..." : "Ask"}
          </Button>
          <Button variant={speak ? "default" : "outline"} onClick={() => setSpeak((s) => !s)}>
            🔊
          </Button>
          <MicButton onText={(text) => setInput((prev) => (prev ? prev + " " + text : text))} />
        </div>
      </div>
    </main>
  )
}
