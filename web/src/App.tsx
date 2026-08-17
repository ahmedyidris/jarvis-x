import { useEffect, useState } from "react"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import { Dashboard } from "@/components/Dashboard"
import { getKillswitch, setKillswitch, type Tier } from "@/lib/api"
import { triggerGenerate, triggerRunTests, VERTICALS } from "@/lib/dashboard-api"

type View = "chat" | "dashboard"

export default function App() {
  const [tier, setTier] = useState<Tier>("local")
  const [view, setView] = useState<View>("chat")

  // Keyboard shortcuts: Ctrl+K kill-switch toggle, Ctrl+G generate videos
  // (batch, all 4 verticals), Ctrl+R run tests (real scripts/status.sh via
  // /api/dashboard/run-tests, not a page reload -- preventDefault is
  // deliberate here).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === "k") {
        e.preventDefault()
        getKillswitch().then((stopped) => setKillswitch(!stopped))
      } else if (e.key === "g") {
        e.preventDefault()
        setView("dashboard")
        VERTICALS.forEach((v) => triggerGenerate(v).catch(() => {}))
      } else if (e.key === "r") {
        e.preventDefault()
        setView("dashboard")
        triggerRunTests().catch(() => {})
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div className="relative isolate flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Ambient arc-reactor glow — grounded in the aesthetic reference, not decoration for its own sake */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, color-mix(in oklch, var(--hud-accent-dim) 22%, transparent), transparent 70%)",
        }}
      />
      <Sidebar tier={tier} onTierChange={setTier} view={view} onViewChange={setView} />
      {view === "chat" ? <ChatPanel tier={tier} /> : <Dashboard />}
    </div>
  )
}
