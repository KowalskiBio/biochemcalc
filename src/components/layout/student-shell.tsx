import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cva } from "class-variance-authority"
import {
  Atom,
  FlaskConical,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  Target,
  Timer,
  Trophy,
  X,
} from "lucide-react"
import type React from "react"
import { type ReactNode, useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { SectionPicker } from "@/components/layout/section-picker"
import { SectionSwitcher } from "@/components/layout/section-switcher"
import { StudentFooter } from "@/components/layout/student-footer"
import { PageTransition } from "@/components/ui/page-transition"
import { Toaster } from "@/components/ui/toaster"
import { useLandingRedirect, useSection } from "@/hooks/use-section"
import { cs } from "@/i18n/cs"
import type { Section } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import { useUiStore } from "@/stores/ui-store"

/**
 * The student's whole world: a handful of destinations per section and
 * nothing else — which section(s) they can reach comes from the invite code
 * they registered with (`user.sections`). Separate
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

const leaderboardNavItem: NavItem = {
  path: "/leaderboard",
  icon: <Trophy className="size-[18px]" strokeWidth={1.75} />,
  label: cs.navigation.leaderboard,
}

const settingsNavItem: NavItem = {
  path: "/settings",
  icon: <Settings className="size-[18px]" strokeWidth={1.75} />,
  label: cs.navigation.settings,
}

const navBySection: Record<Section, NavItem[]> = {
  calculations: [
    {
      path: "/test",
      icon: <Timer className="size-[18px]" strokeWidth={1.75} />,
      label: cs.navigation.test,
    },
    {
      path: "/",
      icon: <Target className="size-[18px]" strokeWidth={1.75} />,
      label: cs.navigation.practice,
    },
    leaderboardNavItem,
    settingsNavItem,
  ],
  biomolecules: [
    {
      path: "/biomolekuly/procvicovani",
      icon: <Target className="size-[18px]" strokeWidth={1.75} />,
      label: cs.navigation.practice,
    },
    {
      path: "/biomolekuly/test",
      icon: <Timer className="size-[18px]" strokeWidth={1.75} />,
      label: cs.navigation.test,
    },
    {
      path: "/biomolekuly",
      icon: <Atom className="size-[18px]" strokeWidth={1.75} />,
      label: cs.navigation.biomolekuly,
    },
    leaderboardNavItem,
    settingsNavItem,
  ],
}

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

/**
 * `onNavigate` closes the mobile drawer this renders inside of — a route
 * change doesn't otherwise dismiss it, since it's a plain open/closed dialog
 * state, not tied to the router. The desktop sidebar (always visible, never
 * inside a drawer) passes nothing.
 */
function StudentSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const darkMode = useUiStore((state) => state.theme === "dark")
  const logout = useAuthStore((s) => s.logout)
  const username = useAuthStore((s) => s.user?.username)
  const { section } = useSection()
  const navItems = navBySection[section]

  // Nav paths can nest ("/biomolekuly/procvicovani" sits under
  // "/biomolekuly"), and a plain startsWith would light up both items at
  // once. Match on whole segments, then let the longest match win: exactly
  // one item is active on any route, and subpages (e.g. a molecule
  // category) still highlight their parent item.
  const matchesPath = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname === path || location.pathname.startsWith(`${path}/`)
  const activePath = navItems.reduce<string | null>(
    (best, item) =>
      matchesPath(item.path) && (best === null || item.path.length > best.length)
        ? item.path
        : best,
    null,
  )

  const handleLogout = async () => {
    onNavigate?.()
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
            BioCal
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[hsl(var(--sidebar-foreground))]/40 truncate">
            {username}
          </span>
        </div>
      </div>

      <div className="border-b border-white/5 p-3">
        <SectionSwitcher tone="sidebar" onSwitch={onNavigate} />
      </div>

      <nav className="flex-1 p-3">
        <div className="flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = item.path === activePath
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onNavigate}
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
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const { needsChoice } = useSection()
  useLandingRedirect()

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--sidebar-width", "232px")
  }, [])

  if (needsChoice) {
    return (
      <>
        <SectionPicker />
        <Toaster />
      </>
    )
  }

  return (
    <div className="relative flex min-h-screen w-full">
      {/* Desktop: the permanent fixed sidebar, unchanged from before. */}
      <div className="fixed left-0 top-0 z-40 hidden h-full md:block">
        <StudentSidebar />
      </div>

      {/* Phone/tablet: the same sidebar content, but as a dismissible drawer
          behind a hamburger button — there's no room to keep it permanently
          on screen below `md`. */}
      <DialogPrimitive.Root open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 md:hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="fixed left-0 top-0 z-50 h-full duration-200 md:hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">
              {cs.navigation.mobileNavTitle}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="absolute right-3 top-3 flex items-center justify-center p-2 rounded-[4px] text-[hsl(var(--sidebar-foreground))]/70 hover:bg-white/5 hover:text-[hsl(var(--sidebar-foreground))]"
              aria-label={cs.navigation.closeMenu}
            >
              <X className="size-4" strokeWidth={1.75} />
            </DialogPrimitive.Close>
            <StudentSidebar onNavigate={() => setIsMobileNavOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <main className="flex flex-1 flex-col md:ml-[var(--sidebar-width)]">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-black/20 bg-[hsl(var(--sidebar))] px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-[4px] bg-[hsl(var(--accent))] flex items-center justify-center flex-shrink-0">
              <FlaskConical className="size-4 text-[hsl(var(--card))]" strokeWidth={1.75} />
            </div>
            <span className="font-semibold text-[hsl(var(--sidebar-foreground))] tracking-tight">
              BioCal
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileNavOpen(true)}
            className="flex items-center justify-center p-2 rounded-[4px] border border-white/10 text-[hsl(var(--sidebar-foreground))]/70 transition-colors duration-100 cursor-pointer hover:bg-white/5 hover:text-[hsl(var(--sidebar-foreground))]"
            aria-label={cs.navigation.openMenu}
          >
            <Menu className="size-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex flex-1 flex-col p-4 sm:p-6 lg:p-8">
          <PageTransition>{children}</PageTransition>
          <StudentFooter />
        </div>
      </main>
      <Toaster />
    </div>
  )
}
