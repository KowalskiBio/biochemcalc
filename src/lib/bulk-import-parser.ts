import { KNOWN_ELEMENTS } from "@/lib/periodic-table-data"
import type { DatabazeEntry } from "@/lib/types"
import { isAtomPlaceholder, parseCzechNumber } from "@/lib/utils"

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
  /**
   * Known answers from `[pH = 5.383]` markers, keyed by target symbol. Import
   * checks the paired formula against them; they are stripped from
   * `questionText` and never sent to the backend.
   */
  expectedAnswers?: Record<string, number>
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

const PLACEHOLDER_REGEX = /\[\[([a-zA-Zα-ωφ][a-zA-Z0-9_%_α-ωφ]*)(?:=([^\]]*))?\]\]/g

import { extractTargets as extractAnswerTargets, stripExpectedValues } from "@/lib/formula-checker"

const POINT_VALUE_REGEX = /^(\d+)\s*body\s*$/i

const SET_INDEX_REGEX = /^(\d+)_(\d+)\s*$/

/**
 * The set header as it is written in the source documents — `Sada 3` under a
 * preceding `3 body` heading — alongside the compact `3_1` form. Accepting both
 * means a pasted assignment needs no rewriting of its structure.
 */
const SET_NAME_REGEX = /^Sada\s+(\d+)\s*$/i

/** Point value assumed for a set that appears before any `N body` heading. */
const DEFAULT_POINT_VALUE = 2

const KNOWN_STRING_SYMBOLS = new Set(["sK", "sA", "KK", "AA", "sKK", "sAA", "molekula2"])

const DEFAULT_STRING_VALUES: Record<string, string[]> = {
  sK: ["Li", "Na", "K", "Rb", "Cs"],
  sA: ["F", "Cl", "Br", "I"],
  KK: ["Mg", "Ca", "Sr", "Ba", "Zn", "Cu"],
  AA: ["O", "S", "SO4", "CO3"],
  sKK: ["Mg", "Ca", "Sr", "Ba"],
  sAA: ["O", "S", "SO4"],
  molekula2: [],
}

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

interface PlaceholderInfo {
  symbol: string
  fixedValue?: number
}

const parseScientificNotation = parseCzechNumber

function extractPlaceholders(text: string): PlaceholderInfo[] {
  const seen = new Set<string>()
  const placeholders: PlaceholderInfo[] = []
  for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
    const symbol = match[1]
    if (seen.has(symbol)) continue
    seen.add(symbol)
    const rawValue = match[2]
    const fixedValue = rawValue !== undefined ? parseScientificNotation(rawValue) : undefined
    placeholders.push({ symbol, fixedValue })
  }
  return placeholders
}

function inferUnitFromText(symbol: string, text: string): string | undefined {
  const regex = new RegExp(`\\[\\[${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`, "g")
  const match = regex.exec(text)
  if (!match) {
    return undefined
  }

  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40)
  for (const { pattern, unit } of UNIT_PATTERNS) {
    if (pattern.test(after)) {
      return unit
    }
  }

  return undefined
}

const SYMBOL_UNIT_PATTERNS: { pattern: RegExp; unit: string }[] = [
  { pattern: /^pH\d*$/, unit: "" },
  { pattern: /^pK[a-z]?$/, unit: "" },
  { pattern: /^dpH\d*$/, unit: "" },
  { pattern: /^K[a-z]$/, unit: "" },
  { pattern: /^ratio\d*$/, unit: "" },
  { pattern: /^wDsc\d*$/, unit: "%" },
  { pattern: /^wperc\d*$/, unit: "%" },
  { pattern: /^vperc\d*$/, unit: "%" },
  { pattern: /^m\d*$/, unit: "g" },
  { pattern: /^ms\d*$/, unit: "g" },
  { pattern: /^mv\d*$/, unit: "g" },
  { pattern: /^mr\d*$/, unit: "g" },
  { pattern: /^V\d*$/, unit: "l" },
  { pattern: /^Vs\d*$/, unit: "l" },
  { pattern: /^Vr\d*$/, unit: "l" },
  { pattern: /^rho[_a-z0-9]*$/, unit: "g.cm-3" },
  { pattern: /^n\d*$/, unit: "mol" },
  { pattern: /^n[a-z]+\d*$/, unit: "mol" },
  { pattern: /^c\d*$/, unit: "mol/l" },
  { pattern: /^c[a-z]+\d*$/, unit: "mol/l" },
]

