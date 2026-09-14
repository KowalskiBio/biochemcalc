import { motion } from "framer-motion"
import type { ReactNode } from "react"
import { useLocation } from "react-router-dom"

/**
 * Smooth fade-in on route change. Keyed by pathname so each navigation
 * remounts the wrapper and replays the enter animation.
 *
 * Deliberately fade-in only (no exit animation): `AnimatePresence mode="wait"`
 * would add latency equal to the exit duration before the new page mounts and
 * starts fetching. A short enter-only fade smooths the visual cut without
 * slowing down navigation.
 *
 * `flex flex-1 flex-col` makes this an inert pass-through for a page's own
 * height when its ancestors are plain block elements (unaffected — `flex-1`
 * only does anything inside a flex parent), but lets a page opt into filling
 * the shell's full height with `flex flex-1 flex-col` on its own root, e.g.
 * to pin a footer to the bottom instead of letting it trail the content.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation()
  return (
    <motion.div
      key={location.pathname}
      className="flex flex-1 flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  )
}
