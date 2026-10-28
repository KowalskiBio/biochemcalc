// Explicit sub/superscript markup for teacher-authored strings (molecule
// names, facts, aliases, abbreviations).
//
// Markup is stored VERBATIM in the database and only interpreted at render
// time:
//   `_{...}` → subscript     FADH_{2}       → FADH₂
//   `^{...}` → superscript   SO_{4}^{2-}    → SO₄²⁻
//   (none)   → plain text    Vitamin B12     → Vitamin B12   (digits alone
//                                                            never script)
//
// Braces are mandatory and their content must be non-empty with no nesting;
// anything else (`_{`, `x^{}`, a lone `_`/`^`) stays literal, so prose like
// "a^b" or "level_1" is unaffected. Nested braces get the innermost valid
// pair (`a_{b_{c}}` → `a_{b` + c-sub + `}`): visibly mangled, which is the
// teacher's feedback that the markup was mistyped. There is deliberately NO
// escape hatch — a literal underscores/caret simply never sits inside braces.
//
// Display layers render with `splitRichText` (via <RichText/>); layers that
// can only carry plain strings — aria/title attributes, confirm-dialog
// interpolations, open-answer comparison — use `stripRichMarkup`.

export type RichTextStyle = "normal" | "sub" | "sup"

export interface RichTextPart {
  readonly text: string
  readonly style: RichTextStyle
}

/** One markup token: `_{...}` or `^{...}` with non-empty, brace-free content. */
const MARKUP_PATTERN = /([_^])\{([^{}]+)\}/g

/**
 * Split a teacher string into styled runs. Plain strings come back as one
 * `normal` part (fast path), so the common no-markup case carries no overhead
 * downstream.
 */
export function splitRichText(value: string): RichTextPart[] {
  if (!value.includes("_{") && !value.includes("^{")) {
    return [{ text: value, style: "normal" }]
  }
  const parts: RichTextPart[] = []
  let last = 0
  MARKUP_PATTERN.lastIndex = 0
  for (let match = MARKUP_PATTERN.exec(value); match !== null; match = MARKUP_PATTERN.exec(value)) {
    const preceding = value.slice(last, match.index)
    if (preceding.length > 0) {
      parts.push({ text: preceding, style: "normal" })
    }
    parts.push({ text: match[2], style: match[1] === "_" ? "sub" : "sup" })
    last = match.index + match[0].length
  }
  const trailing = value.slice(last)
  if (trailing.length > 0) {
    parts.push({ text: trailing, style: "normal" })
  }
  return parts
}

/** The display text without markup braces — what comparison and attributes see. */
export function stripRichMarkup(value: string): string {
  return value.replace(MARKUP_PATTERN, "$2")
}
