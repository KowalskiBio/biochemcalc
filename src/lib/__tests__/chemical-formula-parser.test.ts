import { describe, expect, it } from "vitest"

import {
  calculateMolarMass,
  isValidChemicalFormula,
  parseChemicalFormula,
} from "@/lib/chemical-formula-parser"

describe("parseChemicalFormula", () => {
  it("parses simple molecules", () => {
    const water = parseChemicalFormula("H2O")
    expect(water.ok).toBe(true)
    if (!water.ok) return
    expect(water.value).toBeCloseTo(18.02, 2)
    expect(water.counts).toEqual({ H: 2, O: 1 })

    const salt = parseChemicalFormula("NaCl")
    expect(salt.ok).toBe(true)
    if (!salt.ok) return
    expect(salt.value).toBeCloseTo(58.44, 2)
    expect(salt.counts).toEqual({ Na: 1, Cl: 1 })
  })

  it("parses formulas with parentheses", () => {
    const result = parseChemicalFormula("Al2(SO4)3")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeCloseTo(342.14, 2)
    expect(result.counts).toEqual({ Al: 2, S: 3, O: 12 })
  })

  it("parses hydrate notation with middle dot", () => {
    const result = parseChemicalFormula("CuSO4·5H2O")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeCloseTo(249.71, 2)
    expect(result.counts).toEqual({ Cu: 1, S: 1, O: 9, H: 10 })
  })

  it("parses hydrates with asterisk separator", () => {
    const result = parseChemicalFormula("FeSO4*7H2O")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeCloseTo(278.05, 2)
  })

  it("ignores trailing charge signs", () => {
    const result = parseChemicalFormula("HSO4-")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeCloseTo(97.07, 2)
    expect(result.counts).toEqual({ H: 1, S: 1, O: 4 })
  })

  it("strips caret charge notation", () => {
    const sulfate = parseChemicalFormula("SO4^2-")
    expect(sulfate.ok).toBe(true)
    if (!sulfate.ok) return
    expect(sulfate.value).toBeCloseTo(96.06, 2)

    const hydronium = parseChemicalFormula("H3O+")
    expect(hydronium.ok).toBe(true)
    if (!hydronium.ok) return
    expect(hydronium.value).toBeCloseTo(19.03, 2)
  })

  it("treats single-element ion notation as the neutral atom", () => {
    expect(calculateMolarMass("Ca2+")).toBeCloseTo(40.08, 2)
    expect(calculateMolarMass("Ca^2+")).toBeCloseTo(40.08, 2)
    expect(calculateMolarMass("Na+")).toBeCloseTo(22.99, 2)
    expect(calculateMolarMass("Cl-")).toBeCloseTo(35.45, 2)
    expect(calculateMolarMass("O2-")).toBeCloseTo(16.0, 1)
  })

  it("calculates single-element formulas", () => {
    expect(calculateMolarMass("S")).toBeCloseTo(32.06, 2)
    expect(calculateMolarMass("Fe")).toBeCloseTo(55.85, 2)
    expect(calculateMolarMass("C")).toBeCloseTo(12.01, 2)
  })

  it("falls back to periodic table when custom weights do not include element", () => {
    expect(calculateMolarMass("S", { M_Fe: 55.85 })).toBeCloseTo(32.06, 2)
  })

  it("handles organic molecules", () => {
    const glucose = parseChemicalFormula("C6H12O6")
    expect(glucose.ok).toBe(true)
    if (!glucose.ok) return
    expect(glucose.value).toBeCloseTo(180.18, 2)
  })

  it("handles nested groups", () => {
    const result = parseChemicalFormula("Ca(NO3)2")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeCloseTo(164.1, 1)
    expect(result.counts).toEqual({ Ca: 1, N: 2, O: 6 })
  })

  it("rejects unknown elements", () => {
    const result = parseChemicalFormula("Xy2Z")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("Neznámý prvek")
  })

  it("rejects empty formulas", () => {
    const result = parseChemicalFormula("   ")
    expect(result.ok).toBe(false)
  })

  it("rejects mismatched parentheses", () => {
    const result = parseChemicalFormula("Ca(NO3)2(")
    expect(result.ok).toBe(false)
  })

  it("handles whitespace gracefully", () => {
    const result = parseChemicalFormula("  H2 O ")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeCloseTo(18.02, 2)
  })

  it("handles unicode subscripts", () => {
    const result = parseChemicalFormula("H₂O")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeCloseTo(18.02, 2)
  })

  it("uses custom atomic weights when provided", () => {
    const custom = { H: 2.0, O: 20.0 }
    const result = parseChemicalFormula("H2O", custom)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeCloseTo(24.0, 2)
  })

  it("exposes helper functions", () => {
    expect(isValidChemicalFormula("H2O")).toBe(true)
    expect(isValidChemicalFormula("Xx")).toBe(false)
    expect(calculateMolarMass("H2O")).toBeCloseTo(18.02, 2)
  })
})
