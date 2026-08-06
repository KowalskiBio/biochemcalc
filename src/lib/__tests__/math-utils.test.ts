import { describe, expect, it } from "vitest"
import {
  buildSubstitutedEquation,
  createRandom,
  evaluateExpression,
  formatNumberForText,
  formatNumberMaxDecimals,
  pickMockValues,
  renderEquationAsLatex,
  resolveMolarMasses,
  scientificNotationToHtml,
  validateEquationReferences,
} from "@/lib/math-utils"
import type { LocalVariableEdit, Variable, VariableWithPlaceholder } from "@/lib/types"

describe("renderEquationAsLatex", () => {
  it("renders a simple fraction", () => {
    expect(renderEquationAsLatex("w = ms / (ms + mv)")).toBe(
      "$$w = \\frac{\\mathrm{ms}}{\\mathrm{ms} + \\mathrm{mv}}$$",
    )
  })

  it("renders multiplication as times", () => {
    expect(renderEquationAsLatex("w = a * b")).toBe("$$w = a \\times b$$")
  })

  it("renders dot multiplication", () => {
    expect(renderEquationAsLatex("w = a · b")).toBe("$$w = a \\cdot b$$")
  })

  it("renders superscript digits", () => {
    expect(renderEquationAsLatex("w = a²")).toBe("$$w = {a}^{2}$$")
  })

  it("renders percent unit", () => {
    expect(renderEquationAsLatex("w = 100 %")).toBe("$$w = 100\\%$$")
  })

  it("renders molar-mass identifiers with chemical subscripts", () => {
    expect(renderEquationAsLatex("N = m / M_H_2O")).toBe(
      "$$N = \\frac{m}{M_{\\mathrm{H}_{2}\\mathrm{O}}}$$",
    )
  })

  it("renders trailing digits as subscripts", () => {
    expect(renderEquationAsLatex("m2 = m1 × M_Fe / M_S")).toBe(
      "$$m_{2} = \\frac{m_{1} \\times M_{\\mathrm{Fe}}}{M_{\\mathrm{S}}}$$",
    )
  })

  it("accepts comma decimals and square brackets", () => {
    expect(renderEquationAsLatex("N = (V / 22,4) * NA")).toBe(
      "$$N = \\left(\\frac{V}{22.4}\\right) \\times \\mathrm{NA}$$",
    )
    expect(renderEquationAsLatex("N = [m / M_Fe] * NA")).toBe(
      "$$N = \\left(\\frac{m}{M_{\\mathrm{Fe}}}\\right) \\times \\mathrm{NA}$$",
    )
  })

  it("passes through existing LaTeX", () => {
    const input = "$$\\frac{a}{b}$$"
    expect(renderEquationAsLatex(input)).toBe(input)
  })

  it("returns empty string for empty input", () => {
    expect(renderEquationAsLatex("")).toBe("")
  })

  it("formats negative exponents", () => {
    const rendered = renderEquationAsLatex("c = 10^-pH")
    expect(rendered).toContain("10")
    expect(rendered).toContain("^{-")
    expect(rendered).toContain("pH")
  })

  it("renders semicolon-separated multi-target formulas", () => {
    const rendered = renderEquationAsLatex("c = 10^-pH; wDsc = 100*10^(pH-14)/c")
    expect(rendered).toContain("c = ")
    expect(rendered).toContain("wDsc")
    expect(rendered).toContain("\\text{;}")
  })

  it("renders each multi-target formula as proper LaTeX", () => {
    const rendered = renderEquationAsLatex("V1 = a + b; V2 = a - b")
    expect(rendered).toBe("$$V_{1} = a + b \\; \\text{;} \\; V_{2} = a - b$$")
  })

  it("preserves parentheses for expressions like (1 - w)", () => {
    expect(renderEquationAsLatex("(1 - w)")).toBe("$$\\left(1 - w\\right)$$")
  })

  it("strips redundant parentheses under fraction bars", () => {
    expect(renderEquationAsLatex("w = ms / (ms + mv)")).toBe(
      "$$w = \\frac{\\mathrm{ms}}{\\mathrm{ms} + \\mathrm{mv}}$$",
    )
  })

  it("preserves parentheses in multiplication", () => {
    expect(renderEquationAsLatex("(a + b) * c")).toBe("$$\\left(a + b\\right) \\times c$$")
  })

  it("strips parentheses under exponent braces", () => {
    expect(renderEquationAsLatex("(a + b)^2")).toBe("$${a + b}^{2}$$")
  })

  it("preserves parentheses in subtraction chains", () => {
    expect(renderEquationAsLatex("(a + b) - (c - d)")).toBe(
      "$$\\left(a + b\\right) - \\left(c - d\\right)$$",
    )
  })

  it("preserves nested parentheses", () => {
    expect(renderEquationAsLatex("((a + b))")).toBe("$$\\left(\\left(a + b\\right)\\right)$$")
  })
})

