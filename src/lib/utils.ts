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

/**
 * Generate a UUID for purely client-side use (React keys, local store ids).
 *
 * `crypto.randomUUID()` is gated behind secure contexts, so it is `undefined`
 * when the app is served over plain HTTP (the headless-VM deployment) — and
 * calling it mid-render crashes the whole tree because there is no error
 * boundary. `crypto.getRandomValues()` works on insecure origins too, so fall
 * back to an RFC 4122 v4 UUID built from it, then to Math.random() as a last
 * resort for very old webviews. None of these ids need cryptographic strength.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx

  const hex: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i].toString(16).padStart(2, "0"))
  }
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`
}

export interface PlaceholderMatch {
  symbol: string
  value?: string
}

/**
 * Read a number as it is written in Czech teaching materials: a decimal comma,
 * and a power of ten spelled `1,8.10-5`, `6.76×10-5` or `9.95000x10-5` rather
 * than `1.8e-5`. Returns undefined for anything that is not a single number.
 */
export function parseCzechNumber(value: string): number | undefined {
  const normalized = value
    .trim()
    .replace(/,/g, ".")
    .replace(/\s+/g, "")
    .replace(/[×x*]10\^?/g, "e")
    .replace(/\.10\^?/g, "e")
  if (normalized === "") return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
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

/**
 * Trigger a browser download of a text file by creating a temporary Blob
 * URL and clicking a synthetic `<a>` element. Works in both Tauri (no-op
 * if the webview has no download handler) and regular browser contexts.
 */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Sanitize a user-provided filename: strip path separators and other
 * characters that are illegal in filenames on common operating systems.
 * Does NOT add an extension — the caller decides that.
 */
export function sanitizeFilename(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
