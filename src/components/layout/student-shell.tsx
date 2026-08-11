import { cva } from "class-variance-authority"
import { FlaskConical, LogOut, Moon, Settings, Sun, Target, Trophy } from "lucide-react"
import type React from "react"
import { type ReactNode, useEffect } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"

import { Toaster } from "@/components/ui/toaster"
import { PageTransition } from "@/components/ui/page-transition"
import { cs } from "@/i18n/cs"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import { useUiStore } from "@/stores/ui-store"

/**
 * The student's whole world: three destinations and nothing else. Separate
 * from the teacher `AppShell`/`Sidebar` on purpose — that nav is entirely
 * content-authoring links that 403 for a student account (`/api/cmd/*` is
 * teacher-only), so sharing one component would mean maintaining a list of
 * things to hide rather than a list of things to show.
 */
interface NavItem {
  path: string
  icon: React.ReactNode
  label: string
}

const navItems: NavItem[] = [
  {
    path: "/",
    icon: <Target className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.practice,
  },
  {
    path: "/leaderboard",
    icon: <Trophy className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.leaderboard,
  },
  {
    path: "/settings",
    icon: <Settings className="size-[18px]" strokeWidth={1.75} />,
    label: cs.navigation.settings,
  },
]

const sidebarVariants = cva(
  "flex flex-col h-full bg-[hsl(var(--sidebar))] border-r border-black/20 text-[hsl(var(--sidebar-foreground))] w-[var(--sidebar-width)]",
)

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

const iconButtonVariants = cva(
  "flex items-center justify-center p-2 rounded-[4px] border border-white/10 text-[hsl(var(--sidebar-foreground))]/70 transition-colors duration-100 cursor-pointer hover:bg-white/5 hover:text-[hsl(var(--sidebar-foreground))]",
)

function StudentSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const darkMode = useUiStore((state) => state.theme === "dark")
  const logout = useAuthStore((s) => s.logout)
  const username = useAuthStore((s) => s.user?.username)

  const handleLogout = async () => {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className={cn(sidebarVariants())}>
      <div className="flex items-center gap-3 p-4 border-b border-white/5">
        <div className="w-6 h-6 rounded-[4px] bg-[hsl(var(--accent))] flex items-center justify-center flex-shrink-0">
          <FlaskConical className="size-4 text-[hsl(var(--card))]" strokeWidth={1.75} />
        </div>
        <div className="flex flex-col overflow-hidden">
          <span className="font-semibold text-[hsl(var(--sidebar-foreground))] tracking-tight">
            BiochemCalc
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[hsl(var(--sidebar-foreground))]/40 truncate">
            {username}
          </span>
        </div>
      </div>

      <nav className="flex-1 p-3">
        <div className="flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(navItemVariants({ variant: isActive ? "active" : "default" }))}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="text-[hsl(var(--sidebar-foreground))]/62">{item.icon}</span>
                <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      <div className="border-t border-white/5 p-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => useUiStore.getState().toggleTheme()}
          className={cn(iconButtonVariants())}
          aria-label={darkMode ? cs.theme.light : cs.theme.dark}
        >
          {darkMode ? (
            <Sun className="size-4" strokeWidth={1.75} />
          ) : (
            <Moon className="size-4" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className={cn(iconButtonVariants())}
          aria-label={cs.auth.logout}
          title={cs.auth.logout}
        >
          <LogOut className="size-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

export function StudentShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--sidebar-width", "232px")
  }, [])

  return (
    <div className="relative flex min-h-screen w-full">
      <div className="fixed left-0 top-0 z-40 h-full">
        <StudentSidebar />
      </div>

      <main className="flex-1 flex flex-col ml-[var(--sidebar-width)]">
        <div className="flex-1 p-4 sm:p-6 lg:p-8">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <Toaster />
    </div>
  )
}
