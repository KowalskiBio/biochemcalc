import { normalizeFormulaForEvaluation } from "@/lib/bulk-import-parser"
import { parseChemicalFormula } from "@/lib/chemical-formula-parser"
import type { LocalVariableEdit } from "@/lib/types"
import { extractPlaceholders } from "@/lib/utils"

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
  | "eof"

interface Token {
  type: TokenType
  value: string
}

const NUMBER_REGEX = /^[0-9]+(?:\.[0-9]+)?/

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

export function resolveMolarMasses(
  text: string,
  atomicWeights: Record<string, number> = {},
): string {
  const result: string[] = []
  let i = 0
  while (i < text.length) {
    if (text.startsWith("M_", i)) {
      const start = i + 2
      let end = start
      let parenDepth = 0
      while (end < text.length) {
        const c = text[end]
        const isFormulaChar =
          /[A-Za-z0-9_.*·∙]/.test(c)
        if (isFormulaChar) {
          end++
        } else if (c === "(") {
          parenDepth++
          end++
        } else if (c === ")" && parenDepth > 0) {
          parenDepth--
          end++
        } else {
          break
        }
      }
      const formulaPart = text.slice(start, end)
      if (atomicWeights[`M_${formulaPart}`] !== undefined) {
        result.push(String(atomicWeights[`M_${formulaPart}`]))
      } else {
        const withHydrateDots = formulaPart.replace(/_(\d+)(H_?2O)/g, ".$1$2")
        const formula = withHydrateDots.replace(/_/g, "")
        const parsed = parseChemicalFormula(formula, atomicWeights)
        if (parsed.ok) {
          result.push(String(parsed.value))
        } else {
          result.push(text.slice(i, end))
        }
      }
      i = end
    } else {
      result.push(text[i])
      i++
    }
  }
  return result.join("")
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
      char === "·"
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
      while (i < input.length && IDENTIFIER_BODY.test(input[i])) {
        value += input[i]
        i++
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
  operator: "+" | "-" | "*" | "/" | "^" | "=" | "×" | "·"
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

type AstNode = NumberNode | IdentifierNode | BinaryNode | UnaryNode | FunctionNode | UnitNode

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
        this.peek().value === "·")
    ) {
      const operator = this.consume().value as "*" | "/" | "×" | "·"
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
      return node
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

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export function evaluateExpression(
  expression: string,
  context: Record<string, number> = {},
  constants: Record<string, number> = {},
): number {
  const normalized = normalizeFormulaForEvaluation(expression)
  const rhs = normalized.includes("=") ? normalized.slice(normalized.indexOf("=") + 1) : normalized
  const trimmed = rhs.trim()
  if (trimmed.length === 0) {
    throw new Error("Výraz je prázdný")
  }

  const allConstants = { ...CONSTANTS, ...constants }
  const withMolarMasses = resolveMolarMasses(trimmed, constants)
  const prepared = substituteSpecialSymbols(withMolarMasses, Object.keys(constants), (symbol) => {
    const value = constants[symbol]
    return Number.isFinite(value) ? String(value) : "0"
  })

  const node = parseExpressionOnly(prepared)
  return evaluateNode(node, { ...context, ...allConstants })
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

    default:
      throw new Error("Neplatný výraz")
  }
}

// ---------------------------------------------------------------------------
// LaTeX rendering
// ---------------------------------------------------------------------------

function needsLatexEscape(name: string): string {
  const escaped = name.replace(/%/g, "\\%").replace(/_/g, "\\_")
  return escaped.includes("\\") ? `\\mathrm{${escaped}}` : escaped
}

function nodeToLatex(node: AstNode): string {
  switch (node.kind) {
    case "number":
      return String(node.value)

    case "identifier":
      return needsLatexEscape(node.name)

    case "binary": {
      const left = nodeToLatex(node.left)
      const right = nodeToLatex(node.right)
      if (node.operator === "/") {
        return `\\frac{${left}}{${right}}`
      }
      if (node.operator === "^") {
        return `{${left}}^{${right}}`
      }
      if (node.operator === "=") {
        return `${left} = ${right}`
      }
      const op = node.operator
      let renderedOp: string
      if (op === "*" || op === "×") {
        renderedOp = "\\times "
      } else if (op === "·") {
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
      return `${needsLatexEscape(node.name)}\\left(${arg}\\right)`
    }

    case "unit": {
      const operand = nodeToLatex(node.operand)
      return `${operand}\\%`
    }

    default:
      return ""
  }
}

function preprocessEquation(text: string): string {
  return text
    .replace(/\[\[([^\]=\s]+)(?:=[^\]]*)?\]\]/g, " $1 ")
    .replace(/⁻/g, "^-")
    .replace(/¹/g, "^1")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
}

export function renderEquationAsLatex(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return ""
  }

  const withSuperscripts = trimmed
    .replace(/⁻/g, "^-")
    .replace(/¹/g, "^1")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
  const normalized = normalizeFormulaForEvaluation(withSuperscripts)

  if (normalized.includes("$") || normalized.includes("\\frac")) {
    const escaped = normalized.replace(/_/g, "\\_")
    return escaped.startsWith("$") ? escaped : `$$${escaped}$$`
  }

  try {
    const prepared = preprocessEquation(normalized)
    const node = parseExpression(prepared)
    return `$$${nodeToLatex(node)}$$`
  } catch {
    const escaped = normalized.replace(/\\/g, "\\\\").replace(/_/g, "\\_")
    return `$$\\text{${escaped}}$$`
  }
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

export function formatNumberMaxDecimals(value: number | undefined | null, maxDecimals = 2): string {
  if (value == null || !Number.isFinite(value)) return ""
  return Number(value.toFixed(maxDecimals)).toString()
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

  const available = new Set<string>()
  for (const variable of variables) {
    available.add(variable.placeholder)
    if (variable.symbol) {
      available.add(variable.symbol)
    }
  }
  for (const symbol of Object.keys(constants)) {
    available.add(symbol)
  }

  const missing = new Set<string>()

  // 1) Explicitly bracketed placeholders.
  for (const placeholder of extractPlaceholders(trimmed)) {
    if (!available.has(placeholder)) {
      missing.add(placeholder)
    }
  }

  // 2) Bare symbols on the right-hand side of the equation.
  const rhs = trimmed.includes("=") ? trimmed.slice(trimmed.indexOf("=") + 1) : trimmed
  let prepared = preprocessEquation(rhs)
  prepared = substituteSpecialSymbols(prepared, Object.keys(constants), () => " __CONST__ ")
  prepared = resolveMolarMasses(prepared, constants)
  try {
    const tokens = tokenize(prepared)
    for (const token of tokens) {
      if (
        token.type === "identifier" &&
        !available.has(token.value) &&
        !FUNCTIONS.has(token.value)
      ) {
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
        missing.add(value)
      }
    }
  }

  return Array.from(missing)
}
