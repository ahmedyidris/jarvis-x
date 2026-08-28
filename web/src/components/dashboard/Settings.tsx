import { useEffect, useState } from "react"
import { Globe, Volume2, Accessibility, Cpu } from "lucide-react"

const TIERS = [
  { id: "local", label: "Local 3B", hint: "fast, offline" },
  { id: "quality", label: "Quality 9B", hint: "Arabic, slow" },
]

const VOICES = [
  { id: "clone", label: "My voice (Egyptian)", hint: "cloned, ~45s" },
  { id: "ar_JO-kareem", label: "Arabic MSA", hint: "Piper, instant" },
  { id: "en_us_piper", label: "English", hint: "Piper, instant" },
]

function Card({ icon: Icon, title, children }: any) {
  return (
    <div className="rounded border border-red-900/60 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-500">
        <Icon className="size-4" />
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ active, onClick, label, hint }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded px-3 py-2 text-left text-sm transition ${
        active ? "bg-red-700 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
      }`}
    >
      {label}
      {hint && <span className="ml-2 text-xs opacity-60">{hint}</span>}
    </button>
  )
}

export function Settings() {
  const [tier, setTier] = useState("quality")
  const [voice, setVoice] = useState("clone")
  const [lang, setLang] = useState("ar")
  const [autoPlay, setAutoPlay] = useState(true)
  const [captions, setCaptions] = useState(true)
  const [size, setSize] = useState("base")
  const [status, setStatus] = useState<any>(null)

  useEffect(() => {
    fetch("/api/status").then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    const s = { tier, voice, lang, autoPlay, captions, size }
    try { localStorage.setItem("jarvisx.settings", JSON.stringify(s)) } catch {}
  }, [tier, voice, lang, autoPlay, captions, size])

  return (
    <div className="grid max-w-3xl gap-4 p-4 md:grid-cols-2">
      <Card icon={Globe} title="Language">
        <div className="space-y-2">
          <Row active={lang === "ar"} onClick={() => setLang("ar")} label="العربية (مصري)" />
          <Row active={lang === "en"} onClick={() => setLang("en")} label="English" />
        </div>
      </Card>

      <Card icon={Cpu} title="Model">
        <div className="space-y-2">
          {TIERS.map(t => (
            <Row key={t.id} active={tier === t.id} onClick={() => setTier(t.id)}
                 label={t.label} hint={t.hint} />
          ))}
        </div>
      </Card>

      <Card icon={Volume2} title="Voice">
        <div className="space-y-2">
          {VOICES.map(v => (
            <Row key={v.id} active={voice === v.id} onClick={() => setVoice(v.id)}
                 label={v.label} hint={v.hint} />
          ))}
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={autoPlay} className="accent-red-600"
                   onChange={e => setAutoPlay(e.target.checked)} />
            Play replies automatically
          </label>
        </div>
      </Card>

      <Card icon={Accessibility} title="Accessibility">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={captions} className="accent-red-600"
                 onChange={e => setCaptions(e.target.checked)} />
          Show text with audio
        </label>
        <div className="mt-3">
          <div className="mb-1 text-xs text-zinc-500">Text size</div>
          <div className="flex gap-2">
            {["sm", "base", "lg"].map(s => (
              <button key={s} onClick={() => setSize(s)}
                className={`rounded px-3 py-1 text-sm ${
                  size === s ? "bg-red-700 text-white" : "bg-zinc-900 text-zinc-400"}`}>
                {s === "sm" ? "A" : s === "base" ? "A" : "A"}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {status && (
        <div className="md:col-span-2 rounded border border-zinc-800 bg-zinc-950 p-3
                        font-mono text-xs text-zinc-500">
          {status.version} · {status.conversations} conversations ·
          {" "}{Object.keys(status.available_voices || {}).length} voices installed
        </div>
      )}
    </div>
  )
}
