import { ATOMIC_WEIGHTS, isKnownElement } from "@/lib/periodic-table-data"

export interface MolarMassResultOk {
  ok: true
  value: number
  formula: string
  counts: Record<string, number>
}

export interface MolarMassResultErr {
  ok: false
  error: string
  formula: string
}

export type MolarMassResult = MolarMassResultOk | MolarMassResultErr

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
}

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
}

const HYDRATE_SEPARATORS = new Set(["·", "∙", "*"])
const GROUP_OPEN = new Set(["(", "[", "{"])
const GROUP_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
}

function normalizeSubscripts(input: string): string {
  return input
    .split("")
    .map((char) => SUBSCRIPT_DIGITS[char] ?? char)
    .join("")
}

function normalizeSuperscripts(input: string): string {
  return input
    .split("")
    .map((char) => SUPERSCRIPT_DIGITS[char] ?? char)
    .join("")
}

function stripTrailingCharge(formula: string): string {
  // Cut off explicit superscript charge notation (e.g. SO4^2-, Ca^2+).
  let withoutCharge = formula
  const caretIndex = formula.indexOf("^")
  if (caretIndex !== -1) {
    withoutCharge = formula.slice(0, caretIndex)
  }

  // Special case: single element ion written as Ca2+, O2-, Na+, Cl- etc.
  const singleIonMatch = withoutCharge.match(/^([A-Z][a-z]?)(\d+)?([+-])$/)
  if (singleIonMatch) {
    return singleIonMatch[1]
  }

  return withoutCharge
}

function isUppercase(char: string): boolean {
  return char >= "A" && char <= "Z"
}

function isLowercase(char: string): boolean {
  return char >= "a" && char <= "z"
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9"
}

function readNumber(formula: string, start: number): { value: number; next: number } {
  let i = start
  while (i < formula.length && isDigit(formula[i])) {
    i++
  }
  if (i === start) {
    return { value: 1, next: start }
  }
  const value = Number.parseInt(formula.slice(start, i), 10)
  return { value, next: i }
}

function readElement(formula: string, start: number): { symbol: string; next: number } | null {
  if (start >= formula.length || !isUppercase(formula[start])) {
    return null
  }

  let symbol = formula[start]
  let i = start + 1
  // Element symbols are at most one uppercase + two lowercase letters (e.g. Uue).
  let lowercaseCount = 0
  while (i < formula.length && isLowercase(formula[i]) && lowercaseCount < 2) {
    symbol += formula[i]
    i++
    lowercaseCount++
  }

  return { symbol, next: i }
}

interface ParseState {
  counts: Record<string, number>
  i: number
}

function addCounts(
  target: Record<string, number>,
  source: Record<string, number>,
  multiplier: number,
): void {
  for (const [symbol, count] of Object.entries(source)) {
    target[symbol] = (target[symbol] ?? 0) + count * multiplier
  }
}

function isKnownElementForParsing(symbol: string, atomicWeights?: Record<string, number>): boolean {
  return atomicWeights?.[symbol] !== undefined || isKnownElement(symbol)
}

function parseGroup(
  formula: string,
  start: number,
  atomicWeights?: Record<string, number>,
): ParseState | { error: string; i: number } {
  const counts: Record<string, number> = {}
  let i = start

  while (i < formula.length) {
    const char = formula[i]

    if (char === " " || char === "\t") {
      i++
      continue
    }

    if (GROUP_OPEN.has(char)) {
      const close = GROUP_CLOSE[char]
      const inner = parseGroup(formula, i + 1, atomicWeights)
      if ("error" in inner) {
        return inner
      }
      if (inner.i >= formula.length || formula[inner.i] !== close) {
        return { error: `Chybějící uzavírací závorka „${close}"`, i: inner.i }
      }
      i = inner.i + 1
      const countResult = readNumber(formula, i)
      i = countResult.next
      addCounts(counts, inner.counts, countResult.value)
      continue
    }

    if (char === ")" || char === "]" || char === "}") {
      break
    }

    if (char === "+" || char === "-") {
      break
    }

    if (HYDRATE_SEPARATORS.has(char) || char === ".") {
      break
    }

    const element = readElement(formula, i)
    if (!element) {
      return { error: `Neočekávaný znak „${char}" na pozici ${i + 1}`, i }
    }

    if (!isKnownElementForParsing(element.symbol, atomicWeights)) {
      return { error: `Neznámý prvek „${element.symbol}"`, i }
    }

    i = element.next
    const countResult = readNumber(formula, i)
    i = countResult.next
    counts[element.symbol] = (counts[element.symbol] ?? 0) + countResult.value
  }

  return { counts, i }
}

