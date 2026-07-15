import { cva } from "class-variance-authority"
import { motion } from "framer-motion"
import { Bot, Ellipsis, Menu } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
// Czech translations
import { cs } from "@/i18n/cs"
import { categoriesApi, setsApi, topicsApi } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * TopBar Component
 * Breadcrumbs and page title for BiochemCalc
 */

interface TopBarProps {
  onMenuClick?: () => void
  isMobile: boolean
}

// Breadcrumbs configuration based on route
interface BreadcrumbItem {
  path: string
  label: string
}

const topBarVariants = cva(
  "sticky top-0 z-30 flex items-center justify-between h-[var(--top-bar-height)] bg-card/80 backdrop-blur-lg border-b border-border",
  {
    variants: {
      isMobile: {
        true: "px-2",
        false: "px-4 lg:px-6",
      },
    },
    defaultVariants: {
      isMobile: false,
    },
  },
)

const breadcrumbVariants = cva(
  "flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground hover:underline underline-offset-4 transition-colors",
  {
    variants: {
      isFirst: {
        true: "text-foreground",
        false: "",
      },
    },
  },
)

const titleVariants = cva("text-lg font-semibold text-foreground truncate", {
  variants: {
    isMobile: {
      true: "text-base",
      false: "",
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

const staticRouteTitles: Record<string, string> = {
  "/": cs.home.title,
  "/topics": cs.topics.title,
  "/constants": cs.constants.title,
  "/history": cs.history.title,
  "/settings": cs.navigation.settings,
  "/help": cs.navigation.help,
  "/victor": cs.victor.title,
}

export function TopBar({ onMenuClick, isMobile }: TopBarProps) {
  const location = useLocation()
  const [currentTime, setCurrentTime] = useState<string>("")
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([])
  const [title, setTitle] = useState<string>(cs.home.title)

  // Get current time for display (optional)
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
      setTitle(staticRouteTitles[path] || cs.home.title)
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
        setTitle(cs.victor.title)
      } else if (topicMatch) {
        const topicId = topicMatch[1]
        const topic = await topicsApi.get(topicId)
        setBreadcrumbs([
          { path: "/", label: cs.navigation.home },
          { path: "/topics", label: cs.navigation.topics },
          { path: `/topics/${topicId}`, label: topic.name },
        ])
        setTitle(topic.name)
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
        setTitle(cs.topics.setIndex.replace("{index}", String(set.set.setIndex)))
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
        setTitle(cs.topics.setIndex.replace("{index}", String(set.set.setIndex)))
      } else {
        setBreadcrumbs([{ path: "/", label: cs.navigation.home }])
        setTitle(cs.home.title)
      }
    } catch (err) {
      console.error("Failed to load breadcrumb data:", err)
      setBreadcrumbs(
        staticRouteBreadcrumbs[location.pathname] || [{ path: "/", label: cs.navigation.home }],
      )
      setTitle(staticRouteTitles[location.pathname] || cs.home.title)
    }
  }, [location.pathname])

  useEffect(() => {
    loadDynamicBreadcrumbs()
  }, [loadDynamicBreadcrumbs])

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(topBarVariants({ isMobile }), "gap-4")}
    >
      <div className="flex items-center gap-4 overflow-hidden">
        {/* Mobile menu button */}
        {isMobile && onMenuClick && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onMenuClick}
            className="p-2 rounded-lg hover:bg-muted flex-shrink-0"
            aria-label={cs.sidebar.expand}
          >
            <Menu className="size-5" />
          </motion.button>
        )}

        {/* Breadcrumbs */}
        <div className="hidden md:flex items-center gap-2 overflow-hidden">
          {breadcrumbs.length > 4 ? (
            <>
              <div key={breadcrumbs[0].path} className="flex items-center gap-2">
                <Link
                  to={breadcrumbs[0].path}
                  className={cn(breadcrumbVariants({ isFirst: true }), "max-w-[240px] truncate")}
                >
                  {breadcrumbs[0].label}
                </Link>
                <span className="text-foreground-muted">/</span>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="p-2 rounded-lg hover:bg-muted flex-shrink-0"
                    aria-label={cs.common.showMore}
                  >
                    <Ellipsis className="size-4" />
                  </motion.button>
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

              <span className="text-foreground-muted">/</span>

              {breadcrumbs.slice(breadcrumbs.length - 2).map((item, index) => (
                <div key={`${item.path}-${item.label}`} className="flex items-center gap-2">
                  <Link
                    to={item.path}
                    className={cn(breadcrumbVariants({ isFirst: false }), "max-w-[240px] truncate")}
                  >
                    {item.label}
                  </Link>
                  {index < breadcrumbs.slice(breadcrumbs.length - 2).length - 1 && (
                    <span className="text-foreground-muted">/</span>
                  )}
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
                      isFirst: index === 0,
                    }),
                    "max-w-[240px] truncate",
                  )}
                >
                  {item.label}
                </Link>
                {index < breadcrumbs.length - 1 && <span className="text-foreground-muted">/</span>}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Title */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="flex-1 px-4 text-center"
      >
        <h1 className={cn(titleVariants({ isMobile }))}>{title}</h1>
      </motion.div>

      {/* Right side - Victor button and timezone */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="hidden sm:flex items-center gap-4"
      >
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="p-2 rounded-lg hover:bg-muted"
          aria-label={cs.navigation.victor}
          title={cs.navigation.victor}
        >
          <Link to="/victor">
            <Bot className="size-5" />
          </Link>
        </motion.button>
        <span className="text-sm text-foreground-muted">{currentTime}</span>
      </motion.div>
    </motion.header>
  )
}
