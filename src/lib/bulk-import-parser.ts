import type { DatabazeEntry } from "@/lib/types"

export type BulkImportVarType = "numeric" | "string"

export interface BulkImportVariableInput {
  symbol: string
  name: string
  varType: BulkImportVarType
  minValue: number
  maxValue: number
  step: number
  unit: string
  precision: number
  stringValues?: string[]
}

export interface BulkImportQuestion {
  questionText: string
  formula: string
  equationText: string
  targets: string[]
  variables: BulkImportVariableInput[]
}

export interface BulkImportSet {
  setIndex: number
  questions: BulkImportQuestion[]
}

export interface BulkImportCategory {
  pointValue: number
  sets: BulkImportSet[]
}

export interface BulkImportData {
  topicName: string
  categories: BulkImportCategory[]
}

export type FormulaMap = Record<string, string[]>

const PLACEHOLDER_REGEX = /\[\[([a-zA-Zα-ωφ][a-zA-Z0-9_%_α-ωφ]*)\]\]/g

const TARGET_BLOCK_REGEX = /(?:\[[a-zA-Zα-ωφ][a-zA-Z0-9_%_α-ωφ]*\])+\s*$/

const TARGET_SYMBOL_REGEX = /\[([a-zA-Zα-ωφ][a-zA-Z0-9_%_α-ωφ]*)\]/g

const POINT_VALUE_REGEX = /^(\d+)\s*body\s*$/i

const SET_INDEX_REGEX = /^(\d+)_(\d+)\s*$/

const KNOWN_STRING_SYMBOLS = new Set(["sK", "sA", "KK", "AA", "sKK", "sAA", "molekula2"])

const UNIT_PATTERNS: { pattern: RegExp; unit: string }[] = [
  { pattern: /%\s*(?:obj\.|hmotnostní|hmotnostních)?/, unit: "%" },
  { pattern: /g\s*\.\s*cm\s*[-^]\s*3/, unit: "g.cm-3" },
  { pattern: /g\s*\*\s*cm\s*[-^]\s*3/, unit: "g.cm-3" },
  { pattern: /cm\s*\^\s*3|cm3/, unit: "cm3" },
  { pattern: /dm3|dm\s*\^\s*3/, unit: "dm3" },
  { pattern: /ml/, unit: "ml" },
  { pattern: /\bg\b/, unit: "g" },
  { pattern: /litrech\b/, unit: "l" },
]

function extractTargets(text: string): string[] {
  const trimmed = text.trim()
  const blockMatch = trimmed.match(TARGET_BLOCK_REGEX)
  if (!blockMatch) {
    return []
  }

  const targets: string[] = []
  for (const match of blockMatch[0].trim().matchAll(TARGET_SYMBOL_REGEX)) {
    targets.push(match[1])
  }
  return targets
}

function extractPlaceholderSymbols(text: string): string[] {
  const seen = new Set<string>()
  const symbols: string[] = []
  for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
    const symbol = match[1]
    if (!seen.has(symbol)) {
      seen.add(symbol)
      symbols.push(symbol)
    }
  }
  return symbols
}

function inferUnit(symbol: string, text: string): string {
  const regex = new RegExp(`\\[\\[${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`, "g")
  const match = regex.exec(text)
  if (!match) {
    return "—"
  }

  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40)
  for (const { pattern, unit } of UNIT_PATTERNS) {
    if (pattern.test(after)) {
      return unit
    }
  }

  return "—"
}

function inferVarType(symbol: string, unit: string): BulkImportVarType {
  if (KNOWN_STRING_SYMBOLS.has(symbol)) {
    return "string"
  }
  if (unit === "—") {
    return "numeric"
  }
  return "numeric"
}

function buildVariableInput(
  symbol: string,
  text: string,
  databazeEntries: DatabazeEntry[] = [],
): BulkImportVariableInput {
  const unit = inferUnit(symbol, text)
  const varType = inferVarType(symbol, unit)

  if (varType === "string") {
    const entry = databazeEntries.find((e) => e.code === symbol)
    return {
      symbol,
      name: symbol,
      varType,
      minValue: 0,
      maxValue: 0,
      step: 1,
      unit: "",
      precision: 0,
      stringValues: entry && entry.values.length > 0 ? entry.values : [symbol],
    }
  }

  return {
    symbol,
    name: symbol,
    varType,
    minValue: 1,
    maxValue: 1000,
    step: 1,
    unit,
    precision: 0,
  }
}

function parseQuestion(line: string, databazeEntries: DatabazeEntry[] = []): BulkImportQuestion {
  const trimmed = line.trim()
  const targets = extractTargets(trimmed)
  const symbols = extractPlaceholderSymbols(trimmed)
  const variables = symbols.map((symbol) => buildVariableInput(symbol, trimmed, databazeEntries))

  return {
    questionText: trimmed,
    formula: "",
    equationText: "",
    targets,
    variables,
  }
}

function isQuestionLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.length > 0 &&
    /\[\[/.test(trimmed) &&
    !POINT_VALUE_REGEX.test(trimmed) &&
    !SET_INDEX_REGEX.test(trimmed)
  )
}

