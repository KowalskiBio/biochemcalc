import { normalizeFormulaForEvaluation } from "@/lib/bulk-import-parser"
import type { Template } from "@/lib/types"

export function getEquationKey(template: Template): string {
  return template.equationText?.trim() || template.formula?.trim() || ""
}

function getRawEquationKey(template: Template): string {
  return template.equationText?.trim() || template.formula?.trim() || ""
}

export function normalizeEquationKey(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ""
  const withoutComment = trimmed.split("—")[0] ?? trimmed
  const normalized = normalizeFormulaForEvaluation(withoutComment)
  return normalized.replace(/\s+/g, "").replace(/_/g, "")
}

export function groupTemplatesByEquation(templates: Template[]): Map<string, Template[]> {
  const groups = new Map<string, Template[]>()
  for (const template of templates) {
    const rawKey = getRawEquationKey(template)
    const key = normalizeEquationKey(rawKey)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(template)
    groups.set(key, group)
  }
  return groups
}

export function getUniqueQuestionTexts(templates: Template[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const template of templates) {
    const text = template.questionText?.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    unique.push(text)
  }
  return unique
}

export function buildFormulaPayload(equationText: string): {
  formula: string
  equationText: string
} {
  return { formula: equationText, equationText }
}
