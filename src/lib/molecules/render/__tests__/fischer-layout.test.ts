// @vitest-environment node
// Fischer projection core: recognizer + element builder for open-chain
// aldoses/ketoses. Golden sides come from the textbook Fischer patterns.
import { beforeAll, describe, expect, it } from "vitest"

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
  it("renders the classic vertical spine with crossings and terminal labels", () => {
    const recognition = recognize(OPEN_GLUCOSE)
    if (recognition === null) {
      throw new Error("glucose not recognized")
    }
    const drawing = drawFischer(recognition)
    const labels = drawing.elements.filter((element) => element.kind === "text")
    const texts = labels.map((element) => ("text" in element ? element.text : ""))

    // Terminals: CHO firmly above every crossing, CH2OH below every crossing.
    const cho = labels.find((element) => "text" in element && element.text === "CHO")
    const ch2oh = labels.find((element) => "text" in element && element.text === "CH2OH")
    const crossings = labels.filter(
      (element) => "text" in element && (element.text === "OH" || element.text === "HO"),
    )
    expect(crossings.length).toBe(4)
    expect(cho).toBeDefined()
    expect(ch2oh).toBeDefined()
    for (const crossing of crossings) {
      if (!("y" in crossing) || cho === undefined || ch2oh === undefined) continue
      expect(crossing.y).toBeGreaterThan(cho.y)
      expect(crossing.y).toBeLessThan(ch2oh.y)
    }

    // Left-side OH renders as "HO" (the classic left-flip idiom), right as "OH".
    expect(texts.filter((text) => text === "OH")).toHaveLength(3)
    expect(texts.filter((text) => text === "HO")).toHaveLength(1)
    // An "H" opposite every OH; no bare carbon letters anywhere.
    expect(texts.filter((text) => text === "H")).toHaveLength(4)
    expect(texts).not.toContain("C")

    // The spine is a constant x for every OH/HO crossing label's row anchor.
    const ohXs = crossings.map((element) => ("x" in element ? element.x : 0))
    for (const x of ohXs) {
      expect(Math.abs(x - ohXs[0])).toBeLessThan(80)
    }
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
