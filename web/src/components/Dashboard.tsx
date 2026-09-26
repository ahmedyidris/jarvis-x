import { useState } from "react"
import { MessageSquare, Terminal, Settings as SettingsIcon, History as HistoryIcon, User, Users } from "lucide-react"
import { ChatInterface } from "@/components/dashboard/ChatInterface"
import { Settings } from "@/components/dashboard/Settings"
import { History } from "@/components/dashboard/History"
import { TerminalInterface } from "@/components/dashboard/TerminalInterface"
import { Station } from "@/components/dashboard/Station"

type Tab = "chat" | "station" | "terminal" | "history" | "settings"

const TABS = [
  { id: "chat" as const, label: "Chat", icon: MessageSquare },
  { id: "station" as const, label: "Station", icon: Users },
  { id: "terminal" as const, label: "PC Access", icon: Terminal },
  { id: "history" as const, label: "History", icon: HistoryIcon },
  { id: "settings" as const, label: "Settings", icon: SettingsIcon },
]

export function Dashboard() {
  const [tab, setTab] = useState<Tab>("chat")

  return (
    <div className="flex h-full w-full bg-[#fdfcfb] text-[#1a1a1a] dark:bg-[#1a1a1a] dark:text-[#ececec]">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-[#e5e5e5] bg-[#f9f9f8] dark:border-[#2e2e2e] dark:bg-[#1f1f1f]">
        <div className="flex items-center gap-2 p-4 pt-6">
          <div className="flex size-8 items-center justify-center rounded-lg bg-orange-700 text-white shadow-sm">
            <User className="size-5" />
          </div>
          <div>
            <div className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Jarvis X</div>
            <div className="text-xs font-medium text-zinc-500">v2.0 Claude-style</div>
          </div>
        </div>

        <div className="flex-1 space-y-1 p-3">
          <div className="mb-2 px-2 text-xs font-semibold text-zinc-400">WORKSPACE</div>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                tab === id
                  ? "bg-[#efefed] text-zinc-900 shadow-sm dark:bg-[#2d2d2d] dark:text-zinc-100"
                  : "text-zinc-600 hover:bg-[#efefed]/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-[#2d2d2d]/50 dark:hover:text-zinc-100"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="min-w-0 flex-1 bg-white dark:bg-[#1e1e1e]">
        {tab === "chat" && <ChatInterface />}
        {tab === "station" && <Station />}
        {tab === "terminal" && <TerminalInterface />}
        {tab === "history" && <History />}
        {tab === "settings" && <Settings />}
      </div>
    </div>
  )
}
