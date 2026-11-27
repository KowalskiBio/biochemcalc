import { describe, expect, it } from "vitest"
import {
  autoSubmitMarginMs,
  clockOffsetMs,
  formatCountdown,
  remainingTimeMs,
  withClockOffset,
} from "@/lib/test-clock"

const SERVER = "2026-01-01T12:00:00Z"
const DEADLINE = "2026-01-01T12:10:00Z"
const serverMs = Date.parse(SERVER)

describe("test clock", () => {
  it.each([0, 3_600_000, -3_600_000])("ignores a device skew of %d ms", (skew) => {
    const device = serverMs + skew
    const offset = clockOffsetMs(SERVER, device)
    expect(remainingTimeMs(DEADLINE, offset, device)).toBe(600_000)
  })

  it("stays correct after waiting on the list page", () => {
    const device = serverMs + 120_000
    const [view] = withClockOffset([{ serverNow: SERVER }], device)
    expect(remainingTimeMs(DEADLINE, view?.clockOffsetMs ?? 0, device + 540_000)).toBe(60_000)
  })

  it("falls back to the device clock on an unreadable server time", () => {
    expect(clockOffsetMs("", serverMs)).toBe(0)
  })

  it("does not submit a late start immediately", () => {
    expect(autoSubmitMarginMs(600_000)).toBe(30_000)
    expect(autoSubmitMarginMs(20_000)).toBe(0)
  })
})

describe("formatCountdown", () => {
  it("shows m:ss under an hour", () => {
    expect(formatCountdown(65_000)).toBe("1:05")
    expect(formatCountdown(59 * 60_000 + 59_000)).toBe("59:59")
  })

  it("shows h:mm:ss from an hour up", () => {
    expect(formatCountdown(3_600_000)).toBe("1:00:00")
    expect(formatCountdown(23 * 3_600_000 + 58 * 60_000 + 58_000)).toBe("23:58:58")
  })

  it("rounds up and never goes negative", () => {
    expect(formatCountdown(1)).toBe("0:01")
    expect(formatCountdown(-5_000)).toBe("0:00")
  })
})