describe("evaluateExpression", () => {
  it("respects operator precedence", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14)
  })

  it("evaluates parentheses", () => {
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20)
  })

  it("evaluates exponents", () => {
    expect(evaluateExpression("2 ^ 3")).toBe(8)
  })

  it("evaluates right-associative exponents", () => {
    expect(evaluateExpression("2 ^ 3 ^ 2")).toBe(512)
  })

  it("evaluates negative exponents", () => {
    expect(evaluateExpression("10^-1")).toBe(0.1)
    expect(evaluateExpression("10^-pH", { pH: 1 })).toBe(0.1)
    expect(evaluateExpression("10^(-pH)", { pH: 2 })).toBe(0.01)
  })

  it("evaluates unary minus", () => {
    expect(evaluateExpression("-5 + 3")).toBe(-2)
  })

  it("evaluates functions", () => {
    expect(evaluateExpression("sqrt(16)")).toBe(4)
    expect(evaluateExpression("abs(-5)")).toBe(5)
    expect(evaluateExpression("log(100)")).toBe(2)
  })

  it("evaluates the right-hand side of an equation", () => {
    expect(evaluateExpression("w = 10 / (10 + 20)")).toBeCloseTo(0.3333, 4)
  })

  it("normalizes comma decimals", () => {
    expect(evaluateExpression("3,14 * 2")).toBeCloseTo(6.28, 4)
  })

  it("throws on division by zero", () => {
    expect(() => evaluateExpression("10 / 0")).toThrow()
  })

  it("throws on empty input", () => {
    expect(() => evaluateExpression("")).toThrow()
  })

  it("evaluates semicolon-separated assignments sequentially", () => {
    const result = evaluateExpression("ms = mr * 2; mv = mr - ms", { mr: 100 })
    expect(result).toBeCloseTo(-100, 4)
  })

  it("returns the last assignment value for multi-answer formulas", () => {
    const result = evaluateExpression("a = 5; b = a + 3")
    expect(result).toBe(8)
  })

  it("evaluates unicode operators in multi-answer formulas", () => {
    const result = evaluateExpression("ms = mr × 3; mv = mr − ms", { mr: 10 })
    expect(result).toBeCloseTo(-20, 4)
  })
})

describe("pickMockValues", () => {
  it("picks the midpoint of a numeric range", () => {
    const variables: Pick<
      LocalVariableEdit,
      "placeholder" | "minValue" | "maxValue" | "step" | "varType"
    >[] = [
      {
        placeholder: "X",
        minValue: 10,
        maxValue: 100,
        step: 10,
        varType: "numeric",
      },
    ]
    expect(pickMockValues(variables)).toEqual({ X: 50 })
  })

  it("ignores string variables", () => {
    const variables: Pick<
      LocalVariableEdit,
      "placeholder" | "minValue" | "maxValue" | "step" | "varType"
    >[] = [
      {
        placeholder: "S",
        minValue: 0,
        maxValue: 0,
        step: 1,
        varType: "string",
      },
    ]
    expect(pickMockValues(variables)).toEqual({})
  })
})

describe("createRandom", () => {
  it("produces deterministic values for a given seed", () => {
    const rng = createRandom(12345)
    const first = rng()
    const second = createRandom(12345)()
    expect(first).toBe(second)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(1)
  })

  it("produces different values for different seeds", () => {
    const a = createRandom(1)()
    const b = createRandom(2)()
    expect(a).not.toBe(b)
  })
})

