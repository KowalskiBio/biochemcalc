import { normalizeFormulaForEvaluation } from "@/lib/bulk-import-parser"
import { calculateMolarMass, parseChemicalFormula } from "@/lib/chemical-formula-parser"
import { ATOMIC_WEIGHTS } from "@/lib/periodic-table-data"
import type { LocalVariableEdit, VariableWithPlaceholder, Variant } from "@/lib/types"
import { extractPlaceholders, extractPlaceholderValues } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
  | "number"
  | "identifier"
  | "operator"
  | "percent"
  | "lparen"
  | "rparen"
  | "comma"
  | "semicolon"
  | "eof"

interface Token {
  type: TokenType
  value: string
}

// Trailing exponent is greedy on purpose: a bare number is never followed
// directly by "e"/"E" in this formula language (there's no implicit
// multiplication), so "7.2e-10" is always meant as one scientific-notation
// literal, never "7.2 times the constant e, minus 10". Substituting a very
// small/large sampled value with `String(value)` (buildSubstitutedEquation)
// is exactly what produces this form, and it must round-trip back through
// the tokenizer without splitting into "7.2", identifier "e", "-", "10".
const NUMBER_REGEX = /^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/

// Unicode ranges: α (U+03B1) – ω (U+03C9)
const GREEK_START = "\u03B1"
const GREEK_END = "\u03C9"

const IDENTIFIER_START = new RegExp(`[A-Za-z_${GREEK_START}-${GREEK_END}]`)
const IDENTIFIER_BODY = new RegExp(`[A-Za-z0-9_${GREEK_START}-${GREEK_END}%]`)

const FUNCTIONS = new Set(["sqrt", "sin", "cos", "tan", "log", "ln", "abs", "exp"])

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
}

function isValidIdentifier(name: string): boolean {
  if (name.length === 0) return false
  if (!IDENTIFIER_START.test(name[0])) return false
  for (let i = 1; i < name.length; i++) {
    if (!IDENTIFIER_BODY.test(name[i])) return false
  }
  return true
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function substituteSpecialSymbols(
  text: string,
  symbols: string[],
  replacer: (symbol: string) => string,
): string {
  const special = symbols.filter((s) => !isValidIdentifier(s)).sort((a, b) => b.length - a.length)
  let result = text
  for (const symbol of special) {
    const escaped = escapeRegexLiteral(symbol)
    result = result.replace(new RegExp(escaped, "g"), replacer(symbol))
  }
  return result
}

const MOLAR_MASS_REFERENCE_REGEX = /M_([A-Za-z0-9_().*·∙]+)/g

/**
 * An adduct separator inside an `M_` identifier: the `.` in `M_FeSO4.7H2O`.
 * `*`, `·` and `∙` are also multiplication operators, so the tokenizer only
 * swallows a separator when what follows looks like the formula of the attached
 * molecule — an optional count and then an element symbol, which is always
 * capitalised. That keeps `M_NaCl * 2` and `M_H_2O·n` as multiplications while
 * `M_NiCl2*6H2O` stays one identifier, matching what
 * MOLAR_MASS_REFERENCE_REGEX already captures for evaluation.
 */
const MOLAR_MASS_SEPARATOR_REGEX = /^[.*·∙]\d*[A-Z]/

/**
 * Scans the chemical group opening at `input[start]` — the `(OH)` in
 * `M_Ca(OH)2`, or the whole `(Cu(NH3)4)` in `M_(Cu(NH3)4)SO4` — and returns the
 * index just past its closing bracket. Returns -1 when the group is unbalanced
 * or holds anything that cannot be part of a formula, so `M_x(a+b)` is left to
 * the parser as a function call rather than being swallowed half-way.
 */
function readFormulaGroup(input: string, start: number): number {
  let depth = 0
  for (let i = start; i < input.length; i++) {
    const char = input[i]
    if (char === "(") {
      depth++
    } else if (char === ")") {
      depth--
      if (depth === 0) return i + 1
    } else if (!/[A-Za-z0-9_]/.test(char)) {
      return -1
    }
  }
  return -1
}

function normalizeMolarMassFormula(formulaPart: string): string {
  return formulaPart.replace(/_(\d+)(H_?2O)/g, ".$1$2").replace(/_/g, "")
}

function parseMolarMassFormula(
  formulaPart: string,
  atomicWeights: Record<string, number> = {},
): { ok: true; value: number; matched: string } | { ok: false } {
  const normalized = normalizeMolarMassFormula(formulaPart)
  const parsed = parseChemicalFormula(normalized, atomicWeights)
  if (parsed.ok) {
    return { ok: true, value: parsed.value, matched: formulaPart }
  }

  for (let end = formulaPart.length - 1; end > 0; end--) {
    const prefix = formulaPart.slice(0, end)
    const normalizedPrefix = normalizeMolarMassFormula(prefix)
    const prefixResult = parseChemicalFormula(normalizedPrefix, atomicWeights)
    if (prefixResult.ok) {
      return { ok: true, value: prefixResult.value, matched: prefix }
    }
  }

  return { ok: false }
}

export function resolveMolarMasses(
  text: string,
  atomicWeights: Record<string, number> = {},
): string {
  return text.replace(MOLAR_MASS_REFERENCE_REGEX, (match, formulaPart) => {
    if (atomicWeights[match] !== undefined) {
      return String(atomicWeights[match])
    }
    const parsed = parseMolarMassFormula(formulaPart, atomicWeights)
    if (!parsed.ok) return match
    const rest = match.slice(2 + parsed.matched.length)
    return String(parsed.value) + rest
  })
}

export function extractMolarMassValues(
  text: string,
  constants: Record<string, number> = {},
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const match of text.matchAll(MOLAR_MASS_REFERENCE_REGEX)) {
    const fullMatch = match[0]
    if (result[fullMatch] !== undefined) continue

    if (constants[fullMatch] !== undefined) {
      result[fullMatch] = constants[fullMatch]
      continue
    }

    const formulaPart = fullMatch.slice(2)
    const parsed = parseMolarMassFormula(formulaPart, constants)
    if (parsed.ok) {
      const key = `M_${parsed.matched}`
      if (result[key] === undefined) {
        result[key] = parsed.value
      }
    } else {
      const simpleFormula = formulaPart.replace(/_/g, "")
      if (simpleFormula in ATOMIC_WEIGHTS) {
        result[fullMatch] = ATOMIC_WEIGHTS[simpleFormula]
      }
    }
  }
  return result
}

