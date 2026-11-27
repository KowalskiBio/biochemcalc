import { useLocation } from "react-router-dom"

import { useMoleculeCategories } from "@/stores/biomolecule-data-store"

const LIBRARY_PATH = "/biomolekuly"

/**
 * Identity of the page on screen, for things that should restart when the
 * page changes (the shell's fade-in). Usually the pathname – but the
 * Biomolekuly library is one page across `/biomolekuly` and every
 * `/biomolekuly/<category>`: switching categories only swaps the right pane,
 * so it must not remount and re-fade the whole page. A segment counts as a
 * category when the loaded library has that slug; the other pages living
 * under /biomolekuly/ (test, procvičování, …) keep their own key.
 */
export function usePageKey(): string {
  const { pathname } = useLocation()
  const categories = useMoleculeCategories()
  return pageKeyFor(
    pathname,
    categories.map((category) => category.slug),
  )
}

/** The rule behind `usePageKey`, given the known category slugs. */
export function pageKeyFor(pathname: string, categorySlugs: readonly string[]): string {
  if (pathname === LIBRARY_PATH) return LIBRARY_PATH
  const match = /^\/biomolekuly\/([^/]+)$/.exec(pathname)
  if (match && categorySlugs.includes(match[1])) return LIBRARY_PATH
  return pathname
}
