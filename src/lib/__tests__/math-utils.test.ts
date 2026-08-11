import { describe, expect, it } from "vitest"
import {
  buildSubstitutedEquation,
  createRandom,
  evaluateAllAssignments,
  evaluateExpression,
  evaluateVariantAnswer,
  formatNumberForText,
  formatNumberMaxDecimals,
  formatSignificantDigits,
  pickMockValues,
  renderEquationAsLatex,
  resolveMolarMasses,
  scientificNotationToHtml,
  validateEquationReferences,
} from "@/lib/math-utils"
import type { LocalVariableEdit, Variable, Variant, VariableWithPlaceholder } from "@/lib/types"

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

  it("renders the hydrate count as a coefficient, not a subscript", () => {
    expect(renderEquationAsLatex("m = M_CuSO_4_5H_2O")).toBe(
      "$$m = M_{\\mathrm{CuSO}_{4} \\cdot 5\\mathrm{H}_{2}\\mathrm{O}}$$",
    )
    expect(renderEquationAsLatex("m = M_NiCl_2_6H_2O")).toBe(
      "$$m = M_{\\mathrm{NiCl}_{2} \\cdot 6\\mathrm{H}_{2}\\mathrm{O}}$$",
    )
    expect(renderEquationAsLatex("m = M_Na_2SO_3_7H_2O")).toBe(
      "$$m = M_{\\mathrm{Na}_{2}\\mathrm{SO}_{3} \\cdot 7\\mathrm{H}_{2}\\mathrm{O}}$$",
    )
  })

  it("renders hydrates written with a dot, star, middle dot or bullet separator", () => {
    expect(renderEquationAsLatex("m = M_FeSO4.7H2O")).toBe(
      "$$m = M_{\\mathrm{FeSO}_{4} \\cdot 7\\mathrm{H}_{2}\\mathrm{O}}$$",
    )
    expect(renderEquationAsLatex("m = M_NiCl2*6H2O")).toBe(
      "$$m = M_{\\mathrm{NiCl}_{2} \\cdot 6\\mathrm{H}_{2}\\mathrm{O}}$$",
    )
    expect(renderEquationAsLatex("m = M_CuSO4·5H2O")).toBe(
      "$$m = M_{\\mathrm{CuSO}_{4} \\cdot 5\\mathrm{H}_{2}\\mathrm{O}}$$",
    )
    expect(renderEquationAsLatex("m = M_CuSO4∙5H2O")).toBe(
      "$$m = M_{\\mathrm{CuSO}_{4} \\cdot 5\\mathrm{H}_{2}\\mathrm{O}}$$",
    )
  })

  it("renders a dot hydrate inside a larger equation", () => {
    expect(renderEquationAsLatex("n = m / M_FeSO4.7H2O")).toBe(
      "$$n = \\frac{m}{M_{\\mathrm{FeSO}_{4} \\cdot 7\\mathrm{H}_{2}\\mathrm{O}}}$$",
    )
  })

  it("renders an adduct that is not water", () => {
    expect(renderEquationAsLatex("m = M_CuSO4·6NH3")).toBe(
      "$$m = M_{\\mathrm{CuSO}_{4} \\cdot 6\\mathrm{NH}_{3}}$$",
    )
  })

  it("never leaves a raw separator for KaTeX, which has no glyph for ∙", () => {
    for (const formula of [
      "M_FeSO4.7H2O",
      "M_NiCl2*6H2O",
      "M_CuSO4·5H2O",
      "M_CuSO4∙5H2O",
      "M_CuSO4·6NH3",
      "M_KAl(SO4)2·12H2O",
    ]) {
      expect(renderEquationAsLatex(`m = ${formula}`)).not.toMatch(/[·∙*]|\.(?!\d)/)
    }
  })

  it("renders bracketed groups inside a molar mass", () => {
    expect(renderEquationAsLatex("m = M_Ca(OH)2")).toBe(
      "$$m = M_{\\mathrm{Ca}(\\mathrm{OH})_{2}}$$",
    )
    expect(renderEquationAsLatex("m = M_Ca(OH)_2")).toBe(
      "$$m = M_{\\mathrm{Ca}(\\mathrm{OH})_{2}}$$",
    )
    expect(renderEquationAsLatex("n = m / M_Al2(SO4)3")).toBe(
      "$$n = \\frac{m}{M_{\\mathrm{Al}_{2}(\\mathrm{SO}_{4})_{3}}}$$",
    )
    // Square brackets around a complex ion are normalised to round ones.
    expect(renderEquationAsLatex("m = M_[Cu(NH3)4]SO4")).toBe(
      "$$m = M_{(\\mathrm{Cu}(\\mathrm{NH}_{3})_{4})\\mathrm{SO}_{4}}$$",
    )
  })

  it("renders a bracketed group and a hydrate together", () => {
    expect(renderEquationAsLatex("m = M_KAl(SO4)2·12H2O")).toBe(
      "$$m = M_{\\mathrm{KAl}(\\mathrm{SO}_{4})_{2} \\cdot 12\\mathrm{H}_{2}\\mathrm{O}}$$",
    )
  })

  it("keeps multiplication after a molar mass out of the identifier", () => {
    expect(renderEquationAsLatex("m = M_NaCl*2")).toBe("$$m = M_{\\mathrm{NaCl}} \\times 2$$")
    expect(renderEquationAsLatex("m = M_H_2O·n")).toBe(
      "$$m = M_{\\mathrm{H}_{2}\\mathrm{O}} \\cdot n$$",
    )
    expect(renderEquationAsLatex("c = (n * M_NaCl) / V")).toBe(
      "$$c = \\frac{n \\times M_{\\mathrm{NaCl}}}{V}$$",
    )
  })

  it("leaves a parenthesised expression after a molar mass alone", () => {
    // Only a chemical group is part of the identifier — `(a + b)` is not one.
    expect(renderEquationAsLatex("m = M_x(a+b)")).toBe(
      "$$m = M_{\\mathrm{x}}\\left(a + b\\right)$$",
    )
  })

  it("renders a bullet as multiplication outside a molar mass", () => {
    expect(renderEquationAsLatex("V = n ∙ 22,4")).toBe("$$V = n \\cdot 22.4$$")
  })

  it("still parses dot decimals", () => {
    expect(renderEquationAsLatex("V = n * 22.4")).toBe("$$V = n \\times 22.4$$")
  })

  it("renders a monohydrate with no explicit count", () => {
    expect(renderEquationAsLatex("m = M_CaSO_4_H_2O")).toBe(
      "$$m = M_{\\mathrm{CaSO}_{4} \\cdot \\mathrm{H}_{2}\\mathrm{O}}$$",
    )
  })

  it("never emits a double subscript, which KaTeX rejects", () => {
    for (const formula of ["M_CuSO_4_5H_2O", "M_Ca_3_PO4_2", "M_H_2SO_4", "M_H_2O", "M_KOH"]) {
      expect(renderEquationAsLatex(`m = ${formula}`)).not.toMatch(/_\{\d+\}_\{/)
    }
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

  it("renders a placeholder as its bare name", () => {
    expect(renderEquationAsLatex("m = [[MASS]] * 2")).toBe("$$m = \\mathrm{MASS} \\times 2$$")
    expect(renderEquationAsLatex("m = [[MASS=5]] * 2")).toBe("$$m = \\mathrm{MASS} \\times 2$$")
    expect(renderEquationAsLatex("n = m / M_[[LATKA]]")).toBe(
      "$$n = \\frac{m}{M_{\\mathrm{LATKA}}}$$",
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

  it("renders a scientific-notation literal as times-10-to-the-power, not raw 'e' text", () => {
    // String(7.2e-10) is "7.2e-10" — buildSubstitutedEquation embeds sampled
    // values with String(value), so this exact form is what a tiny/huge
    // constant (e.g. a Ka) looks like once substituted into equation text.
    expect(renderEquationAsLatex("x = 7.2e-10 + 1")).toBe("$$x = 7.2 \\times 10^{-10} + 1$$")
  })

  it("does not fall back to \\text{} for an equation containing scientific notation", () => {
    // Before the tokenizer accepted "e" exponents, "7.2e-10" split into the
    // number 7.2, identifier "e" (the Euler's-number constant), and "-10" —
    // an unparseable sequence that made renderSingleEquationAsLatex give up
    // and dump the raw formula as literal \text{} instead of real math.
    const rendered = renderEquationAsLatex(
      "wDsc = 100*(-7.2e-10 + sqrt(7.2e-10^2 + 4*7.2e-10*975))/(2*975)",
    )
    expect(rendered).not.toContain("\\text{wDsc")
    expect(rendered).toContain("\\sqrt")
    expect(rendered).toContain("10^{-10}")
  })

  it("parenthesizes a scientific-notation base before squaring it", () => {
    // 7.2e-10^2 must read as "(7.2 * 10^-10) squared", not two exponents
    // stacked with nothing to separate them ("10^{-10}^{2}" renders as one
    // run "-10, 2" — indistinguishable from a typo).
    expect(renderEquationAsLatex("x = 7.2e-10^2")).toBe(
      "$$x = {\\left(7.2 \\times 10^{-10}\\right)}^{2}$$",
    )
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

  it("evaluates a scientific-notation literal as one number, not number*e-number", () => {
    // Before the fix, "7.2e-10" tokenized as 7.2, identifier "e" (the
    // constant Euler's number), then "-10" — silently computing
    // 7.2*Math.E - 10 (~9.57) instead of the intended 7.2 * 10^-10.
    expect(evaluateExpression("7.2e-10")).toBeCloseTo(7.2e-10, 20)
    expect(evaluateExpression("1e-10 + 1e-10")).toBeCloseTo(2e-10, 20)
    expect(evaluateExpression("6.022e23 / 2")).toBeCloseTo(3.011e23, 15)
  })

  it("evaluates a bullet as multiplication", () => {
    expect(evaluateExpression("2 ∙ 3")).toBe(6)
  })

  it("evaluates molar masses with bracketed groups", () => {
    expect(evaluateExpression("M_Ca(OH)2")).toBeCloseTo(74.1, 2)
    expect(evaluateExpression("M_Ca(OH)2 * 2")).toBeCloseTo(148.2, 2)
    expect(evaluateExpression("m / M_Al2(SO4)3", { m: 342.15 })).toBeCloseTo(1, 2)
  })

  it("evaluates every hydrate notation to the same mass", () => {
    const forms = ["M_CuSO4.5H2O", "M_CuSO4*5H2O", "M_CuSO4·5H2O", "M_CuSO4∙5H2O", "M_CuSO_4_5H_2O"]
    const values = forms.map((form) => evaluateExpression(form))
    for (const value of values) {
      expect(value).toBeCloseTo(249.71, 2)
    }
  })

  it("evaluates a bracketed group and a hydrate together", () => {
    expect(evaluateExpression("M_KAl(SO4)2·12H2O")).toBeCloseTo(474.44, 2)
  })
})

describe("evaluateAllAssignments", () => {
  it("returns every named target in order, not just the last", () => {
    // Reported bug: the "Testovací výsledek" preview (question-detail-dialog's
    // mockResult fallback, used whenever real server generation fails) only
    // ever showed evaluateExpression's single return value — the LAST named
    // target — silently dropping every earlier one for a multi-answer
    // formula like "c = ...; wDsc = ...".
    const result = evaluateAllAssignments(
      "c = 10^(2*pH-28)/Kb + 10^(pH-14); wDsc = 100*10^(pH-14)/c",
      {
        pH: 4.7,
        Kb: 4e-7,
      },
    )
    expect(result.map((r) => r.symbol)).toEqual(["c", "wDsc"])
    expect(result[0].value).toBeCloseTo(5.0182e-10, 13)
    expect(result[1].value).toBeCloseTo(99.87, 1)
  })

  it("returns a single-item array for a formula with one target", () => {
    expect(evaluateAllAssignments("a = 2 + 3")).toEqual([{ symbol: "a", value: 5 }])
  })

  it("returns an empty array for an unnamed expression", () => {
    expect(evaluateAllAssignments("2 + 3")).toEqual([])
  })

  it("later targets can reference earlier ones", () => {
    const result = evaluateAllAssignments("ms = mr * 2; mv = mr - ms", { mr: 100 })
    expect(result).toEqual([
      { symbol: "ms", value: 200 },
      { symbol: "mv", value: -100 },
    ])
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

  it("does not flag molar masses with bracketed groups or hydrates", () => {
    for (const formula of [
      "M_Ca(OH)2",
      "M_Al2(SO4)3",
      "M_[Cu(NH3)4]SO4",
      "M_Al2[SO4]3",
      "M_FeSO4.7H2O",
      "M_NiCl2*6H2O",
      "M_KAl(SO4)2·12H2O",
      "M_CuSO4∙5H2O",
    ]) {
      expect(validateEquationReferences(`m = n * ${formula}`, [{ placeholder: "n" }])).toEqual([])
    }
  })

  it("does not flag a string placeholder naming the substance", () => {
    expect(
      validateEquationReferences("n = m / M_[[LATKA]]", [
        { placeholder: "m" },
        { placeholder: "LATKA", varType: "string" },
      ]),
    ).toEqual([])
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
    expect(formatNumberMaxDecimals(0.1, 3)).toBe("0.1")
    expect(formatNumberMaxDecimals(0)).toBe("0")
  })
})

describe("formatSignificantDigits", () => {
  it("rounds to the requested number of significant digits in plain notation", () => {
    expect(formatSignificantDigits(0.246806, 6)).toBe("0.246806")
    expect(formatSignificantDigits(0.18, 6)).toBe("0.180000")
    expect(formatSignificantDigits(123.456, 4)).toBe("123.5")
  })

  it("uses scientific notation for very small values", () => {
    expect(formatSignificantDigits(0.05, 6)).toBe("5.00000×10^-2")
    expect(formatSignificantDigits(0.00123, 3)).toBe("1.23×10^-3")
  })

  it("uses scientific notation for very large values", () => {
    expect(formatSignificantDigits(1.524e25, 3)).toBe("1.52×10^25")
  })

  it("forces scientific notation for ALL values when forceScientific is true", () => {
    expect(formatSignificantDigits(0.18, 6, true)).toBe("1.80000×10^-1")
    expect(formatSignificantDigits(0.05, 6, true)).toBe("5.00000×10^-2")
    expect(formatSignificantDigits(722, 6, true)).toBe("7.22000×10^2")
    expect(formatSignificantDigits(123.456, 4, true)).toBe("1.235×10^2")
  })

  it("handles zero", () => {
    expect(formatSignificantDigits(0, 6)).toBe("0.00000")
    expect(formatSignificantDigits(0, 3)).toBe("0.00")
  })

  it("handles null and non-finite values", () => {
    expect(formatSignificantDigits(null, 3)).toBe("")
    expect(formatSignificantDigits(undefined, 3)).toBe("")
    expect(formatSignificantDigits(Number.NaN, 3)).toBe("")
  })

  it("rounds large numbers to the correct magnitude when sig digits < integer digits", () => {
    expect(formatSignificantDigits(111554, 2)).toBe("110000")
    expect(formatSignificantDigits(111554, 3)).toBe("112000")
    expect(formatSignificantDigits(111554, 4)).toBe("111600")
    expect(formatSignificantDigits(111554, 5)).toBe("111550")
    expect(formatSignificantDigits(111554, 6)).toBe("111554")
    expect(formatSignificantDigits(111554, 7)).toBe("111554.0")
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

  function makeNumericVar(symbol: string, placeholder = symbol): VariableWithPlaceholder {
    return {
      placeholder,
      isShared: false,
      variable: {
        id: symbol,
        name: symbol,
        symbol,
        varType: "numeric",
        minValue: 0,
        maxValue: 0,
        step: 1,
        unit: "",
        precision: 0,
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

  it("substitutes a sampled scientific-notation value in String(value) form", () => {
    // A degenerate numeric range (min === max, e.g. a fixed Ka) samples to
    // exactly that value; String(7.2e-10) is "7.2e-10", not "0.00000000072".
    const result = buildSubstitutedEquation(
      "wDsc = 100 * (-Ka + sqrt(Ka^2 + 4*Ka*c)) / (2*c)",
      [makeNumericVar("Ka"), makeNumericVar("c")],
      { Ka: 7.2e-10, c: 975 },
      {},
      {},
    )
    expect(result).toContain("7.2e-10")
  })

  it("substitutes a symbol injected by a string variable's paired constants", () => {
    // Reproduces the reported bug: "Ka" isn't its own declared variable, it's
    // only ever introduced via wac's pairedConstants and referenced in the
    // question/formula as "[[Ka=wac]]" / bare "Ka". Before this fix, neither
    // the bracket form nor the bare formula identifier ever substituted,
    // because "Ka" wasn't registered as a known symbol at all.
    const wac: VariableWithPlaceholder = {
      placeholder: "wac",
      isShared: false,
      variable: {
        id: "1",
        name: "wac",
        symbol: "wac",
        varType: "string",
        minValue: 0,
        maxValue: 0,
        step: 1,
        unit: "",
        precision: 0,
        stringValues: ["CH_3COOH", "kyselina citrónové"],
        pairedConstants: [{ Ka: 1.75e-5 }, { Ka: 8.6e-4 }],
        createdAt: "",
      } as Variable,
    }
    const result = buildSubstitutedEquation(
      "wDsc = 100 * (-Ka + sqrt(Ka^2 + 4*Ka*c)) / (2*c)",
      [wac, makeNumericVar("c")],
      { Ka: 1.75e-5, c: 0.1 },
      { wac: "CH_3COOH" },
      {},
      "Vypočítejte stupeň disociace [[wac]] v [[c]] M roztoku. (Ka = [[Ka=wac]]).",
    )
    expect(result).not.toMatch(/(?<![A-Za-z0-9_])Ka(?![A-Za-z0-9_])/)
    expect(result).toContain("0.0000175")
  })
})

describe("evaluateVariantAnswer with scientific-notation constants", () => {
  const makeVariant = (assignedValues: Record<string, number>): Variant => ({
    id: "v1",
    templateId: "t1",
    assignedValues,
    correctAnswer: 0,
    seed: 1,
    createdAt: "",
  })

  function makeNumericVar(symbol: string): VariableWithPlaceholder {
    return {
      placeholder: symbol,
      isShared: false,
      variable: {
        id: symbol,
        name: symbol,
        symbol,
        varType: "numeric",
        minValue: 0,
        maxValue: 0,
        step: 1,
        unit: "",
        precision: 0,
        createdAt: "",
      } as Variable,
    }
  }

  it("computes the dissociation degree for a tiny fixed Ka without erroring", () => {
    // Reproduces the reported bug exactly: HCN's Ka (7.2e-10) substituted
    // into the dissociation-degree formula used to throw during parsing
    // (the LaTeX preview fell back to raw \text{}) because the tokenizer
    // split "7.2e-10" into 7.2, the constant "e", and "-10".
    const result = evaluateVariantAnswer(
      "wDsc = 100 * (-Ka + sqrt(Ka^2 + 4*Ka*c)) / (2*c)",
      [makeNumericVar("Ka"), makeNumericVar("c")],
      makeVariant({ Ka: 7.2e-10, c: 975 }),
      {},
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBeCloseTo(8.593e-5, 7)
    }
  })
})
