import { cva } from "class-variance-authority"
import {
  Atom,
  BookOpen,
  Database,
  Eye,
  FileText,
  Flag,
  FlaskConical,
  FolderOpen,
  HelpCircle,
  History,
  Moon,
  Settings,
  Sigma,
  Sun,
  Trophy,
  Upload,
} from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { useSection } from "@/hooks/use-section"
import { cs } from "@/i18n/cs"
import { reportsApi } from "@/lib/reports-api"
import type { Section } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useUiStore } from "@/stores/ui-store"

interface NavItem {
  path: string
  icon: React.ReactNode
  label: string
}

const calculationsNavItems: NavItem[] = [
  {
    path: "/topics",
    icon: <BookOpen className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.topics,
  },
  {
    path: "/projekty",
    icon: <FolderOpen className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.projekty,
  },
  {
    path: "/testy",
    icon: <FileText className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.testy,
  },
  {
    path: "/databaze",
    icon: <Database className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.databaze,
  },
  {
    path: "/vzorce",
    icon: <Sigma className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.formulas,
  },
  {
    path: "/bulk-import",
    icon: <Upload className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.bulkImport,
  },
  {
    path: "/constants",
    icon: <FlaskConical className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.constants,
  },
  {
    path: "/history",
    icon: <History className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.history,
  },
  {
    path: "/hlaseni",
    icon: <Flag className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.hlaseni,
  },
  {
    path: "/leaderboard",
    icon: <Trophy className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.leaderboard,
  },
]

const settingsNavItem: NavItem = {
  path: "/settings",
  icon: <Settings className="size-[18px]" strokeWidth={1.75} />,
  label: cs.navigation.settings,
}

const calculationsBottomNavItems: NavItem[] = [
  settingsNavItem,
  {
    path: "/help",
    icon: <HelpCircle className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.help,
  },
]

const biomoleculesNavItems: NavItem[] = [
  {
    path: "/biomolekuly",
    icon: <Atom className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.biomolekuly,
  },
  {
    path: "/biomolekuly/projekce",
    icon: <Eye className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.projections,
  },
  {
    path: "/leaderboard",
    icon: <Trophy className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.leaderboard,
  },
]

const navBySection: Record<Section, { main: NavItem[]; bottom: NavItem[] }> = {
  calculations: { main: calculationsNavItems, bottom: calculationsBottomNavItems },
  biomolecules: { main: biomoleculesNavItems, bottom: [settingsNavItem] },
}

/** Biomolekuly owns its category pages; Projekce has its own sibling nav item. */
function isNavItemActive(itemPath: string, pathname: string): boolean {
  if (itemPath === "/biomolekuly") {
    return pathname === itemPath || (pathname.startsWith(`${itemPath}/`) && !pathname.startsWith("/biomolekuly/projekce"))
  }
  return pathname === itemPath
}

const sidebarVariants = cva(
  "flex flex-col h-full bg-[hsl(var(--sidebar))] border-r border-black/20 text-[hsl(var(--sidebar-foreground))] w-[var(--sidebar-width)]",
)

const sidebarHeaderVariants = cva("flex items-center gap-3 p-4 border-b border-white/5")

const navItemVariants = cva(
  "flex items-center gap-3 px-3 py-2 rounded-[4px] text-sm font-medium transition-colors duration-100 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "text-[hsl(var(--sidebar-foreground))]/60 hover:bg-white/5 hover:text-[hsl(var(--sidebar-foreground))]",
        active:
          "bg-white/10 text-[hsl(var(--sidebar-foreground))] shadow-[inset_2px_0_0_hsl(var(--accent))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

const navSectionVariants = cva("flex flex-col gap-1")

const navLabelVariants = cva("text-sm font-medium whitespace-nowrap")

const themeToggleVariants = cva(
  "flex items-center justify-center p-2 rounded-[4px] border border-white/10 text-[hsl(var(--sidebar-foreground))]/70 transition-colors duration-100 cursor-pointer hover:bg-white/5 hover:text-[hsl(var(--sidebar-foreground))]",
)

export function Sidebar() {
  const location = useLocation()
  const { section } = useSection()
  const { main: navItems, bottom: bottomNavItems } = navBySection[section]
  const darkMode = useUiStore((state) => state.theme === "dark")
  const [reportCount, setReportCount] = useState<number>(0)

  const toggleDarkMode = () => {
    useUiStore.getState().toggleTheme()
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-fetch count when navigating to ensure badge stays up-to-date
  useEffect(() => {
    const fetchReportCount = async () => {
      try {
        const reports = await reportsApi.list()
        setReportCount(reports.length)
      } catch {
        // Silently ignore errors (403 for students)
      }
    }

    fetchReportCount()
  }, [location.pathname])

  return (
    <div className={cn(sidebarVariants())}>
      {/* Header with logo */}
      <div className={cn(sidebarHeaderVariants())}>
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-[4px] bg-[hsl(var(--accent))] flex items-center justify-center flex-shrink-0">
            <FlaskConical className="size-4 text-[hsl(var(--card))]" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-[hsl(var(--sidebar-foreground))] tracking-tight">
              BioCal
            </span>
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[hsl(var(--sidebar-foreground))]/40">
              LAB v1
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3">
        <div className="text-[10px] tracking-[0.18em] text-[hsl(var(--sidebar-foreground))]/40 font-mono uppercase px-3 mb-1">
          NAVIGACE
        </div>
        <div className={cn(navSectionVariants())}>
          {navItems.map((item) => {
            const isActive = isNavItemActive(item.path, location.pathname)
            const isReports = item.path === "/hlaseni"
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  navItemVariants({
                    variant: isActive ? "active" : "default",
                  }),
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="text-[hsl(var(--sidebar-foreground))]/62 group-hover:text-[hsl(var(--sidebar-foreground))] transition-colors">
                  {item.icon}
                </span>
                <span className={cn(navLabelVariants())}>{item.label}</span>
                {isReports && reportCount > 0 && (
                  <Badge variant="default" className="ml-auto px-2 py-0.5 text-[10px] font-mono">
                    {reportCount}
                  </Badge>
                )}
              </Link>
            )
          })}
        </div>

        {/* Bottom navigation */}
        <div className={cn(navSectionVariants(), "mt-4")}>
          {bottomNavItems.map((item) => {
            const isActive = isNavItemActive(item.path, location.pathname)
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  navItemVariants({
                    variant: isActive ? "active" : "default",
                  }),
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="text-[hsl(var(--sidebar-foreground))]/62 group-hover:text-[hsl(var(--sidebar-foreground))] transition-colors">
                  {item.icon}
                </span>
                <span className={cn(navLabelVariants())}>{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Theme toggle and build info */}
      <div className="border-t border-white/5 p-2">
        <button
          type="button"
          onClick={toggleDarkMode}
          className={cn(themeToggleVariants())}
          aria-label={darkMode ? cs.theme.light : cs.theme.dark}
        >
          {darkMode ? (
            <Sun className="size-4" strokeWidth={1.75} />
          ) : (
            <Moon className="size-4" strokeWidth={1.75} />
          )}
        </button>

        <div className="px-3 pt-1 text-[10px] text-[hsl(var(--sidebar-foreground))]/30 font-mono">
          build: {__BUILD_VERSION__}
        </div>
      </div>
    </div>
  )
}
