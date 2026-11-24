// Server-time arithmetic shared by both teacher-test run pages.

/** Auto-submit normally fires this long before the deadline. */
export const AUTO_SUBMIT_MARGIN_MS = 30_000
/** Runs opened with less time than this use the whole window instead. */
const LATE_START_MS = 60_000

/** Server clock minus device clock, measured when the response arrives. */
export function clockOffsetMs(serverNow: string, receivedAt: number): number {
  const server = Date.parse(serverNow)
  return Number.isNaN(server) ? 0 : server - receivedAt
}

/**
 * Attach the offset to a response as it arrives. It must not be computed later:
 * `serverNow` goes stale while the student sits on the list page.
 */
export function withClockOffset<T extends { serverNow: string }>(
  views: T[],
  receivedAt = Date.now(),
): (T & { clockOffsetMs: number })[] {
  return views.map((view) => ({
    ...view,
    clockOffsetMs: clockOffsetMs(view.serverNow, receivedAt),
  }))
}

/** Time left on the server's clock. */
export function remainingTimeMs(availableTo: string, offsetMs: number, deviceNow: number): number {
  return Date.parse(availableTo) - (deviceNow + offsetMs)
}

/**
 * Margin for one run, from the time left when it opened. A late start submits
 * at the deadline itself (inside the server's 60 s grace), so opening a test in
 * its last seconds never burns the only attempt on a blank submission.
 */
export function autoSubmitMarginMs(leftAtOpen: number): number {
  return leftAtOpen <= LATE_START_MS ? 0 : AUTO_SUBMIT_MARGIN_MS
}