function isHydrateSeparator(char: string): boolean {
  return HYDRATE_SEPARATORS.has(char) || char === "."
}

function parseHydratePart(
  formula: string,
  start: number,
  atomicWeights?: Record<string, number>,
): { counts: Record<string, number>; next: number } | { error: string; i: number } {
  let i = start
  while (i < formula.length && (formula[i] === " " || formula[i] === "\t")) {
    i++
  }

  if (i >= formula.length) {
    return { counts: {}, next: i }
  }

  const multiplierResult = readNumber(formula, i)
  const multiplier = multiplierResult.value
  i = multiplierResult.next
  while (i < formula.length && (formula[i] === " " || formula[i] === "\t")) {
    i++
  }

  const group = parseGroup(formula, i, atomicWeights)
  if ("error" in group) {
    return group
  }

  const counts: Record<string, number> = {}
  addCounts(counts, group.counts, multiplier)
  return { counts, next: group.i }
}

function lookupAtomicWeight(
  symbol: string,
  customWeights?: Record<string, number>,
): number | undefined {
  return customWeights?.[symbol] ?? ATOMIC_WEIGHTS[symbol]
}

export function parseChemicalFormula(
  formula: string,
  atomicWeights?: Record<string, number>,
): MolarMassResult {
  const normalized = normalizeSubscripts(normalizeSuperscripts(formula.trim()))
  const withoutCharge = stripTrailingCharge(normalized)

  if (withoutCharge.length === 0) {
    return { ok: false, error: "Prázdný vzorec", formula }
  }

  const main = parseGroup(withoutCharge, 0, atomicWeights)
  if ("error" in main) {
    return { ok: false, error: main.error, formula }
  }

  const counts: Record<string, number> = { ...main.counts }
  let i = main.i

  while (i < withoutCharge.length && isHydrateSeparator(withoutCharge[i])) {
    i++
    const hydrate = parseHydratePart(withoutCharge, i, atomicWeights)
    if ("error" in hydrate) {
      return { ok: false, error: hydrate.error, formula }
    }
    addCounts(counts, hydrate.counts, 1)
    i = hydrate.next
  }

  if (i < withoutCharge.length) {
    const remaining = withoutCharge.slice(i).trim()
    if (remaining.length > 0 && !remaining.match(/^[+-]+$/)) {
      return { ok: false, error: `Nezpracovaná část vzorce: „${remaining}"`, formula }
    }
  }

  let total = 0
  for (const [symbol, count] of Object.entries(counts)) {
    const weight = lookupAtomicWeight(symbol, atomicWeights)
    if (weight === undefined) {
      return { ok: false, error: `Chybí atomová hmotnost pro prvek „${symbol}"`, formula }
    }
    total += weight * count
  }

  return {
    ok: true,
    value: Math.round(total * 100) / 100,
    formula,
    counts,
  }
}

export function calculateMolarMass(
  formula: string,
  atomicWeights?: Record<string, number>,
): number | null {
  const result = parseChemicalFormula(formula, atomicWeights)
  return result.ok ? result.value : null
}

export function isValidChemicalFormula(formula: string): boolean {
  return parseChemicalFormula(formula).ok
}

export function getFormulaElementCounts(formula: string): Record<string, number> | null {
  const result = parseChemicalFormula(formula)
  return result.ok ? result.counts : null
}
