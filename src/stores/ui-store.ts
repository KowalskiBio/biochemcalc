import { create } from "zustand"
import { persist } from "zustand/middleware"

/**
 * UI Store for BiochemCalc
 * Manages global UI state including sidebar collapse, theme, and current page
 */

interface UiState {
  // Sidebar state
  sidebarCollapsed: boolean

  // Theme state
  theme: "light" | "dark"

  // Current page for tracking active route
  currentPage: string

  // Actions
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setTheme: (theme: "light" | "dark") => void
  toggleTheme: () => void
  setCurrentPage: (page: string) => void
}

const defaultState: Pick<UiState, "sidebarCollapsed" | "theme" | "currentPage"> = {
  sidebarCollapsed: false,
  theme: "light",
  currentPage: "/",
}

/**
 * Create UI store with persistence for theme preference
 * Sidebar state is not persisted as it's per-session preference
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...defaultState,

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      toggleSidebar: () =>
        set((state) => ({
          sidebarCollapsed: !state.sidebarCollapsed,
        })),

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
export const useSidebar = () => useUiStore((state) => state.sidebarCollapsed)
export const useThemeStore = () => useUiStore((state) => state.theme)
export const useCurrentPage = () => useUiStore((state) => state.currentPage)

// Action hooks
export const useSidebarActions = () => ({
  setSidebarCollapsed: useUiStore((state) => state.setSidebarCollapsed),
  toggleSidebar: useUiStore((state) => state.toggleSidebar),
})

export const useThemeActions = () => ({
  setTheme: useUiStore((state) => state.setTheme),
  toggleTheme: useUiStore((state) => state.toggleTheme),
})

export const usePageActions = () => ({
  setCurrentPage: useUiStore((state) => state.setCurrentPage),
})

// Type-safe selectors for specific state slices
export const selectSidebar = (state: UiState) => state.sidebarCollapsed
export const selectTheme = (state: UiState) => state.theme
export const selectCurrentPage = (state: UiState) => state.currentPage
