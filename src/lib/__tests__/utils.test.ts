import { afterEach, describe, expect, it, vi } from "vitest"
import {
  extractPlaceholders,
  extractPlaceholderValues,
  formatDecimalComma,
  generateId,
  isAtomPlaceholder,
  normalizeDecimalCommasInText,
  parseCzechNumber,
  replacePlaceholder,
  stripAnswerTargets,
} from "@/lib/utils"

describe("stripAnswerTargets", () => {
  it("removes a trailing answer-target marker", () => {
    expect(
      stripAnswerTargets("Vypočítejte látkové množství Ca^2+ v [[m]] g Ca(HSO_3)_2. [n]"),
    ).toBe("Vypočítejte látkové množství Ca^2+ v [[m]] g Ca(HSO_3)_2.")
  })

  it("removes several trailing markers with units", () => {
    expect(stripAnswerTargets("Vypočítejte obojí [n mol][m g]")).toBe("Vypočítejte obojí")
  })

  it("leaves double-bracket placeholders alone", () => {
    expect(stripAnswerTargets("Vypočítejte pro objem [[V]]")).toBe("Vypočítejte pro objem [[V]]")
  })

  it("leaves text without markers alone", () => {
    expect(stripAnswerTargets("Vypočítejte hmotnost roztoku.")).toBe(
      "Vypočítejte hmotnost roztoku.",
    )
  })

  it("only strips the trailing block, keeping bracketed asides mid-sentence", () => {
    expect(stripAnswerTargets("Vypočítejte [pozor] hmotnost [m]")).toBe(
      "Vypočítejte [pozor] hmotnost",
    )
  })
})

describe("extractPlaceholders", () => {
  it("extracts simple placeholders", () => {
    expect(extractPlaceholders("[[ms]] g látky ve [[mv]] g vody")).toEqual(["ms", "mv"])
  })

  it("returns unique placeholders", () => {
    expect(extractPlaceholders("[[ms]] a [[ms]]")).toEqual(["ms"])
  })

  it("supports symbols with percent sign and underscore", () => {
    expect(extractPlaceholders("[[v%]] a [[rho_r]]")).toEqual(["v%", "rho_r"])
  })

  it("extracts symbol from fixed-value placeholders", () => {
    expect(extractPlaceholders("[[v%=56 %]] a [[rho_r=0.9607]]")).toEqual(["v%", "rho_r"])
  })
})

describe("extractPlaceholderValues", () => {
  it("returns values for fixed placeholders", () => {
    expect(extractPlaceholderValues("[[v%=56 %]] (ρ = [[rho_r=0.9607]] g*cm^-3)")).toEqual([
      { symbol: "v%", value: "56 %" },
      { symbol: "rho_r", value: "0.9607" },
    ])
  })

  it("returns undefined value for non-fixed placeholders", () => {
    expect(extractPlaceholderValues("[[ms]] g ve [[mv]] g")).toEqual([
      { symbol: "ms" },
      { symbol: "mv" },
    ])
  })

  it("returns unique placeholders keeping the first occurrence", () => {
    expect(extractPlaceholderValues("[[v%=10]] a [[v%=20]]")).toEqual([
      { symbol: "v%", value: "10" },
    ])
  })
})

describe("replacePlaceholder", () => {
  it("renames a simple placeholder", () => {
    expect(replacePlaceholder("[[ms]] g", "ms", "x")).toBe("[[x]] g")
  })

  it("renames a fixed-value placeholder keeping the value", () => {
    expect(replacePlaceholder("[[v%=56 %]]", "v%", "x")).toBe("[[x=56 %]]")
  })
})

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("generateId", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns a valid RFC 4122 v4 UUID", () => {
    expect(generateId()).toMatch(UUID_V4_REGEX)
  })

  it("returns unique ids across calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()))
    expect(ids.size).toBe(1000)
  })

  it("falls back to getRandomValues when randomUUID is unavailable (plain-HTTP origins)", () => {
    const originalCrypto = globalThis.crypto
    vi.stubGlobal("crypto", {
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
    })
    expect(generateId()).toMatch(UUID_V4_REGEX)
  })

  it("falls back to Math.random when Web Crypto is unavailable entirely", () => {
    vi.stubGlobal("crypto", undefined)
    expect(generateId()).toMatch(UUID_V4_REGEX)
  })
})

describe("isAtomPlaceholder", () => {
  it("matches indexed atom placeholders", () => {
    expect(isAtomPlaceholder("atom1")).toBe(true)
    expect(isAtomPlaceholder("atom2")).toBe(true)
    expect(isAtomPlaceholder("ATOM10")).toBe(true)
  })

  it("matches bare element synonyms", () => {
    expect(isAtomPlaceholder("atom")).toBe(true)
    expect(isAtomPlaceholder("element")).toBe(true)
    expect(isAtomPlaceholder("prvek")).toBe(true)
  })

  it("does not match ordinary numeric placeholders", () => {
    expect(isAtomPlaceholder("ms")).toBe(false)
    expect(isAtomPlaceholder("rho_r")).toBe(false)
    expect(isAtomPlaceholder("atomX")).toBe(false)
  })
})

