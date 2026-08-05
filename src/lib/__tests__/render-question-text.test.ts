import { describe, expect, it } from "vitest"

import {
  formatChemicalText,
  renderQuestionText,
  renderQuestionTextWithVariant,
} from "@/lib/render-question-text"
import type { Variant } from "@/lib/types"

describe("formatChemicalText", () => {
  it("converts caret charge notation to a superscript", () => {
    expect(formatChemicalText("Ca^2+")).toBe("Ca<sup>2+</sup>")
  })

  it("handles negative charges", () => {
    expect(formatChemicalText("SO4^2-")).toBe("SO4<sup>2-</sup>")
  })

  it("handles charges without sign", () => {
    expect(formatChemicalText("Ca^2")).toBe("Ca<sup>2</sup>")
  })

  it("converts underscore subscript notation", () => {
    expect(formatChemicalText("H_3PO_4")).toBe("H<sub>3</sub>PO<sub>4</sub>")
  })

  it("handles subscripts after parentheses", () => {
    expect(formatChemicalText("(NO_3)_2")).toBe("(NO<sub>3</sub>)<sub>2</sub>")
  })

  it("handles combined subscripts and superscripts", () => {
    expect(formatChemicalText("SO_4^2-")).toBe("SO<sub>4</sub><sup>2-</sup>")
  })

  it("converts multiplication asterisks to a multiplication sign", () => {
    expect(formatChemicalText("g*cm^-3")).toBe("g×cm<sup>-3</sup>")
    expect(formatChemicalText("2*3")).toBe("2×3")
  })

  it("converts multiplication middle dots to a multiplication sign", () => {
    expect(formatChemicalText("g·cm^-3")).toBe("g×cm<sup>-3</sup>")
  })

  it("converts hydrate dots and stars to a multiplication sign", () => {
    expect(formatChemicalText("FeSO4*7H2O")).toBe("FeSO4×7H2O")
    expect(formatChemicalText("FeSO4.7H2O")).toBe("FeSO4×7H2O")
    expect(formatChemicalText("FeSO4.7H_2O")).toBe("FeSO4×7H<sub>2</sub>O")
    expect(formatChemicalText("FeSO4.H2O")).toBe("FeSO4×H2O")
    expect(formatChemicalText("CO2.5H2O")).toBe("CO2×5H2O")
  })

  it("preserves decimal points in numbers", () => {
    expect(formatChemicalText("58.44 g")).toBe("58.44 g")
    expect(formatChemicalText("Hustota 1.5 g*cm^-3")).toBe("Hustota 1.5 g×cm<sup>-3</sup>")
  })

  it("does not convert asterisks used for markdown emphasis", () => {
    expect(formatChemicalText("*italic* text")).toBe("*italic* text")
  })

  it("does not affect placeholders", () => {
    expect(formatChemicalText("[[ion]] Ca^2+")).toBe("[[ion]] Ca<sup>2+</sup>")
  })
})

describe("renderQuestionText", () => {
  it("preserves chemical formatting while replacing placeholders", () => {
    const text = "Kolik gramů [[ms]] Ca^2+?"
    const result = renderQuestionText(text, [
      {
        placeholder: "ms",
        variable: {
          id: "1",
          name: "Mass",
          symbol: "ms",
          varType: "numeric",
          minValue: 10,
          maxValue: 20,
          step: 1,
          unit: "g",
          precision: 1,
          createdAt: "",
        },
        isShared: false,
      },
    ])
    expect(result).toContain("Ca<sup>2+</sup>")
    expect(result).toContain(">10<")
  })
})

