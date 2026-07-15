import { describe, expect, it } from "vitest"
import {
  createRandom,
  evaluateExpression,
  formatNumberMaxDecimals,
  pickMockValues,
  renderEquationAsLatex,
  resolveMolarMasses,
  validateEquationReferences,
} from "@/lib/math-utils"
import type { LocalVariableEdit } from "@/lib/types"

describe("renderEquationAsLatex", () => {
  it("renders a simple fraction", () => {
    expect(renderEquationAsLatex("w = ms / (ms + mv)")).toBe("$$w = \\frac{ms}{ms + mv}$$")
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

  it("escapes underscores in identifiers", () => {
    expect(renderEquationAsLatex("N = m / M_H_2O")).toBe("$$N = \\frac{m}{\\mathrm{M\\_H\\_2O}}$$")
  })

  it("accepts comma decimals and square brackets", () => {
    expect(renderEquationAsLatex("N = (V / 22,4) * NA")).toBe("$$N = \\frac{V}{22.4} \\times NA$$")
    expect(renderEquationAsLatex("N = [m / M_Fe] * NA")).toBe(
      "$$N = \\frac{m}{\\mathrm{M\\_Fe}} \\times NA$$",
    )
  })

  it("passes through existing LaTeX", () => {
    const input = "$$\\frac{a}{b}$$"
    expect(renderEquationAsLatex(input)).toBe(input)
  })

  it("returns empty string for empty input", () => {
    expect(renderEquationAsLatex("")).toBe("")
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

  it("prefers a registered constant over computing the formula", () => {
    const result = resolveMolarMasses("M_FeSO4.7H2O", { "M_FeSO4.7H2O": 300 })
    expect(Number(result)).toBe(300)
  })

  it("prefers a custom M_x constant when formula would be invalid", () => {
    const result = resolveMolarMasses("M_x", { M_x: 120.37 })
    expect(Number(result)).toBeCloseTo(120.37, 2)
  })

  it("handles hydrate inside parentheses without consuming the closing paren", () => {
    const result = resolveMolarMasses("(M_CuSO_4 / M_CuSO_4*5H_2O)")
    expect(result).toMatch(/^\(159\.\d+\s+\/\s+249\.\d+\)$/)
  })
})

describe("evaluateExpression with molar-mass references", () => {
  it("evaluates an expression containing M_<formula>", () => {
    expect(evaluateExpression("w = 1 * M_H2O / 1000", {}, {})).toBeCloseTo(0.018, 3)
  })

  it("evaluates M_<formula> with underscore subscripts", () => {
    expect(evaluateExpression("w = M_H_3PO_4 / 2", {}, {})).toBeCloseTo(49.0, 2)
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
})
