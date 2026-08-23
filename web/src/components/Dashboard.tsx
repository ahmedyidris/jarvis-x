import { useState } from "react"
import { Activity, Gauge, Newspaper, Clapperboard, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Observatory } from "@/components/dashboard/Observatory"
import { MarketData } from "@/components/dashboard/MarketData"
import { LiveData } from "@/components/dashboard/LiveData"
import { VideoPipeline } from "@/components/dashboard/VideoPipeline"
import { Configuration } from "@/components/dashboard/Configuration"

const TABS = [
  { id: "observatory", label: "Observatory", icon: Gauge, Component: Observatory },
  { id: "live", label: "Live Data", icon: Activity, Component: LiveData },
  { id: "market", label: "Market Data", icon: Newspaper, Component: MarketData },
  { id: "video", label: "Video Pipeline", icon: Clapperboard, Component: VideoPipeline },
  { id: "config", label: "Configuration", icon: Settings, Component: Configuration },
] as const

export type DashboardTab = (typeof TABS)[number]["id"]

interface DashboardProps {
  activeTab?: DashboardTab
  onTabChange?: (tab: DashboardTab) => void
}

export function Dashboard({ activeTab, onTabChange }: DashboardProps) {
  const [internalTab, setInternalTab] = useState<DashboardTab>("observatory")
  const tab = activeTab ?? internalTab
  const setTab = onTabChange ?? setInternalTab

  const Active = TABS.find((t) => t.id === tab)?.Component ?? Observatory

  return (
    <div className="flex h-full flex-1 flex-col gap-4 overflow-hidden p-4">
      <div role="tablist" className="flex shrink-0 gap-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            size="sm"
            variant={tab === id ? "default" : "outline"}
            className="rounded-[3px] font-mono-hud text-xs"
            onClick={() => setTab(id)}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Active />
      </div>
    </div>
  )
}