export function substituteRemainingMolarMasses(text: string): string {
  return text.replace(MOLAR_MASS_REFERENCE_REGEX, (match, formulaPart) => {
    const parsed = parseMolarMassFormula(formulaPart, ATOMIC_WEIGHTS)
    if (parsed.ok) {
      const rest = match.slice(2 + parsed.matched.length)
      return String(parsed.value) + rest
    }
    const simpleFormula = formulaPart.replace(/_/g, "")
    if (simpleFormula in ATOMIC_WEIGHTS) return String(ATOMIC_WEIGHTS[simpleFormula])
    return match
  })
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const char = input[i]

    if (/\s/.test(char)) {
      i++
      continue
    }

    if (char === "(") {
      tokens.push({ type: "lparen", value: char })
      i++
      continue
    }

    if (char === ")") {
      tokens.push({ type: "rparen", value: char })
      i++
      continue
    }

    if (char === ",") {
      tokens.push({ type: "comma", value: char })
      i++
      continue
    }

    if (char === ";") {
      tokens.push({ type: "semicolon", value: char })
      i++
      continue
    }

    if (char === "%") {
      tokens.push({ type: "percent", value: char })
      i++
      continue
    }

    if (
      char === "+" ||
      char === "-" ||
      char === "*" ||
      char === "/" ||
      char === "^" ||
      char === "=" ||
      char === "×" ||
      char === "·" ||
      char === "∙"
    ) {
      tokens.push({ type: "operator", value: char })
      i++
      continue
    }

    const numberMatch = input.slice(i).match(NUMBER_REGEX)
    if (numberMatch) {
      tokens.push({ type: "number", value: numberMatch[0] })
      i += numberMatch[0].length
      continue
    }

    if (IDENTIFIER_START.test(char)) {
      let value = char
      i++
      while (i < input.length) {
        if (IDENTIFIER_BODY.test(input[i])) {
          value += input[i]
          i++
          continue
        }
        // A molar-mass reference reaches further than a plain identifier: it may
        // carry bracketed groups and adducts, exactly as
        // MOLAR_MASS_REFERENCE_REGEX captures them for evaluation.
        if (value.startsWith("M_")) {
          if (MOLAR_MASS_SEPARATOR_REGEX.test(input.slice(i))) {
            value += input[i]
            i++
            continue
          }
          if (input[i] === "(") {
            const groupEnd = readFormulaGroup(input, i)
            if (groupEnd !== -1) {
              value += input.slice(i, groupEnd)
              i = groupEnd
              continue
            }
          }
        }
        break
      }
      tokens.push({ type: "identifier", value })
      continue
    }

    throw new Error(`Neznámý znak na pozici ${i}: "${char}"`)
  }

  tokens.push({ type: "eof", value: "" })
  return tokens
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

interface NumberNode {
  kind: "number"
  value: number
}

interface IdentifierNode {
  kind: "identifier"
  name: string
}

interface BinaryNode {
  kind: "binary"
  operator: "+" | "-" | "*" | "/" | "^" | "=" | "×" | "·" | "∙"
  left: AstNode
  right: AstNode
}

interface UnaryNode {
  kind: "unary"
  operator: "-"
  operand: AstNode
}

interface FunctionNode {
  kind: "function"
  name: string
  argument: AstNode
}

interface UnitNode {
  kind: "unit"
  operand: AstNode
}

