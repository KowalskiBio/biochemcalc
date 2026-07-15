import { describe, expect, it } from "vitest"
import {
  buildFormulaPayload,
  getEquationKey,
  getUniqueQuestionTexts,
  groupTemplatesByEquation,
} from "@/lib/formula-grouping"
import type { Template } from "@/lib/types"

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: "id",
    questionText: "question",
    formula: "",
    equationText: "",
    resultUnit: "",
    pointValue: 2,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe("getEquationKey", () => {
  it("returns trimmed equationText when present", () => {
    const template = makeTemplate({
      equationText: "  w = ms / mr ",
      formula: "ms/mr",
    })
    expect(getEquationKey(template)).toBe("w = ms / mr")
  })

  it("falls back to formula when equationText is empty", () => {
    const template = makeTemplate({ equationText: "", formula: "  ms/mr " })
    expect(getEquationKey(template)).toBe("ms/mr")
  })

  it("returns empty string when both are empty", () => {
    const template = makeTemplate({ equationText: "", formula: "" })
    expect(getEquationKey(template)).toBe("")
  })
})

describe("groupTemplatesByEquation", () => {
  it("groups templates by normalized equationText", () => {
    const templates = [
      makeTemplate({ id: "1", equationText: "w = ms / mr" }),
      makeTemplate({ id: "2", equationText: "w = ms / mr" }),
      makeTemplate({ id: "3", equationText: "v = V / Vt" }),
    ]
    const groups = groupTemplatesByEquation(templates)
    expect(groups.get("w=ms/mr")?.length).toBe(2)
    expect(groups.get("v=V/Vt")?.length).toBe(1)
  })

  it("groups equivalent equations that differ only by formatting", () => {
    const templates = [
      makeTemplate({ id: "1", equationText: "N = (V / 22,4) * NA — (NA = Avogadrova konstanta)" }),
      makeTemplate({ id: "2", equationText: "N=(V/22.4)*NA" }),
      makeTemplate({ id: "3", equationText: "N = [V / 22.4] × NA" }),
    ]
    const groups = groupTemplatesByEquation(templates)
    expect(groups.size).toBe(1)
    expect(groups.get("N=(V/22.4)*NA")?.length).toBe(3)
  })

  it("groups equations with underscore variants of the same identifier", () => {
    const templates = [
      makeTemplate({ id: "1", equationText: "N = m / M_H_2O * NA" }),
      makeTemplate({ id: "2", equationText: "N = m / M_H2O * NA" }),
    ]
    const groups = groupTemplatesByEquation(templates)
    expect(groups.size).toBe(1)
    expect(groups.get("N=m/MH2O*NA")?.length).toBe(2)
  })

  it("skips templates with empty keys", () => {
    const templates = [
      makeTemplate({ id: "1", equationText: "", formula: "" }),
      makeTemplate({ id: "2", equationText: "w = ms / mr" }),
    ]
    const groups = groupTemplatesByEquation(templates)
    expect(groups.size).toBe(1)
    expect(groups.get("w=ms/mr")?.length).toBe(1)
  })
})

describe("getUniqueQuestionTexts", () => {
  it("returns unique question texts preserving order", () => {
    const templates = [
      makeTemplate({ id: "1", questionText: "Q1" }),
      makeTemplate({ id: "2", questionText: "Q2" }),
      makeTemplate({ id: "3", questionText: "Q1" }),
      makeTemplate({ id: "4", questionText: "Q2" }),
    ]
    expect(getUniqueQuestionTexts(templates)).toEqual(["Q1", "Q2"])
  })

  it("ignores empty question texts", () => {
    const templates = [
      makeTemplate({ id: "1", questionText: "" }),
      makeTemplate({ id: "2", questionText: "Q1" }),
    ]
    expect(getUniqueQuestionTexts(templates)).toEqual(["Q1"])
  })

  it("returns empty array for empty input", () => {
    expect(getUniqueQuestionTexts([])).toEqual([])
  })
})

describe("buildFormulaPayload", () => {
  it("returns formula equal to equationText", () => {
    const result = buildFormulaPayload("w = ms / mr")
    expect(result.formula).toBe("w = ms / mr")
    expect(result.equationText).toBe("w = ms / mr")
  })
})
