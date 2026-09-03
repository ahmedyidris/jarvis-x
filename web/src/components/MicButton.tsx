import { useRef, useState } from "react"
import { Mic, Square, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { transcribeAudio } from "@/lib/stt"

export function MicButton({ onText, language = "ar" }: { onText: (text: string) => void; language?: string }) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function start() {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Mic unavailable: open this page at http://localhost:5173 (secure context required).")
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setError(`Mic denied: ${(e as Error).name}. Check ChromeOS site permissions.`)
      return
    }
    const recorder = new MediaRecorder(stream)
    chunksRef.current = []
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setBusy(true)
      try {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
        if (blob.size < 1000) { setError("Recording too short."); return }
        const text = await transcribeAudio(blob, language)
        if (!text.trim()) { setError("No speech detected."); return }
        onText(text)
      } catch (e) {
        setError(`Transcribe failed: ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    }
    recorder.start()
    recorderRef.current = recorder
    setRecording(true)
  }

  function stop() {
    recorderRef.current?.stop()
    setRecording(false)
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={recording ? "destructive" : "outline"}
        size="icon"
        disabled={busy}
        className={recording ? "rounded-[3px] hud-pulse-voice" : "rounded-[3px]"}
        onClick={recording ? stop : start}
        aria-pressed={recording}
        aria-label={recording ? "Stop recording" : "Start voice input"}
      >
        {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
      </Button>
      {error && (
        <p className="flex items-start gap-1 text-xs text-destructive max-w-[220px]">
          <AlertCircle className="size-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