interface ParenthesizedNode {
  kind: "parenthesized"
  inner: AstNode
}

type AstNode =
  | NumberNode
  | IdentifierNode
  | BinaryNode
  | UnaryNode
  | FunctionNode
  | UnitNode
  | ParenthesizedNode

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "eof", value: "" }
  }

  private consume(): Token {
    return this.tokens[this.pos++] ?? { type: "eof", value: "" }
  }

  private expect(type: TokenType): Token {
    const token = this.peek()
    if (token.type !== type) {
      throw new Error(`Očekáván token ${type}, nalezeno ${token.type}`)
    }
    return this.consume()
  }

  parseRelation(): AstNode {
    let node = this.parseAddSub()
    while (this.peek().type === "operator" && this.peek().value === "=") {
      this.consume()
      const right = this.parseAddSub()
      node = { kind: "binary", operator: "=", left: node, right }
    }
    return node
  }

  parseExpression(): AstNode {
    return this.parseRelation()
  }

  parse(): AstNode {
    return this.parseAddSub()
  }

  private parseAddSub(): AstNode {
    let node = this.parseMulDiv()
    while (
      this.peek().type === "operator" &&
      (this.peek().value === "+" || this.peek().value === "-")
    ) {
      const operator = this.consume().value as "+" | "-"
      const right = this.parseMulDiv()
      node = { kind: "binary", operator, left: node, right }
    }
    return node
  }

  private parseMulDiv(): AstNode {
    let node = this.parsePower()
    while (
      this.peek().type === "operator" &&
      (this.peek().value === "*" ||
        this.peek().value === "/" ||
        this.peek().value === "×" ||
        this.peek().value === "·" ||
        this.peek().value === "∙")
    ) {
      const operator = this.consume().value as "*" | "/" | "×" | "·" | "∙"
      const right = this.parsePower()
      node = { kind: "binary", operator, left: node, right }
    }
    return node
  }

  private parsePower(): AstNode {
    let node = this.parseUnary()
    if (this.peek().type === "percent") {
      this.consume()
      node = { kind: "unit", operand: node }
    }
    if (this.peek().type === "operator" && this.peek().value === "^") {
      this.consume()
      const right = this.parsePower()
      node = { kind: "binary", operator: "^", left: node, right }
    }
    return node
  }

  private parseUnary(): AstNode {
    if (this.peek().type === "operator" && this.peek().value === "-") {
      this.consume()
      const operand = this.parseUnary()
      return { kind: "unary", operator: "-", operand }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): AstNode {
    const token = this.peek()

    if (token.type === "number") {
      this.consume()
      return { kind: "number", value: Number.parseFloat(token.value) }
    }

    if (token.type === "identifier") {
      this.consume()
      if (this.peek().type === "lparen") {
        this.consume()
        const argument = this.parseExpression()
        this.expect("rparen")
        return { kind: "function", name: token.value, argument }
      }
      return { kind: "identifier", name: token.value }
    }

    if (token.type === "lparen") {
      this.consume()
      const node = this.parseExpression()
      this.expect("rparen")
      return { kind: "parenthesized", inner: node }
    }

    if (token.type === "percent") {
      this.consume()
      return { kind: "unit", operand: { kind: "number", value: 1 } }
    }

    throw new Error(`Neočekávaný token: ${token.type} (${token.value})`)
  }
}

function parseExpression(input: string): AstNode {
  const tokens = tokenize(input)
  const parser = new Parser(tokens)
  return parser.parseExpression()
}

function parseExpressionOnly(input: string): AstNode {
  const tokens = tokenize(input)
  const parser = new Parser(tokens)
  return parser.parse()
}

interface FormulaAssignment {
  target: string
  expression: string
}

function isSingleIdentifier(s: string): boolean {
  if (s.length === 0) return false
  if (!IDENTIFIER_START.test(s[0])) return false
  return s
    .slice(1)
    .split("")
    .every((c) => IDENTIFIER_BODY.test(c))
}

