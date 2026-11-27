import { useEffect, useLayoutEffect, useRef } from "react"
import { useLocation, useNavigationType } from "react-router-dom"

/**
 * Window scroll position per pathname, kept for the whole browser session
 * (not just this tab's history entries): leaving the Biomolekuly hub for a
 * category and coming back – by the back button OR by an in-app "Zpět" link,
 * which is a fresh PUSH – lands where the student left off.
 */
const positions = new Map<string, number>()

/** How long a restore keeps waiting for late content (structure drawings) to grow the page. */
const RESTORE_TIMEOUT_MS = 2000

/**
 * Pages that must open at their top on a fresh visit even when an older
 * visit of the same URL was scrolled: score/result screens (a student
 * submits from the bottom of a long test) and runs in progress.
 */
const ALWAYS_TOP = /\/(results|vysledek|active|pisat)$/

/**
 * Shell-level scroll memory. Every scroll is recorded against the current
 * pathname; on each navigation the new page either gets its remembered
 * position back or starts at the top (the router alone would keep the
 * previous page's offset). Restoring retries frame by frame until the page
 * is tall enough, since lists and SVG depictions render after mount, and
 * gives up as soon as the user scrolls on their own.
 */
export function useScrollRestoration() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  const restoringRef = useRef(false)

  useEffect(() => {
    const onScroll = () => {
      if (!restoringRef.current) positions.set(pathname, window.scrollY)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [pathname])

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per page change – the navigation type only qualifies that change
  useLayoutEffect(() => {
    const saved = positions.get(pathname) ?? 0
    const target = navigationType !== "POP" && ALWAYS_TOP.test(pathname) ? 0 : saved
    if (target <= 0) {
      window.scrollTo(0, 0)
      return
    }

    let frame = 0
    const startedAt = performance.now()
    const stop = () => {
      restoringRef.current = false
      cancelAnimationFrame(frame)
      window.removeEventListener("wheel", stop)
      window.removeEventListener("touchstart", stop)
      window.removeEventListener("keydown", stop)
    }
    const attempt = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo(0, Math.min(target, Math.max(0, max)))
      if (max >= target || performance.now() - startedAt > RESTORE_TIMEOUT_MS) {
        stop()
        positions.set(pathname, window.scrollY)
        return
      }
      frame = requestAnimationFrame(attempt)
    }

    restoringRef.current = true
    window.addEventListener("wheel", stop, { passive: true })
    window.addEventListener("touchstart", stop, { passive: true })
    window.addEventListener("keydown", stop)
    attempt()
    return stop
  }, [pathname])
}
