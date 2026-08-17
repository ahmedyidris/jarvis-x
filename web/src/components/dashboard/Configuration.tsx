import { useEffect, useState } from "react"
import { Settings, ShieldAlert } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getConfig, type DashboardConfig } from "@/lib/dashboard-api"

export function Configuration() {
  const [config, setConfig] = useState<DashboardConfig | null>(null)

  useEffect(() => {
    getConfig().then(setConfig).catch(() => {})
  }, [])

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card className="rounded-[3px] hud-border-dim md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 font-mono-hud text-xs uppercase tracking-[0.06em]">
            <ShieldAlert className="size-3.5" aria-hidden="true" />
            Honesty note
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono-hud text-xs text-muted-foreground">
            This tab is read-only by design. A model selector, cost-ceiling slider, or rate-limit
            control that doesn't actually change any live behavior would be worse than not having
            one — none of those map to a real enforced setting in the running system today (see{" "}
            <code className="text-foreground">docs/obsidian-vault/decisions/model-gateway-not-wired.md</code>).
            What's below is either a genuine informational value or a read-only preview of the
            files that actually govern behavior.
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-[3px] hud-border-dim">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 font-mono-hud text-xs uppercase tracking-[0.06em]">
            <Settings className="size-3.5" aria-hidden="true" />
            Live settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 font-mono-hud text-xs">
          <p>
            API auth: <Badge variant={config?.api_token_configured ? "default" : "outline"}>{config?.api_token_configured ? "enabled" : "disabled (default)"}</Badge>
          </p>
          <div>
            <p className="mb-1 text-muted-foreground">Voice per vertical (real, from tts_engine.py):</p>
            {config && Object.entries(config.voice_per_vertical).map(([v, voice]) => (
              <p key={v} className="ps-2">
                {v}: {voice}
              </p>
            ))}
          </div>
          <p className="text-muted-foreground">Self-debug loop: {config?.self_debug_loop_status}</p>
        </CardContent>
      </Card>

      <Card className="rounded-[3px] hud-border-dim">
        <CardHeader>
          <CardTitle className="font-mono-hud text-xs uppercase tracking-[0.06em]">CONSTITUTION.md (read-only)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono-hud text-[11px] text-muted-foreground">
            {config?.constitution_preview ?? "Loading…"}
          </pre>
        </CardContent>
      </Card>

      <Card className="rounded-[3px] hud-border-dim md:col-span-2">
        <CardHeader>
          <CardTitle className="font-mono-hud text-xs uppercase tracking-[0.06em]">knowledge/Guidelines.md (read-only)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono-hud text-[11px] text-muted-foreground">
            {config?.guidelines_preview ?? "Loading…"}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
