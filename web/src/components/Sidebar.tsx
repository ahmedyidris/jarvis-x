import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { getHistory, getKillswitch, setKillswitch, type HistoryEntry, type Tier } from "@/lib/api"

interface SidebarProps {
  tier: Tier
  onTierChange: (tier: Tier) => void
}

export function Sidebar({ tier, onTierChange }: SidebarProps) {
  const [stopped, setStopped] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    getKillswitch().then(setStopped)
    getHistory(10).then(setHistory)
  }, [])

  async function toggleKillswitch() {
    const next = await setKillswitch(!stopped)
    setStopped(next)
  }

  return (
    <aside className="flex h-full w-72 flex-col gap-4 border-r border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Model tier</span>
        <Button
          size="sm"
          variant={tier === "local" ? "default" : "outline"}
          onClick={() => onTierChange(tier === "local" ? "quality" : "local")}
        >
          {tier === "local" ? "local (3b)" : "quality (7b)"}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Kill switch</span>
        <div className="flex items-center gap-2">
          {stopped && <Badge variant="destructive">STOPPED</Badge>}
          <Switch checked={!stopped} onCheckedChange={toggleKillswitch} />
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <span className="text-sm font-medium">Recent memory</span>
        <ScrollArea className="mt-2 h-full pr-2">
          {history.map((h, i) => (
            <div key={i} className="mb-2 rounded border border-border p-2 text-xs">
              <p className="truncate text-muted-foreground">{h.user_input}</p>
              <p className="truncate">{h.response}</p>
            </div>
          ))}
        </ScrollArea>
      </div>
    </aside>
  )
}
