import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Section } from "@/lib/types"

/**
 * UI Store for BioCal
 * Manages global UI state including theme and current page
 */

interface UiState {
  // Theme state
  theme: "light" | "dark"

  // Current page for tracking active route
  currentPage: string

  // Section of the last section-specific page visited this session (not
  // persisted — the durable choice is `user.preferredSection` on the server)
  lastSection: Section | null

  // Actions
  setTheme: (theme: "light" | "dark") => void
  toggleTheme: () => void
  setCurrentPage: (page: string) => void
  setLastSection: (section: Section | null) => void
}

const defaultState: Pick<UiState, "theme" | "currentPage" | "lastSection"> = {
  theme: "light",
  currentPage: "/",
  lastSection: null,
}

/**
 * Create UI store with persistence for theme preference
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...defaultState,

      setTheme: (theme) => {
        // Also update DOM class
        const root = window.document.documentElement
        if (theme === "dark") {
          root.classList.add("dark")
        } else {
          root.classList.remove("dark")
        }
        return set({ theme })
      },

      toggleTheme: () => {
        const root = window.document.documentElement
        return set((state) => {
          const newTheme = state.theme === "light" ? "dark" : "light"
          if (newTheme === "dark") {
            root.classList.add("dark")
          } else {
            root.classList.remove("dark")
          }
          return { theme: newTheme }
        })
      },

      setCurrentPage: (page) => set({ currentPage: page }),

      setLastSection: (section) => set({ lastSection: section }),
    }),
    {
      // Only persist theme preference
      name: "ui-store",
      partialize: (state) => ({
        theme: state.theme,
      }),
    },
  ),
)

// Selector hooks for better performance
export const useThemeStore = () => useUiStore((state) => state.theme)
export const useCurrentPage = () => useUiStore((state) => state.currentPage)

// Action hooks
export const useThemeActions = () => ({
  setTheme: useUiStore((state) => state.setTheme),
  toggleTheme: useUiStore((state) => state.toggleTheme),
})

export const usePageActions = () => ({
  setCurrentPage: useUiStore((state) => state.setCurrentPage),
})

// Type-safe selectors for specific state slices
export const selectTheme = (state: UiState) => state.theme
export const selectCurrentPage = (state: UiState) => state.currentPage
