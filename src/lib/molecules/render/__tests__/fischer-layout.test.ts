// @vitest-environment node
// Fischer projection core: recognizer + element builder for open-chain
// aldoses/ketoses. Golden sides come from the textbook Fischer patterns.
import { beforeAll, describe, expect, it } from "vitest"

import {
  ATOM_COLOR_NEUTRAL,
  ATOM_COLOR_OXYGEN,
} from "@/lib/molecules/render/atom-palette"
import { drawFischer, recognizeOpenChainSugar } from "@/lib/molecules/render/fischer-layout"
import { haworthLayoutOf } from "@/lib/molecules/render/haworth-rdkit"
import { ensureRdkit } from "@/lib/molecules/render/rdkit-engine"

beforeAll(async () => {
  await ensureRdkit()
})

const OPEN_GLUCOSE = "C([C@H]([C@H]([C@@H]([C@H](C=O)O)O)O)O)O"
const OPEN_FRUCTOSE = "O=C(CO)[C@@H](O)[C@H](O)[C@H](O)CO"
const D_GLYCERALDEHYDE = "O=C[C@H](O)CO"
const L_GLYCERALDEHYDE = "O=C[C@@H](O)CO"
const OPEN_RIBOSE = "O=C[C@H](O)[C@H](O)[C@H](O)CO"
const CYCLIC_GLUCOSE = "OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O"
const VALINE = "CC(C)[C@@H](C(=O)O)N"
const PROPANEDIOL = "CC(O)C(O)O"
const MALIC_ACID = "OC(CC(=O)O)C(=O)O"

function recognize(smiles: string) {
  const layout = haworthLayoutOf(smiles)
  if (layout === null) {
    throw new Error(`no layout for ${smiles}`)
  }
  return recognizeOpenChainSugar(layout.snapshot, layout.chirality)
}

describe("recognizeOpenChainSugar", () => {
  it("derives the D-glucose pattern (right, left, right, right)", () => {
    const result = recognize(OPEN_GLUCOSE)
    expect(result).not.toBeNull()
    expect(result?.ketone).toBe(false)
    expect(result?.topLabel).toBe("CHO")
    expect(result?.bottomLabel).toBe("CH2OH")
    expect(result?.centers.map((center) => center.ohSide)).toEqual([
      "right",
      "left",
      "right",
      "right",
    ])
  })

  it("derives the D-fructose ketose pattern (left, right, right)", () => {
    const result = recognize(OPEN_FRUCTOSE)
    expect(result).not.toBeNull()
    expect(result?.ketone).toBe(true)
    expect(result?.topLabel).toBe("CH2OH")
    expect(result?.centers.map((center) => center.ohSide)).toEqual(["left", "right", "right"])
  })

  it("handles single-center trioses (D- and L-glyceraldehyde)", () => {
    expect(recognize(D_GLYCERALDEHYDE)?.centers.map((c) => c.ohSide)).toEqual(["right"])
    expect(recognize(L_GLYCERALDEHYDE)?.centers.map((c) => c.ohSide)).toEqual(["left"])
  })

  it("derives the D-ribose pattern (all right)", () => {
    expect(recognize(OPEN_RIBOSE)?.centers.map((c) => c.ohSide)).toEqual([
      "right",
      "right",
      "right",
    ])
  })

  it("rejects cyclic sugars, non-polyhydroxy chains and branched chains", () => {
    expect(recognize(CYCLIC_GLUCOSE)).toBeNull()
    expect(recognize(VALINE)).toBeNull()
    expect(recognize(PROPANEDIOL)).toBeNull()
    expect(recognize(MALIC_ACID)).toBeNull()
  })
})