describe("validateEquationReferences", () => {
  it("returns empty when all placeholders are defined", () => {
    const variables = [
      { placeholder: "A", symbol: "a" },
      { placeholder: "B", symbol: "b" },
    ]
    expect(validateEquationReferences("[[A]] * [[B]]", variables)).toEqual([])
  })

  it("detects a missing placeholder", () => {
    const variables = [{ placeholder: "A", symbol: "a" }]
    expect(validateEquationReferences("[[A]] * [[C]]", variables)).toEqual(["C"])
  })

  it("detects a missing bare symbol", () => {
    const variables = [
      { placeholder: "A", symbol: "a" },
      { placeholder: "B", symbol: "b" },
    ]
    expect(validateEquationReferences("w = a / c", variables)).toEqual(["c"])
  })

  it("returns empty for empty equation", () => {
    expect(validateEquationReferences("", [])).toEqual([])
  })

  it("does not flag valid M_<formula> molar-mass references", () => {
    expect(validateEquationReferences("w = c * M_H3PO4 / (rho_r * 1000)", [])).toEqual([
      "c",
      "rho_r",
    ])
  })

  it("does not flag M_<formula> with underscore subscripts", () => {
    const result = validateEquationReferences("w = M_H_3PO_4 / M_NaCl", [])
    expect(result).not.toContain("M_H_3PO_4")
    expect(result).not.toContain("M_NaCl")
  })

  it("does not flag M_KOH as missing", () => {
    expect(validateEquationReferences("V1 = rho_r1 * M_KOH / w1perc", [])).toEqual([
      "rho_r1",
      "w1perc",
    ])
  })

  it("does not flag single-element molar masses like M_Fe and M_S", () => {
    expect(validateEquationReferences("m2 = m1 * M_Fe / M_S", [])).toEqual(["m1"])
  })

  it("does not flag M_S with multiplication sign", () => {
    expect(validateEquationReferences("m2 = m1 × M_Fe / M_S", [])).toEqual(["m1"])
  })

  it("does not flag M_KOH in a longer equation", () => {
    const equation = "V1 = rho_r1 * (100/w1perc) * (c3*V4/V3) * (1000/V2) * M_KOH"
    expect(validateEquationReferences(equation, [])).toEqual([
      "rho_r1",
      "w1perc",
      "c3",
      "V4",
      "V3",
      "V2",
    ])
  })

  it("does not flag M_KOH when variables and fixed placeholders are provided", () => {
    const variables = [
      { placeholder: "V2", symbol: "V2" },
      { placeholder: "V3", symbol: "V3" },
      { placeholder: "V4", symbol: "V4" },
      { placeholder: "c3", symbol: "c3" },
      { placeholder: "w1perc", symbol: "w1perc" },
      { placeholder: "rho_r1", symbol: "rho_r1" },
    ]
    const equation = "V1 = rho_r1 * (100/w1perc) * (c3*V4/V3) * (1000/V2) * M_KOH"
    expect(validateEquationReferences(equation, variables)).toEqual([])
  })

  it("does not flag targets defined in earlier assignments", () => {
    const variables = [{ placeholder: "mr", symbol: "mr" }]
    expect(validateEquationReferences("ms = mr * 2; mv = mr - ms", variables)).toEqual([])
  })

  it("detects missing symbols in multi-assignment equations", () => {
    const variables = [{ placeholder: "mr", symbol: "mr" }]
    expect(validateEquationReferences("ms = mr * x; mv = mr - ms", variables)).toEqual(["x"])
  })
})

