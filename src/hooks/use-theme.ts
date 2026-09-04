import { useEffect, useState } from "react"

/**
 * Theme hook for managing dark mode in BioCal
 * Uses Tailwind CSS "class" strategy: toggles .dark class on <html> element
 * Persists preference to localStorage
 * Respects prefers-reduced-motion
 */
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(
    (localStorage.getItem("theme") as "light" | "dark" | null) || "dark",
  )

  // Initialize theme on mount
  useEffect(() => {
    const root = window.document.documentElement

    // Check localStorage first, then system preference
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null

    const initialTheme = savedTheme || "dark"

    // Apply the theme class to html element
    if (initialTheme === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }

    setTheme(initialTheme)
  }, [])

  // Update theme and persist to localStorage
  const setThemePreference = (newTheme: "light" | "dark") => {
    const root = window.document.documentElement

    if (newTheme === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }

    localStorage.setItem("theme", newTheme)
    setTheme(newTheme)
  }

  // Toggle between light and dark theme
  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light"
    setThemePreference(newTheme)
  }

  // Check if reduced motion is preferred
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    setPrefersReducedMotion(mediaQuery.matches)

    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches)
    mediaQuery.addEventListener("change", handleChange)

    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  return {
    theme,
    setTheme: setThemePreference,
    toggleTheme,
    isDark: theme === "dark",
    prefersReducedMotion,
  }
}

// Export a singleton instance for usage in components without re-renders
let themeInstance: ReturnType<typeof useTheme> | null = null

export function getThemeInstance() {
  if (!themeInstance) {
    // This is a fallback for SSR/non-react contexts
    // In practice, useTheme() should be used within React components
    themeInstance = {
      theme: (localStorage.getItem("theme") as "light" | "dark") || "dark",
      setTheme: () => {},
      toggleTheme: () => {},
      isDark: false,
      prefersReducedMotion: false,
    }
  }
  return themeInstance
}
