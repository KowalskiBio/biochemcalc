const SYMBOL_CHAR_START = "a-zA-Zα-ωφ"
const SYMBOL_CHAR_BODY = "a-zA-Z0-9_%α-ωφ"

const FORMULA_VARIABLE_REGEX = new RegExp(`[${SYMBOL_CHAR_START}][${SYMBOL_CHAR_BODY}]*`, "g")

const TARGET_BLOCK_REGEX = new RegExp(
  `(?:\\[[${SYMBOL_CHAR_START}][${SYMBOL_CHAR_BODY}]*(?:\\s+[^\\]]+)?\\])+\\s*$`,
)

export interface AnswerTarget {
  symbol: string
  unit?: string
}

const TARGET_SYMBOL_UNIT_REGEX = new RegExp(
  `\\[([${SYMBOL_CHAR_START}][${SYMBOL_CHAR_BODY}]*)(?:\\s+([^\\]]+))?\\]`,
  "g",
)

export function extractTargets(text: string): AnswerTarget[] {
  const trimmed = text.trim()
  const blockMatch = trimmed.match(TARGET_BLOCK_REGEX)
  if (!blockMatch) {
    return []
  }

  const targets: AnswerTarget[] = []
  for (const match of blockMatch[0].trim().matchAll(TARGET_SYMBOL_UNIT_REGEX)) {
    const symbol = match[1]
    const unit = match[2]?.trim()
    targets.push({ symbol, unit })
  }

  return targets
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