describe("resolveMolarMasses", () => {
  it("replaces M_<formula> with the computed molar mass", () => {
    const result = resolveMolarMasses("M_H2O")
    expect(Number(result)).toBeCloseTo(18.02, 2)
  })

  it("handles underscore subscripts", () => {
    const result = resolveMolarMasses("M_H_3PO_4")
    expect(Number(result)).toBeCloseTo(98.0, 2)
  })

  it("uses provided atomic weights", () => {
    const result = resolveMolarMasses("M_H2O", { H: 2.0, O: 20.0 })
    expect(Number(result)).toBeCloseTo(24.0, 2)
  })

  it("leaves invalid references unchanged", () => {
    expect(resolveMolarMasses("M_Xy2Z")).toBe("M_Xy2Z")
  })

  it("handles hydrate notation with a dot", () => {
    const result = resolveMolarMasses("M_FeSO4.7H2O")
    expect(Number(result)).toBeCloseTo(278.05, 1)
  })

  it("handles underscore hydrate notation", () => {
    const result = resolveMolarMasses("M_FeSO_4_7H_2O")
    expect(Number(result)).toBeCloseTo(278.05, 1)
  })

  it("handles star hydrate notation", () => {
    const result = resolveMolarMasses("M_NiCl2*6H2O")
    expect(Number(result)).toBeCloseTo(237.69, 1)
  })

  it("resolves star hydrate inside a larger equation", () => {
    const result = resolveMolarMasses("ms * (NiCl2/M_NiCl2*6H2O) / w - ms")
    expect(result).not.toContain("M_NiCl2*6H2O")
    expect(Number(result.match(/\d+\.\d+/)?.[0])).toBeCloseTo(237.7, 1)
  })

  it("prefers a registered constant over computing the formula", () => {
    const result = resolveMolarMasses("M_FeSO4.7H2O", { "M_FeSO4.7H2O": 300 })
    expect(Number(result)).toBe(300)
  })

  it("prefers a custom M_x constant when formula would be invalid", () => {
    const result = resolveMolarMasses("M_x", { M_x: 120.37 })
    expect(Number(result)).toBeCloseTo(120.37, 2)
  })
})

describe("evaluateExpression with molar-mass references", () => {
  it("evaluates an expression containing M_<formula>", () => {
    expect(evaluateExpression("w = 1 * M_H2O / 1000", {}, {})).toBeCloseTo(0.018, 3)
  })

  it("evaluates M_<formula> with underscore subscripts", () => {
    expect(evaluateExpression("w = M_H_3PO_4 / 2", {}, {})).toBeCloseTo(49.0, 2)
  })

  it("evaluates m2 = m1 × M_Fe / M_S with times sign and empty constants", () => {
    const result = evaluateExpression("m2 = m1 × M_Fe / M_S", { m1: 1 }, {})
    expect(result).toBeCloseTo(55.85 / 32.06, 2)
  })

  it("evaluates m2 = m1 × M_Fe / M_S with M_Fe in constants", () => {
    const result = evaluateExpression("m2 = m1 × M_Fe / M_S", { m1: 1 }, { M_Fe: 55.85 })
    expect(result).toBeCloseTo(55.85 / 32.06, 2)
  })

  it("resolves M_S after symbol substitution (mockResult flow)", () => {
    const equation = "m2=m1×M_Fe/M_S"
    const constants = { M_Fe: 55.85 }
    const substituted = equation.replace(
      /(?<![A-Za-z0-9_\u03B1-\u03C9])m1(?![A-Za-z0-9_\u03B1-\u03C9])/g,
      "1",
    )
    const resolved = resolveMolarMasses(substituted, constants)
    const expression = resolved.replace(/^[^=]*=\s*/, "")
    const result = evaluateExpression(expression, {}, constants)
    expect(result).toBeCloseTo(55.85 / 32.06, 2)
  })
})

