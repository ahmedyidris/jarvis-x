import { useRef, useState } from "react"
import { Mic, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { transcribeAudio } from "@/lib/api"

export function MicButton({ onText }: { onText: (text: string) => void }) {
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream)
    chunksRef.current = []
    recorder.ondataavailable = (e) => chunksRef.current.push(e.data)
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" })
      const text = await transcribeAudio(blob)
      onText(text)
      stream.getTracks().forEach((t) => t.stop())
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
    <Button
      variant={recording ? "destructive" : "outline"}
      size="icon"
      className={recording ? "rounded-[3px] hud-pulse-voice" : "rounded-[3px]"}
      onClick={recording ? stop : start}
      aria-pressed={recording}
      aria-label={recording ? "Stop recording" : "Start voice input"}
      title={recording ? "Stop recording" : "Start voice input"}
    >
      {recording ? <Square className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}
    </Button>
  )
}
