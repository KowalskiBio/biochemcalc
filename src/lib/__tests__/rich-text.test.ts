import { describe, expect, it } from "vitest"

import { normalizeQuizAnswer } from "@/lib/molecules/quiz/question-generator"
import { type RichTextPart, splitRichText, stripRichMarkup } from "@/lib/rich-text"

function parts(...runs: [string, "normal" | "sub" | "sup"][]): RichTextPart[] {
  return runs.map(([text, style]) => ({ text, style }))
}

describe("splitRichText", () => {
  it("leaves plain text untouched in a single normal part (fast path)", () => {
    expect(splitRichText("Vitamín B12")).toEqual(parts(["Vitamín B12", "normal"]))
    expect(splitRichText("FADH2")).toEqual(parts(["FADH2", "normal"]))
    // A lone underscore or caret without braces is prose, not markup.
    expect(splitRichText("level_1")).toEqual(parts(["level_1", "normal"]))
    expect(splitRichText("a^2 > 0")).toEqual(parts(["a^2 > 0", "normal"]))
  })

  it("parses a trailing subscript (FADH2)", () => {
    expect(splitRichText("FADH_{2}")).toEqual(parts(["FADH", "normal"], ["2", "sub"]))
  })

  it("parses superscript charges", () => {
    expect(splitRichText("Ca^{2+}")).toEqual(parts(["Ca", "normal"], ["2+", "sup"]))
    expect(splitRichText("kyselina NO_{3}^{-}")).toEqual(
      parts(["kyselina NO", "normal"], ["3", "sub"], ["-", "sup"]),
    )
  })

  it("handles adjacent sub/super pairs (SO4^2-)", () => {
    expect(splitRichText("SO_{4}^{2-}")).toEqual(
      parts(["SO", "normal"], ["4", "sub"], ["2-", "sup"]),
    )
  })

  it("keeps multi-character content inside the braces", () => {
    expect(splitRichText("C_{6}H_{12}O_{6}")).toEqual(
      parts(
        ["C", "normal"],
        ["6", "sub"],
        ["H", "normal"],
        ["12", "sub"],
        ["O", "normal"],
        ["6", "sub"],
      ),
    )
  })

  it("treats empty braces as literal text", () => {
    expect(splitRichText("x_{}")).toEqual(parts(["x_{}", "normal"]))
    expect(splitRichText("x^{}")).toEqual(parts(["x^{}", "normal"]))
  })

  it("treats an unclosed marker as literal text", () => {
    expect(splitRichText("FADH_{2")).toEqual(parts(["FADH_{2", "normal"]))
  })

  it("parses the innermost pair of nested braces (visible mangling flags the typo)", () => {
    expect(splitRichText("a_{b_{c}}")).toEqual(
      parts(["a_{b", "normal"], ["c", "sub"], ["}", "normal"]),
    )
  })

  it("never parses markup twice across already-consumed spans", () => {
    expect(splitRichText("H_{2}O_{2}")).toEqual(
      parts(["H", "normal"], ["2", "sub"], ["O", "normal"], ["2", "sub"]),
    )
  })
})

describe("stripRichMarkup", () => {
  it("collapses markup to its visible text", () => {
    expect(stripRichMarkup("FADH_{2}")).toBe("FADH2")
    expect(stripRichMarkup("SO_{4}^{2-}")).toBe("SO42-")
  })

  it("is a no-op on plain or syntactically unbalanced strings", () => {
    expect(stripRichMarkup("Vitamín B12")).toBe("Vitamín B12")
    expect(stripRichMarkup("x_{}")).toBe("x_{}")
    expect(stripRichMarkup("FADH_{2")).toBe("FADH_{2")
  })
})

describe("open-answer comparison", () => {
  it("ignores markup, so students never type braces", () => {
    expect(normalizeQuizAnswer("FADH_{2}")).toBe(normalizeQuizAnswer("fadh2"))
    expect(normalizeQuizAnswer("  SO_{4}^{2-} ")).toBe(normalizeQuizAnswer("So42-"))
  })
})