describe("formatNumberMaxDecimals", () => {
  it("rounds to a maximum of two decimals", () => {
    expect(formatNumberMaxDecimals(Math.PI)).toBe("3.14")
    expect(formatNumberMaxDecimals(3.1)).toBe("3.1")
    expect(formatNumberMaxDecimals(3)).toBe("3")
  })

  it("handles null or undefined values", () => {
    expect(formatNumberMaxDecimals(null)).toBe("")
    expect(formatNumberMaxDecimals(undefined)).toBe("")
  })

  it("falls back to scientific notation when a non-zero value rounds to zero", () => {
    expect(formatNumberMaxDecimals(0.001)).toBe("1.00×10^-3")
    expect(formatNumberMaxDecimals(-0.001)).toBe("-1.00×10^-3")
    expect(formatNumberMaxDecimals(0.0049)).toBe("4.90×10^-3")
    expect(formatNumberMaxDecimals(1.23e-5)).toBe("1.23×10^-5")
  })

  it("uses scientific notation for large values instead of JavaScript's e+ syntax", () => {
    // Molecule counts land here: the raw toString would be "1.5244...e+25",
    // which is neither readable nor superscriptable.
    expect(formatNumberMaxDecimals(1.524493429448685e25)).toBe("1.52×10^25")
    expect(formatNumberMaxDecimals(6.022e23)).toBe("6.02×10^23")
    expect(formatNumberMaxDecimals(-1.8433287150633585e25)).toBe("-1.84×10^25")
    expect(formatNumberMaxDecimals(5.2149e24)).toBe("5.21×10^24")
  })

  it("never emits raw exponential syntax", () => {
    for (const value of [1e6, 1e21, 1.5e25, 1e-7, 9.9e-30, 12345.678]) {
      expect(formatNumberMaxDecimals(value)).not.toMatch(/e[+-]/i)
    }
  })

  it("never leaks a bare caret into plain-text output", () => {
    // Toasts and badges cannot render markup, so the exponent has to be real
    // superscript characters rather than "^25".
    expect(formatNumberForText(1.524493429448685e25)).toBe("1.52×10²⁵")
    expect(formatNumberForText(6.022e23)).toBe("6.02×10²³")
    expect(formatNumberForText(1.23e-5)).toBe("1.23×10⁻⁵")
    expect(formatNumberForText(2711.93)).toBe("2711.93")
    for (const value of [1e6, 1.5e25, 1e-7, 12345.678]) {
      expect(formatNumberForText(value)).not.toContain("^")
      expect(formatNumberForText(value)).not.toMatch(/e[+-]/i)
    }
  })

  it("converts scientific notation to superscript markup for rendered contexts", () => {
    expect(scientificNotationToHtml("1.52×10^25")).toBe("1.52×10<sup>25</sup>")
    expect(scientificNotationToHtml("1.23×10^-5")).toBe("1.23×10<sup>-5</sup>")
    expect(scientificNotationToHtml("2711.93")).toBe("2711.93")
  })

  it("keeps ordinary magnitudes in plain decimal form", () => {
    expect(formatNumberMaxDecimals(2711.93)).toBe("2711.93")
    expect(formatNumberMaxDecimals(1262.984)).toBe("1262.98")
    expect(formatNumberMaxDecimals(999999.4)).toBe("999999.4")
  })

  it("keeps fixed notation when the value is representable at the requested precision", () => {
    expect(formatNumberMaxDecimals(0.001, 3)).toBe("0.001")
    expect(formatNumberMaxDecimals(0.0099)).toBe("0.01")
    expect(formatNumberMaxDecimals(0)).toBe("0")
  })
})

describe("buildSubstitutedEquation", () => {
  function makeStringVar(symbol: string, placeholder: string): VariableWithPlaceholder {
    return {
      placeholder,
      isShared: false,
      variable: {
        id: "1",
        name: symbol,
        symbol,
        varType: "string",
        minValue: 0,
        maxValue: 0,
        step: 1,
        unit: "",
        precision: 0,
        stringValues: [],
        createdAt: "",
      } as Variable,
    }
  }

  it("substitutes string variable values into molar-mass references", () => {
    const variables = [makeStringVar("plyn", "plyn")]
    const result = buildSubstitutedEquation(
      "rho = M_plyn / 22.4",
      variables,
      {},
      { plyn: "CO_2" },
      {},
    )
    expect(result).toContain("44.01")
    expect(result).toContain("22.4")
  })

  it("works with different placeholder and symbol names", () => {
    const variables = [makeStringVar("gas", "G")]
    const result = buildSubstitutedEquation("rho = M_G / 22.4", variables, {}, { G: "N_2" }, {})
    expect(result).toContain("28.02")
  })
})
