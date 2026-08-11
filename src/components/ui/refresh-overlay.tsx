import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface RefreshOverlayProps {
  /** When true, dims content and blocks interaction. */
  isRefreshing: boolean
  children: ReactNode
  className?: string
}

/**
 * Wraps content that is being refreshed in-place (not initial load).
 * Dims opacity slightly and blocks pointer events so the user sees the
 * existing content is updating, rather than blanking to a loading state.
 *
 * Use this around the main content area of a page during refetch —
 * after save, after delete, after move, etc. The page stays visible
 * and stable; only a subtle dim signals "refreshing".
 */
export function RefreshOverlay({ isRefreshing, children, className }: RefreshOverlayProps) {
  return (
    <div
      className={cn(
        "transition-opacity duration-150",
        isRefreshing && "opacity-60 pointer-events-none",
        className,
      )}
    >
      {children}
    </div>
  )
}