function parseAssignments(input: string): FormulaAssignment[] {
  const withoutComment = (input.split("—")[0] ?? input).trim()
  const parts = withoutComment
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const assignments: FormulaAssignment[] = []
  for (const part of parts) {
    const eqPos = part.indexOf("=")
    if (eqPos !== -1) {
      const before = part.slice(0, eqPos).trim()
      const after = part.slice(eqPos + 1).trim()
      if (isSingleIdentifier(before) && after.length > 0) {
        assignments.push({ target: before, expression: after })
        continue
      }
    }
    assignments.push({ target: "", expression: part })
  }
  return assignments
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export function evaluateExpression(
  expression: string,
  context: Record<string, number> = {},
  constants: Record<string, number> = {},
): number {
  const normalized = normalizeFormulaForEvaluation(expression)
  const trimmed = normalized.trim()
  if (trimmed.length === 0) {
    throw new Error("Výraz je prázdný")
  }

  const assignments = parseAssignments(trimmed)
  if (assignments.length === 1 && assignments[0].target === "") {
    return evaluateSingleExpression(assignments[0].expression, context, constants)
  }

  const results: Record<string, number> = { ...context }
  for (const assignment of assignments) {
    const value = evaluateSingleExpression(assignment.expression, results, constants)
    if (assignment.target) {
      results[assignment.target] = value
    }
  }

  for (let i = assignments.length - 1; i >= 0; i--) {
    if (assignments[i].target) {
      return results[assignments[i].target]
    }
  }
  return evaluateSingleExpression(
    assignments[assignments.length - 1].expression,
    results,
    constants,
  )
}

function evaluateSingleExpression(
  expression: string,
  context: Record<string, number> = {},
  constants: Record<string, number> = {},
): number {
  const trimmed = expression.trim()
  if (trimmed.length === 0) {
    throw new Error("Výraz je prázdný")
  }

  const allConstants = { ...CONSTANTS, ...constants }
  if (allConstants.N_A !== undefined && allConstants.NA === undefined) {
    allConstants.NA = allConstants.N_A
  } else if (allConstants.NA !== undefined && allConstants.N_A === undefined) {
    allConstants.N_A = allConstants.NA
  }
  const molarMassValues = extractMolarMassValues(trimmed, constants)
  const withMolarMasses = resolveMolarMasses(trimmed, constants)
  const prepared = substituteSpecialSymbols(withMolarMasses, Object.keys(constants), (symbol) => {
    const value = constants[symbol]
    return Number.isFinite(value) ? String(value) : "0"
  })

  const node = parseExpressionOnly(prepared)
  return evaluateNode(node, { ...context, ...allConstants, ...molarMassValues })
}

function evaluateNode(node: AstNode, context: Record<string, number>): number {
  switch (node.kind) {
    case "number":
      return node.value

    case "identifier": {
      if (node.name in context) {
        return context[node.name]
      }
      if (node.name in CONSTANTS) {
        return CONSTANTS[node.name]
      }
      if (node.name.startsWith("M_")) {
        const formulaPart = normalizeMolarMassFormula(node.name.slice(2))
        const mass = calculateMolarMass(formulaPart)
        if (mass !== null) {
          return mass
        }
      }
      throw new Error(`Neznámá proměnná: ${node.name}`)
    }

    case "binary": {
      const left = evaluateNode(node.left, context)
      const right = evaluateNode(node.right, context)
      const op = node.operator
      switch (op) {
        case "+":
          return left + right
        case "-":
          return left - right
        case "*":
        case "×":
        case "·":
        case "∙":
          return left * right
        case "/":
          if (right === 0) {
            throw new Error("Dělení nulou")
          }
          return left / right
        case "^":
          return left ** right
        case "=":
          return right
        default:
          throw new Error(`Neznámý operátor: ${op}`)
      }
    }

    case "unary":
      return -evaluateNode(node.operand, context)

    case "function": {
      const argument = evaluateNode(node.argument, context)
      switch (node.name) {
        case "sqrt":
          if (argument < 0) {
            throw new Error("Odmocnina záporného čísla")
          }
          return Math.sqrt(argument)
        case "sin":
          return Math.sin(argument)
        case "cos":
          return Math.cos(argument)
        case "tan":
          return Math.tan(argument)
        case "log":
          return Math.log10(argument)
        case "ln":
          return Math.log(argument)
        case "abs":
          return Math.abs(argument)
        case "exp":
          return Math.exp(argument)
        default:
          throw new Error(`Neznámá funkce: ${node.name}`)
      }
    }

    case "unit":
      return 1

    case "parenthesized":
      return evaluateNode(node.inner, context)

    default:
      throw new Error("Neplatný výraz")
  }
}

// ---------------------------------------------------------------------------
// LaTeX rendering
// ---------------------------------------------------------------------------

function escapeIdentifierPart(name: string): string {
  const escaped = name.replace(/%/g, "\\%")
  // Multi-letter alphabetic identifiers look better in roman type.
  if (escaped.length > 1 && /^[A-Za-z]+$/.test(escaped)) {
    return `\\mathrm{${escaped}}`
  }
  return escaped
}

/**
 * The explicit adduct separators of a molar-mass formula: the `·` in
 * `CuSO4·5H2O`. Unambiguous, so anything after one is an attached molecule —
 * water or otherwise (`CuSO4·6NH3`). They must never reach the output: KaTeX
 * has no glyph for `∙`, and a bare `·` would draw as an operator.
 */
const ADDUCT_SEPARATOR_REGEX = /[.*·∙]/

/**
 * The water-of-crystallisation tail written with the underscore separator: the
 * `_5H_2O` in `M_CuSO_4_5H_2O`. Underscores are otherwise subscript markers, so
 * unlike ADDUCT_SEPARATOR_REGEX this only applies to a trailing water molecule —
 * the same shape `normalizeMolarMassFormula` rewrites before computing, so what
 * we draw matches what we compute. The count is optional: `CaSO_4_H_2O` is a
 * monohydrate.
 */
const UNDERSCORE_WATER_TAIL_REGEX = /_(\d*)(H_?2O)$/

function formulaSegmentToLatex(segment: string): string {
  return (
    segment
      .split("_")
      .map((part) => part.replace(/(\d+)/g, "_{$1}").replace(/([A-Za-z]+)/g, "\\mathrm{$1}"))
      .join("")
      // A digits-only part following one that already ended in digits would emit
      // `_{4}_{2}` — a double subscript, which KaTeX refuses to render at all.
      // The empty group keeps it valid; the notation is ambiguous either way.
      .replace(/(_\{\d+\})(?=_\{)/g, "$1{}")
  )
}

function adductToLatex(adduct: string): string {
  // The count in front multiplies the whole attached molecule, so it is a
  // coefficient rather than a subscript on the atom that follows it.
  const count = adduct.match(/^\d+/)?.[0] ?? ""
  return `${count}${formulaSegmentToLatex(adduct.slice(count.length))}`
}

function molarMassFormulaToLatex(formula: string): string {
  const segments = formula.split(ADDUCT_SEPARATOR_REGEX)
  let anhydrous = segments[0]
  const adducts = segments.slice(1).map(adductToLatex)

  const water = anhydrous.match(UNDERSCORE_WATER_TAIL_REGEX)
  if (water) {
    anhydrous = anhydrous.slice(0, anhydrous.length - water[0].length)
    adducts.unshift(`${water[1]}\\mathrm{H}_{2}\\mathrm{O}`)
  }

  return [formulaSegmentToLatex(anhydrous), ...adducts].join(" \\cdot ")
}

function identifierToLatex(name: string): string {
  // Molar-mass references: M_<formula> -> M_{\mathrm{<formula>}}
  if (name.startsWith("M_")) {
    return `M_{${molarMassFormulaToLatex(name.slice(2))}}`
  }

  const trailingDigits = name.match(/(\d+)$/)
  const digits = trailingDigits ? trailingDigits[1] : undefined
  const base = digits ? name.slice(0, -digits.length) : name

  if (!base.includes("_")) {
    return digits ? `${escapeIdentifierPart(base)}_{${digits}}` : escapeIdentifierPart(base)
  }

  const parts = base.split("_")
  const head = parts[0]
  const tail = parts.slice(1)
  const subscriptParts = digits ? [...tail, digits] : tail
  let result = escapeIdentifierPart(head)
  if (subscriptParts.length > 0) {
    result += `_{${subscriptParts.map(escapeIdentifierPart).join("")}}`
  }
  return result
}

function stripParentheses(node: AstNode): AstNode {
  return node.kind === "parenthesized" ? node.inner : node
}

/**
 * `String(7.2e-10)` is `"7.2e-10"` — literal `e` notation, which reads as
 * broken text rather than math if dropped straight into LaTeX. Render it as
 * `7.2 \times 10^{-10}` instead; every other number passes through as-is.
 */
function numberNodeToLatex(value: number): string {
  const str = String(value)
  const match = str.match(/^(-?[0-9]+(?:\.[0-9]+)?)e([+-]?[0-9]+)$/)
  if (!match) return str
  const [, mantissa, exponent] = match
  return `${mantissa} \\times 10^{${exponent.replace(/^\+/, "")}}`
}

/** True for a number that renders as `m \times 10^{n}` — it already ends in
 * its own superscript, so using it bare as the base of an outer `^` would
 * stack two exponents with nothing to tell them apart (`10^{-10}^{2}` reads
 * as one compound "-10, 2", not "(10^-10) squared"). */
function isScientificNotationNumber(node: AstNode): boolean {
  return node.kind === "number" && /e[+-]?[0-9]+$/i.test(String(node.value))
}

function nodeToLatex(node: AstNode): string {
  switch (node.kind) {
    case "number":
      return numberNodeToLatex(node.value)

    case "identifier":
      return identifierToLatex(node.name)

    case "binary": {
      if (node.operator === "/") {
        const left = nodeToLatex(stripParentheses(node.left))
        const right = nodeToLatex(stripParentheses(node.right))
        return `\\frac{${left}}{${right}}`
      }
      if (node.operator === "^") {
        const strippedLeft = stripParentheses(node.left)
        const leftLatex = nodeToLatex(strippedLeft)
        const left = isScientificNotationNumber(strippedLeft)
          ? `\\left(${leftLatex}\\right)`
          : leftLatex
        const right = nodeToLatex(stripParentheses(node.right))
        return `{${left}}^{${right}}`
      }
      const left = nodeToLatex(node.left)
      const right = nodeToLatex(node.right)
      if (node.operator === "=") {
        return `${left} = ${right}`
      }
      const op = node.operator
      let renderedOp: string
      if (op === "*" || op === "×") {
        renderedOp = "\\times "
      } else if (op === "·" || op === "∙") {
        renderedOp = "\\cdot "
      } else {
        renderedOp = `${op} `
      }
      return `${left} ${renderedOp}${right}`
    }

    case "unary":
      return `-${nodeToLatex(node.operand)}`

    case "function": {
      const arg = nodeToLatex(node.argument)
      if (node.name === "sqrt") {
        return `\\sqrt{${arg}}`
      }
      if (FUNCTIONS.has(node.name)) {
        return `\\${node.name}\\left(${arg}\\right)`
      }
      return `${identifierToLatex(node.name)}\\left(${arg}\\right)`
    }

    case "unit": {
      const operand = nodeToLatex(node.operand)
      return `${operand}\\%`
    }

    case "parenthesized":
      return `\\left(${nodeToLatex(node.inner)}\\right)`

    default:
      return ""
  }
}

const PLACEHOLDER_REGEX = /\[\[([^\]=\s]+)(?:=[^\]]*)?\]\]/g

