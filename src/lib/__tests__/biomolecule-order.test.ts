import { describe, expect, it } from "vitest"

import { compareMoleculeNames } from "@/lib/biomolecule-order"

describe("compareMoleculeNames", () => {
  it("strips rich-text markup before comparing", () => {
    expect(compareMoleculeNames("FADH_{2}", "FADH2")).toBe(0)
    expect(compareMoleculeNames("H_{2}O", "Glycin")).toBeGreaterThan(0) // G < H
  })

  it("keeps Czech letters with garbled ASCII and plain letters correct", () => {
    expect(compareMoleculeNames("alanin", "B")).toBeLessThan(0)
    expect(compareMoleculeNames("Žluťoučký kůň", "zlatý")) // ž and z differ in cs
      .toBeGreaterThan(0)
  })

  it("compares digit runs numerically (B2 before B12), letters case-insensitively", () => {
    expect(compareMoleculeNames("Vitamín B2", "vitamín B12")).toBeLessThan(0)
    expect(compareMoleculeNames("alanin", "Alanin")).toBe(0)
  })
})