function inferUnitFromSymbol(symbol: string): string {
  for (const { pattern, unit } of SYMBOL_UNIT_PATTERNS) {
    if (pattern.test(symbol)) {
      return unit
    }
  }
  return ""
}

function inferUnit(symbol: string, text: string): string {
  return inferUnitFromText(symbol, text) ?? inferUnitFromSymbol(symbol)
}

function inferVarType(symbol: string, unit: string): BulkImportVarType {
  if (KNOWN_STRING_SYMBOLS.has(symbol) || isAtomPlaceholder(symbol)) {
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
  fixedValue?: number,
): BulkImportVariableInput {
  const unit = inferUnit(symbol, text)
  const varType = inferVarType(symbol, unit)

  if (fixedValue !== undefined) {
    return {
      symbol,
      name: symbol,
      varType: "numeric",
      minValue: fixedValue,
      maxValue: fixedValue,
      step: 1,
      unit,
      precision: 0,
    }
  }

  if (varType === "string") {
    if (isAtomPlaceholder(symbol)) {
      return {
        symbol,
        name: symbol,
        varType,
        minValue: 0,
        maxValue: 0,
        step: 1,
        unit: "",
        precision: 0,
        stringValues: [...KNOWN_ELEMENTS],
      }
    }
    const entry = databazeEntries.find((e) => e.code === symbol)
    if (entry && entry.values.length > 0) {
      return {
        symbol,
        name: symbol,
        varType,
        minValue: 0,
        maxValue: 0,
        step: 1,
        unit: "",
        precision: 0,
        stringValues: entry.values,
      }
    }
    const defaultValues = DEFAULT_STRING_VALUES[symbol]
    return {
      symbol,
      name: symbol,
      varType,
      minValue: 0,
      maxValue: 0,
      step: 1,
      unit: "",
      precision: 0,
      stringValues: defaultValues && defaultValues.length > 0 ? defaultValues : [symbol],
    }
  }

  // Mass fraction symbol `w` is dimensionless and must stay in (0, 1).
  if (symbol === "w") {
    return {
      symbol,
      name: symbol,
      varType,
      minValue: 0.1,
      maxValue: 0.9,
      step: 0.1,
      unit: "—",
      precision: 1,
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
  const answerTargets = extractAnswerTargets(trimmed)
  const placeholders = extractPlaceholders(trimmed)
  const variables = placeholders.map(({ symbol, fixedValue }) =>
    buildVariableInput(symbol, trimmed, databazeEntries, fixedValue),
  )

  const expectedAnswers: Record<string, number> = {}
  for (const target of answerTargets) {
    if (target.expected !== undefined) {
      expectedAnswers[target.symbol] = target.expected
    }
  }

  return {
    questionText: stripExpectedValues(trimmed),
    formula: "",
    equationText: "",
    targets: answerTargets.map((target) => target.symbol),
    variables,
    ...(Object.keys(expectedAnswers).length > 0 ? { expectedAnswers } : {}),
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

/** Markers like `(X)` that tag a value in an assignment not yet converted. */
const VARIANT_MARKER_REGEX = /\([A-Z]\)/

const SKIPPED_SAMPLE_LIMIT = 3
const UNCONVERTED_SAMPLE_LIMIT = 5

function quoteLine(lineNumber: number, text: string): string {
  const shortened = text.length > 60 ? `${text.slice(0, 60)}…` : text
  return `řádek ${lineNumber}: „${shortened}"`
}

function buildSkippedWarnings(
  skipped: { lineNumber: number; text: string }[],
  unconverted: { lineNumber: number; text: string }[],
): string[] {
  const warnings: string[] = []

  for (const line of unconverted.slice(0, UNCONVERTED_SAMPLE_LIMIT)) {
    warnings.push(
      `Vypadá jako otázka se značkami (X), ale nemá žádné [[proměnné]] — ${quoteLine(line.lineNumber, line.text)}`,
    )
  }
  if (unconverted.length > UNCONVERTED_SAMPLE_LIMIT) {
    warnings.push(
      `…a dalších ${unconverted.length - UNCONVERTED_SAMPLE_LIMIT} řádků se značkami (X) bez [[proměnných]].`,
    )
  }

  if (skipped.length > 0) {
    const samples = skipped
      .slice(0, SKIPPED_SAMPLE_LIMIT)
      .map((line) => quoteLine(line.lineNumber, line.text))
      .join("; ")
    warnings.push(
      `Přeskočeno ${skipped.length} řádků bez [[proměnných]] (${samples}${skipped.length > SKIPPED_SAMPLE_LIMIT ? "; …" : ""}).`,
    )
  }

  return warnings
}

/**
 * Parse the question blob, reporting what was left out. Every line that is not
 * a heading or a question is dropped, so without the warnings an unconverted
 * assignment imports as an empty topic and looks like it worked.
 */
export function parseBulkImport(
  text: string,
  databazeEntries: DatabazeEntry[] = [],
): { data: BulkImportData; warnings: string[] } {
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
  const skipped: { lineNumber: number; text: string }[] = []
  const unconverted: { lineNumber: number; text: string }[] = []

  function startSet(setIndex: number, pointValue: number): BulkImportSet {
    let category = currentCategory
    if (!category) {
      category = { pointValue, sets: [] }
      categories.push(category)
      currentCategory = category
    }
    const set: BulkImportSet = { setIndex, questions: [] }
    category.sets.push(set)
    currentSet = set
    return set
  }

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
      startSet(Number.parseInt(setMatch[2], 10), Number.parseInt(setMatch[1], 10))
      continue
    }

    const setNameMatch = trimmed.match(SET_NAME_REGEX)
    if (setNameMatch) {
      startSet(
        Number.parseInt(setNameMatch[1], 10),
        currentCategory?.pointValue ?? DEFAULT_POINT_VALUE,
      )
      continue
    }

    if (isQuestionLine(trimmed)) {
      const question = parseQuestion(trimmed, databazeEntries)
      const set =
        currentSet ?? startSet((currentCategory?.sets.length ?? 0) + 1, DEFAULT_POINT_VALUE)
      set.questions.push(question)
      continue
    }

    if (VARIANT_MARKER_REGEX.test(trimmed)) {
      unconverted.push({ lineNumber: idx + 1, text: trimmed })
    } else {
      skipped.push({ lineNumber: idx + 1, text: trimmed })
    }
  }

  return {
    data: { topicName, categories },
    warnings: buildSkippedWarnings(skipped, unconverted),
  }
}

export function parseBulkImportText(
  text: string,
  databazeEntries: DatabazeEntry[] = [],
): BulkImportData {
  return parseBulkImport(text, databazeEntries).data
}

export function parseFormulaText(text: string): FormulaMap {
  const lines = text.split(/\r?\n/)
  const formulaMap: FormulaMap = {}

  let currentSetKey: string | null = null
  let currentPointValue = DEFAULT_POINT_VALUE
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

    const pointMatch = trimmed.match(POINT_VALUE_REGEX)
    if (pointMatch) {
      currentPointValue = Number.parseInt(pointMatch[1], 10)
      continue
    }

    const setMatch = trimmed.match(SET_INDEX_REGEX)
    const setNameMatch = setMatch ? null : trimmed.match(SET_NAME_REGEX)
    if (setMatch || setNameMatch) {
      flushCurrentSet()
      currentSetKey = setMatch
        ? `${setMatch[1]}_${setMatch[2]}`
        : `${currentPointValue}_${setNameMatch?.[1]}`
    } else if (currentSetKey) {
      const parts = trimmed
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
      currentFormulas.push(...parts)
    }
  }

  flushCurrentSet()
  return formulaMap
}

export function normalizeFormulaForEvaluation(raw: string): string {
  // Strip explanatory comments such as "— (NA = Avogadrova konstanta)"
  // so they are not evaluated as part of the formula.
  const withoutComment = raw.split("—")[0] ?? raw
  return withoutComment
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/,/g, ".")
    .replace(/⁻/g, "-")
    .replace(/×/g, "*")
    .replace(/−/g, "-")
    .replace(/÷/g, "/")
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
  return formulas.join("; ")
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

      const unconsumed = formulas.filter((_, i) => !consumed.has(i))
      if (unconsumed.length > 0) {
        const list = unconsumed.map((f) => `"${f}"`).join(", ")
        warnings.push(
          `Sada ${setKey}: ${set.questions.length} otázky, ${formulas.length} vzorce — ${unconsumed.length} vzorců nebylo spárováno: ${list}`,
        )
      }
    }
  }

  return { data: deepCopy, warnings }
}
