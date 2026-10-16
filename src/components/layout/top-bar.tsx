import { cva } from "class-variance-authority"
import { LogOut } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { SectionSwitcher } from "@/components/layout/section-switcher"
import { useSection } from "@/hooks/use-section"
import { cs } from "@/i18n/cs"
import { categoriesApi, setsApi, topicsApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import {
  useBiomoleculeDataLoaded,
  useCategoryNames,
  useMoleculeCategories,
} from "@/stores/biomolecule-data-store"
import { useCarryStore } from "@/stores/drag-store"

interface BreadcrumbItem {
  path: string
  label: string
}

const biomoleculesRoot: BreadcrumbItem = { path: "/biomolekuly", label: cs.navigation.biomolekuly }

/** Biomolekuly hub, category, and quiz pages — names come from `nameOf`. */
function biomoleculesBreadcrumbs(
  path: string,
  nameOf: (categoryId: string) => string,
  categoryExists: (categoryId: string) => boolean,
): BreadcrumbItem[] | null {
  const match = path.match(/^\/biomolekuly(?:\/([^/]+))?(\/procvicovani)?\/?$/)
  if (!match) return null
  const [, categoryId, quiz] = match
  const crumbs = [biomoleculesRoot]
  if (categoryId && categoryExists(categoryId)) {
    crumbs.push({ path: `/biomolekuly/${categoryId}`, label: nameOf(categoryId) })
    if (quiz) {
      crumbs.push({
        path: `/biomolekuly/${categoryId}/procvicovani`,
        label: cs.biomolekuly.quiz.title,
      })
    }
  }
  return crumbs
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
  "/topics": [{ path: "/topics", label: cs.navigation.topics }],
  "/constants": [
    { path: "/topics", label: cs.navigation.topics },
    { path: "/constants", label: cs.navigation.constants },
  ],
  "/history": [
    { path: "/topics", label: cs.navigation.topics },
    { path: "/history", label: cs.navigation.history },
  ],
  "/settings": [
    { path: "/topics", label: cs.navigation.topics },
    { path: "/settings", label: cs.navigation.settings },
  ],
  "/help": [
    { path: "/topics", label: cs.navigation.topics },
    { path: "/help", label: cs.navigation.help },
  ],
  "/leaderboard": [
    { path: "/topics", label: cs.navigation.topics },
    { path: "/leaderboard", label: cs.navigation.leaderboard },
  ],
}

export function TopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { section } = useSection()
  const categoryNameOf = useCategoryNames()
  const moleculeCategories = useMoleculeCategories()
  const biomoleculeDataLoaded = useBiomoleculeDataLoaded()
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

    // Pre-load the category list is still empty — report every slug as
    // existing so direct links don't lose their category crumb and pop
    // back in once the dataset arrives.
    const categoryExists = (categoryId: string) =>
      !biomoleculeDataLoaded || moleculeCategories.some((c) => c.slug === categoryId)

    const bioCrumbs = biomoleculesBreadcrumbs(path, categoryNameOf, categoryExists)
    if (bioCrumbs) {
      setBreadcrumbs(bioCrumbs)
      return
    }

    if (staticRouteBreadcrumbs[path]) {
      // Shared pages (settings, leaderboard) root at whichever section the
      // user is in, rather than always at Témata.
      const [root, ...rest] = staticRouteBreadcrumbs[path]
      setBreadcrumbs(
        section === "biomolecules" && rest.length > 0
          ? [biomoleculesRoot, ...rest]
          : [root, ...rest],
      )
      return
    }

    try {
      const topicMatch = path.match(/^\/topics\/([^/]+)$/)
      const topicSetMatch = path.match(/^\/topics\/([^/]+)\/sets\/([^/]+)$/)
      const setMatch = path.match(/^\/sets\/([^/]+)$/)
      if (topicMatch) {
        const topicId = topicMatch[1]
        const topic = await topicsApi.get(topicId)
        setBreadcrumbs([
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
        setBreadcrumbs([{ path: "/topics", label: cs.navigation.topics }])
      }
    } catch (err) {
      console.error("Failed to load breadcrumb data:", err)
      setBreadcrumbs(
        staticRouteBreadcrumbs[location.pathname] || [
          { path: "/topics", label: cs.navigation.topics },
        ],
      )
    }
  }, [location.pathname, section, categoryNameOf, moleculeCategories, biomoleculeDataLoaded])

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

      {/* Right side - section switcher, logout and clock */}
      <SectionSwitcher tone="light" />
      <div className="hidden sm:flex items-center gap-4">
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
