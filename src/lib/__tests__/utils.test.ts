import { describe, expect, it } from "vitest"
import {
  extractPlaceholders,
  extractPlaceholderValues,
  isAtomPlaceholder,
  replacePlaceholder,
  stripAnswerTargets,
} from "@/lib/utils"

describe("stripAnswerTargets", () => {
  it("removes a trailing answer-target marker", () => {
    expect(
      stripAnswerTargets("Vypočítejte látkové množství Ca^2+ v [[m]] g Ca(HSO_3)_2. [n]"),
    ).toBe("Vypočítejte látkové množství Ca^2+ v [[m]] g Ca(HSO_3)_2.")
  })

  it("removes several trailing markers with units", () => {
    expect(stripAnswerTargets("Vypočítejte obojí [n mol][m g]")).toBe("Vypočítejte obojí")
  })

  it("leaves double-bracket placeholders alone", () => {
    expect(stripAnswerTargets("Vypočítejte pro objem [[V]]")).toBe("Vypočítejte pro objem [[V]]")
  })

  it("leaves text without markers alone", () => {
    expect(stripAnswerTargets("Vypočítejte hmotnost roztoku.")).toBe(
      "Vypočítejte hmotnost roztoku.",
    )
  })

  it("only strips the trailing block, keeping bracketed asides mid-sentence", () => {
    expect(stripAnswerTargets("Vypočítejte [pozor] hmotnost [m]")).toBe(
      "Vypočítejte [pozor] hmotnost",
    )
  })
})

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
