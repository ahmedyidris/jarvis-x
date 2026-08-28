import { useState } from "react"
import { MessageSquare, Settings as SettingsIcon, History as HistoryIcon } from "lucide-react"
import { ChatInterface } from "@/components/dashboard/ChatInterface"
import { Settings } from "@/components/dashboard/Settings"
import { History } from "@/components/dashboard/History"

type Tab = "chat" | "settings" | "history"

const TABS = [
  { id: "chat" as const, label: "Chat", icon: MessageSquare },
  { id: "settings" as const, label: "Settings", icon: SettingsIcon },
  { id: "history" as const, label: "History", icon: HistoryIcon },
]

export function Dashboard() {
  const [tab, setTab] = useState<Tab>("chat")

  return (
    <div className="flex h-full w-full flex-col bg-black text-zinc-100">
      <div className="border-b border-red-900/60 px-5 pb-2 pt-4">
        <div className="text-xl font-bold tracking-wide text-red-600">JARVIS X</div>
        <div className="text-xs text-zinc-500">Personal AI Assistant</div>
      </div>

      <div className="flex gap-1 border-b border-red-900/60 bg-zinc-950 px-3 py-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition ${
              tab === id
                ? "bg-red-700 text-white"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-red-400"
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "chat" && <ChatInterface />}
        {tab === "settings" && <Settings />}
        {tab === "history" && <History />}
      </div>
    </div>
  )
}
