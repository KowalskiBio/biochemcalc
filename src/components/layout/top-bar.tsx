import { cva } from "class-variance-authority"
import { Bot, LogOut } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { cs } from "@/i18n/cs"
import { categoriesApi, setsApi, topicsApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import { useCarryStore } from "@/stores/drag-store"

interface BreadcrumbItem {
  path: string
  label: string
}

const topBarVariants = cva(
  "sticky top-0 z-30 flex items-center justify-between h-[var(--top-bar-height)] bg-background border-b border-border px-4 lg:px-6",
)

const breadcrumbVariants = cva("text-sm hover:text-foreground transition-colors cursor-pointer", {
  variants: {
    variant: {
      first: "font-medium text-foreground",
      normal: "font-mono text-[11px] uppercase tracking-wider text-muted-foreground",
      current: "font-medium text-foreground cursor-default",
    },
  },
})

const staticRouteBreadcrumbs: Record<string, BreadcrumbItem[]> = {
  "/": [{ path: "/", label: cs.navigation.home }],
  "/topics": [
    { path: "/", label: cs.navigation.home },
    { path: "/topics", label: cs.navigation.topics },
  ],
  "/constants": [
    { path: "/", label: cs.navigation.home },
    { path: "/constants", label: cs.navigation.constants },
  ],
  "/history": [
    { path: "/", label: cs.navigation.home },
    { path: "/history", label: cs.navigation.history },
  ],
  "/settings": [
    { path: "/", label: cs.navigation.home },
    { path: "/settings", label: cs.navigation.settings },
  ],
  "/help": [
    { path: "/", label: cs.navigation.home },
    { path: "/help", label: cs.navigation.help },
  ],
  "/victor": [
    { path: "/", label: cs.navigation.home },
    { path: "/victor", label: cs.navigation.victor },
  ],
}

export function TopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const isCarrying = useCarryStore((s) => s.isCarrying)
  const [currentTime, setCurrentTime] = useState<string>("")
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([])
  const [hoveredCrumb, setHoveredCrumb] = useState<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCrumbMouseEnter = useCallback(
    (path: string) => {
      if (!isCarrying) return
      setHoveredCrumb(path)
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = setTimeout(() => {
        navigate(path)
      }, 1500)
    },
    [isCarrying, navigate],
  )

  const handleCrumbMouseLeave = useCallback(() => {
    setHoveredCrumb(null)
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await logout()
    navigate("/login", { replace: true })
  }, [logout, navigate])

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      const hours = now.getHours().toString().padStart(2, "0")
      const minutes = now.getMinutes().toString().padStart(2, "0")
      setCurrentTime(`${hours}:${minutes}`)
    }

    updateTime()
    const interval = setInterval(updateTime, 60000)

    return () => clearInterval(interval)
  }, [])

  const loadDynamicBreadcrumbs = useCallback(async () => {
    const path = location.pathname

    if (staticRouteBreadcrumbs[path]) {
      setBreadcrumbs(staticRouteBreadcrumbs[path])
      return
    }

    try {
      const topicMatch = path.match(/^\/topics\/([^/]+)$/)
      const topicSetMatch = path.match(/^\/topics\/([^/]+)\/sets\/([^/]+)$/)
      const setMatch = path.match(/^\/sets\/([^/]+)$/)
      const victorMatch = path.match(/^\/victor($|\/)/)

      if (victorMatch) {
        setBreadcrumbs([
          { path: "/", label: cs.navigation.home },
          { path: "/victor", label: cs.navigation.victor },
        ])
      } else if (topicMatch) {
        const topicId = topicMatch[1]
        const topic = await topicsApi.get(topicId)
        setBreadcrumbs([
          { path: "/", label: cs.navigation.home },
          { path: "/topics", label: cs.navigation.topics },
          { path: `/topics/${topicId}`, label: topic.name },
        ])
      } else if (topicSetMatch) {
        const topicId = topicSetMatch[1]
        const setId = topicSetMatch[2]

        const [topic, set] = await Promise.all([
          topicsApi.get(topicId),
          setsApi.getWithTemplates(setId),
        ])

        const category = await categoriesApi.get(set.set.categoryId)

        setBreadcrumbs([
          { path: "/", label: cs.navigation.home },
          { path: "/topics", label: cs.navigation.topics },
          { path: `/topics/${topicId}`, label: topic.name },
          {
            path: `/topics/${topicId}`,
            label: cs.topics.pointValue.replace("{value}", String(category.pointValue)),
          },
          {
            path: `/topics/${topicId}/sets/${setId}`,
            label: cs.topics.setIndex.replace("{index}", String(set.set.setIndex)),
          },
        ])
      } else if (setMatch) {
        const setId = setMatch[1]

        const set = await setsApi.getWithTemplates(setId)
        const category = await categoriesApi.get(set.set.categoryId)
        const topic = await topicsApi.get(category.topicId)

        setBreadcrumbs([
          { path: "/", label: cs.navigation.home },
          { path: "/topics", label: cs.navigation.topics },
          { path: `/topics/${topic.id}`, label: topic.name },
          {
            path: `/topics/${topic.id}`,
            label: cs.topics.pointValue.replace("{value}", String(category.pointValue)),
          },
          {
            path: `/sets/${setId}`,
            label: cs.topics.setIndex.replace("{index}", String(set.set.setIndex)),
          },
        ])
      } else {
        setBreadcrumbs([{ path: "/", label: cs.navigation.home }])
      }
    } catch (err) {
      console.error("Failed to load breadcrumb data:", err)
      setBreadcrumbs(
        staticRouteBreadcrumbs[location.pathname] || [{ path: "/", label: cs.navigation.home }],
      )
    }
  }, [location.pathname])

  useEffect(() => {
    loadDynamicBreadcrumbs()
  }, [loadDynamicBreadcrumbs])

  const crumbHoverProps = (path: string) =>
    isCarrying
      ? {
          onMouseEnter: () => handleCrumbMouseEnter(path),
          onMouseLeave: handleCrumbMouseLeave,
        }
      : {}

  const crumbHighlight = (path: string) =>
    isCarrying && hoveredCrumb === path
      ? "bg-primary/15 rounded px-2 py-1 ring-2 ring-primary/40"
      : ""

  return (
    <header className={cn(topBarVariants(), "gap-4")}>
      <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
        <div className="flex items-center gap-2 overflow-hidden min-w-0">
          {breadcrumbs.map((item, index) => {
            const isLast = index === breadcrumbs.length - 1
            return (
              <div
                key={`${item.path}-${item.label}`}
                className="flex items-center gap-2 min-w-0 flex-shrink-0"
              >
                <Link
                  to={item.path}
                  className={cn(
                    breadcrumbVariants({
                      variant: isLast ? "current" : index === 0 ? "first" : "normal",
                    }),
                    "truncate max-w-[140px]",
                    crumbHighlight(item.path),
                  )}
                  {...crumbHoverProps(item.path)}
                >
                  {item.label}
                </Link>
                {!isLast && (
                  <span className="text-muted-foreground font-mono flex-shrink-0">/</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Right side - Victor button and clock */}
      <div className="hidden sm:flex items-center gap-4">
        <Link
          to="/victor"
          className="p-2 rounded-[4px] border border-border hover:bg-muted"
          aria-label={cs.navigation.victor}
          title={cs.navigation.victor}
        >
          <Bot className="size-5" />
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="p-2 rounded-[4px] border border-border hover:bg-muted"
          aria-label={cs.auth.logout}
          title={cs.auth.logout}
        >
          <LogOut className="size-5" />
        </button>
        <span className="font-mono text-[12px] tabular text-muted-foreground">{currentTime}</span>
      </div>
    </header>
  )
}
