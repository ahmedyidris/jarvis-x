import { useEffect, useState } from "react"
import { Globe, Volume2, Accessibility, Cpu } from "lucide-react"

// How each engine actually sounds to a user, not what it is internally.
const VOICE_LABELS: Record<string, { name: string; note: string }> = {
  ahmed:          { name: "Ahmed",            note: "Egyptian" },
  ar_eg_egtts:    { name: "Egyptian",         note: "Masri" },
  ar_msa_piper:   { name: "Arabic",           note: "formal · instant" },
  ar_msa_mms:     { name: "Arabic (alt)",     note: "formal" },
  en_us_piper:    { name: "English",          note: "instant" },
  en_gb_piper:    { name: "English (UK)",     note: "instant" },
  en_us_kokoro:   { name: "English (warm)",   note: "" },
  en_gb_kokoro:   { name: "English UK (warm)",note: "" },
}

const MODELS = [
  { id: "local",   name: "Quick",    note: "answers in seconds · English is best" },
  { id: "quality", name: "Thorough", note: "best Arabic · takes a minute or two" },
]

function Card({ icon: Icon, title, children }: any) {
  return (
    <div className="rounded border border-red-900/60 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-500">
        <Icon className="size-4" />{title}
      </div>
      {children}
    </div>
  )
}

function Row({ active, onClick, name, note }: any) {
  return (
    <button onClick={onClick}
      className={`w-full rounded px-3 py-2 text-left text-sm transition ${
        active ? "bg-red-700 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}>
      {name}
      {note && <span className="ml-2 text-xs opacity-60">{note}</span>}
    </button>
  )
}

export function Settings() {
  const [model, setModel] = useState("quality")
  const [voice, setVoice] = useState("ahmed")
  const [lang, setLang] = useState("ar")
  const [autoPlay, setAutoPlay] = useState(true)
  const [captions, setCaptions] = useState(true)
  const [size, setSize] = useState("base")
  const [status, setStatus] = useState<any>(null)

  useEffect(() => {
    fetch("/api/status")
      .then(r => r.json())
      .then(setStatus)
      .catch(e => setStatus({ _err: String(e) }))
    try {
      const s = JSON.parse(localStorage.getItem("jarvisx.settings") || "{}")
      if (s.tier) setModel(s.tier)
      if (s.voice) setVoice(s.voice)
      if (s.lang) setLang(s.lang)
      if (typeof s.autoPlay === "boolean") setAutoPlay(s.autoPlay)
      if (typeof s.captions === "boolean") setCaptions(s.captions)
      if (s.size) setSize(s.size)
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem("jarvisx.settings",
        JSON.stringify({ tier: model, voice, lang, autoPlay, captions, size }))
      document.documentElement.style.fontSize =
        size === "sm" ? "14px" : size === "lg" ? "19px" : "16px"
    } catch {}
  }, [model, voice, lang, autoPlay, captions, size])

  // Ahmed first, then whatever the backend reports as installed.
  const installed: string[] = Object.keys(status?.available_voices || {})
  const voiceIds = ["ahmed", ...installed.filter(v => v !== "ahmed")]

  return (
    <div className="grid max-w-3xl gap-4 p-4 md:grid-cols-2">
      <Card icon={Globe} title="Language">
        <div className="space-y-2">
          <Row active={lang === "ar"} onClick={() => setLang("ar")} name="العربية (مصري)" />
          <Row active={lang === "en"} onClick={() => setLang("en")} name="English" />
        </div>
      </Card>

      <Card icon={Cpu} title="Response style">
        <div className="space-y-2">
          {MODELS.map(m => (
            <Row key={m.id} active={model === m.id} onClick={() => setModel(m.id)}
                 name={m.name} note={m.note} />
          ))}
        </div>
      </Card>

      <Card icon={Volume2} title="Voice">
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {voiceIds.map(id => {
            const meta = VOICE_LABELS[id] || { name: id, note: "" }
            return <Row key={id} active={voice === id} onClick={() => setVoice(id)}
                        name={meta.name} note={meta.note} />
          })}
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={autoPlay} className="accent-red-600"
                 onChange={e => setAutoPlay(e.target.checked)} />
          Play replies automatically
        </label>
      </Card>

      <Card icon={Accessibility} title="Accessibility">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={captions} className="accent-red-600"
                 onChange={e => setCaptions(e.target.checked)} />
          Show text with audio
        </label>
        <div className="mt-3">
          <div className="mb-1 text-xs text-zinc-500">Text size</div>
          <div className="flex items-end gap-2">
            {[["sm","A","text-xs"],["base","A","text-base"],["lg","A","text-2xl"]].map(
              ([id, ch, cls]) => (
                <button key={id} onClick={() => setSize(id)}
                  className={`${cls} rounded px-3 py-1 leading-none ${
                    size === id ? "bg-red-700 text-white" : "bg-zinc-900 text-zinc-400"}`}>
                  {ch}
                </button>
              ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
