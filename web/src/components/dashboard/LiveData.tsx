import { useCallback, useEffect, useState } from "react"
import { Activity, AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getLiveData, type LiveDataSnapshot } from "@/lib/dashboard-api"

function fmt(value: number | null, unit: string | null): string {
  if (value === null) return "—"
  const n = value.toLocaleString("en-US", { maximumFractionDigits: 2 })
  if (unit === "percent") return `${n}%`
  if (unit === "USD") return `$${n}`
  return unit ? `${n} ${unit}` : n
}

export function LiveData() {
  const [snap, setSnap] = useState<LiveDataSnapshot | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    getLiveData()
      .then(setSnap)
      .catch((e) => setSnap({ items: [], error: String(e) }))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    const t = window.setInterval(refresh, 60000)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-mono-hud text-xs uppercase tracking-[0.06em]">
          {snap?.live_count ?? 0}/{snap?.total ?? 0} live
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {snap?.error && (
        <Card className="rounded-[3px] hud-border-dim">
          <CardContent className="pt-4 text-xs text-destructive">{snap.error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(snap?.items ?? []).map((item) => {
          const up = (item.changePercent24h ?? 0) > 0
          return (
            <Card key={item.id} className="rounded-[3px] hud-border-dim">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 font-mono-hud text-xs uppercase tracking-[0.06em]">
                  <Activity className="size-3.5" aria-hidden="true" />
                  {item.label}
                  <Badge
                    variant={item.live ? "outline" : "secondary"}
                    className="ml-auto"
                  >
                    {item.error ? "error" : item.live ? item.origin : "mock"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {item.error ? (
                  <div className="flex items-start gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>{item.error}</span>
                  </div>
                ) : (
                  <>
                    {item.headline ? (
                      <div className="text-sm leading-snug">{item.headline}</div>
                    ) : (
                      <div className="font-mono-hud text-2xl">{fmt(item.value, item.unit)}</div>
                    )}
                    {item.changePercent24h !== null && (
                      <div className={`text-xs ${up ? "text-emerald-500" : "text-destructive"}`}>
                        {up ? "▲" : "▼"} {Math.abs(item.changePercent24h).toFixed(2)}% 24h
                      </div>
                    )}
                  </>
                )}
                {item.note && <div className="text-xs opacity-60">{item.note}</div>}
                {item.asOf && (
                  <div className="text-xs opacity-50">as of {item.asOf.slice(0, 19).replace("T", " ")}</div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
