import { cva } from "class-variance-authority"
import { Bot, Ellipsis } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cs } from "@/i18n/cs"
import { categoriesApi, setsApi, topicsApi } from "@/lib/api"
import { cn } from "@/lib/utils"

interface BreadcrumbItem {
  path: string
  label: string
}

const topBarVariants = cva(
  "sticky top-0 z-30 flex items-center justify-between h-[var(--top-bar-height)] bg-background border-b border-border px-4 lg:px-6",
)

const breadcrumbVariants = cva(
  "text-sm hover:text-foreground transition-colors cursor-pointer",
  {
    variants: {
      variant: {
        first: "font-medium text-foreground",
        normal: "font-mono text-[11px] uppercase tracking-wider text-muted-foreground",
        current: "font-medium text-foreground cursor-default",
      },
    },
  },
)

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
  const [currentTime, setCurrentTime] = useState<string>("")
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([])

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

  return (
    <header className={cn(topBarVariants(), "gap-4")}>
      <div className="flex items-center gap-4 overflow-hidden">
        {/* Breadcrumbs */}
        <div className="hidden md:flex items-center gap-2 overflow-hidden">
          {breadcrumbs.length > 4 ? (
            <>
              <div key={breadcrumbs[0].path} className="flex items-center gap-2">
                <Link
                  to={breadcrumbs[0].path}
                  className={cn(breadcrumbVariants({ variant: "first" }), "max-w-[240px] truncate")}
                >
                  {breadcrumbs[0].label}
                </Link>
                <span className="text-muted-foreground font-mono">/</span>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <button
                     type="button"
                     className="p-2 rounded-[4px] hover:bg-muted flex-shrink-0 border border-transparent"
                     aria-label={cs.common.showMore}
                   >
                    <Ellipsis className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" sideOffset={4}>
                  {breadcrumbs.slice(1, breadcrumbs.length - 2).map((item) => (
                    <DropdownMenuItem key={`${item.path}-${item.label}`} asChild>
                      <Link to={item.path} className="w-full max-w-[320px] truncate">
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <span className="text-muted-foreground font-mono">/</span>

              {breadcrumbs.slice(breadcrumbs.length - 2).map((item, index) => (
                <div key={`${item.path}-${item.label}`} className="flex items-center gap-2">
                  <Link
                    to={item.path}
                    className={cn(
                      breadcrumbVariants({ variant: index === breadcrumbs.slice(breadcrumbs.length - 2).length - 1 ? "current" : "normal" }),
                      "max-w-[240px] truncate"
                    )}
                  >
                    {item.label}
                  </Link>
                </div>
              ))}
            </>
          ) : (
            breadcrumbs.map((item, index) => (
              <div key={`${item.path}-${item.label}`} className="flex items-center gap-2">
                <Link
                  to={item.path}
                  className={cn(
                    breadcrumbVariants({
                      variant: index === breadcrumbs.length - 1 ? "current" : index === 0 ? "first" : "normal",
                    }),
                    "max-w-[240px] truncate"
                  )}
                >
                  {item.label}
                </Link>
                {index < breadcrumbs.length - 1 && <span className="text-muted-foreground font-mono">/</span>}
              </div>
            ))
          )}
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
        <span className="font-mono text-[12px] tabular text-muted-foreground">{currentTime}</span>
      </div>
    </header>
  )
}
