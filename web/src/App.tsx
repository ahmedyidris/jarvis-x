import { useState } from "react"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import type { Tier } from "@/lib/api"

export default function App() {
  const [tier, setTier] = useState<Tier>("local")
  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      <Sidebar tier={tier} onTierChange={setTier} />
      <ChatPanel tier={tier} />
    </div>
  )
}
