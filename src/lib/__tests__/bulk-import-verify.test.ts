import { describe, expect, it } from "vitest"
import {
  pairFormulasWithQuestions,
  parseBulkImport,
  parseFormulaText,
} from "@/lib/bulk-import-parser"
import { describeFailedChecks, verifyExpectedAnswers } from "@/lib/bulk-import-verify"

function importPair(questions: string, formulas: string) {
  const parsed = parseBulkImport(questions)
  return pairFormulasWithQuestions(parsed.data, parseFormulaText(formulas)).data
}

describe("verifyExpectedAnswers", () => {
  it("passes a formula that reproduces the printed answer", () => {
    const data = importPair(
      `pH
2 body
Sada 1
Vypočítejte pH roztoku kyseliny sírové o koncentraci [[c=0.89]] mmol.l-1. [pH = 2.75]`,
      `2 body
Sada 1
pH = -log(2 * c / 1000)`,
    )

    const checks = verifyExpectedAnswers(data)
    expect(checks).toHaveLength(1)
    expect(checks[0].ok).toBe(true)
    expect(checks[0].actual).toBeCloseTo(2.75, 2)
    expect(describeFailedChecks(checks)).toEqual([])
  })

  it("catches a constant that disagrees with the printed answer", () => {
    // From the source assignment: the marked version of this question states
    // Ka = 1.8e-5 (pKa 4.745), the student wording states 1.74e-5 (pKa 4.760).
    const data = importPair(
      `pH
2 body
Sada 1
Jaké je pH roztoku, obsahujícího [[ck=37.3]] mM kyselinu octovou a [[cs=162]] mM octan sodný? [pH = 5.383]`,
      `2 body
Sada 1
pH = 4.756 + log(cs / ck)`,
    )

    const checks = verifyExpectedAnswers(data)
    expect(checks[0].ok).toBe(false)
    expect(checks[0].actual).toBeCloseTo(5.394, 3)
    expect(describeFailedChecks(checks)[0]).toContain("očekáváno 5.383")
  })

  it("reports a formula that cannot be evaluated", () => {
    const data = importPair(
      `pH
2 body
Sada 1
Vypočítejte pH roztoku o koncentraci [[c=0.89]] mmol.l-1. [pH = 2.75]`,
      `2 body
Sada 1
pH = -log(2 * cx / 1000)`,
    )

    const checks = verifyExpectedAnswers(data)
    expect(checks[0].ok).toBe(false)
    expect(checks[0].actual).toBeUndefined()
    expect(describeFailedChecks(checks)[0]).toContain("nelze vyhodnotit")
  })

  it("checks every answer of a multi-target question", () => {
    const data = importPair(
      `pH
4 body
Sada 3
Disociační konstanta zásady je [[Kb=4.0e-7]], pH roztoku je [[pH=10.027]]. [c = 0.028][alpha = 0.376]`,
      `4 body
Sada 3
c = (10^(2*(pH - 14)))/Kb ; alpha = 100 * 10^(pH - 14) / c`,
    )

    const checks = verifyExpectedAnswers(data)
    expect(checks.map((check) => check.target)).toEqual(["c", "alpha"])
    expect(checks.every((check) => check.ok)).toBe(true)
  })

  it("skips questions with no known answer, no formula, or an open range", () => {
    const data = importPair(
      `pH
2 body
Sada 1
Bez výsledku, ale se vzorcem [[c=0.89]]. [pH]
Výsledek bez vzorce [[c=0.89]]. [pH = 2.75]
Rozsah místo pevné hodnoty [[c]]. [pH = 2.75]`,
      `2 body
Sada 1
pH = -log(2 * c / 1000)`,
    )

    expect(verifyExpectedAnswers(data)).toEqual([])
  })

  it("resolves molar masses and constants in the formula", () => {
    const data = importPair(
      `pH
3 body
Sada 1
Vypočítejte hmotnost NaOH pro [[V=28.7]] l o pH [[pH=11.2]]. [m = 1.82 g]`,
      `3 body
Sada 1
m = 10^(pH - 14) * V * M_NaOH`,
    )

    const checks = verifyExpectedAnswers(data)
    expect(checks[0].ok).toBe(true)
    expect(checks[0].actual).toBeCloseTo(1.82, 2)
  })
})
