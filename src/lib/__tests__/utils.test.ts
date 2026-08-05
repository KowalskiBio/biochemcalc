import { describe, expect, it } from "vitest"
import {
  extractPlaceholders,
  extractPlaceholderValues,
  isAtomPlaceholder,
  replacePlaceholder,
} from "@/lib/utils"

describe("extractPlaceholders", () => {
  it("extracts simple placeholders", () => {
    expect(extractPlaceholders("[[ms]] g látky ve [[mv]] g vody")).toEqual(["ms", "mv"])
  })

  it("returns unique placeholders", () => {
    expect(extractPlaceholders("[[ms]] a [[ms]]")).toEqual(["ms"])
  })

  it("supports symbols with percent sign and underscore", () => {
    expect(extractPlaceholders("[[v%]] a [[rho_r]]")).toEqual(["v%", "rho_r"])
  })

  it("extracts symbol from fixed-value placeholders", () => {
    expect(extractPlaceholders("[[v%=56 %]] a [[rho_r=0.9607]]")).toEqual(["v%", "rho_r"])
  })
})

describe("extractPlaceholderValues", () => {
  it("returns values for fixed placeholders", () => {
    expect(extractPlaceholderValues("[[v%=56 %]] (ρ = [[rho_r=0.9607]] g*cm^-3)")).toEqual([
      { symbol: "v%", value: "56 %" },
      { symbol: "rho_r", value: "0.9607" },
    ])
  })

  it("returns undefined value for non-fixed placeholders", () => {
    expect(extractPlaceholderValues("[[ms]] g ve [[mv]] g")).toEqual([
      { symbol: "ms" },
      { symbol: "mv" },
    ])
  })

  it("returns unique placeholders keeping the first occurrence", () => {
    expect(extractPlaceholderValues("[[v%=10]] a [[v%=20]]")).toEqual([
      { symbol: "v%", value: "10" },
    ])
  })
})

describe("replacePlaceholder", () => {
  it("renames a simple placeholder", () => {
    expect(replacePlaceholder("[[ms]] g", "ms", "x")).toBe("[[x]] g")
  })

  it("renames a fixed-value placeholder keeping the value", () => {
    expect(replacePlaceholder("[[v%=56 %]]", "v%", "x")).toBe("[[x=56 %]]")
  })
})

describe("isAtomPlaceholder", () => {
  it("matches indexed atom placeholders", () => {
    expect(isAtomPlaceholder("atom1")).toBe(true)
    expect(isAtomPlaceholder("atom2")).toBe(true)
    expect(isAtomPlaceholder("ATOM10")).toBe(true)
  })

  it("matches bare element synonyms", () => {
    expect(isAtomPlaceholder("atom")).toBe(true)
    expect(isAtomPlaceholder("element")).toBe(true)
    expect(isAtomPlaceholder("prvek")).toBe(true)
  })

  it("does not match ordinary numeric placeholders", () => {
    expect(isAtomPlaceholder("ms")).toBe(false)
    expect(isAtomPlaceholder("rho_r")).toBe(false)
    expect(isAtomPlaceholder("atomX")).toBe(false)
  })
})
