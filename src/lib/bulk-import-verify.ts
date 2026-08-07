import type { BulkImportData, BulkImportQuestion } from "@/lib/bulk-import-parser"
import { evaluateExpression } from "@/lib/math-utils"
import { extractPlaceholderValues } from "@/lib/utils"

/**
 * Checking an imported formula against the answer printed in the source
 * assignment. A question is only checkable when it states a known answer, has a
 * paired formula, and pins every placeholder to a value — `[[c=0.89]]` rather
 * than a range, which is how a worked example from an assignment is written.
 */
export interface AnswerCheck {
  pointValue: number
  setIndex: number
  questionText: string
  target: string
  expected: number
  /** Undefined when the formula could not be evaluated at all. */
  actual?: number
  error?: string
  ok: boolean
}

function significantDigits(value: number): number {
  const mantissa = Math.abs(value).toExponential().split("e")[0]
  return mantissa.replace(".", "").replace(/0+$/, "").length || 1
}

/**
 * Does the computed answer agree to the precision the source actually printed?
 * A printed "2.75" claims two decimals and nothing more, so anything within one
 * unit of its last digit agrees; "5.383" claims three, and 5.394 does not.
 * Tying the tolerance to the printed precision is what lets the check pass
 * rounding while still catching a wrong constant — the two differ by far more
 * than the source's own last digit.
 */
function agrees(expected: number, actual: number): boolean {
  if (!Number.isFinite(actual)) return false
  if (expected === 0) return Math.abs(actual) < 1e-12

  const exponent = Math.floor(Math.log10(Math.abs(expected)))
  const lastDigitUnit = 10 ** (exponent - significantDigits(expected) + 1)
  return Math.abs(expected - actual) <= Math.max(lastDigitUnit, Math.abs(expected) * 1e-9)
}

const IDENTIFIER_ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g

/**
 * The part of a multi-answer formula that computes one target: for
 * `c = …; alpha = … c …` and target `c`, everything up to the `c` clause, since
 * evaluation returns the value of the last assignment. Later clauses may depend
 * on earlier ones, so the chain in front is kept.
 */
function clausesUpTo(equation: string, target: string): string {
  const clauses = equation
    .split(";")
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
  if (clauses.length <= 1) return equation

  const escaped = target.replace(IDENTIFIER_ESCAPE_REGEX, "\\$&")
  const targetRegex = new RegExp(`^${escaped}\\s*=`)
  const index = clauses.findIndex((clause) => targetRegex.test(clause))
  return index === -1 ? equation : clauses.slice(0, index + 1).join("; ")
}

function fixedValues(question: BulkImportQuestion): Record<string, number> | null {
  const values: Record<string, number> = {}
  for (const { symbol, value } of extractPlaceholderValues(question.questionText)) {
    if (value === undefined) return null
    const numeric = Number(value.replace(",", "."))
    if (!Number.isFinite(numeric)) return null
    values[symbol] = numeric
  }
  return values
}

function checkQuestion(
  question: BulkImportQuestion,
  pointValue: number,
  setIndex: number,
  constants: Record<string, number>,
): AnswerCheck[] {
  const expectedAnswers = question.expectedAnswers
  const equation = question.equationText || question.formula
  if (!expectedAnswers || !equation.trim()) {
    return []
  }

  const values = fixedValues(question)
  if (!values) {
    return []
  }

  return Object.entries(expectedAnswers).map(([target, expected]) => {
    const base: Omit<AnswerCheck, "ok"> = {
      pointValue,
      setIndex,
      questionText: question.questionText,
      target,
      expected,
    }
    try {
      const actual = evaluateExpression(clausesUpTo(equation, target), values, constants)
      return { ...base, actual, ok: agrees(expected, actual) }
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err), ok: false }
    }
  })
}

/**
 * Check every question that states a known answer. Whatever comes back failing
 * is either a wrong formula or an error in the source document — both are worth
 * seeing before the import is committed.
 */
export function verifyExpectedAnswers(
  data: BulkImportData,
  constants: Record<string, number> = {},
): AnswerCheck[] {
  const checks: AnswerCheck[] = []
  for (const category of data.categories) {
    for (const set of category.sets) {
      for (const question of set.questions) {
        checks.push(...checkQuestion(question, category.pointValue, set.setIndex, constants))
      }
    }
  }
  return checks
}

function shorten(text: string, limit = 60): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** The failing checks phrased for the import preview. */
export function describeFailedChecks(checks: AnswerCheck[]): string[] {
  return checks
    .filter((check) => !check.ok)
    .map((check) => {
      const where = `${check.pointValue} body, sada ${check.setIndex}`
      const got =
        check.actual !== undefined
          ? `vzorec dává ${check.actual.toPrecision(4)}`
          : `vzorec nelze vyhodnotit (${check.error})`
      return `${where}: ${got}, očekáváno ${check.expected} pro [${check.target}] — „${shorten(check.questionText)}"`
    })
}
