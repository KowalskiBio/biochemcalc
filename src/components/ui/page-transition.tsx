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
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation()
  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  )
}