describe("drawFischer", () => {
  // Aliases to the shared app palette (atom-palette.ts) — never re-hardcode
  // the hexes here, the projection must track the palette by reference.
  const OXYGEN_RED = ATOM_COLOR_OXYGEN
  const NEUTRAL_INK = ATOM_COLOR_NEUTRAL

  interface Glyph {
    text: string
    x: number
    y: number
    anchor?: string
    fill?: string
    fontSize?: number
  }

  function glyphsOf(drawing: ReturnType<typeof drawFischer>): Glyph[] {
    return drawing.elements
      .filter((element) => element.kind === "text")
      .map((element) => element as unknown as Glyph & { kind: "text" })
  }

  it("renders terminal labels as carbon-centered runs with red oxygens and a true subscript", () => {
    const recognition = recognize(OPEN_GLUCOSE)
    if (recognition === null) {
      throw new Error("glucose not recognized")
    }
    const drawing = drawFischer(recognition)
    const glyphs = glyphsOf(drawing)
    const texts = glyphs.map((glyph) => glyph.text)

    // Nothing is spelled with "=" and no whole-word carbon labels anywhere.
    expect(texts.some((text) => text.includes("="))).toBe(false)
    expect(texts).not.toContain("CHO")
    expect(texts).not.toContain("CH2OH")

    // Every oxygen letter takes the atom palette; carbons/hydrogens stay ink.
    for (const glyph of glyphs) {
      const expected = glyph.text === "O" ? OXYGEN_RED : NEUTRAL_INK
      expect(glyph.fill, `glyph ${glyph.text} fill`).toBe(expected)
    }

    // The two terminal carbons (CHO top and CH2OH bottom) share exactly one x,
    // centered on the vertical spine bond (half a letter left of it).
    const spineXs = new Set(
      drawing.elements
        .filter(
          (element): element is Extract<typeof element, { kind: "line" }> =>
            element.kind === "line" && element.x1 === element.x2,
        )
        .map((line) => line.x1),
    )
    expect(spineXs.size).toBe(1)
    const spineX = [...spineXs][0]
    const terminalCs = glyphs.filter((glyph) => glyph.text === "C")
    expect(terminalCs).toHaveLength(2)
    for (const glyph of terminalCs) {
      expect(Math.abs(glyph.x - (spineX - 3.5))).toBeLessThan(0.01)
    }

    // The "2" is a real subscript: smaller font and dropped below its siblings.
    const twos = glyphs.filter((glyph) => glyph.text === "2")
    expect(twos).toHaveLength(1)
    expect(twos[0].fontSize).toBeLessThan(11)
    const siblingRowGlyphs = glyphs.filter((glyph) => glyph.y === twos[0].y - 4)
    expect(siblingRowGlyphs.length, "CH2OH row carries its siblings").toBeGreaterThanOrEqual(4)

    // Terminal labels hug the chain: top row above every crossing, bottom row below.
    const crossingYs = drawing.elements
      .filter(
        (element): element is Extract<typeof element, { kind: "line" }> =>
          element.kind === "line" && element.y1 === element.y2 && element.x1 < element.x2,
      )
      .map((line) => line.y1)
    expect(crossingYs.length).toBeGreaterThan(0)
    const [topY, bottomY] = [
      Math.min(...terminalCs.map((glyph) => glyph.y)),
      Math.max(...terminalCs.map((glyph) => glyph.y)),
    ]
    for (const y of crossingYs) {
      expect(y).toBeGreaterThan(topY)
      expect(y).toBeLessThan(bottomY)
    }
  })

  it("renders a ketose with a real double-bonded oxygen on the right, never '='", () => {
    const recognition = recognize(OPEN_FRUCTOSE)
    if (recognition === null) {
      throw new Error("fructose not recognized")
    }
    const drawing = drawFischer(recognition)
    const glyphs = glyphsOf(drawing)
    const texts = glyphs.map((glyph) => glyph.text)

    expect(texts.some((text) => text.includes("="))).toBe(false)
    expect(texts).not.toContain("C=O")
    // Both CH2OH terminals decompose: two subscript "2" runs.
    expect(
      glyphs.filter((glyph) => glyph.text === "2" && glyph.fontSize !== undefined),
    ).toHaveLength(2)

    // Exactly one red O strictly to the right of the glycosidic OH side, joined
    // by two short parallel horizontal strokes of equal y-offset.
    const spineXs = new Set(
      drawing.elements
        .filter(
          (element): element is Extract<typeof element, { kind: "line" }> =>
            element.kind === "line" && element.x1 === element.x2,
        )
        .map((line) => line.x1),
    )
    const spineX = [...spineXs][0]
    const carbonylOxygen = glyphs.filter((glyph) => glyph.text === "O" && glyph.x > spineX + 20)
    expect(carbonylOxygen.length).toBeGreaterThan(0)
    for (const glyph of carbonylOxygen) {
      expect(glyph.fill).toBe(OXYGEN_RED)
    }
    // Two short parallel strokes leave the spine, one exactly 2px above and
    // one exactly 2px below the carbonyl oxygen's baseline — a double bond,
    // never an equals sign.
    const ARM_APPROX = 26 * 0.8
    const strokes = drawing.elements.filter(
      (element): element is Extract<typeof element, { kind: "line" }> =>
        element.kind === "line" &&
        element.y1 === element.y2 &&
        Math.abs(element.x1 - spineX) < 0.01 &&
        Math.abs(element.x2 - element.x1 - ARM_APPROX) < 2.5 &&
        Math.abs(Math.abs(element.y1 - carbonylOxygen[0].y) - 2) < 0.01,
    )
    expect(strokes.map((line) => line.y1 - carbonylOxygen[0].y).sort((a, b) => a - b)).toEqual([
      -2, 2,
    ])
  })

  it("sizes up with chain length (glucose taller than ribose)", () => {
    const glucoseRecognition = recognize(OPEN_GLUCOSE)
    const riboseRecognition = recognize(OPEN_RIBOSE)
    if (glucoseRecognition === null || riboseRecognition === null) {
      throw new Error("aldoses not recognized")
    }
    const glucose = drawFischer(glucoseRecognition)
    const ribose = drawFischer(riboseRecognition)
    expect(glucose.height).toBeGreaterThan(ribose.height)
    expect(glucose.width).toBeGreaterThan(0)
  })
})