describe("formatDecimalComma", () => {
  it("swaps the decimal dot for a comma", () => {
    expect(formatDecimalComma("7.1")).toBe("7,1")
    expect(formatDecimalComma("-0.125")).toBe("-0,125")
  })

  it("leaves an integer string untouched", () => {
    expect(formatDecimalComma("42")).toBe("42")
  })

  it("converts only the decimal point of an e-notation mantissa", () => {
    expect(formatDecimalComma("1.52e+25")).toBe("1,52e+25")
  })
})

describe("normalizeDecimalCommasInText", () => {
  it("rewrites decimals a teacher typed with a dot", () => {
    expect(normalizeDecimalCommasInText("objem 1.25 l")).toBe("objem 1,25 l")
    expect(normalizeDecimalCommasInText("pH 7.1 a 3.02")).toBe("pH 7,1 a 3,02")
    expect(normalizeDecimalCommasInText("0.5%")).toBe("0,5%")
  })

  it("leaves hydrate separators alone", () => {
    expect(normalizeDecimalCommasInText("FeSO4.7H2O")).toBe("FeSO4.7H2O")
    expect(normalizeDecimalCommasInText("M_FeSO4.7H2O")).toBe("M_FeSO4.7H2O")
    expect(normalizeDecimalCommasInText("Ca3(PO4)2.4H2O")).toBe("Ca3(PO4)2.4H2O")
  })

  it("separates a hydrate from a decimal in the same sentence", () => {
    expect(normalizeDecimalCommasInText("CuSO4.5H2O v 0.25 l")).toBe("CuSO4.5H2O v 0,25 l")
  })

  it("rewrites a pinned placeholder value", () => {
    expect(normalizeDecimalCommasInText("[[rho_r=1.1296]]")).toBe("[[rho_r=1,1296]]")
  })

  it("leaves a unit dot and an e-notation exponent alone", () => {
    expect(normalizeDecimalCommasInText("g.cm^-3")).toBe("g.cm^-3")
    expect(normalizeDecimalCommasInText("1.5e-5")).toBe("1.5e-5")
  })
})

describe("parseCzechNumber", () => {
  it("reads an ordinary decimal comma", () => {
    expect(parseCzechNumber("22,4")).toBeCloseTo(22.4)
    expect(parseCzechNumber("0,25")).toBeCloseTo(0.25)
  })

  it("reads a decimal whose fraction starts with 10", () => {
    // These used to be swallowed by the power-of-ten rule: "1,105" parsed as
    // 1e5 = 100000, "0,105" as 0 and "3,10" as NaN.
    expect(parseCzechNumber("1,105")).toBeCloseTo(1.105)
    expect(parseCzechNumber("0,105")).toBeCloseTo(0.105)
    expect(parseCzechNumber("2,104")).toBeCloseTo(2.104)
    expect(parseCzechNumber("3,10")).toBeCloseTo(3.1)
    expect(parseCzechNumber("1,1029")).toBeCloseTo(1.1029)
  })

  it("still reads every Czech spelling of a power of ten", () => {
    expect(parseCzechNumber("1,8.10^-5")).toBeCloseTo(1.8e-5)
    expect(parseCzechNumber("1,8.10-5")).toBeCloseTo(1.8e-5)
    expect(parseCzechNumber("3,53.10^-4")).toBeCloseTo(3.53e-4)
    expect(parseCzechNumber("6.76×10-5")).toBeCloseTo(6.76e-5)
    expect(parseCzechNumber("9.95000x10-5")).toBeCloseTo(9.95e-5)
  })
})

describe("normalizeDecimalCommasInText idempotency", () => {
  it("is stable when applied twice to a Czech power of ten", () => {
    // api.ts persists this output on every save, so a second save must not
    // turn "3,53.10^-4" into "3,53,10^-4".
    const once = normalizeDecimalCommasInText("[[Ka=3.53.10^-4]]")
    expect(once).toBe("[[Ka=3,53.10^-4]]")
    expect(normalizeDecimalCommasInText(once)).toBe(once)
  })

  it("is stable on ordinary prose and hydrates", () => {
    for (const input of ["objem 1.25 l", "FeSO4.7H2O", "CuSO4.5H2O v 0.25 l", "2.104 g"]) {
      const once = normalizeDecimalCommasInText(input)
      expect(normalizeDecimalCommasInText(once)).toBe(once)
    }
  })
})
