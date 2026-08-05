import { cva } from "class-variance-authority"
import { type ReactNode, useEffect } from "react"
import { Toaster } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"

import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"

interface AppShellProps {
  children: ReactNode
}

const mainContentVariants = cva("flex-1 flex flex-col ml-[var(--sidebar-width)]")

export function AppShell({ children }: AppShellProps) {
  // CSS variables for sidebar dimensions
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--sidebar-width", "232px")
    root.style.setProperty("--top-bar-height", "56px")
  }, [])

  return (
    <div className="relative flex min-h-screen w-full">
      {/* Sidebar */}
      <div className="fixed left-0 top-0 z-40 h-full">
        <Sidebar />
      </div>

      {/* Main content area */}
      <main className={cn(mainContentVariants())}>
        {/* Top bar */}
        <TopBar />

        {/* Page content */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
      <Toaster />
    </div>
  )
}