describe("renderQuestionTextWithVariant", () => {
  const makeVariant = (values: Record<string, number>): Variant => ({
    id: "variant-1",
    templateId: "template-1",
    assignedValues: values,
    correctAnswer: 0,
    seed: 1,
    createdAt: "",
  })

  it("does not append unit to inline placeholders", () => {
    const text = "Kolik gramů [[ms]] Ca^2+?"
    const result = renderQuestionTextWithVariant(
      text,
      [
        {
          placeholder: "ms",
          variable: {
            id: "1",
            name: "Mass",
            symbol: "ms",
            varType: "numeric",
            minValue: 10,
            maxValue: 20,
            step: 1,
            unit: "g",
            precision: 1,
            createdAt: "",
          },
          isShared: false,
        },
      ],
      makeVariant({ ms: 12.5 }),
    )
    expect(result).toContain(">12.5<")
    expect(result).not.toContain(">12.5 g<")
    expect(result).not.toContain(">12.5g<")
  })

  it("renders assigned string values without units", () => {
    const text = "Jaká látka: [[substance]]?"
    const result = renderQuestionTextWithVariant(
      text,
      [
        {
          placeholder: "substance",
          variable: {
            id: "2",
            name: "Substance",
            symbol: "substance",
            varType: "string",
            minValue: 0,
            maxValue: 0,
            step: 1,
            unit: "",
            precision: 0,
            stringValues: ["NaCl", "KBr"],
            createdAt: "",
          },
          isShared: false,
        },
      ],
      { ...makeVariant({}), assignedStrings: { substance: "NaCl" } },
    )
    expect(result).toContain(">NaCl<")
  })

  it("applies chemical formatting to string variable values", () => {
    const text = "Vypočítejte hustotu [[plyn]]. [rho]"
    const result = renderQuestionTextWithVariant(
      text,
      [
        {
          placeholder: "plyn",
          variable: {
            id: "2",
            name: "Plyn",
            symbol: "plyn",
            varType: "string",
            minValue: 0,
            maxValue: 0,
            step: 1,
            unit: "",
            precision: 0,
            stringValues: ["CO_2", "N_2", "O_2"],
            createdAt: "",
          },
          isShared: false,
        },
      ],
      { ...makeVariant({}), assignedStrings: { plyn: "N_2" } },
    )
    expect(result).toContain("N<sub>2</sub>")
    expect(result).not.toContain(">N_2<")
  })

  it("renders fixed-value placeholders without brackets", () => {
    const text = "Hustota roztoku je [[rho_r=1.1296]] g*cm^-3. [c]"
    const result = renderQuestionTextWithVariant(text, [], makeVariant({}))
    expect(result).toContain(">1.1296<")
    expect(result).not.toContain("[[rho_r=1.1296]]")
    expect(result).toContain("g×cm<sup>-3</sup>")
  })

  it("converts dots in hydrates to multiplication dots without touching decimals in placeholders", () => {
    const text = "[[ns]] molu FeSO4.7H2O v [[nv]] molech vody? [wperc]"
    const result = renderQuestionTextWithVariant(
      text,
      [
        {
          placeholder: "ns",
          variable: {
            id: "1",
            name: "ns",
            symbol: "ns",
            varType: "numeric",
            minValue: 1,
            maxValue: 10,
            step: 1,
            unit: "mol",
            precision: 0,
            createdAt: "",
          },
          isShared: false,
        },
        {
          placeholder: "nv",
          variable: {
            id: "2",
            name: "nv",
            symbol: "nv",
            varType: "numeric",
            minValue: 1,
            maxValue: 10,
            step: 1,
            unit: "mol",
            precision: 0,
            createdAt: "",
          },
          isShared: false,
        },
      ],
      makeVariant({ ns: 5, nv: 3 }),
    )
    expect(result).toContain("FeSO4×7H2O")
    expect(result).not.toContain("FeSO4.7H2O")
    expect(result).toContain(">5<")
    expect(result).toContain(">3<")
  })

  it("renders constant placeholders from the constants map", () => {
    const text = "Molekulární hmotnost látky je [[M_x]] g/mol."
    const result = renderQuestionText(text, [], [], { M_x: 120.37 })
    expect(result).toContain(">120.37<")
    expect(result).not.toContain("[[M_x]]")
  })

  it("gives variables precedence over constants with the same placeholder", () => {
    const text = "Hodnota je [[x]]."
    const result = renderQuestionText(
      text,
      [
        {
          placeholder: "x",
          variable: {
            id: "1",
            name: "x",
            symbol: "x",
            varType: "numeric",
            minValue: 5,
            maxValue: 10,
            step: 1,
            unit: "g",
            precision: 0,
            createdAt: "",
          },
          isShared: false,
        },
      ],
      [],
      { x: 99 },
    )
    expect(result).toContain(">5<")
    expect(result).not.toContain(">99<")
  })

  it("renders constant placeholders with variants", () => {
    const text = "Hmotnost vzorku je [[M_x]] g."
    const result = renderQuestionTextWithVariant(text, [], makeVariant({}), [], { M_x: 58.44 })
    expect(result).toContain(">58.44<")
    expect(result).not.toContain("[[M_x]]")
  })

  it("formats numeric placeholder values with variable precision", () => {
    const text = "Hodnota je [[x]]."
    const result = renderQuestionTextWithVariant(
      text,
      [
        {
          placeholder: "x",
          variable: {
            id: "1",
            name: "x",
            symbol: "x",
            varType: "numeric",
            minValue: 0,
            maxValue: 100,
            step: 1,
            unit: "",
            precision: 0,
            createdAt: "",
          },
          isShared: false,
        },
      ],
      makeVariant({ x: 16.999999999 }),
    )
    expect(result).toContain(">17<")
    expect(result).not.toContain(">16.999999999<")
  })

  it("formats fallback numeric values with variable precision", () => {
    const text = "Hodnota je [[x]]."
    const result = renderQuestionText(text, [
      {
        placeholder: "x",
        variable: {
          id: "1",
          name: "x",
          symbol: "x",
          varType: "numeric",
          minValue: 16.1234,
          maxValue: 100,
          step: 1,
          unit: "",
          precision: 2,
          createdAt: "",
        },
        isShared: false,
      },
    ])
    expect(result).toContain(">16.12<")
  })
})
