import { cva } from "class-variance-authority"
import { AnimatePresence, motion } from "framer-motion"
import { type ReactNode, useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import { Toaster } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"
import { useSidebar, useSidebarActions } from "@/stores/ui-store"

import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"

interface AppShellProps {
  children: ReactNode
}

const appShellVariants = cva("relative flex min-h-screen w-full", {
  variants: {
    sidebar: {
      expanded: "",
      collapsed: "",
    },
  },
  defaultVariants: {
    sidebar: "expanded",
  },
})

const mainContentVariants = cva("flex-1 flex flex-col transition-all duration-300 ease-in-out", {
  variants: {
    sidebar: {
      expanded: "ml-[var(--sidebar-width)]",
      collapsed: "ml-[var(--sidebar-collapsed-width)]",
    },
  },
  defaultVariants: {
    sidebar: "expanded",
  },
})

export function AppShell({ children }: AppShellProps) {
  const location = useLocation()

  // Sidebar state management
  const sidebarCollapsed = useSidebar()
  const { setSidebarCollapsed, toggleSidebar } = useSidebarActions()
  const [isMobile, setIsMobile] = useState(false)

  // Check screen size and update sidebar state
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)

      if (mobile) {
        setSidebarCollapsed(true)
      }
    }

    // Initial check
    checkMobile()

    // Add resize listener
    window.addEventListener("resize", checkMobile)

    return () => window.removeEventListener("resize", checkMobile)
  }, [setSidebarCollapsed])

  // CSS variables for sidebar dimensions
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--sidebar-width", "256px")
    root.style.setProperty("--sidebar-collapsed-width", "64px")
    root.style.setProperty("--top-bar-height", "56px")
  }, [])

  return (
    <div className={cn(appShellVariants({ sidebar: sidebarCollapsed ? "collapsed" : "expanded" }))}>
      {/* Sidebar */}
      <div className="fixed left-0 top-0 z-40 h-full">
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} isMobile={isMobile} />
      </div>

      {/* Mobile sidebar backdrop */}
      <AnimatePresence>
        {!sidebarCollapsed && isMobile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
            onClick={toggleSidebar}
          />
        )}
      </AnimatePresence>

      {/* Main content area */}
      <main
        className={cn(
          mainContentVariants({ sidebar: sidebarCollapsed ? "collapsed" : "expanded" }),
        )}
      >
        {/* Top bar */}
        <TopBar onMenuClick={toggleSidebar} isMobile={isMobile} />

        {/* Page content */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <Toaster />
    </div>
  )
}
