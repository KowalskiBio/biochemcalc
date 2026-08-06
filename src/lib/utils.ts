import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`${name} is required`)
  }
  return value
}

export interface PlaceholderMatch {
  symbol: string
  value?: string
}

export const PLACEHOLDER_REGEX = /\[\[([^\]=\s]+)(?:=([^\]]*))?\]\]/g

/**
 * Remove the trailing `[n]` / `[n mol]` answer-target markers from question
 * text. They tell the generator which symbol to solve for and are never part
 * of the question itself, so they must not be shown to teachers or students.
 *
 * Mirrors `scan_targets` in `src-tauri/src/engine/answer_targets.rs` — only a
 * contiguous run of markers at the very end counts, so a bracketed aside in
 * the middle of a sentence survives, and `[[x]]` placeholders are untouched.
 */
export function stripAnswerTargets(text: string): string {
  const trimmed = text.trim()
  let i = trimmed.length
  let blockStart = trimmed.length

  while (i > 0) {
    const before = trimmed.slice(0, i)
    const open = before.lastIndexOf("[")
    if (open === -1) break
    if (open + 1 >= i || before[i - 1] !== "]") break

    const inner = before.slice(open + 1, i - 1)
    if (inner === "" || inner.includes("[") || inner.includes("]")) break

    const symbol = inner.trim().split(/\s/, 1)[0] ?? ""
    if (symbol !== "") {
      blockStart = open
    }

    const trailing = before.slice(0, open).trimEnd()
    if (trailing === "") break
    i = trailing.length
  }

  return trimmed.slice(0, blockStart).trimEnd()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function replacePlaceholder(
  text: string,
  oldPlaceholder: string,
  newPlaceholder: string,
): string {
  return text.replace(
    new RegExp(`\\[\\[${escapeRegex(oldPlaceholder)}(=[^\\]]*)?\\]\\]`, "g"),
    (_match, value) => `[[${newPlaceholder}${value ?? ""}]]`,
  )
}

export function extractPlaceholders(text: string): string[] {
  const matches = text.matchAll(PLACEHOLDER_REGEX)
  const seen = new Set<string>()
  const placeholders: string[] = []
  for (const match of matches) {
    const name = match[1]
    if (!seen.has(name)) {
      seen.add(name)
      placeholders.push(name)
    }
  }
  return placeholders
}

export function extractPlaceholderValues(text: string): PlaceholderMatch[] {
  const matches = text.matchAll(PLACEHOLDER_REGEX)
  const seen = new Set<string>()
  const result: PlaceholderMatch[] = []
  for (const match of matches) {
    const symbol = match[1].trim()
    const value = match[2]?.trim()
    if (!seen.has(symbol)) {
      seen.add(symbol)
      result.push({ symbol, value })
    }
  }
  return result
}

const ATOM_PLACEHOLDER_REGEX = /^atom\d*$/i
const ELEMENT_SYNONYMS = new Set(["atom", "element", "prvek"])

export function isAtomPlaceholder(placeholder: string): boolean {
  const lower = placeholder.toLowerCase()
  return ELEMENT_SYNONYMS.has(lower) || ATOM_PLACEHOLDER_REGEX.test(lower)
}
