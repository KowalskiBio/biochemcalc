import { cva } from "class-variance-authority"
import { type ReactNode, useEffect } from "react"
import { CarryOverlay } from "@/components/layout/carry-overlay"
import { PageTransition } from "@/components/ui/page-transition"
import { Toaster } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"
import { useCarryStore } from "@/stores/drag-store"

import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"

interface AppShellProps {
  children: ReactNode
}

const mainContentVariants = cva("flex-1 flex flex-col ml-[var(--sidebar-width)]")

export function AppShell({ children }: AppShellProps) {
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--sidebar-width", "232px")
    root.style.setProperty("--top-bar-height", "56px")
  }, [])

  const isCarrying = useCarryStore((s) => s.isCarrying)
  const updateMouse = useCarryStore((s) => s.updateMouse)
  const endCarry = useCarryStore((s) => s.endCarry)

  useEffect(() => {
    if (!isCarrying) return
    const handleMouseMove = (e: MouseEvent) => updateMouse(e.clientX, e.clientY)
    const handleMouseUp = () => endCarry()
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    document.body.style.userSelect = "none"
    document.body.style.cursor = "grabbing"
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
    }
  }, [isCarrying, updateMouse, endCarry])

  return (
    <div className="relative flex min-h-screen w-full">
      <div className="fixed left-0 top-0 z-40 h-full">
        <Sidebar />
      </div>
      <main className={cn(mainContentVariants())}>
        <TopBar />
        <div className="flex-1 p-4 sm:p-6 lg:p-8">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <Toaster />
      <CarryOverlay />
    </div>
  )
}