/**
 * A placeholder naming the substance of a molar mass. It belongs to that
 * identifier, so it is unwrapped without the separating spaces the general case
 * needs: `M_[[LATKA]]` is one reference, not `M_` next to `LATKA`.
 */
const MOLAR_MASS_PLACEHOLDER_REGEX = new RegExp(`(?<=M_)${PLACEHOLDER_REGEX.source}`, "g")

function preprocessEquation(text: string): string {
  return text
    .replace(MOLAR_MASS_PLACEHOLDER_REGEX, "$1")
    .replace(PLACEHOLDER_REGEX, " $1 ")
    .replace(/⁻/g, "^-")
    .replace(/¹/g, "^1")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
}

function renderSingleEquationAsLatex(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return ""
  }

  // Placeholders are unwrapped before normalisation: it rewrites `[` as `(`,
  // which would leave nothing for preprocessEquation to recognise and draw
  // `[[MASS=5]]` as a doubly parenthesised equation.
  const normalized = normalizeFormulaForEvaluation(preprocessEquation(trimmed))

  if (normalized.includes("$") || normalized.includes("\\frac")) {
    const escaped = normalized.replace(/_/g, "\\_")
    return escaped.startsWith("$") ? escaped : `$$${escaped}$$`
  }

  try {
    const node = parseExpression(normalized)
    return `$$${nodeToLatex(node)}$$`
  } catch {
    const escaped = normalized.replace(/\\/g, "\\\\").replace(/_/g, "\\_")
    return `$$\\text{${escaped}}$$`
  }
}

