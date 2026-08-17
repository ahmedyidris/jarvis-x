import { useEffect, useState } from "react"
import { Loader2, Newspaper, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  getVerticals,
  triggerGenerate,
  VERTICALS,
  type Vertical,
  type VerticalStatus,
} from "@/lib/dashboard-api"

const LABELS: Record<Vertical, string> = {
  letters: "Letters",
  economic_facts: "Economic Facts",
  commodities_macro: "Commodities + Macro",
  geopolitical_risk: "Geopolitical Risk",
}

export function MarketData() {
  const [data, setData] = useState<Record<Vertical, VerticalStatus> | null>(null)
  const [generating, setGenerating] = useState<Vertical | null>(null)

  function refresh() {
    getVerticals().then(setData).catch(() => {})
  }

  useEffect(refresh, [])

  async function handleGenerate(vertical: Vertical) {
    setGenerating(vertical)
    try {
      await triggerGenerate(vertical)
      // Real generation runs for minutes (CPU-only Ollama) -- this just
      // confirms the job started; poll the Observatory tab's job list or
      // refresh here after enough time has passed for a real result.
    } finally {
      setGenerating(null)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {VERTICALS.map((vertical) => {
        const status = data?.[vertical]
        return (
          <Card key={vertical} className="rounded-[3px] hud-border-dim">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 font-mono-hud text-xs uppercase tracking-[0.06em]">
                <Newspaper className="size-3.5" aria-hidden="true" />
                {LABELS[vertical]}
                <Badge variant="outline" className="ml-auto">
                  {status?.fact_count ?? 0} facts
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-col gap-1.5">
                {status?.facts.slice(0, 3).map((f) => (
                  <div key={f.filename} className="rounded-[3px] border border-hud-accent-dim/30 bg-background/60 p-2 text-xs">
                    <p className="truncate font-medium text-foreground">{f.topic}</p>
                    {f.source_url && (
                      <a
                        href={f.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-muted-foreground underline decoration-dotted hover:text-hud-accent"
                      >
                        {f.source_name}
                      </a>
                    )}
                  </div>
                ))}
                {!status?.facts.length && (
                  <p className="font-mono-hud text-xs text-muted-foreground">No content generated yet.</p>
                )}
              </div>
              <p className="font-mono-hud text-[11px] text-muted-foreground/70">
                Next scheduled refresh: not configured (no live schedule wired for Phase B today)
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full rounded-[3px] font-mono-hud text-xs"
                disabled={generating === vertical}
                onClick={() => handleGenerate(vertical)}
              >
                {generating === vertical ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                )}
                Generate new batch
              </Button>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
