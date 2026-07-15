import { parseChemicalFormula } from "@/lib/chemical-formula-parser"

export const MOLAR_MASS_UNIT = "g/mol"

export interface BulkImportEntry {
  symbol: string
  formula: string
  value: number
}

function deriveFormula(symbol: string): string {
  return symbol.startsWith("M_") ? symbol.slice(2) : symbol
}

function parseNumber(text: string): number | null {
  const normalized = text.replace(",", ".").trim()
  if (normalized === "") return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function computeMolarMass(
  formula: string,
  lineNumber: number,
  atomicWeights?: Record<string, number>,
): { value: number } | { error: string } {
  const result = parseChemicalFormula(formula, atomicWeights)
  if (!result.ok) {
    return { error: `Řádek ${lineNumber}: ${result.error} („${formula}")` }
  }
  return { value: result.value }
}

export function parseMolarMassBulkImport(
  input: string,
  atomicWeights?: Record<string, number>,
): {
  entries: BulkImportEntry[]
  errors: string[]
} {
  const entries: BulkImportEntry[] = []
  const parseErrors: string[] = []
  const seen = new Set<string>()

  const lines = input.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (line.length === 0) continue
    if (line.startsWith("#")) continue

    const parts = line.split("=")
    if (parts.length > 3) {
      parseErrors.push(
        `Řádek ${i + 1}: očekáván formát Symbol = vzorec = hodnota ("${raw.trim()}")`,
      )
      continue
    }

    let symbol: string
    let formula: string
    let value: number | undefined

    if (parts.length === 3) {
      symbol = parts[0].trim()
      formula = parts[1].trim()
      const valueText = parts[2].trim()
      const parsedValue = parseNumber(valueText)
      if (parsedValue === null) {
        parseErrors.push(`Řádek ${i + 1}: „${valueText}" není platné číslo`)
        continue
      }
      value = parsedValue
    } else if (parts.length === 2) {
      symbol = parts[0].trim()
      const right = parts[1].trim()
      if (right === "") {
        formula = deriveFormula(symbol)
        value = undefined
      } else {
        const parsedValue = parseNumber(right)
        if (parsedValue !== null) {
          formula = deriveFormula(symbol)
          value = parsedValue
        } else {
          formula = right
          value = undefined
        }
      }
    } else {
      symbol = line
      formula = deriveFormula(symbol)
      value = undefined
    }

    if (!symbol) {
      parseErrors.push(`Řádek ${i + 1}: chybí referenční symbol`)
      continue
    }

    if (!formula) {
      parseErrors.push(`Řádek ${i + 1}: chybí vzorec pro „${symbol}"`)
      continue
    }

    if (value === undefined) {
      const computed = computeMolarMass(formula, i + 1, atomicWeights)
      if ("error" in computed) {
        parseErrors.push(computed.error)
        continue
      }
      value = computed.value
    }

    if (seen.has(symbol)) {
      parseErrors.push(`Řádek ${i + 1}: „${symbol}" je v seznamu vícekrát`)
      continue
    }

    seen.add(symbol)
    entries.push({ symbol, formula, value })
  }

  return { entries, errors: parseErrors }
}
