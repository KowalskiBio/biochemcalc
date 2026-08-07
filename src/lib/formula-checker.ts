import { parseCzechNumber } from "@/lib/utils"

const SYMBOL_CHAR_START = "a-zA-Zα-ωφ"
const SYMBOL_CHAR_BODY = "a-zA-Z0-9_%α-ωφ"

const FORMULA_VARIABLE_REGEX = new RegExp(`[${SYMBOL_CHAR_START}][${SYMBOL_CHAR_BODY}]*`, "g")

const TARGET_BLOCK_REGEX = new RegExp(
  `(?:\\[[${SYMBOL_CHAR_START}][${SYMBOL_CHAR_BODY}]*(?:\\s+[^\\]]+)?\\])+\\s*$`,
)

export interface AnswerTarget {
  symbol: string
  unit?: string
  /**
   * The known answer, when the marker carries one: `[pH = 5.383]`. Import uses
   * it to check that the paired formula reproduces the printed result; it is
   * never persisted, so students never see it.
   */
  expected?: number
}

const TARGET_SYMBOL_UNIT_REGEX = new RegExp(
  `\\[([${SYMBOL_CHAR_START}][${SYMBOL_CHAR_BODY}]*)(?:\\s+([^\\]]+))?\\]`,
  "g",
)

/** Splits `= 19.64 g` into the expected value and the unit that follows it. */
const EXPECTED_VALUE_REGEX = /^=\s*([^\s]+)\s*(.*)$/

function parseTargetRest(rest: string | undefined): { unit?: string; expected?: number } {
  if (rest === undefined) return {}

  const expectedMatch = rest.match(EXPECTED_VALUE_REGEX)
  if (!expectedMatch) {
    return { unit: rest }
  }

  const expected = parseCzechNumber(expectedMatch[1])
  const unit = expectedMatch[2].trim()
  // An unreadable value is kept as the unit rather than dropped, so a typo
  // shows up in the preview instead of silently becoming "no known answer".
  if (expected === undefined) return { unit: rest }
  return { unit: unit === "" ? undefined : unit, expected }
}

export function extractTargets(text: string): AnswerTarget[] {
  const trimmed = text.trim()
  const blockMatch = trimmed.match(TARGET_BLOCK_REGEX)
  if (!blockMatch) {
    return []
  }

  const targets: AnswerTarget[] = []
  for (const match of blockMatch[0].trim().matchAll(TARGET_SYMBOL_UNIT_REGEX)) {
    targets.push({ symbol: match[1], ...parseTargetRest(match[2]?.trim()) })
  }

  return targets
}

/**
 * The question text with known answers removed from its target markers:
 * `... [pH = 5.383]` -> `... [pH]`. The value is an import-time check, and the
 * backend would otherwise store `= 5.383` as the answer's unit.
 */
export function stripExpectedValues(text: string): string {
  const trimmed = text.trim()
  const blockMatch = trimmed.match(TARGET_BLOCK_REGEX)
  if (!blockMatch) {
    return text
  }

  const rebuilt = blockMatch[0].trim().replace(TARGET_SYMBOL_UNIT_REGEX, (marker, symbol, rest) => {
    const { unit, expected } = parseTargetRest(rest?.trim())
    if (expected === undefined) return marker
    return unit ? `[${symbol} ${unit}]` : `[${symbol}]`
  })

  return trimmed.slice(0, blockMatch.index) + rebuilt
}

export function extractFormulaVariables(equation: string): string[] {
  const seen = new Set<string>()
  const variables: string[] = []

  for (const match of equation.matchAll(FORMULA_VARIABLE_REGEX)) {
    const variable = match[0]
    if (!seen.has(variable)) {
      seen.add(variable)
      variables.push(variable)
    }
  }

  return variables
}

import type { PlaceholderMatch } from "@/lib/utils"

export interface VariableMatchResult {
  targets: string[]
  placeholders: PlaceholderMatch[]
  formulaVariables: string[]
  required: string[]
  present: string[]
  missing: string[]
}

export function matchVariables(
  placeholders: PlaceholderMatch[],
  formulaVariables: string[],
  targets: string[],
): VariableMatchResult {
  const placeholderSet = new Set(placeholders.map((p) => p.symbol))
  const targetSet = new Set(targets)
  const required = formulaVariables.filter((v) => !targetSet.has(v))
  const present = required.filter((v) => placeholderSet.has(v))
  const missing = required.filter((v) => !placeholderSet.has(v))

  return {
    targets,
    placeholders,
    formulaVariables,
    required,
    present,
    missing,
  }
}