export function renderEquationAsLatex(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return ""
  }

  const parts = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (parts.length === 0) {
    return ""
  }

  const renderedParts = parts.map((part) => renderSingleEquationAsLatex(part))
  const inner = renderedParts
    .map((part) => part.replace(/^\$\$/, "").replace(/\$\$$/, ""))
    .join(" \\; \\text{;} \\; ")
  return `$$${inner}$$`
}

// ---------------------------------------------------------------------------
// Mock value picker
// ---------------------------------------------------------------------------

export function pickMockValues(
  variables: Pick<
    LocalVariableEdit,
    "placeholder" | "minValue" | "maxValue" | "step" | "varType"
  >[],
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const variable of variables) {
    if (variable.varType !== "numeric") {
      continue
    }
    const { minValue, maxValue, step, placeholder } = variable
    if (step <= 0 || maxValue <= minValue) {
      result[placeholder] = minValue
      continue
    }
    const totalSteps = Math.floor((maxValue - minValue) / step)
    const middleStep = Math.floor(totalSteps / 2)
    result[placeholder] = minValue + middleStep * step
  }
  return result
}

/** Mantissa precision for scientific notation, e.g. `5.21×10^24`. */
const SCIENTIFIC_MANTISSA_DECIMALS = 2

/**
 * Above this magnitude a plain decimal string stops being readable — and
 * JavaScript's own `toString` starts emitting `1.5e+25`, which is neither the
 * `×10^n` convention used everywhere else in the app nor something
 * `FormattedResult` can turn into a superscript.
 */
const SCIENTIFIC_UPPER_THRESHOLD = 1e6

/** Render as `m×10^n`; `FormattedResult` superscripts the exponent. */
function toScientificNotation(value: number): string {
  return value
    .toExponential(SCIENTIFIC_MANTISSA_DECIMALS)
    .replace(/e([+-]?)(\d+)/, (_, sign: string, digits: string) => {
      return `×10^${sign === "-" ? "-" : ""}${digits}`
    })
}

/** Matches the `×10^n` form that {@link formatNumberMaxDecimals} produces. */
const SCIENTIFIC_EXPONENT_REGEX = /×10\^([+-]?\d+)/g

/**
 * `1.52×10^25` → `1.52×10<sup>25</sup>`, for the places that render markup
 * (question text, answer chips, units). Only for in-app rendering — the
 * exported `.txt` builds its own HTML in the Rust writer.
 */
export function scientificNotationToHtml(text: string): string {
  return text.replace(SCIENTIFIC_EXPONENT_REGEX, "×10<sup>$1</sup>")
}

