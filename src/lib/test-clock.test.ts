import { describe, expect, it } from "vitest"
import {
  autoSubmitMarginMs,
  clockOffsetMs,
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
