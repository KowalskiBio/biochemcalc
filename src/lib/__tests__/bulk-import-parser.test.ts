import { describe, expect, it } from "vitest"
import {
  normalizeFormulaForEvaluation,
  pairFormulasWithQuestions,
  parseBulkImportText,
  parseFormulaText,
} from "@/lib/bulk-import-parser"
import { KNOWN_ELEMENTS } from "@/lib/periodic-table-data"

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

  it("falls back to symbol-based units when context gives none", () => {
    const input = `Topic
4 body
4_1
Question with [[pH]] and [[c1]]? [c1]`
    const result = parseBulkImportText(input)
    const question = result.categories[0].sets[0].questions[0]
    const pH = question.variables.find((v) => v.symbol === "pH")
    const c1 = question.variables.find((v) => v.symbol === "c1")
    expect(pH?.unit).toBe("")
    expect(c1?.unit).toBe("mol/l")
  })

  it("infers dimensionless units for equilibrium constants", () => {
    const input = `Topic
4 body
4_1
Hodnota [[Ka=1.8*10^-5]]. [x]`
    const result = parseBulkImportText(input)
    const question = result.categories[0].sets[0].questions[0]
    const ka = question.variables.find((v) => v.symbol === "Ka")
    expect(ka?.unit).toBe("")
  })

  it("infers volume units for V symbols", () => {
    const input = `Topic
4 body
4_1
Question with [[V1]]? [V1]`
    const result = parseBulkImportText(input)
    const question = result.categories[0].sets[0].questions[0]
    const V1 = question.variables.find((v) => v.symbol === "V1")
    expect(V1?.unit).toBe("l")
  })

  it("infers density units for rho symbols", () => {
    const input = `Topic
4 body
4_1
Question with [[rho_r]]? [rho_r]`
    const result = parseBulkImportText(input)
    const question = result.categories[0].sets[0].questions[0]
    const rho = question.variables.find((v) => v.symbol === "rho_r")
    expect(rho?.unit).toBe("g.cm-3")
  })

  it("treats salt-name placeholders as string variables", () => {
    const result = parseBulkImportText(sampleInput)
    const question = result.categories[0].sets[0].questions[0]
    const sK = question.variables.find((v) => v.symbol === "sK")
    const sA = question.variables.find((v) => v.symbol === "sA")
    expect(sK?.varType).toBe("string")
    expect(sA?.varType).toBe("string")
    expect(sK?.stringValues).toEqual(["Li", "Na", "K", "Rb", "Cs"])
    expect(sA?.stringValues).toEqual(["F", "Cl", "Br", "I"])
  })

  it("provides default values for KK/AA placeholders", () => {
    const input = `Topic
2 body
2_1
Question with [[KK]] and [[AA]]? [x]`
    const result = parseBulkImportText(input)
    const question = result.categories[0].sets[0].questions[0]
    const KK = question.variables.find((v) => v.symbol === "KK")
    const AA = question.variables.find((v) => v.symbol === "AA")
    expect(KK?.varType).toBe("string")
    expect(AA?.varType).toBe("string")
    expect(KK?.stringValues).toEqual(["Mg", "Ca", "Sr", "Ba", "Zn", "Cu"])
    expect(AA?.stringValues).toEqual(["O", "S", "SO4", "CO3"])
  })

  it("falls back to symbol name for string symbols without defaults", () => {
    const input = `Topic\n2 body\n2_1\nQuestion with [[molekula2]]? [x]`
    const result = parseBulkImportText(input)
    const question = result.categories[0].sets[0].questions[0]
    const mol = question.variables.find((v) => v.symbol === "molekula2")
    expect(mol?.varType).toBe("string")
    expect(mol?.stringValues).toEqual(["molekula2"])
  })

  it("prefers databaze entries over defaults when provided", () => {
    const customEntries = [{ id: "1", code: "sK", values: ["Custom1", "Custom2"], createdAt: "" }]
    const result = parseBulkImportText(sampleInput, customEntries)
    const question = result.categories[0].sets[0].questions[0]
    const sK = question.variables.find((v) => v.symbol === "sK")
    expect(sK?.stringValues).toEqual(["Custom1", "Custom2"])
  })

  it("provides default values for sKK/sAA placeholders", () => {
    const input = `Topic\n2 body\n2_1\nQuestion with [[sKK]] and [[sAA]]? [x]`
    const result = parseBulkImportText(input)
    const question = result.categories[0].sets[0].questions[0]
    const sKK = question.variables.find((v) => v.symbol === "sKK")
    const sAA = question.variables.find((v) => v.symbol === "sAA")
    expect(sKK?.varType).toBe("string")
    expect(sAA?.varType).toBe("string")
    expect(sKK?.stringValues).toEqual(["Mg", "Ca", "Sr", "Ba"])
    expect(sAA?.stringValues).toEqual(["O", "S", "SO4"])
  })

  it("creates default numeric ranges", () => {
    const result = parseBulkImportText(sampleInput)
    const question = result.categories[0].sets[0].questions[0]
    const ms = question.variables.find((v) => v.symbol === "ms")
    expect(ms?.minValue).toBe(1)
    expect(ms?.maxValue).toBe(1000)
    expect(ms?.step).toBe(1)
  })

  it("treats mass fraction w as a dimensionless value between 0 and 1", () => {
    const input = `Topic\n2 body\n2_1\nHmotnostní zlomek je [[w]]. [x]`
    const result = parseBulkImportText(input)
    const question = result.categories[0].sets[0].questions[0]
    const w = question.variables.find((v) => v.symbol === "w")
    expect(w?.varType).toBe("numeric")
    expect(w?.minValue).toBe(0.1)
    expect(w?.maxValue).toBe(0.9)
    expect(w?.step).toBe(0.1)
    expect(w?.precision).toBe(1)
    expect(w?.unit).toBe("—")
  })

  it("treats atom placeholders as string variables with all known elements", () => {
    const input = `Topic\n2 body\n2_1\nJaký je poměr atomových hmotností [[atom1]] a [[atom2]]? [w]`
    const result = parseBulkImportText(input)
    const question = result.categories[0].sets[0].questions[0]
    const atom1 = question.variables.find((v) => v.symbol === "atom1")
    const atom2 = question.variables.find((v) => v.symbol === "atom2")
    expect(atom1?.varType).toBe("string")
    expect(atom2?.varType).toBe("string")
    expect(atom1?.stringValues).toEqual(KNOWN_ELEMENTS)
    expect(atom2?.stringValues).toEqual(KNOWN_ELEMENTS)
  })

  it("creates fixed numeric variables for fixed-value placeholders", () => {
    const input = `Topic\n2 body\n2_1\nHodnota [[Ka=1.8*10^-5]] a [[pKa=4.756]]. [x]`
    const result = parseBulkImportText(input)
    const question = result.categories[0].sets[0].questions[0]
    const ka = question.variables.find((v) => v.symbol === "Ka")
    const pka = question.variables.find((v) => v.symbol === "pKa")
    expect(ka?.varType).toBe("numeric")
    expect(ka?.minValue).toBe(1.8e-5)
    expect(ka?.maxValue).toBe(1.8e-5)
    expect(pka?.minValue).toBe(4.756)
  })

  it("handles empty input gracefully", () => {
    const result = parseBulkImportText("")
    expect(result.topicName).toBe("")
    expect(result.categories).toEqual([])
  })

  it("splits semicolon-separated formulas for multi-target pairing", () => {
    const sampleInput = `Topic\n4 body\n4_3\nQuestion with [[pH]]? [c][wDsc]`
    const parsedData = parseBulkImportText(sampleInput)
    const formulaMap = parseFormulaText(`4_3\nc = 10^-pH ; wDsc = 100*10^(pH-14)/c`)
    const result = pairFormulasWithQuestions(parsedData, formulaMap)

    expect(result.warnings).toEqual([])
    const question = result.data.categories[0].sets[0].questions[0]
    expect(question.equationText).toBe("c = 10^-pH; wDsc = 100*10^(pH-14)/c")
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

  it("ignores point-value headers copied into the formula section", () => {
    const formulaText = `2_4
w = 1
3 body
2_5
x = 2`

    const result = parseFormulaText(formulaText)
    expect(result["2_4"]).toEqual(["w = 1"])
    expect(result["2_5"]).toEqual(["x = 2"])
    expect(Object.values(result).flat()).not.toContain("3 body")
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

  it("strips explanatory comments after an em dash", () => {
    expect(normalizeFormulaForEvaluation("N = (V / 22,4) * NA — (NA = Avogadrova konstanta)")).toBe(
      "N = (V / 22.4) * NA ",
    )
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

    expect(result.warnings).toEqual([
      'Sada 2_1: 3 otázky, 3 vzorce — 1 vzorců nebylo spárováno: "extra = 1 + 1"',
    ])
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
      "V1 = a + b; V2 = a - b",
    )
    expect(result.data.categories[0].sets[0].questions[0].formula).toBe("V1 = a + b; V2 = a - b")
    expect(result.data.categories[0].sets[0].questions[1].equationText).toBe(
      "ms = mr * w; mv = mr - ms",
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
