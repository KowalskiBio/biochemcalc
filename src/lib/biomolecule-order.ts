// Order helpers for the biomolecule reorder dialogs.

import { stripRichMarkup } from "@/lib/rich-text"

const czechCollator = new Intl.Collator("cs", { sensitivity: "base", numeric: true })

/**
 * Compare two teacher-authored names for an alphabetical sort: rich-text
 * markup is stripped (FADH_{2} sorts as FADH2), accents follow Czech rules,
 * case is ignored and digit runs compare numerically ("B2" before "B12").
 * Equal keys let the caller's sort stay stable (original positions win).
 */
export function compareMoleculeNames(a: string, b: string): number {
  return czechCollator.compare(stripRichMarkup(a), stripRichMarkup(b))
}
