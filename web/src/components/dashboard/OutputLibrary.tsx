import { useState, useCallback } from "react"
import { Download, RotateCcw, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { queryOutputs, askJarvis, type OutputEntry } from "@/lib/api"

export function OutputLibrary() {
  const [outputs, setOutputs] = useState<OutputEntry[]>([])
  const [search, setSearch] = useState("")
  const [modelFilter, setModelFilter] = useState("")
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const results = await queryOutputs({
        search: search || undefined,
        model: modelFilter || undefined,
        limit: 50,
      })
      setOutputs(results)
    } catch (e) {
      console.error("Failed to query outputs:", e)
    } finally {
      setLoading(false)
    }
  }, [search, modelFilter])

  const rerun = async (entry: OutputEntry) => {
    try {
      await askJarvis(entry.question, entry.tier, false)
      refresh()
    } catch (e) {
      console.error("Rerun failed:", e)
    }
  }

  const exportCsv = () => {
    const csv = [
      "timestamp,question,response,model,tier",
      ...outputs.map(o =>
        `"${o.timestamp}","${o.question.replace(/"/g, '""')}","${o.response.replace(/"/g, '""')}","${o.model}","${o.tier}"`
      ),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `jarvis-outputs-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search outputs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Input
          placeholder="Filter by model"
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          className="w-32"
        />
        <Button size="sm" onClick={refresh} disabled={loading}>
          Search
        </Button>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={outputs.length === 0}>
          <Download className="size-3 mr-1" />
          Export CSV
        </Button>
      </div>

      <div className="space-y-2">
        {outputs.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No outputs yet</p>
        ) : (
          outputs.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="pt-4">
                <p className="text-sm font-medium mb-2">{entry.question}</p>
                <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{entry.response}</p>
                <div className="flex justify-between items-center">
                  <div className="flex gap-1">
                    <Badge variant="secondary" className="text-xs">{entry.model}</Badge>
                    <Badge variant="secondary" className="text-xs">{entry.tier}</Badge>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => rerun(entry)}>
                    <RotateCcw className="size-3" />
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
