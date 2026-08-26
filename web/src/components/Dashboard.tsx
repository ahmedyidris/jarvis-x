import { useState } from "react"
import { MessageSquare, Settings, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatInterface } from "@/components/dashboard/ChatInterface"
import { Settings as SettingsComponent } from "@/components/dashboard/Settings"
import { History as HistoryComponent } from "@/components/dashboard/History"

type DashboardTab = "chat" | "settings" | "history"

const TABS = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "history", label: "History", icon: History },
] as const

interface DashboardProps {
  activeTab?: DashboardTab
  onTabChange?: (tab: DashboardTab) => void
}

export function Dashboard({ activeTab, onTabChange }: DashboardProps) {
  const [internalTab, setInternalTab] = useState<DashboardTab>("chat")
  const [tier, setTier] = useState("local")
  const [voice, setVoice] = useState("en_us_piper")
  const [language, setLanguage] = useState("en")
  const [autoPlay, setAutoPlay] = useState(true)
  const [showCaptions, setShowCaptions] = useState(true)
  const [textSize, setTextSize] = useState<"sm" | "base" | "lg">("base")
  const [arabicDialect, setArabicDialect] = useState<"msa" | "egyptian">("msa")

  const tab = activeTab ?? internalTab
  const setTab = onTabChange ?? setInternalTab

  const renderContent = () => {
    switch (tab) {
      case "chat":
        return (
          <ChatInterface
            tier={tier}
            voice={voice}
            language={language}
            autoPlay={autoPlay}
            showCaptions={showCaptions}
          />
        )
      case "settings":
        return (
          <SettingsComponent
            tier={tier}
            voice={voice}
            language={language}
            autoPlay={autoPlay}
            showCaptions={showCaptions}
            textSize={textSize}
            arabicDialect={arabicDialect}
            onTierChange={setTier}
            onVoiceChange={setVoice}
            onLanguageChange={setLanguage}
            onAutoPlayChange={setAutoPlay}
            onCaptionsChange={setShowCaptions}
            onTextSizeChange={setTextSize}
            onDialectChange={setArabicDialect}
          />
        )
      case "history":
        return <HistoryComponent />
      default:
        return null
    }
  }

  return (
    <div className="flex h-full flex-col bg-black text-white">
      {/* Header */}
      <div className="border-b border-red-500 bg-black px-4 py-3">
        <h1 className="text-2xl font-bold text-red-500">JARVIS X</h1>
        <p className="text-xs text-gray-400">Personal AI Assistant</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-red-500 px-4 py-2 bg-gray-950">
        {TABS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={tab === id ? "default" : "ghost"}
            size="sm"
            onClick={() => setTab(id as DashboardTab)}
            className={`gap-2 ${
              tab === id
                ? "bg-red-600 text-white hover:bg-red-700"
                : "text-gray-400 hover:text-red-500 hover:bg-gray-900"
            }`}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-black">
        {renderContent()}
      </div>
    </div>
  )
}
