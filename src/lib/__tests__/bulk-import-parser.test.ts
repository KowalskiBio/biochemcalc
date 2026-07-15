import { describe, expect, it } from "vitest"
import {
  normalizeFormulaForEvaluation,
  pairFormulasWithQuestions,
  parseBulkImportText,
  parseFormulaText,
} from "@/lib/bulk-import-parser"

const sampleInput = `Hmotnostní a objemové procento, ředění
2 body
2_1
Jaký je hmotnostní zlomek [[sK]][[sA]] v roztoku, který vznikl rozpuštěním [[ms]] g této látky ve [[mv]] g vody? [w]
Jaký je hmotnostní zlomek [[KK]][[AA]] v roztoku, jehož [[mr]] g obsahuje [[ms]] g [[KK]][[AA]]? [w]
2_2
Kolik gramů [[molekula2]] je nutno rozpustit ve [[mv]] litrech vody, abychom získali [[wperc]] roztok? [ms]
3 body
3_1
Jaký je hmotnostní zlomek [[KK]][[AA]] v roztoku, který vznikl z [[m1]] g vodného roztoku [[KK]][[AA]], ve kterém byl w([[KK]][[AA]]) = [[w1]], bylo-li do soustavy přidáno [[m2]] g vody? [w2]
`

describe("parseBulkImportText", () => {
  it("extracts the topic name from the first line", () => {
    const result = parseBulkImportText(sampleInput)
    expect(result.topicName).toBe("Hmotnostní a objemové procento, ředění")
  })

  it("groups questions by point value", () => {
    const result = parseBulkImportText(sampleInput)
    expect(result.categories).toHaveLength(2)
    expect(result.categories[0].pointValue).toBe(2)
    expect(result.categories[1].pointValue).toBe(3)
  })

  it("groups questions by set index", () => {
    const result = parseBulkImportText(sampleInput)
    expect(result.categories[0].sets).toHaveLength(2)
    expect(result.categories[0].sets[0].setIndex).toBe(1)
    expect(result.categories[0].sets[1].setIndex).toBe(2)
  })

  it("parses question text and preserves placeholders", () => {
    const result = parseBulkImportText(sampleInput)
    const question = result.categories[0].sets[0].questions[0]
    expect(question.questionText).toContain("[[ms]]")
    expect(question.questionText).toContain("[[mv]]")
  })

  it("extracts single targets", () => {
    const result = parseBulkImportText(sampleInput)
    const question = result.categories[0].sets[0].questions[0]
    expect(question.targets).toEqual(["w"])
  })

  it("extracts multi-target questions", () => {
    const input = `Topic\n2 body\n2_1\nQuestion with [[V1]] and [[V2]]? [V1][V2]`
    const result = parseBulkImportText(input)
    expect(result.categories[0].sets[0].questions[0].targets).toEqual(["V1", "V2"])
  })

  it("infers numeric units from context", () => {
    const result = parseBulkImportText(sampleInput)
    const question = result.categories[0].sets[0].questions[0]
    const ms = question.variables.find((v) => v.symbol === "ms")
    const mv = question.variables.find((v) => v.symbol === "mv")
    expect(ms?.varType).toBe("numeric")
    expect(ms?.unit).toBe("g")
    expect(mv?.unit).toBe("g")
  })

  it("treats salt-name placeholders as string variables", () => {
    const result = parseBulkImportText(sampleInput)
    const question = result.categories[0].sets[0].questions[0]
    const sK = question.variables.find((v) => v.symbol === "sK")
    const sA = question.variables.find((v) => v.symbol === "sA")
    expect(sK?.varType).toBe("string")
    expect(sA?.varType).toBe("string")
    expect(sK?.stringValues).toEqual(["sK"])
  })

  it("creates default numeric ranges", () => {
    const result = parseBulkImportText(sampleInput)
    const question = result.categories[0].sets[0].questions[0]
    const ms = question.variables.find((v) => v.symbol === "ms")
    expect(ms?.minValue).toBe(1)
    expect(ms?.maxValue).toBe(1000)
    expect(ms?.step).toBe(1)
  })

  it("handles empty input gracefully", () => {
    const result = parseBulkImportText("")
    expect(result.topicName).toBe("")
    expect(result.categories).toEqual([])
  })

  it("treats imperative sentences ending with a target block as questions", () => {
    const input = `Topic
2 body
2_1
Ve [[mr]] g roztoku [[sK]][[sA]] je rozpuštěno [[ms]] g této látky. Vypočítejte hmotnostní procento [[sK]][[sA]]. [wperc]
[[ms]] g [[sK]][[sA]] bylo rozpuštěno ve [[mv]] g vody. Vypočtěte procento. [wperc]
Kolik gramů [[molekula2]] je nutno rozpustit? [ms]`
    const result = parseBulkImportText(input)
    expect(result.categories[0].sets[0].questions).toHaveLength(3)
    expect(result.categories[0].sets[0].questions[0].targets).toEqual(["wperc"])
    expect(result.categories[0].sets[0].questions[2].targets).toEqual(["ms"])
  })
})

