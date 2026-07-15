import { cva } from "class-variance-authority"
import { AnimatePresence, motion } from "framer-motion"
import {
  BookOpen,
  Database,
  FileText,
  FlaskConical,
  FolderOpen,
  HelpCircle,
  History,
  Home,
  Menu,
  Moon,
  Settings,
  Sigma,
  Sun,
  Upload,
  X,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { cs } from "@/i18n/cs"
import { cn } from "@/lib/utils"

/**
 * Sidebar Component
 * Vertical navigation with icons and Czech labels
 */

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  isMobile: boolean
}

interface NavItem {
  path: string
  icon: React.ReactNode
  label: string
}

// Navigation items configuration
const navItems: NavItem[] = [
  {
    path: "/",
    icon: <Home className="size-5" />,
    label: cs.navigation.home,
  },
  {
    path: "/topics",
    icon: <BookOpen className="size-5" />,
    label: cs.navigation.topics,
  },
  {
    path: "/projekty",
    icon: <FolderOpen className="size-5" />,
    label: cs.navigation.projekty,
  },
  {
    path: "/testy",
    icon: <FileText className="size-5" />,
    label: cs.navigation.testy,
  },
  {
    path: "/databaze",
    icon: <Database className="size-5" />,
    label: cs.navigation.databaze,
  },
  {
    path: "/vzorce",
    icon: <Sigma className="size-5" />,
    label: cs.navigation.formulas,
  },
  {
    path: "/bulk-import",
    icon: <Upload className="size-5" />,
    label: cs.navigation.bulkImport,
  },
  {
    path: "/constants",
    icon: <FlaskConical className="size-5" />,
    label: cs.navigation.constants,
  },
  {
    path: "/history",
    icon: <History className="size-5" />,
    label: cs.navigation.history,
  },
]

// Bottom navigation items
const bottomNavItems: NavItem[] = [
  {
    path: "/settings",
    icon: <Settings className="size-5" />,
    label: cs.navigation.settings,
  },
  {
    path: "/help",
    icon: <HelpCircle className="size-5" />,
    label: cs.navigation.help,
  },
]

const sidebarVariants = cva(
  "flex flex-col h-full bg-card border-r border-border transition-all duration-300 ease-in-out",
  {
    variants: {
      collapsed: {
        true: "w-[var(--sidebar-collapsed-width)]",
        false: "w-[var(--sidebar-width)]",
      },
    },
    defaultVariants: {
      collapsed: false,
    },
  },
)

const sidebarHeaderVariants = cva("flex items-center justify-between p-4 border-b border-border", {
  variants: {
    collapsed: {
      true: "justify-center px-2",
      false: "",
    },
  },
})

const navItemVariants = cva(
  "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer",
  {
    variants: {
      variant: {
        default: "text-foreground-secondary hover:bg-muted hover:text-foreground",
        active: "bg-primary text-primary-foreground",
      },
      collapsed: {
        true: "justify-center px-2 gap-0",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      collapsed: false,
    },
  },
)

const navSectionVariants = cva("flex flex-col gap-1", {
  variants: {
    collapsed: {
      true: "items-center",
      false: "",
    },
  },
})

const navLabelVariants = cva(
  "text-sm font-medium whitespace-nowrap transition-opacity duration-200",
  {
    variants: {
      visible: {
        true: "opacity-100",
        false: "opacity-0 hidden",
      },
    },
  },
)

const themeToggleVariants = cva(
  "flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer hover:bg-muted",
  {
    variants: {
      collapsed: {
        true: "justify-center px-2 gap-0",
        false: "",
      },
    },
  },
)

export function Sidebar({ collapsed, onToggle, isMobile }: SidebarProps) {
  const location = useLocation()
  const [darkMode, setDarkMode] = useState(false)

  // Check initial dark mode state
  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark")
    setDarkMode(isDark)
  }, [])

  // Toggle dark mode
  const toggleDarkMode = () => {
    const root = document.documentElement
    const isDark = !root.classList.contains("dark")

    if (isDark) {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }

    localStorage.setItem("theme", isDark ? "dark" : "light")
    setDarkMode(isDark)
  }

  return (
    <motion.div
      className={cn(sidebarVariants({ collapsed }))}
      initial={false}
      animate={{ width: collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)" }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
    >
      {/* Header with logo and toggle */}
      <div className={cn(sidebarHeaderVariants({ collapsed }))}>
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              key="logo"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2"
            >
              <FlaskConical className="size-6 text-primary" />
              <span className="font-semibold text-foreground">BiochemCalc</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile menu toggle */}
        {isMobile && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onToggle}
            className="p-1 rounded-lg hover:bg-muted"
            aria-label={collapsed ? cs.sidebar.expand : cs.sidebar.collapse}
          >
            {collapsed ? <Menu className="size-5" /> : <X className="size-5" />}
          </motion.button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3">
        <div className={cn(navSectionVariants({ collapsed }))}>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <motion.div key={item.path} whileHover={{ scale: 1.02 }}>
                <Link
                  to={item.path}
                  className={cn(
                    navItemVariants({
                      variant: isActive ? "active" : "default",
                      collapsed,
                    }),
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="text-foreground-secondary group-hover:text-foreground transition-colors">
                    {item.icon}
                  </span>
                  <AnimatePresence mode="wait">
                    {!collapsed && (
                      <motion.span
                        key={`label-${item.path}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.15 }}
                        className={cn(navLabelVariants({ visible: !collapsed }))}
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Link>
              </motion.div>
            )
          })}
        </div>

        {/* Bottom navigation */}
        <div className={cn(navSectionVariants({ collapsed }))}>
          {bottomNavItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <motion.div key={item.path} whileHover={{ scale: 1.02 }}>
                <Link
                  to={item.path}
                  className={cn(
                    navItemVariants({
                      variant: isActive ? "active" : "default",
                      collapsed,
                    }),
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="text-foreground-secondary group-hover:text-foreground transition-colors">
                    {item.icon}
                  </span>
                  <AnimatePresence mode="wait">
                    {!collapsed && (
                      <motion.span
                        key={`label-${item.path}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.15 }}
                        className={cn(navLabelVariants({ visible: !collapsed }))}
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </nav>

      {/* Theme toggle at the bottom */}
      <div className="border-t border-border p-2">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleDarkMode}
          className={cn(themeToggleVariants({ collapsed }))}
          aria-label={darkMode ? cs.theme.light : cs.theme.dark}
        >
          <AnimatePresence mode="wait">
            <motion.span
              key={darkMode ? "moon" : "sun"}
              initial={{ opacity: 0, rotate: -180 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 180 }}
              transition={{ duration: 0.2 }}
            >
              {darkMode ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </motion.span>
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {!collapsed && (
              <motion.span
                key={`theme-label-${darkMode}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className={cn(navLabelVariants({ visible: !collapsed }))}
              >
                {darkMode ? cs.theme.light : cs.theme.dark}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </motion.div>
  )
}
