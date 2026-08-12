import { describe, expect, it } from "vitest"
import {
  applyResultUnits,
  extractFormulaVariables,
  extractTargets,
  matchVariables,
} from "@/lib/formula-checker"

function targets(symbols: string[]) {
  return symbols.map((symbol) => ({ symbol }))
}

function placeholders(symbols: string[]) {
  return symbols.map((symbol) => ({ symbol }))
}

describe("extractTargets", () => {
  it("returns the target variable from trailing [w]", () => {
    expect(extractTargets("...vody? [w]")).toEqual([{ symbol: "w" }])
  })

  it("returns an empty array when no target is present", () => {
    expect(extractTargets("...vody?")).toEqual([])
  })

  it("ignores placeholders and only matches the trailing variable", () => {
    expect(extractTargets("Jaký je zlomek [[w]] v roztoku [ms]")).toEqual([{ symbol: "ms" }])
  })

  it("supports percent sign in target variable", () => {
    expect(extractTargets("... [w%]")).toEqual([{ symbol: "w%" }])
  })

  it("supports underscore in target variable", () => {
    expect(extractTargets("... [rho_r]")).toEqual([{ symbol: "rho_r" }])
  })

  it("extracts multiple adjacent targets", () => {
    expect(extractTargets("... [V1][V2]")).toEqual(targets(["V1", "V2"]))
  })

  it("extracts multiple adjacent targets with underscores", () => {
    expect(extractTargets("... [ms][mv]")).toEqual(targets(["ms", "mv"]))
  })

  it("only treats adjacent trailing brackets as multiple targets", () => {
    expect(extractTargets("Jaký je [[w]] mezi [ms] a [mv]")).toEqual([{ symbol: "mv" }])
  })

  it("extracts target with unit", () => {
    expect(extractTargets("... [n mol]")).toEqual([{ symbol: "n", unit: "mol" }])
  })

  it("extracts multiple targets with units", () => {
    expect(extractTargets("... [n mol][m g]")).toEqual([
      { symbol: "n", unit: "mol" },
      { symbol: "m", unit: "g" },
    ])
  })
})

describe("applyResultUnits", () => {
  it("zips semicolon-separated units onto targets by position", () => {
    const result = applyResultUnits(targets(["n", "m"]), "mol;g")
    expect(result).toEqual([
      { symbol: "n", unit: "mol" },
      { symbol: "m", unit: "g" },
    ])
  })

  it("trims whitespace around semicolons", () => {
    const result = applyResultUnits(targets(["n", "m"]), " mol ; g ")
    expect(result).toEqual([
      { symbol: "n", unit: "mol" },
      { symbol: "m", unit: "g" },
    ])
  })

  it("broadcasts a single unit to every target", () => {
    const result = applyResultUnits(targets(["n", "m"]), "mol")
    expect(result).toEqual([
      { symbol: "n", unit: "mol" },
      { symbol: "m", unit: "mol" },
    ])
  })

  it("leaves targets beyond the provided units untouched", () => {
    const result = applyResultUnits(
      [{ symbol: "a" }, { symbol: "b" }, { symbol: "c", unit: "existing" }],
      "mol;g",
    )
    expect(result).toEqual([
      { symbol: "a", unit: "mol" },
      { symbol: "b", unit: "g" },
      { symbol: "c", unit: "existing" },
    ])
  })

  it("is a no-op for an empty result unit", () => {
    expect(applyResultUnits(targets(["n"]), "")).toEqual([{ symbol: "n" }])
  })
})

describe("extractFormulaVariables", () => {
  it("extracts variables from a mass fraction equation", () => {
    expect(extractFormulaVariables("w = ms / (ms + mv) × 100")).toEqual(["w", "ms", "mv"])
  })

  it("extracts variables from a volume fraction equation with Greek phi", () => {
    expect(extractFormulaVariables("φ = Vs / (Vs + Vr) × 100")).toEqual(["φ", "Vs", "Vr"])
  })

  it("extracts variables from amount-of-substance equation", () => {
    expect(extractFormulaVariables("n = m / M")).toEqual(["n", "m", "M"])
  })

  it("returns unique variables even when repeated", () => {
    expect(extractFormulaVariables("w = ms / (ms + ms) × 100")).toEqual(["w", "ms"])
  })

  it("supports percent sign and underscore in variable names", () => {
    expect(extractFormulaVariables("w% = v% * rho_s / (v% * rho_s + mr)")).toEqual([
      "w%",
      "v%",
      "rho_s",
      "mr",
    ])
  })

  it("does not treat plain numbers as variables", () => {
    expect(extractFormulaVariables("w = 100 / (100 + 50)")).toEqual(["w"])
  })
})

describe("matchVariables", () => {
  it("marks all required variables as present when available", () => {
    const result = matchVariables(placeholders(["ms", "mv"]), ["w", "ms", "mv"], ["w"])
    expect(result.present).toEqual(["ms", "mv"])
    expect(result.missing).toEqual([])
    expect(result.targets).toEqual(["w"])
  })

  it("marks missing variables when a required one is absent", () => {
    const result = matchVariables(placeholders(["ms"]), ["w", "ms", "mv"], ["w"])
    expect(result.present).toEqual(["ms"])
    expect(result.missing).toEqual(["mv"])
  })

  it("treats the target variable as the output, not required input", () => {
    const result = matchVariables(placeholders(["ms", "mv"]), ["w", "ms", "mv"], ["w"])
    expect(result.required).toEqual(["ms", "mv"])
    expect(result.required).not.toContain("w")
  })

  it("handles equations where target is not in placeholders", () => {
    const result = matchVariables(placeholders(["ms", "mv"]), ["w", "ms", "mv"], [])
    expect(result.required).toEqual(["w", "ms", "mv"])
    expect(result.present).toEqual(["ms", "mv"])
    expect(result.missing).toEqual(["w"])
  })

  it("keeps placeholder values in the result", () => {
    const result = matchVariables(
      [
        { symbol: "v%", value: "56 %" },
        { symbol: "rho_r", value: "0.9607" },
      ],
      ["w%", "v%", "rho_r", "mv"],
      ["w%"],
    )
    expect(result.placeholders).toEqual([
      { symbol: "v%", value: "56 %" },
      { symbol: "rho_r", value: "0.9607" },
    ])
  })

  it("excludes multiple targets from required variables", () => {
    const result = matchVariables(
      placeholders(["m1", "m2"]),
      ["V1", "V2", "m1", "m2"],
      ["V1", "V2"],
    )
    expect(result.targets).toEqual(["V1", "V2"])
    expect(result.required).toEqual(["m1", "m2"])
    expect(result.present).toEqual(["m1", "m2"])
    expect(result.missing).toEqual([])
  })

  it("reports missing variables when one target is present as placeholder", () => {
    const result = matchVariables(
      placeholders(["V1", "m1", "m2"]),
      ["V1", "V2", "m1", "m2"],
      ["V1", "V2"],
    )
    expect(result.required).toEqual(["m1", "m2"])
    expect(result.present).toEqual(["m1", "m2"])
    expect(result.missing).toEqual([])
  })
})