describe("parseFormulaText", () => {
  it("parses formula document with set headers", () => {
    const formulaText = `2_1
w = ms / (ms + mv)
w = ms / mr
2_2
wperc = ms / mr * 100`

    const result = parseFormulaText(formulaText)
    expect(result["2_1"]).toEqual(["w = ms / (ms + mv)", "w = ms / mr"])
    expect(result["2_2"]).toEqual(["wperc = ms / mr * 100"])
  })

  it("skips empty lines", () => {
    const formulaText = `2_1

w = ms / (ms + mv)

w = ms / mr`

    const result = parseFormulaText(formulaText)
    expect(result["2_1"]).toEqual(["w = ms / (ms + mv)", "w = ms / mr"])
  })

  it("handles empty input", () => {
    const result = parseFormulaText("")
    expect(result).toEqual({})
  })

  it("handles document with only whitespace", () => {
    const result = parseFormulaText("   \n   \n   ")
    expect(result).toEqual({})
  })
})

describe("normalizeFormulaForEvaluation", () => {
  it("converts square brackets to parentheses", () => {
    expect(normalizeFormulaForEvaluation("w = [ms + mv]")).toBe("w = (ms + mv)")
  })

  it("converts commas to periods", () => {
    expect(normalizeFormulaForEvaluation("w = 1,5")).toBe("w = 1.5")
  })

  it("converts minus sign (⁻) to hyphen", () => {
    expect(normalizeFormulaForEvaluation("x⁻¹")).toBe("x-1")
  })

  it("converts multiplication sign (×) to asterisk", () => {
    expect(normalizeFormulaForEvaluation("a × b")).toBe("a * b")
  })

  it("handles multiple conversions", () => {
    const result = normalizeFormulaForEvaluation("w = [ms + mv] × 1,5⁻¹")
    expect(result).toBe("w = (ms + mv) * 1.5-1")
  })
})