export function parseBulkImportText(
  text: string,
  databazeEntries: DatabazeEntry[] = [],
): BulkImportData {
  const lines = text.split(/\r?\n/)

  let topicName = ""
  let idx = 0

  // First non-empty line is the topic name.
  while (idx < lines.length && lines[idx].trim() === "") {
    idx++
  }
  if (idx < lines.length) {
    topicName = lines[idx].trim()
    idx++
  }

  const categories: BulkImportCategory[] = []
  let currentCategory: BulkImportCategory | null = null
  let currentSet: BulkImportSet | null = null

  for (; idx < lines.length; idx++) {
    const line = lines[idx]
    const trimmed = line.trim()
    if (trimmed === "") {
      continue
    }

    const pointMatch = trimmed.match(POINT_VALUE_REGEX)
    if (pointMatch) {
      currentCategory = {
        pointValue: Number.parseInt(pointMatch[1], 10),
        sets: [],
      }
      categories.push(currentCategory)
      currentSet = null
      continue
    }

    const setMatch = trimmed.match(SET_INDEX_REGEX)
    if (setMatch) {
      currentSet = {
        setIndex: Number.parseInt(setMatch[2], 10),
        questions: [],
      }
      if (!currentCategory) {
        currentCategory = {
          pointValue: Number.parseInt(setMatch[1], 10),
          sets: [],
        }
        categories.push(currentCategory)
      }
      currentCategory.sets.push(currentSet)
      continue
    }

    if (isQuestionLine(trimmed)) {
      const question = parseQuestion(trimmed, databazeEntries)
      if (currentSet) {
        currentSet.questions.push(question)
      } else {
        if (!currentCategory) {
          currentCategory = {
            pointValue: 2,
            sets: [],
          }
          categories.push(currentCategory)
        }
        currentSet = {
          setIndex: currentCategory.sets.length + 1,
          questions: [question],
        }
        currentCategory.sets.push(currentSet)
      }
    }
  }

  return {
    topicName,
    categories,
  }
}

export function parseFormulaText(text: string): FormulaMap {
  const lines = text.split(/\r?\n/)
  const formulaMap: FormulaMap = {}

  let currentSetKey: string | null = null
  const currentFormulas: string[] = []

  function flushCurrentSet() {
    if (currentSetKey && currentFormulas.length > 0) {
      formulaMap[currentSetKey] = [...currentFormulas]
      currentFormulas.length = 0
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === "") {
      continue
    }

    const setMatch = trimmed.match(SET_INDEX_REGEX)
    if (setMatch) {
      flushCurrentSet()
      currentSetKey = `${setMatch[1]}_${setMatch[2]}`
    } else if (currentSetKey) {
      currentFormulas.push(trimmed)
    }
  }

  flushCurrentSet()
  return formulaMap
}

export function normalizeFormulaForEvaluation(raw: string): string {
  return raw
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/,/g, ".")
    .replace(/⁻/g, "-")
    .replace(/×/g, "*")
    .replace(/¹/g, "1")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
}

const FORMULA_TARGET_REGEX = /^\s*([a-zA-Zα-ωφ][a-zA-Z0-9_%_α-ωφ]*)\s*=/

function extractFormulaTarget(formula: string): string | null {
  const match = formula.match(FORMULA_TARGET_REGEX)
  return match ? match[1] : null
}

function joinFormulas(formulas: string[]): string {
  return formulas.join("\n")
}

export function pairFormulasWithQuestions(
  data: BulkImportData,
  formulaMap: FormulaMap,
): { data: BulkImportData; warnings: string[] } {
  const warnings: string[] = []

  const deepCopy: BulkImportData = {
    topicName: data.topicName,
    categories: data.categories.map((category) => ({
      pointValue: category.pointValue,
      sets: category.sets.map((set) => ({
        setIndex: set.setIndex,
        questions: set.questions.map((question) => ({
          ...question,
        })),
      })),
    })),
  }

  for (const category of deepCopy.categories) {
    for (const set of category.sets) {
      const setKey = `${category.pointValue}_${set.setIndex}`
      const formulas = formulaMap[setKey]

      if (!formulas || formulas.length === 0) {
        continue
      }

      const consumed = new Set<number>()

      for (const question of set.questions) {
        if (question.targets.length === 0) {
          continue
        }

        const matchedFormulas: string[] = []
        const unmatchedTargets: string[] = []

        for (const target of question.targets) {
          const index = formulas.findIndex(
            (formula, i) => !consumed.has(i) && extractFormulaTarget(formula) === target,
          )
          if (index === -1) {
            unmatchedTargets.push(target)
            continue
          }
          consumed.add(index)
          matchedFormulas.push(formulas[index])
        }

        if (unmatchedTargets.length === 0) {
          const joined = joinFormulas(matchedFormulas)
          question.equationText = joined
          question.formula = normalizeFormulaForEvaluation(joined)
        }
      }

      const unconsumedCount = formulas.length - consumed.size
      if (unconsumedCount > 0) {
        warnings.push(
          `Sada ${setKey}: ${set.questions.length} otázky, ${formulas.length} vzorce — ${unconsumedCount} vzorců nebylo spárováno.`,
        )
      }
    }
  }

  return { data: deepCopy, warnings }
}
