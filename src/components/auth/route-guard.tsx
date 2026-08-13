import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"
import type { Role } from "@/lib/types"
import { useAuthStore } from "@/stores/auth-store"

/**
 * Gate on "is anyone logged in". `useAuthStore`'s `status` starts as
 * "unknown" until the app-mount `fetchMe()` call (see `App.tsx`) resolves,
 * so this renders nothing rather than bouncing to /login prematurely.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status)
  const location = useLocation()

  if (status === "unknown") {
    return null
  }
  if (status === "anonymous") {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return <>{children}</>
}

/**
 * Gate on role, assuming a `RequireAuth` ancestor already guarantees a
 * logged-in user. Redirects to `/` rather than `/login` since the visitor
 * IS authenticated — they just don't have the right role for this page.
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const user = useAuthStore((s) => s.user)

  if (!user) {
    return null
  }
  if (user.role !== role) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
