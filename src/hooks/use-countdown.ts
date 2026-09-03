import { useEffect, useMemo, useState } from "react"

/**
 * Ticks down to a fixed deadline (epoch ms), independent of `setInterval`
 * drift: each tick recomputes the remainder from the real clock rather than
 * decrementing a counter, so a throttled background tab still reports the
 * correct remaining time once it's visible again.
 *
 * `deadlineMs` of `undefined` means "no deadline" (an untimed session):
 * `remainingSeconds` stays `null` and `expired` stays `false` forever.
 */
export function useCountdown(deadlineMs: number | undefined) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (deadlineMs == null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [deadlineMs])

  return useMemo(() => {
    if (deadlineMs == null) {
      return { remainingSeconds: null as number | null, expired: false }
    }
    const remainingSeconds = Math.max(0, Math.ceil((deadlineMs - now) / 1000))
    return { remainingSeconds, expired: remainingSeconds <= 0 }
  }, [deadlineMs, now])
}
