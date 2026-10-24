// @vitest-environment node
// Fischer projection core: recognizer + element builder for open-chain
// aldoses/ketoses. Golden sides come from the textbook Fischer patterns.
import { beforeAll, describe, expect, it } from "vitest"

import { ATOM_COLOR_NEUTRAL, ATOM_COLOR_OXYGEN } from "@/lib/molecules/render/atom-palette"
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
  /** Layout plumbing shared with production: bond ≈ ARM, ink-to-bond-end gap 2 px. */
  const ARM_APPROX = 26 * 0.8
  const BOND_LABEL_GAP = 2
  /** Left-side (HO) ink keeps its own measured adjacency — further out than the right side. */
  const LEFT_BOND_LABEL_GAP = 6

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
      expect(Math.abs(glyph.x - (spineX - 4))).toBeLessThan(0.01)
    }

    // The "2" is a real subscript: smaller font and dropped below its siblings.
    const twos = glyphs.filter((glyph) => glyph.text === "2")
    expect(twos).toHaveLength(1)
    expect(twos[0].fontSize).toBeLessThan(16)
    const siblingRowGlyphs = glyphs.filter((glyph) => glyph.y === twos[0].y - 5)
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

    // Every hydroxyl pair reads like the rest of the app: "HO" on the LEFT of
    // its bond (H outermost letter), "OH" on the RIGHT (O bond-adjacent).
    let leftPairRows = 0
    let rightPairRows = 0
    const uniqueRowYs = [...new Set(crossingYs)]
    for (const rowY of uniqueRowYs) {
      const row = glyphs.filter((glyph) => Math.abs(glyph.y - rowY) < 0.01)
      const left = row.filter((glyph) => glyph.x < spineX).sort((a, b) => a.x - b.x)
      const right = row.filter((glyph) => glyph.x > spineX).sort((a, b) => a.x - b.x)
      const leftHasHO = left.some((g) => g.text === "H") && left.some((g) => g.text === "O")
      const rightHasHO = right.some((g) => g.text === "H") && right.some((g) => g.text === "O")
      if (leftHasHO) {
        leftPairRows += 1
        expect(left[0].text, "left side reads H-first: HO").toBe("H")
        expect(left[1].text, "left side then O adjacent to the bond").toBe("O")
      }
      if (rightHasHO) {
        rightPairRows += 1
        expect(right[0].text, "right side reads O-first: OH").toBe("O")
        expect(right[1].text, "right side then H").toBe("H")
      }
      // Letter-slot spacing: the two letters of every pair are one full slot
      // apart — identical to what the RDKit skeletal side gives them (no
      // crowding, no overlap).
      for (const pair of [left, right]) {
        for (let index = 0; index + 1 < pair.length; index += 1) {
          const step = pair[index + 1].x - pair[index].x
          expect(step, "one full letter slot between adjacent letters").toBeGreaterThan(9)
          expect(step).toBeLessThan(11)
        }
      }
    }
    expect(leftPairRows, "glucose carries exactly one left-side HO pair").toBe(1)
    expect(rightPairRows, "glucose carries the three right-side OH pairs").toBe(3)

    // Adjacent-to-bond placement like the rest of the app: on the right the
    // O begins 2 px past the bond end; on the left the O's ink ends 2 px from
    // it — letters nearly touch their bond, never float away.
    for (const rowY of uniqueRowYs) {
      const row = glyphs.filter((glyph) => Math.abs(glyph.y - rowY) < 0.01)
      const rightO = row.find((glyph) => glyph.text === "O" && glyph.x > spineX)
      if (rightO !== undefined) {
        expect(
          Math.abs(rightO.x - (spineX + ARM_APPROX + BOND_LABEL_GAP)),
          "right-side O hugs the bond end",
        ).toBeLessThan(0.01)
      }
      const leftO = row.find((glyph) => glyph.text === "O" && glyph.x < spineX)
      if (leftO !== undefined) {
        expect(
          Math.abs(spineX - ARM_APPROX - LEFT_BOND_LABEL_GAP - leftO.x - 8),
          "left-side O keeps its six pixels of room",
        ).toBeLessThan(0.01)
      }
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
    // The ketone C2 vertex: locate it structurally from its double-bond
    // strokes (short parallel lines starting at the spine, ≈ARM long), then
    // look at the O on their baseline — independent of any letter arithmetic.
    const carbonylStrokes = drawing.elements.filter(
      (element): element is Extract<typeof element, { kind: "line" }> =>
        element.kind === "line" &&
        element.y1 === element.y2 &&
        Math.abs(element.x1 - spineX) < 0.01 &&
        Math.abs(element.x2 - element.x1 - ARM_APPROX) < 2.5,
    )
    const strokeYs = carbonylStrokes.map((line) => line.y1).sort((a, b) => a - b)
    expect(strokeYs, "the ketone double bond is two strokes at y ± 2").toHaveLength(2)
    const carbonylY = (strokeYs[0] + strokeYs[1]) / 2
    expect(Math.abs(strokeYs[1] - strokeYs[0] - 4)).toBeLessThan(0.01)

    const carbonylOxygen = glyphs.filter(
      (glyph) =>
        glyph.text === "O" && Math.abs(glyph.y - carbonylY) < 0.01 && glyph.x > spineX + 15,
    )
    expect(carbonylOxygen.length).toBeGreaterThan(0)
    for (const glyph of carbonylOxygen) {
      expect(glyph.fill).toBe(OXYGEN_RED)
    }

    // C2 is a junction, not a gap: vertical spine bonds run continuously
    // through the ketone slot — the bond arriving from above ends exactly at
    // the vertex's y and the bond leaving below starts exactly there.
    const spineLinks = drawing.elements
      .filter(
        (element): element is Extract<typeof element, { kind: "line" }> =>
          element.kind === "line" &&
          element.x1 === element.x2 &&
          Math.abs(element.x1 - spineX) < 0.01,
      )
      .sort((a, b) => a.y1 - b.y1)
    const arrivesAtVertex = spineLinks.some((line) => Math.abs(line.y2 - carbonylY) < 0.01)
    const leavesVertex = spineLinks.some((line) => Math.abs(line.y1 - carbonylY) < 0.01)
    expect(arrivesAtVertex, "upper bond meets the ketone vertex").toBe(true)
    expect(leavesVertex, "lower bond leaves the ketone vertex").toBe(true)
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
