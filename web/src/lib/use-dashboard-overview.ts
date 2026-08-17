import { useEffect, useRef, useState } from "react"
import { dashboardWsUrl, getOverview, type DashboardOverview } from "@/lib/dashboard-api"

// Live overview via WebSocket (server pushes every 5s, see app.py's
// /ws/dashboard), falling back to one-shot polling if the socket can't
// connect at all (e.g. reverse proxy that doesn't support upgrade) --
// degrades gracefully rather than showing nothing.
export function useDashboardOverview() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [connected, setConnected] = useState(false)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    let ws: WebSocket | null = null
    let cancelled = false

    function startPolling() {
      if (pollRef.current) return
      const poll = () => getOverview().then((o) => !cancelled && setOverview(o)).catch(() => {})
      poll()
      pollRef.current = window.setInterval(poll, 5000)
    }

    try {
      ws = new WebSocket(dashboardWsUrl())
      ws.onopen = () => {
        setConnected(true)
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }
      ws.onmessage = (event) => {
        if (!cancelled) setOverview(JSON.parse(event.data))
      }
      ws.onerror = () => setConnected(false)
      ws.onclose = () => {
        setConnected(false)
        if (!cancelled) startPolling()
      }
    } catch {
      startPolling()
    }

    return () => {
      cancelled = true
      ws?.close()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  return { overview, connected }
}
