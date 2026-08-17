import { useEffect, useState } from "react"
import { Cpu, Gauge, History, MessageSquare, OctagonX, Radio } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getHistory, getKillswitch, setKillswitch, type HistoryEntry, type Tier } from "@/lib/api"

interface SidebarProps {
  tier: Tier
  onTierChange: (tier: Tier) => void
  view: "chat" | "dashboard"
  onViewChange: (view: "chat" | "dashboard") => void
}

export function Sidebar({ tier, onTierChange, view, onViewChange }: SidebarProps) {
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
    <aside className="flex h-full w-72 shrink-0 flex-col gap-4 border-e border-hud-accent-dim/40 bg-background p-4">
      {/* Wordmark — no logo yet (see BrandGuidelines.md), text mark in the HUD mono face */}
      <div className="flex items-center gap-2 pb-1">
        <Radio className="size-4 text-hud-accent" aria-hidden="true" />
        <span className="font-mono-hud text-sm font-semibold tracking-[0.08em] text-foreground">
          JARVIS X
        </span>
      </div>

      {/* Chat / Dashboard view switcher — Ctrl+G/Ctrl+R (App.tsx) jump here automatically */}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant={view === "chat" ? "default" : "outline"}
          className="flex-1 rounded-[3px] font-mono-hud text-xs"
          onClick={() => onViewChange("chat")}
        >
          <MessageSquare className="size-3.5" aria-hidden="true" />
          Chat
        </Button>
        <Button
          size="sm"
          variant={view === "dashboard" ? "default" : "outline"}
          className="flex-1 rounded-[3px] font-mono-hud text-xs"
          onClick={() => onViewChange("dashboard")}
        >
          <Gauge className="size-3.5" aria-hidden="true" />
          Dashboard
        </Button>
      </div>

      {/* Model tier */}
      <section className="rounded-[3px] hud-border-dim bg-card p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
          <Cpu className="size-3.5" aria-hidden="true" />
          <span>Model tier</span>
        </div>
        <Button
          size="sm"
          variant={tier === "local" ? "default" : "outline"}
          className="w-full rounded-[3px] font-mono-hud text-xs"
          onClick={() => onTierChange(tier === "local" ? "quality" : "local")}
          title={tier === "local" ? "Running local 3B model. Click to switch to quality (7B)." : "Running quality 7B model. Click to switch to local (3B)."}
        >
          {tier === "local" ? "LOCAL 3B" : "QUALITY 7B"}
        </Button>
      </section>

      {/* Kill switch — always one tap away, never nested (Design.md). Blocked state never glows. */}
      <section
        className={
          stopped
            ? "rounded-[3px] border border-hud-blocked bg-hud-blocked/15 p-3"
            : "rounded-[3px] hud-border-dim bg-card p-3"
        }
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            <OctagonX className={stopped ? "size-3.5 text-hud-blocked" : "size-3.5"} aria-hidden="true" />
            <span>Kill switch</span>
          </div>
          <Switch
            checked={!stopped}
            onCheckedChange={toggleKillswitch}
            aria-label={stopped ? "Kill switch engaged. Toggle to resume." : "System running. Toggle to stop."}
            title={stopped ? "Kill switch engaged. Toggle to resume." : "System running. Toggle to stop."}
          />
        </div>
        {stopped && (
          <p className="mt-2 font-mono-hud text-xs font-semibold tracking-[0.08em] text-hud-blocked">
            STOPPED
          </p>
        )}
      </section>

      {/* Recent memory — live values at a glance, not behind a click */}
      <section className="flex flex-1 flex-col overflow-hidden rounded-[3px] hud-border-dim bg-card p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
          <History className="size-3.5" aria-hidden="true" />
          <span>Recent memory</span>
        </div>
        <ScrollArea className="min-h-0 flex-1 pe-2">
          <div className="flex flex-col gap-2">
            {history.length === 0 && (
              <p className="rounded-[3px] border border-dashed border-hud-accent-dim/40 p-2 text-xs text-muted-foreground">
                No conversations logged yet.
              </p>
            )}
            {history.map((h, i) => (
              <div key={i} className="min-w-0 rounded-[3px] border border-hud-accent-dim/30 bg-background/60 p-2 text-xs">
                <p className="min-w-0 truncate text-muted-foreground">{h.user_input}</p>
                <p className="min-w-0 truncate text-foreground">{h.response}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </section>
    </aside>
  )
}
