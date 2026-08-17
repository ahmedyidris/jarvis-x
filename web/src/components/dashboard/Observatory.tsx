import { useEffect, useState } from "react"
import { Activity, Cpu, HardDrive, OctagonX, TestTube2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useDashboardOverview } from "@/lib/use-dashboard-overview"
import { getHistory, type HistoryEntry } from "@/lib/api"
import { getTestHistory, type TestHistoryEntry } from "@/lib/dashboard-api"

// Small dependency-free sparkline -- inline SVG rather than pulling in a
// charting library for one chart backed by real (if currently short)
// history. See docs/DEVELOPMENT.md / this vertical's honesty note: this
// will show few points until the nightly cron job (added 2026-08-16) has
// run more than a couple of times -- that's real data, not padding.
function Sparkline({ data }: { data: TestHistoryEntry[] }) {
  if (data.length === 0) {
    return (
      <p className="font-mono-hud text-xs text-muted-foreground">
        No nightly runs yet — first one fires at 03:00.
      </p>
    )
  }
  const w = 240
  const h = 48
  const max = Math.max(...data.map((d) => d.passed + d.failed), 1)
  const points = data.map((d, i) => {
    const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w
    const y = h - (d.passed / max) * h
    return `${x},${y}`
  })
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full" aria-label="Nightly test pass count over time">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--hud-accent)"
        strokeWidth={2}
      />
      {data.map((d, i) => {
        const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w
        const y = h - (d.passed / max) * h
        return <circle key={d.date} cx={x} cy={y} r={2.5} fill="var(--hud-accent)" />
      })}
    </svg>
  )
}

export function Observatory() {
  const { overview, connected } = useDashboardOverview()
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [testHistory, setTestHistory] = useState<TestHistoryEntry[]>([])

  useEffect(() => {
    getHistory(10).then(setHistory).catch(() => {})
    getTestHistory().then(setTestHistory).catch(() => {})
  }, [])

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card className="rounded-[3px] hud-border-dim">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 font-mono-hud text-xs uppercase tracking-[0.06em]">
            <Cpu className="size-3.5" aria-hidden="true" />
            System health
            <Badge variant={connected ? "default" : "outline"} className="ml-auto">
              {connected ? "live" : "polling"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 font-mono-hud text-xs">
          {overview ? (
            <>
              <p>
                <HardDrive className="mr-1 inline size-3" aria-hidden="true" />
                Disk: {overview.system.disk_free_gb}GB free of {overview.system.disk_total_gb}GB
              </p>
              <p>Load avg: {overview.system.load_average["1m"].toFixed(2)} / {overview.system.load_average["5m"].toFixed(2)} / {overview.system.load_average["15m"].toFixed(2)}</p>
              {overview.system.memory_total_mb && (
                <p>
                  Memory: {Math.round(overview.system.memory_used_mb!)}MB / {Math.round(overview.system.memory_total_mb)}MB
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Loading…</p>
          )}
        </CardContent>
      </Card>

      <Card className={overview?.kill_switch_stopped ? "rounded-[3px] border border-hud-blocked bg-hud-blocked/15" : "rounded-[3px] hud-border-dim"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 font-mono-hud text-xs uppercase tracking-[0.06em]">
            <OctagonX className={overview?.kill_switch_stopped ? "size-3.5 text-hud-blocked" : "size-3.5"} aria-hidden="true" />
            Kill switch &amp; agent loop
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 font-mono-hud text-xs">
          <p className={overview?.kill_switch_stopped ? "font-semibold text-hud-blocked" : ""}>
            {overview?.kill_switch_stopped ? "STOPPED" : "Running"}
          </p>
          <p className="text-muted-foreground">
            scheduler.js: {overview?.agent_loop.scheduler_running === null ? "unknown" : overview?.agent_loop.scheduler_running ? "running" : "not running"}
          </p>
          <p className="text-muted-foreground/70">{overview?.agent_loop.note}</p>
        </CardContent>
      </Card>

      <Card className="rounded-[3px] hud-border-dim">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 font-mono-hud text-xs uppercase tracking-[0.06em]">
            <TestTube2 className="size-3.5" aria-hidden="true" />
            Test suite
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 font-mono-hud text-xs">
          {overview?.tests.available ? (
            <p>
              {overview.tests.passed}/{(overview.tests.passed ?? 0) + (overview.tests.failed ?? 0)} passed ({overview.tests.file})
            </p>
          ) : (
            <p className="text-muted-foreground">{overview?.tests.note ?? "Loading…"}</p>
          )}
          <Sparkline data={testHistory} />
        </CardContent>
      </Card>

      <Card className="rounded-[3px] hud-border-dim">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 font-mono-hud text-xs uppercase tracking-[0.06em]">
            <Activity className="size-3.5" aria-hidden="true" />
            Last 10 decisions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-40">
            <div className="flex flex-col gap-2 pe-2">
              {history.length === 0 && (
                <p className="font-mono-hud text-xs text-muted-foreground">No conversations logged yet.</p>
              )}
              {history.map((h, i) => (
                <div key={i} className="min-w-0 rounded-[3px] border border-hud-accent-dim/30 bg-background/60 p-2 text-xs">
                  <p className="min-w-0 truncate text-muted-foreground">{h.user_input}</p>
                  <p className="min-w-0 truncate text-foreground">{h.response}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
