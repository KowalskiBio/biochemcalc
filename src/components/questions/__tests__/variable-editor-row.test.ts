import { describe, expect, it } from "vitest"

import {
  parsePairedConstantsText,
  serializePairedConstants,
} from "@/components/questions/variable-editor-row"

describe("parsePairedConstantsText", () => {
  it("parses a period-decimal value per the documented format", () => {
    expect(parsePairedConstantsText("Ka=1.8e-5")).toEqual([{ Ka: 1.8e-5 }])
  })

  it("parses a Czech comma-decimal value without dropping the fractional part", () => {
    // Reported bug: "Ka=1,75e-5" used to split on the decimal comma into
    // "Ka=1" and a dangling "75e-5" with no "=", silently storing Ka=1
    // instead of 1.75e-5.
    expect(parsePairedConstantsText("Ka=1,75e-5")).toEqual([{ Ka: 1.75e-5 }])
  })

  it("still supports multiple comma-separated pairs per line", () => {
    expect(parsePairedConstantsText("Ka=1.8e-5, pKa=4.74")).toEqual([{ Ka: 1.8e-5, pKa: 4.74 }])
  })

  it("supports multiple comma-decimal pairs per line", () => {
    expect(parsePairedConstantsText("Ka=1,8e-5, pKa=4,74")).toEqual([{ Ka: 1.8e-5, pKa: 4.74 }])
  })

  it("keeps one row per string value in order", () => {
    expect(parsePairedConstantsText("Ka=1,75e-5\nKa=8.6e-4")).toEqual([
      { Ka: 1.75e-5 },
      { Ka: 8.6e-4 },
    ])
  })

  it("ignores blank lines", () => {
    expect(parsePairedConstantsText("Ka=1.8e-5\n\nKa=8.6e-4\n")).toEqual([
      { Ka: 1.8e-5 },
      { Ka: 8.6e-4 },
    ])
  })

  it("returns an empty array for empty input", () => {
    expect(parsePairedConstantsText("")).toEqual([])
  })

  it("skips a line with no recognizable key=value pair", () => {
    expect(parsePairedConstantsText("not a pair")).toEqual([{}])
  })
})

describe("serializePairedConstants", () => {
  it("round-trips through parsePairedConstantsText", () => {
    const original = [{ Ka: 1.75e-5 }, { Ka: 0.00086 }]
    const text = serializePairedConstants(original)
    expect(parsePairedConstantsText(text)).toEqual(original)
  })

  it("returns an empty string for undefined or empty input", () => {
    expect(serializePairedConstants(undefined)).toBe("")
    expect(serializePairedConstants([])).toBe("")
  })
})
