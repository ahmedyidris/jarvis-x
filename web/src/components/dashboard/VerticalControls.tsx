import { useEffect, useState } from "react"
import { Play, Pause, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getVerticalStatus, pauseVertical, resumeVertical, type VerticalStatus } from "@/lib/api"

export function VerticalControls() {
  const [verticals, setVerticals] = useState<VerticalStatus[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const status = await getVerticalStatus()
      setVerticals(status)
    } catch (e) {
      console.error("Failed to fetch vertical status:", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30000) // Poll every 30s
    return () => clearInterval(interval)
  }, [])

  const toggle = async (name: string, enabled: boolean) => {
    try {
      const result = enabled ? await resumeVertical(name) : await pauseVertical(name)
      setVerticals(verticals.map(v => v.name === name ? result : v))
    } catch (e) {
      console.error(`Failed to toggle ${name}:`, e)
    }
  }

  return (
    <div className="space-y-3">
      <Button size="sm" onClick={refresh} disabled={loading}>
        Refresh
      </Button>

      <div className="space-y-2">
        {verticals.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No verticals configured</p>
        ) : (
          verticals.map((v) => (
            <Card key={v.name}>
              <CardContent className="pt-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{v.name}</p>
                    <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
                      {v.last_run && (
                        <div className="flex items-center gap-1">
                          <Clock className="size-3" />
                          Last: {new Date(v.last_run).toLocaleTimeString()}
                        </div>
                      )}
                      {v.next_run && (
                        <div className="flex items-center gap-1">
                          <Clock className="size-3" />
                          Next: {new Date(v.next_run).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={v.enabled ? "default" : "outline"}
                    onClick={() => toggle(v.name, !v.enabled)}
                  >
                    {v.enabled ? (
                      <>
                        <Pause className="size-3 mr-1" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="size-3 mr-1" />
                        Resume
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