const SUPERSCRIPT_CHARS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
  "+": "⁺",
}

/**
 * `1.52×10^25` → `1.52×10²⁵` using real superscript characters, for plain-text
 * places that cannot render markup at all — toasts, badges, labels. Keeps a
 * bare `^` from ever reaching the screen.
 */
export function scientificNotationToUnicode(text: string): string {
  return text.replace(SCIENTIFIC_EXPONENT_REGEX, (_, exponent: string) => {
    const digits = [...exponent].map((char) => SUPERSCRIPT_CHARS[char] ?? char).join("")
    return `×10${digits}`
  })
}

/**
 * A number ready to drop straight into plain text: `1.52×10²⁵`. Prefer
 * `FormattedResult` where markup renders; use this everywhere else.
 */
export function formatNumberForText(value: number | undefined | null, maxDecimals = 2): string {
  return scientificNotationToUnicode(formatNumberMaxDecimals(value, maxDecimals))
}

export function formatNumberMaxDecimals(value: number | undefined | null, maxDecimals = 2): string {
  if (value == null || !Number.isFinite(value)) return ""
  const decimals = Math.max(0, maxDecimals)
  const fixed = value.toFixed(decimals)
  const rounded = Number(fixed)

  // Too small to survive rounding at this precision, or too large to write
  // out in full — either way scientific notation is the readable form.
  if ((rounded === 0 && value !== 0) || Math.abs(rounded) >= SCIENTIFIC_UPPER_THRESHOLD) {
    return toScientificNotation(value)
  }
  return rounded.toString()
}

export function substituteStringsInMolarMassReferences(
  text: string,
  stringSources: Array<{ placeholder: string; symbol: string }>,
  assignedStrings: Record<string, string>,
): string {
  let result = text
  for (const v of stringSources) {
    const value = assignedStrings[v.placeholder] ?? assignedStrings[v.symbol]
    if (value === undefined) continue

    const replaceRef = (symbol: string) => {
      const escaped = escapeRegexLiteral(symbol)
      result = result.replace(new RegExp(`M_${escaped}(?![A-Za-z0-9_])`, "g"), () => `M_${value}`)
    }

    replaceRef(v.symbol)
    if (v.placeholder !== v.symbol) {
      replaceRef(v.placeholder)
    }
  }
  return result
}

export function buildSubstitutedEquation(
  equationText: string,
  variables: VariableWithPlaceholder[],
  assignedValues: Record<string, number>,
  assignedStrings: Record<string, string>,
  constants: Record<string, number>,
  questionText?: string,
): string {
  const text = equationText.trim()
  if (text.length === 0) return ""

  const numericSources = variables
    .filter((vwp) => vwp.variable.varType === "numeric" && vwp.placeholder !== "ANS")
    .map((vwp) => ({ placeholder: vwp.placeholder, symbol: vwp.variable.symbol }))
  const stringSources = variables
    .filter((vwp) => vwp.variable.varType === "string" && vwp.placeholder !== "ANS")
    .map((vwp) => ({ placeholder: vwp.placeholder, symbol: vwp.variable.symbol }))

  const fixedMap = new Map<string, number>()
  if (questionText) {
    for (const { symbol, value } of extractPlaceholderValues(questionText)) {
      if (value === undefined) continue
      const numeric = Number(value)
      if (!Number.isNaN(numeric)) {
        fixedMap.set(symbol, numeric)
      }
    }
  }
  const fixedSources = Array.from(fixedMap.keys()).map((placeholder) => ({
    placeholder,
    symbol: placeholder,
  }))
  const allNumericSources = [...numericSources, ...fixedSources]

  let substituted = text
  for (const v of allNumericSources) {
    const value = assignedValues[v.placeholder] ?? assignedValues[v.symbol]
    if (value === undefined) continue
    substituted = substituted.replace(
      new RegExp(`\\[\\[${escapeRegexLiteral(v.placeholder)}(?:=[^\\]]*)?\\]\\]`, "g"),
      String(value),
    )
  }
  for (const v of stringSources) {
    const value = assignedStrings[v.placeholder] ?? assignedStrings[v.symbol]
    if (value === undefined) continue
    substituted = substituted.replace(
      new RegExp(`\\[\\[${escapeRegexLiteral(v.placeholder)}(?:=[^\\]]*)?\\]\\]`, "g"),
      value,
    )
  }

  const symbolsByLength = [...allNumericSources, ...stringSources].sort(
    (a, b) => b.symbol.length - a.symbol.length,
  )
  for (const v of symbolsByLength) {
    const value =
      assignedValues[v.placeholder] ??
      assignedValues[v.symbol] ??
      assignedStrings[v.placeholder] ??
      assignedStrings[v.symbol]
    if (value === undefined) continue
    substituted = substituted.replace(
      new RegExp(
        `(?<![A-Za-z0-9_${GREEK_START}-${GREEK_END}])${escapeRegexLiteral(v.symbol)}(?![A-Za-z0-9_${GREEK_START}-${GREEK_END}])`,
        "g",
      ),
      String(value),
    )
  }

  substituted = substituteStringsInMolarMassReferences(substituted, stringSources, assignedStrings)
  substituted = resolveMolarMasses(substituted, constants)
  substituted = substituteRemainingMolarMasses(substituted)

  return substituted
}

