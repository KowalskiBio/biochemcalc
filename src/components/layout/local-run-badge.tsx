import { Construction } from "lucide-react"
import { cs } from "@/i18n/cs"

/**
 * A traffic-cone marker for local runs (issue #10), so a dev build can't be
 * mistaken for the live site at a glance. Shown for the Vite dev server and
 * for any build opened on a loopback host; the live site and the desktop
 * app (`tauri.localhost`) never match, so they render nothing.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export const isLocalRun = import.meta.env.DEV || LOOPBACK_HOSTS.has(window.location.hostname)

export function LocalRunBadge() {
  if (!isLocalRun) return null

  return (
    <div
      className="pointer-events-none fixed bottom-3 right-3 z-[100] flex items-center gap-1.5 rounded-[4px] border-2 border-black/80 bg-[repeating-linear-gradient(-45deg,#facc15_0_10px,#171717_10px_20px)] p-1 shadow-lg"
      aria-hidden="true"
    >
      <span className="flex items-center gap-1.5 rounded-[2px] bg-[#facc15] px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-black">
        <Construction className="size-4" strokeWidth={2} />
        {cs.localRun.label}
      </span>
    </div>
  )
}
