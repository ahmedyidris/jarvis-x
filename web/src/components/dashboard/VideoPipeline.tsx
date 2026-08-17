import { useEffect, useState } from "react"
import { Clapperboard, Loader2, Play } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useDashboardOverview } from "@/lib/use-dashboard-overview"
import {
  getVideos,
  triggerGenerate,
  VERTICALS,
  type Vertical,
  type VideoEntry,
  type VideoStatus,
} from "@/lib/dashboard-api"

const LABELS: Record<Vertical, string> = {
  letters: "Letters",
  economic_facts: "Economic Facts",
  commodities_macro: "Commodities + Macro",
  geopolitical_risk: "Geopolitical Risk",
}

export function VideoPipeline() {
  const { overview } = useDashboardOverview()
  const [data, setData] = useState<Record<Vertical, VideoStatus> | null>(null)
  const [selected, setSelected] = useState<VideoEntry | null>(null)
  const [batchRunning, setBatchRunning] = useState(false)

  function refresh() {
    getVideos().then(setData).catch(() => {})
  }

  useEffect(refresh, [])
  // Re-check the video list whenever a job finishes, so a completed
  // generate shows its new video without a manual refresh.
  useEffect(() => {
    if (overview && Object.values(overview.jobs).some((j) => j.status !== "running")) refresh()
  }, [overview])

  async function batchGenerate() {
    setBatchRunning(true)
    try {
      await Promise.all(VERTICALS.map((v) => triggerGenerate(v).catch(() => null)))
    } finally {
      setBatchRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="font-mono-hud text-xs uppercase tracking-[0.06em] text-muted-foreground">
          4 verticals — generation is real (CPU-only Ollama), expect minutes per batch
        </p>
        <Button
          size="sm"
          className="rounded-[3px] font-mono-hud text-xs"
          disabled={batchRunning}
          onClick={batchGenerate}
        >
          {batchRunning && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          Batch generate all 4
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {VERTICALS.map((vertical) => {
          const status = data?.[vertical]
          const job = overview?.jobs[vertical]
          return (
            <Card key={vertical} className="rounded-[3px] hud-border-dim">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 font-mono-hud text-xs uppercase tracking-[0.06em]">
                  <Clapperboard className="size-3.5" aria-hidden="true" />
                  {LABELS[vertical]}
                  <Badge variant={status?.video_count ? "default" : "outline"} className="ml-auto">
                    {status?.video_count ?? 0} video{status?.video_count === 1 ? "" : "s"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {job && (
                  <p className="font-mono-hud text-[11px] text-muted-foreground">
                    last job: {job.status}
                    {job.status === "running" && <Loader2 className="ml-1 inline size-3 animate-spin" aria-hidden="true" />}
                  </p>
                )}
                <div className="flex flex-col gap-1.5">
                  {status?.videos.map((v) => (
                    <button
                      key={v.filename}
                      onClick={() => setSelected(v)}
                      className="flex items-center gap-2 rounded-[3px] border border-hud-accent-dim/30 bg-background/60 p-2 text-start text-xs hover:border-hud-accent/50"
                    >
                      <Play className="size-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">{v.filename}</span>
                      <span className="ml-auto shrink-0 text-muted-foreground">{v.size_mb}MB</span>
                    </button>
                  ))}
                  {!status?.videos.length && (
                    <p className="font-mono-hud text-xs text-muted-foreground">
                      No rendered videos yet — this directory is regenerable, not a permanent store.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {selected && (
        <Card className="rounded-[3px] hud-border-dim">
          <CardHeader>
            <CardTitle className="font-mono-hud text-xs uppercase tracking-[0.06em]">{selected.filename}</CardTitle>
          </CardHeader>
          <CardContent>
            <video src={selected.url} controls className="max-h-[60vh] w-full rounded-[3px]" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