describe("pairFormulasWithQuestions", () => {
  it("pairs formulas with questions when counts match", () => {
    const sampleInput = `Test Topic
2 body
2_1
Jaký je hmotnostní zlomek [[ms]]? [w]
Jaký je objem [[mv]]? [v]`

    const parsedData = parseBulkImportText(sampleInput)
    const formulaMap = parseFormulaText(`2_1
w = ms / mr
v = mv / mt`)

    const result = pairFormulasWithQuestions(parsedData, formulaMap)

    expect(result.warnings).toEqual([])
    expect(result.data.categories[0].sets[0].questions[0].equationText).toBe("w = ms / mr")
    expect(result.data.categories[0].sets[0].questions[0].formula).toBe("w = ms / mr")
    expect(result.data.categories[0].sets[0].questions[1].equationText).toBe("v = mv / mt")
    expect(result.data.categories[0].sets[0].questions[1].formula).toBe("v = mv / mt")
  })

  it("normalizes formulas when pairing", () => {
    const sampleInput = `Test Topic
2 body
2_1
Jaký je hmotnostní zlomek [[ms]]? [w]`

    const parsedData = parseBulkImportText(sampleInput)
    const formulaMap = parseFormulaText(`2_1
w = [ms + mv] × 1,5`)

    const result = pairFormulasWithQuestions(parsedData, formulaMap)

    expect(result.data.categories[0].sets[0].questions[0].equationText).toBe("w = [ms + mv] × 1,5")
    expect(result.data.categories[0].sets[0].questions[0].formula).toBe("w = (ms + mv) * 1.5")
  })

  it("adds warning when some formulas cannot be matched to targets", () => {
    const sampleInput = `Test Topic
2 body
2_1
Jaký je hmotnostní zlomek [[ms]]? [w]
Jaký je objem [[mv]]? [v]
Jaká je hustota [[rho]]? [rho]`

    const parsedData = parseBulkImportText(sampleInput)
    const formulaMap = parseFormulaText(`2_1
w = ms / mr
v = mv / mt
extra = 1 + 1`)

    const result = pairFormulasWithQuestions(parsedData, formulaMap)

    expect(result.warnings).toEqual(["Sada 2_1: 3 otázky, 3 vzorce — 1 vzorců nebylo spárováno."])
    expect(result.data.categories[0].sets[0].questions[0].equationText).toBe("w = ms / mr")
    expect(result.data.categories[0].sets[0].questions[0].formula).toBe("w = ms / mr")
    expect(result.data.categories[0].sets[0].questions[2].equationText).toBe("")
    expect(result.data.categories[0].sets[0].questions[2].formula).toBe("")
  })

  it("does not mutate original data", () => {
    const sampleInput = `Test Topic
2 body
2_1
Jaký je hmotnostní zlomek [[ms]]? [w]`

    const parsedData = parseBulkImportText(sampleInput)
    const originalFormula = parsedData.categories[0].sets[0].questions[0].formula

    const formulaMap = parseFormulaText(`2_1
w = ms / mr`)
    const result = pairFormulasWithQuestions(parsedData, formulaMap)

    expect(parsedData.categories[0].sets[0].questions[0].formula).toBe(originalFormula)
    expect(result.data.categories[0].sets[0].questions[0].formula).toBe("w = ms / mr")
  })

  it("handles missing set in formula map", () => {
    const sampleInput = `Test Topic
2 body
2_1
Jaký je hmotnostní zlomek [[ms]]? [w]
2_2
Jaký je objem [[mv]]? [v]`

    const parsedData = parseBulkImportText(sampleInput)
    const formulaMap = parseFormulaText(`2_1
w = ms / mr`)

    const result = pairFormulasWithQuestions(parsedData, formulaMap)

    expect(result.warnings).toEqual([])
    expect(result.data.categories[0].sets[0].questions[0].formula).toBe("w = ms / mr")
    expect(result.data.categories[0].sets[1].questions[0].formula).toBe("")
  })

  it("matches multiple formulas to a multi-target question", () => {
    const sampleInput = `Test Topic
4 body
4_4
Vypočítejte objemy [[V1]] a [[V2]]. [V1][V2]
Vypočítejte hmotnosti [[ms]] a [[mv]]. [ms][mv]`

    const parsedData = parseBulkImportText(sampleInput)
    const formulaMap = parseFormulaText(`4_4
V1 = a + b
V2 = a - b
ms = mr * w
mv = mr - ms`)

    const result = pairFormulasWithQuestions(parsedData, formulaMap)

    expect(result.warnings).toEqual([])
    expect(result.data.categories[0].sets[0].questions[0].equationText).toBe(
      "V1 = a + b\nV2 = a - b",
    )
    expect(result.data.categories[0].sets[0].questions[0].formula).toBe("V1 = a + b\nV2 = a - b")
    expect(result.data.categories[0].sets[0].questions[1].equationText).toBe(
      "ms = mr * w\nmv = mr - ms",
    )
  })

  it("supports placeholders with underscores", () => {
    const sampleInput = `Test Topic
2 body
2_1
Jaká je hustota [[rho_r]] a [[rho_s]]? [rho_r]`

    const parsedData = parseBulkImportText(sampleInput)
    const rhoR = parsedData.categories[0].sets[0].questions[0].variables.find(
      (v) => v.symbol === "rho_r",
    )
    const rhoS = parsedData.categories[0].sets[0].questions[0].variables.find(
      (v) => v.symbol === "rho_s",
    )
    expect(rhoR).toBeDefined()
    expect(rhoS).toBeDefined()
  })
})
