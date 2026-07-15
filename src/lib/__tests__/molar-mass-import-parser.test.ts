import { describe, expect, it } from "vitest"

import { parseMolarMassBulkImport } from "@/lib/molar-mass-import-parser"

describe("parseMolarMassBulkImport", () => {
  it("parses explicit values", () => {
    const { entries, errors } = parseMolarMassBulkImport("NaCl = 58,44\nKCl = 74.55")
    expect(errors).toEqual([])
    expect(entries).toEqual([
      { symbol: "NaCl", formula: "NaCl", value: 58.44 },
      { symbol: "KCl", formula: "KCl", value: 74.55 },
    ])
  })

  it("computes values from formulas when no value is given", () => {
    const { entries, errors } = parseMolarMassBulkImport("H2O\nNaCl\nCaSO4 =")
    expect(errors).toEqual([])
    expect(entries).toHaveLength(3)
    expect(entries[0].symbol).toBe("H2O")
    expect(entries[0].formula).toBe("H2O")
    expect(entries[0].value).toBeCloseTo(18.02, 2)
    expect(entries[1].symbol).toBe("NaCl")
    expect(entries[1].formula).toBe("NaCl")
    expect(entries[1].value).toBeCloseTo(58.44, 2)
    expect(entries[2].symbol).toBe("CaSO4")
    expect(entries[2].formula).toBe("CaSO4")
    expect(entries[2].value).toBeCloseTo(136.14, 2)
  })

  it("computes hydrated and ionic formulas", () => {
    const { entries, errors } = parseMolarMassBulkImport("CuSO4·5H2O\nHSO4-")
    expect(errors).toEqual([])
    expect(entries[0].value).toBeCloseTo(249.71, 2)
    expect(entries[1].value).toBeCloseTo(97.07, 2)
  })

  it("reports duplicate symbols", () => {
    const { entries, errors } = parseMolarMassBulkImport("NaCl\nNaCl = 60")
    expect(entries).toHaveLength(1)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain("vícekrát")
  })

  it("reports invalid formulas", () => {
    const { entries, errors } = parseMolarMassBulkImport("Xy2Z")
    expect(entries).toHaveLength(0)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain("Neznámý prvek")
  })

  it("ignores empty lines and comments", () => {
    const { entries, errors } = parseMolarMassBulkImport("\n# comment\nH2O = 18.015\n\n")
    expect(errors).toEqual([])
    expect(entries).toEqual([{ symbol: "H2O", formula: "H2O", value: 18.015 }])
  })

  it("rejects malformed lines", () => {
    const { entries, errors } = parseMolarMassBulkImport("= 12\na = b = c")
    expect(entries).toHaveLength(0)
    expect(errors.length).toBe(2)
  })

  it("parses symbol, formula and value separated by equals", () => {
    const { entries, errors } = parseMolarMassBulkImport("M_x = FeSO4.7H2O = 278,05")
    expect(errors).toEqual([])
    expect(entries).toEqual([{ symbol: "M_x", formula: "FeSO4.7H2O", value: 278.05 }])
  })

  it("derives formula from M_* symbols when only a value is given", () => {
    const { entries, errors } = parseMolarMassBulkImport("M_NaCl = 58,44")
    expect(errors).toEqual([])
    expect(entries).toEqual([{ symbol: "M_NaCl", formula: "NaCl", value: 58.44 }])
  })

  it("allows a custom reference symbol with a separate formula", () => {
    const { entries, errors } = parseMolarMassBulkImport("M_x = FeSO4.7H2O")
    expect(errors).toEqual([])
    expect(entries[0].symbol).toBe("M_x")
    expect(entries[0].formula).toBe("FeSO4.7H2O")
    expect(entries[0].value).toBeCloseTo(278.05, 1)
  })
})
