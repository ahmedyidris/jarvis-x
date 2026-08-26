import { useEffect, useState } from "react"
import { Search, ChevronRight, Clock, Zap } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { getHistory } from "@/lib/api"
import { getDecision, type DecisionDetail, type HistoryEntry } from "@/lib/api"

export function DecisionInspector() {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selected, setSelected] = useState<DecisionDetail | null>(null)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getHistory(50).then(setHistory).catch(console.error)
  }, [])

  const filtered = history.filter(h =>
    h.user_input.toLowerCase().includes(search.toLowerCase())
  )

  async function inspect(entry: HistoryEntry) {
    setLoading(true)
    try {
      const id = entry.timestamp
      const detail = await getDecision(id)
      setSelected(detail)
    } catch (e) {
      console.error("Failed to fetch decision:", e)
    } finally {
      setLoading(false)
    }
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
          ← Back to history
        </Button>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Decision: {selected.question}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="font-mono-hud text-xs text-muted-foreground mb-1">Tier / Model</p>
              <div className="flex gap-2">
                <Badge variant="secondary">{selected.tier}</Badge>
                <Badge variant="secondary">{selected.model}</Badge>
              </div>
            </div>
            <div>
              <p className="font-mono-hud text-xs text-muted-foreground mb-1">Reasoning</p>
              <p className="text-sm">{selected.reasoning}</p>
            </div>
            <div>
              <p className="font-mono-hud text-xs text-muted-foreground mb-1">Sources</p>
              <div className="space-y-1">
                {selected.sources.map((s, i) => (
                  <div key={i} className="text-xs flex justify-between">
                    <span>{s.name}: {s.value}</span>
                    <span className="text-muted-foreground">{(s.age_ms / 1000).toFixed(1)}s old</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="font-mono-hud text-xs text-muted-foreground mb-1">Output</p>
              <p className="text-sm">{selected.output}</p>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="size-3" />
                {selected.latency_ms}ms
              </div>
              <div className="flex items-center gap-1">
                <Zap className="size-3" />
                {new Date(selected.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
        <Input
          placeholder="Search decisions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No decisions yet</p>
        ) : (
          filtered.map((entry) => (
            <Card key={entry.timestamp} className="cursor-pointer hover:bg-accent" onClick={() => inspect(entry)}>
              <CardContent className="pt-4 flex justify-between items-start">
                <div className="flex-1">
                  <p className="text-sm font-medium truncate">{entry.user_input}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {entry.model} • {entry.latency_ms}ms
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" />
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