export function evaluateVariantAnswer(
  equationText: string,
  variables: VariableWithPlaceholder[],
  variant: Variant,
  constants: Record<string, number>,
  questionText?: string,
):
  | { ok: true; value: number; substituted: string }
  | { ok: false; error: string; substituted: string } {
  const substituted = buildSubstitutedEquation(
    equationText,
    variables,
    variant.assignedValues,
    variant.assignedStrings ?? {},
    constants,
    questionText,
  )
  if (substituted.trim().length === 0) {
    return { ok: false, error: "Equation is empty", substituted }
  }

  const expression = substituted.replace(/^[^=]*=\s*/, "")
  const normalized = normalizeFormulaForEvaluation(expression)

  try {
    const value = evaluateExpression(normalized, {}, constants)
    return { ok: true, value, substituted }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), substituted }
  }
}

export function createRandom(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Variable reference validation
// ---------------------------------------------------------------------------

interface VariableReference {
  placeholder: string
  symbol?: string
  varType?: "numeric" | "string"
}

export function validateEquationReferences(
  equationText: string,
  variables: VariableReference[],
  constants: Record<string, number> = {},
): string[] {
  const trimmed = equationText.trim()
  if (trimmed.length === 0) {
    return []
  }

  // Strip explanatory comments after an em dash so words like "Avogadrova"
  // inside "— (NA = Avogadrova konstanta)" are not treated as placeholders.
  const equationWithoutComment = trimmed.split("—")[0] ?? trimmed

  const available = new Set<string>()
  const stringVariables = new Set<string>()
  for (const variable of variables) {
    available.add(variable.placeholder)
    if (variable.symbol) {
      available.add(variable.symbol)
    }
    if (variable.varType === "string") {
      stringVariables.add(variable.placeholder)
      if (variable.symbol) {
        stringVariables.add(variable.symbol)
      }
    }
  }
  for (const symbol of Object.keys(constants)) {
    available.add(symbol)
  }

  const missing = new Set<string>()

  // 1) Explicitly bracketed placeholders.
  for (const placeholder of extractPlaceholders(equationWithoutComment)) {
    if (!available.has(placeholder)) {
      missing.add(placeholder)
    }
  }

  // 2) Validate each assignment in order so that a target defined in one
  //    clause is available to subsequent clauses (e.g. "ms = ...; mv = mr - ms").
  const assignments = parseAssignments(equationWithoutComment)
  for (const assignment of assignments) {
    // Validate the same text the evaluator will see: `[Cu(NH3)4]` only parses
    // as a formula once its brackets are round ones, and `÷`/`×` only tokenize
    // once rewritten. Placeholders are expanded first, before their `[[` is
    // turned into parentheses.
    let prepared = normalizeFormulaForEvaluation(preprocessEquation(assignment.expression))
    prepared = substituteSpecialSymbols(prepared, Object.keys(constants), () => " __CONST__ ")
    prepared = resolveMolarMasses(prepared, constants)
    const molarMassValues = extractMolarMassValues(prepared, constants)
    for (const symbol of Object.keys(molarMassValues)) {
      available.add(symbol)
    }

    try {
      const tokens = tokenize(prepared)
      for (const token of tokens) {
        if (
          token.type === "identifier" &&
          !available.has(token.value) &&
          !FUNCTIONS.has(token.value)
        ) {
          if (token.value.startsWith("M_")) {
            const formulaPart = normalizeMolarMassFormula(token.value.slice(2))
            if (calculateMolarMass(formulaPart) !== null) {
              continue
            }
            const varName = token.value.slice(2)
            if (stringVariables.has(varName)) {
              continue
            }
          }
          missing.add(token.value)
        }
      }
    } catch {
      const identifierRegex = new RegExp(
        `[A-Za-z_${GREEK_START}-${GREEK_END}][A-Za-z0-9_${GREEK_START}-${GREEK_END}%]*`,
        "g",
      )
      for (const match of prepared.matchAll(identifierRegex)) {
        const value = match[0]
        if (value !== "__CONST__" && !available.has(value) && !FUNCTIONS.has(value)) {
          if (value.startsWith("M_")) {
            const formulaPart = normalizeMolarMassFormula(value.slice(2))
            if (calculateMolarMass(formulaPart) !== null) {
              continue
            }
            const varName = value.slice(2)
            if (stringVariables.has(varName)) {
              continue
            }
          }
          missing.add(value)
        }
      }
    }

    if (assignment.target) {
      available.add(assignment.target)
    }
  }

  return Array.from(missing)
}
