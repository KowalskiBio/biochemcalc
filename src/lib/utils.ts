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
