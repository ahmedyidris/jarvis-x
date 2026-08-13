import { useState } from "react"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import type { Tier } from "@/lib/api"

export default function App() {
  const [tier, setTier] = useState<Tier>("local")
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
      <Sidebar tier={tier} onTierChange={setTier} />
      <ChatPanel tier={tier} />
    </div>
  )
}
