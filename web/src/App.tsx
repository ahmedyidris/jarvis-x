import { useEffect, useState } from "react"
import { Power } from "lucide-react"
import { Dashboard } from "@/components/Dashboard"
import { getKillswitch, setKillswitch } from "@/lib/api"

export default function App() {
  const [stopped, setStopped] = useState(false)

  useEffect(() => {
    getKillswitch().then(setStopped).catch(() => {})
  }, [])

  async function toggleKill() {
    try {
      const next = await setKillswitch(!stopped)
      setStopped(next)
    } catch {}
  }

  // Ctrl+K toggles the kill switch — the one control worth a shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        toggleKill()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <div className="relative isolate flex h-screen w-screen flex-col overflow-hidden
                    bg-black text-zinc-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-30"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(198,40,40,0.25), transparent 70%)",
        }}
      />

      <button
        onClick={toggleKill}
        title="Kill switch (Ctrl+K)"
        className={`absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded
                    px-2.5 py-1 text-xs font-medium transition ${
          stopped
            ? "bg-red-700 text-white"
            : "bg-zinc-900 text-zinc-500 hover:text-red-400"}`}
      >
        <Power className="size-3.5" />
        {stopped ? "HALTED" : "ACTIVE"}
      </button>

      <Dashboard />
    </div>
  )
}
