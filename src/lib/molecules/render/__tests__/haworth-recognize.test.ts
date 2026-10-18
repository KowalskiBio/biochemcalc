// @vitest-environment jsdom
// Truth battery for the sugar-ring recognizer: drives the real smiles-drawer
// pipeline headlessly, then asserts the derived Haworth up/down sides against
// the known depictions (α/β-D-glucopyranose, β-D-galaktopyranóza,
// α-D-manopyranóza, adenosine/AMP ribose).

import SmilesDrawer from "smiles-drawer"
import { describe, expect, it } from "vitest"
import {
  applyHaworthHOLabels,
  applyHaworthLayout,
  collectOhLabelHints,
  type HaworthPreprocessor,
} from "@/lib/molecules/render/haworth-layout"
import {
  type PreprocessorLike,
  snapshotFromPreprocessor,
} from "@/lib/molecules/render/pipeline-snapshot"
import { type GraphSnapshot, recognizeSugarRings } from "@/lib/molecules/render/recognize"

interface Pipeline {
  snapshot: GraphSnapshot
  preprocessor: HaworthPreprocessor
}

function pipelineOf(smiles: string): Pipeline {
  let captured: Pipeline | null = null
  SmilesDrawer.parse(smiles, (tree: unknown) => {
    const drawer = new SmilesDrawer.SvgDrawer({ width: 400, height: 300, bondLength: 24 })
    const preprocessor = (
      drawer as unknown as {
        preprocessor: HaworthPreprocessor & { processGraph: (...args: unknown[]) => void }
      }
    ).preprocessor
    const original = preprocessor.processGraph
    preprocessor.processGraph = ((...args: unknown[]) => {
      const result = original.apply(preprocessor, args)
      captured = {
        snapshot: snapshotFromPreprocessor(preprocessor as PreprocessorLike),
        preprocessor,
      }
      return result
    }) as typeof original
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    document.body.appendChild(svg)
    drawer.draw(tree, svg, "light")
    svg.remove()
  })
  if (captured === null) {
    throw new Error(`no snapshot captured for ${smiles}`)
  }
  return captured
}

function snapshotOf(smiles: string): GraphSnapshot {
  return pipelineOf(smiles).snapshot
}

// True SMILES verified against the library's R/S annotation (see the pipeline
// probe): every center's R/S matches the expected configuration of the sugar.
const TRUE_ALPHA_GLUCOSE = "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O)O)O)O)O"
const TRUE_BETA_GLUCOSE = "C([C@@H]1[C@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O"
const CANDIDATE_BETA_GALACTOSE = "C([C@@H]1[C@@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O"
const CANDIDATE_ALPHA_MANNOSE = "C([C@@H]1[C@H]([C@@H]([C@@H]([C@H](O1)O)O)O)O)O"
const ADENOSINE = "Nc1ncnc2c1ncn2[C@@H]3O[C@H](CO)[C@@H](O)[C@H]3O"
const AMP = "Nc1ncnc2c1ncn2[C@@H]3O[C@H](COP(=O)(O)O)[C@@H](O)[C@H]3O"
const CANDIDATE_BETA_FRUCTOSE = "OC[C@]1(O)[C@@H](O)[C@@H](O)[C@@H](CO)O1"
const CANDIDATE_BETA_RIBOSE = "OC[C@H]1O[C@@H](O)[C@H](O)[C@@H]1O"
const CANDIDATE_BETA_DEOXYRIBOSE = "OC[C@H]1O[C@@H](O)C[C@@H]1O"
// The kekulized seed form (uppercase, alternating double bonds) — the exact
// SMILES kept in `biomolecule_seed.rs`; the recognizer works on either form.
const ADENOSINE_KEKULE = "NC1=NC=NC2=C1N=CN2[C@@H]3O[C@H](CO)[C@@H](O)[C@H]3O"
const AMP_KEKULE = "NC1=NC=NC2=C1N=CN2[C@@H]3O[C@H](COP(=O)(O)O)[C@@H](O)[C@H]3O"

interface RoleExpectation {
  up: string[]
  down: string[]
}

function sidesOf(
  snapshot: GraphSnapshot,
  cycleRoleVertex: number,
  recognized: { up: number[]; down: number[] } | undefined,
): RoleExpectation {
  const elementOf = (ids: number[]): string[] =>
    ids.map((id) => {
      const atom = snapshot.atoms.get(id)
      if (atom === undefined) {
        throw new Error(`unknown atom ${id}`)
      }
      return atom.element
    })
  if (recognized === undefined) {
    throw new Error(`no recognized atom for role vertex ${cycleRoleVertex}`)
  }
  return {
    up: elementOf(recognized.up).filter((element) => element !== "H"),
    down: elementOf(recognized.down).filter((element) => element !== "H"),
  }
}

function expectRing(smiles: string, expectedRoles: RoleExpectation[], label: string): void {
  const snapshot = snapshotOf(smiles)
  const plans = recognizeSugarRings(snapshot)
  expect(plans, `${label}: a sugar ring should be recognized`).toHaveLength(1)
  const plan = plans[0]
  expect(plan.cycle.length, label).toBe(expectedRoles.length + 1)
  for (let role = 0; role < expectedRoles.length; role += 1) {
    const roleVertexId = plan.cycle[role]
    const recognized = plan.atoms.find((atom) => atom.vertexId === roleVertexId)
    const sides = sidesOf(snapshot, roleVertexId, recognized)
    expect(sides, `${label} role ${role + 1}`).toEqual(expectedRoles[role])
  }
}

describe("applyHaworthLayout", () => {
  const BOND = 24

  function positionOf(
    preprocessor: HaworthPreprocessor,
    vertexId: number,
  ): { x: number; y: number } {
    const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === vertexId)
    if (vertex === undefined) {
      throw new Error(`unknown vertex ${vertexId}`)
    }
    return vertex.position
  }

  it("snaps a recognized ring onto the Haworth polygon with vertical substituents", () => {
    const pipeline = pipelineOf(TRUE_BETA_GLUCOSE)
    const plans = recognizeSugarRings(pipeline.snapshot)
    expect(plans).toHaveLength(1)
    expect(applyHaworthLayout(pipeline.preprocessor)).toBe(true)
    const plan = plans[0]

    // Ring bonds are near bond length after the snap. The polygon is
    // intentionally wider than tall, so edges vary between ≈0.94 and ≈1.15
    // bonds (long bottom edge, slightly shorter slanted edges).
    const ringCycle = plan.cycle
    for (let index = 0; index < ringCycle.length; index += 1) {
      const a = positionOf(pipeline.preprocessor, ringCycle[index])
      const b = positionOf(pipeline.preprocessor, ringCycle[(index + 1) % ringCycle.length])
      expect(Math.hypot(b.x - a.x, b.y - a.y), `edge ${index}`).toBeGreaterThan(0.93 * BOND)
      expect(Math.hypot(b.x - a.x, b.y - a.y), `edge ${index}`).toBeLessThan(1.2 * BOND)
    }

    // Every exocyclic heavy substituent is strictly vertical above/below its
    // ring atom (up = smaller y, down = larger y) — except chain substituents,
    // which are tilted toward free space (checked by the adenosine bias test).
    for (const atom of plan.atoms) {
      const anchor = positionOf(pipeline.preprocessor, atom.vertexId)
      for (const id of atom.up) {
        const position = positionOf(pipeline.preprocessor, id)
        const isH =
          pipeline.preprocessor.graph.vertices.find((c) => c.id === id)?.value.element === "H"
        const isChain =
          !isH &&
          (
            pipeline.preprocessor.graph.vertices.find((candidate) => candidate.id === id)
              ?.neighbours ?? []
          ).some(
            (neighbour) =>
              neighbour !== atom.vertexId &&
              pipeline.preprocessor.graph.vertices.find((candidate) => candidate.id === neighbour)
                ?.value.element !== "H",
          )
        if (isChain) {
          continue
        }
        expect(Math.abs(position.x - anchor.x), `up ${id}`).toBeLessThan(0.01)
        expect(position.y < anchor.y, `up ${id}`).toBe(true)
      }
      for (const id of atom.down) {
        const position = positionOf(pipeline.preprocessor, id)
        expect(Math.abs(position.x - anchor.x), `down ${id}`).toBeLessThan(0.01)
        expect(position.y > anchor.y, `down ${id}`).toBe(true)
      }
    }

    // Stereo wedges on the ring's bonds were blanked (plain Haworth).
    const ringSet = new Set(plan.cycle)
    for (const edge of pipeline.preprocessor.graph.edges ?? []) {
      if (ringSet.has(edge.sourceId) && ringSet.has(edge.targetId)) {
        expect(edge.wedge ?? "").toBe("")
      }
    }
  })

  it("leaves non-sugar molecules untouched", () => {
    const pipeline = pipelineOf("C1CCOC1")
    expect(applyHaworthLayout(pipeline.preprocessor)).toBe(false)
  })

  it("kekulizes the adenine base (alternating double bonds, no circles)", () => {
    const pipeline = pipelineOf(ADENOSINE)
    expect(applyHaworthLayout(pipeline.preprocessor)).toBe(true)

    // Every formerly aromatic member atom lost the aromatic flag, so no
    // inner aromaticity circle is drawn.
    const aromaticLeft = pipeline.preprocessor.graph.vertices.filter(
      (vertex) => vertex.value.isPartOfAromaticRing === true,
    )
    expect(aromaticLeft).toEqual([])

    // Ring edges of the purine system alternate single/double: weights are
    // only 1 or 2, every ring edge stays between ring members, and each
    // aromatic ring carries at least one double bond with no two doubles
    // sharing an atom.
    const purineRing = pipeline.preprocessor.rings.find((ring) => ring.members.length === 6)
    expect(purineRing).toBeDefined()
    const ringMembers = new Set(purineRing?.members ?? [])
    const ringEdges = (pipeline.preprocessor.graph.edges ?? []).filter(
      (edge) => ringMembers.has(edge.sourceId) && ringMembers.has(edge.targetId),
    )
    expect(ringEdges.length).toBe(6)
    const doubles = ringEdges.filter((edge) => edge.weight === 2)
    expect(doubles.length).toBeGreaterThanOrEqual(2)
    const doubleAtoms = doubles.flatMap((edge) => [edge.sourceId, edge.targetId])
    expect(new Set(doubleAtoms).size).toBe(doubleAtoms.length)
  })

  it("biases chain substituents toward free space (base right, CH2OH tail left)", () => {
    const pipeline = pipelineOf(ADENOSINE_KEKULE)
    expect(applyHaworthLayout(pipeline.preprocessor)).toBe(true)
    const plan = recognizeSugarRings(pipeline.snapshot)[0]

    // Glycosidic nitrogen at the anomeric carbon: tilts away from the ring
    // centre side (to the right for the ring's right-hand anomeric carbon).
    const anomericId = plan.cycle[0]
    const anomericAtom = plan.atoms.find((atom) => atom.vertexId === anomericId)
    if (anomericAtom === undefined) {
      throw new Error("anomeric atom missing")
    }
    const anchor = positionOf(pipeline.preprocessor, anomericId)
    const glycoN = positionOf(pipeline.preprocessor, anomericAtom.up[0])
    expect(glycoN.y < anchor.y).toBe(true)
    expect(glycoN.x > anchor.x).toBe(true)

    // The 5′ CH2OH tail at the far carbon tilts left, away from the base.
    const tailAnchorId = plan.cycle[plan.cycle.length - 2]
    const tailAnchorPos = positionOf(pipeline.preprocessor, tailAnchorId)
    const tailAtom = plan.atoms.find((atom) => atom.vertexId === tailAnchorId)
    if (tailAtom === undefined) {
      throw new Error("tail anchor missing")
    }
    const tailCarbon = positionOf(pipeline.preprocessor, tailAtom.up[0])
    expect(tailCarbon.y < tailAnchorPos.y).toBe(true)
    // Pure -CH2OH tails draw strictly vertical (no tilt) with a 120° kink at
    // the chain vertex — the textbook look, replacing the former 18° lean.
    expect(Math.abs(tailCarbon.x - tailAnchorPos.x)).toBeLessThan(0.01)
  })

  it("draws pure -CH2OH tails strictly vertical with a 120° interior turn (textbook chain)", () => {
    const cases: { smiles: string; anchorIsLast: boolean; upSide: boolean; name: string }[] = [
      // Pyranose C5-CH2OH (glucose): bond up strict, 120° interior at CH2.
      { smiles: TRUE_BETA_GLUCOSE, anchorIsLast: true, upSide: true, name: "β-glucose C5" },
      // Fructose anomeric C2-CH2OH: bond down strict, 120° interior at CH2.
      { smiles: CANDIDATE_BETA_FRUCTOSE, anchorIsLast: false, upSide: false, name: "fructose C2" },
    ]
    for (const testCase of cases) {
      const pipeline = pipelineOf(testCase.smiles)
      expect(applyHaworthLayout(pipeline.preprocessor)).toBe(true)
      const plan = recognizeSugarRings(pipeline.snapshot)[0]
      const anchorId = testCase.anchorIsLast ? plan.cycle[plan.cycle.length - 2] : plan.cycle[0]
      const anchorAtom = plan.atoms.find((atom) => atom.vertexId === anchorId)
      if (anchorAtom === undefined) {
        throw new Error(`${testCase.name}: anchor missing`)
      }
      const chainIds = (testCase.upSide ? anchorAtom.up : anchorAtom.down).filter(
        (id) => pipeline.snapshot.atoms.get(id)?.element === "C",
      )
      expect(chainIds, `${testCase.name}: carbon tail present`).toHaveLength(1)
      const anchorPos = positionOf(pipeline.preprocessor, anchorId)
      const chainPos = positionOf(pipeline.preprocessor, chainIds[0])

      // First bond strictly vertical on the declared side.
      expect(Math.abs(chainPos.x - anchorPos.x), `${testCase.name}: tail verticality`).toBeLessThan(
        0.01,
      )
      if (testCase.upSide) {
        expect(chainPos.y < anchorPos.y, `${testCase.name}: tail above`).toBe(true)
      } else {
        expect(chainPos.y > anchorPos.y, `${testCase.name}: tail below`).toBe(true)
      }

      // Interior angle at the chain vertex between anchor and terminal O ≈ 120°.
      const chainVertex = pipeline.preprocessor.graph.vertices.find(
        (candidate) => candidate.id === chainIds[0],
      )
      if (chainVertex === undefined) {
        throw new Error(`${testCase.name}: chain vertex missing`)
      }
      const ohOxygen = (chainVertex.neighbours ?? []).find(
        (n) => n !== anchorId && pipeline.snapshot.atoms.get(n)?.element === "O",
      )
      expect(ohOxygen, `${testCase.name}: terminal O present`).toBeDefined()
      if (ohOxygen === undefined) {
        continue
      }
      const ohPos = positionOf(pipeline.preprocessor, ohOxygen)
      const angleToAnchor = Math.atan2(anchorPos.y - chainPos.y, anchorPos.x - chainPos.x)
      const angleToOh = Math.atan2(ohPos.y - chainPos.y, ohPos.x - chainPos.x)
      let interior = Math.abs(angleToOh - angleToAnchor)
      if (interior > Math.PI) {
        interior = 2 * Math.PI - interior
      }
      expect(
        Math.abs(interior - (2 * Math.PI) / 3),
        `${testCase.name}: interior ≈ 120°`,
      ).toBeLessThan(0.15)
    }
  })

  it("walks the AMP 5′ phosphate up-left, away from the adenine base", () => {
    const pipeline = pipelineOf(AMP_KEKULE)
    expect(applyHaworthLayout(pipeline.preprocessor)).toBe(true)
    const plan = recognizeSugarRings(pipeline.snapshot)[0]
    const graph = pipeline.preprocessor.graph
    const elementOf = (id: number): string | undefined =>
      graph.vertices.find((candidate) => candidate.id === id)?.value.element
    const neighboursOf = (id: number): number[] =>
      graph.vertices.find((candidate) => candidate.id === id)?.neighbours ?? []

    // C4′ is the tail anchor; C5′ → O → P is the phosphate chain.
    const ringSet = new Set(plan.cycle)
    const anchorId = plan.cycle[plan.cycle.length - 2]
    const c5Id = neighboursOf(anchorId).find((id) => !ringSet.has(id) && elementOf(id) === "C")
    if (c5Id === undefined) {
      throw new Error("AMP 5′ carbon missing")
    }
    const oxygenId = neighboursOf(c5Id).find((id) => id !== anchorId && elementOf(id) === "O")
    if (oxygenId === undefined) {
      throw new Error("AMP 5′ oxygen missing")
    }
    const phosphorusId = neighboursOf(oxygenId).find((id) => id !== c5Id && elementOf(id) === "P")
    if (phosphorusId === undefined) {
      throw new Error("AMP phosphorus missing")
    }

    const anchor = positionOf(pipeline.preprocessor, anchorId)
    const c5 = positionOf(pipeline.preprocessor, c5Id)
    const oxygen = positionOf(pipeline.preprocessor, oxygenId)
    const phosphorus = positionOf(pipeline.preprocessor, phosphorusId)
    const ringPositions = plan.cycle.map((id) => positionOf(pipeline.preprocessor, id))
    const ringCentroid = {
      x: ringPositions.reduce((sum, point) => sum + point.x, 0) / ringPositions.length,
      y: ringPositions.reduce((sum, point) => sum + point.y, 0) / ringPositions.length,
    }

    // The phosphate marches out to the LEFT of C4′ and well clear of the
    // base / sugar ring (not stacked underneath it).
    expect(phosphorus.x).toBeLessThan(anchor.x)
    expect(phosphorus.x).toBeLessThan(ringCentroid.x - 1.5 * BOND)

    // The whole adenine system stays to the RIGHT of the sugar: every base
    // ring atom is right of the ring centroid, and the base is right of the
    // phosphate (unchanged right-side placement, now guarded).
    const baseRings = pipeline.preprocessor.rings.filter(
      (ring) => !ring.members.some((id) => ringSet.has(id)),
    )
    expect(baseRings.length).toBeGreaterThan(0)
    const basePositions = baseRings.flatMap((ring) =>
      ring.members.map((id) => positionOf(pipeline.preprocessor, id)),
    )
    for (const basePosition of basePositions) {
      expect(basePosition.x).toBeGreaterThan(ringCentroid.x)
    }
    expect(Math.min(...basePositions.map((point) => point.x))).toBeGreaterThan(phosphorus.x)

    // Every link of the tail is a full bond length: the first tilted link and
    // both continuation links (which are normalized by the outward walk).
    const distance = (from: { x: number; y: number }, to: { x: number; y: number }): number =>
      Math.hypot(to.x - from.x, to.y - from.y)
    for (const [from, to] of [
      [anchor, c5],
      [c5, oxygen],
      [oxygen, phosphorus],
    ] as const) {
      expect(Math.abs(distance(from, to) - BOND)).toBeLessThanOrEqual(0.05 * BOND)
    }

    // Both continuation links turn 60° off vertical toward free space:
    // atan2(−1, −tan 60°) = −150° (up-left).
    const angleDegrees = (from: { x: number; y: number }, to: { x: number; y: number }): number =>
      (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
    const expected = (Math.atan2(-1, -Math.tan(Math.PI / 3)) * 180) / Math.PI
    for (const [from, to] of [
      [c5, oxygen],
      [oxygen, phosphorus],
    ] as const) {
      expect(Math.abs(angleDegrees(from, to) - expected)).toBeLessThanOrEqual(6)
    }
  })

  it("flags only the left ring-edge hydroxyls for the HO label convention", () => {
    const pipeline = pipelineOf(CANDIDATE_BETA_GALACTOSE)
    expect(applyHaworthLayout(pipeline.preprocessor)).toBe(true)
    const hints = collectOhLabelHints(pipeline.preprocessor)
    const hoHints = hints.filter((hint) => hint.side === "HO")
    // β-galactose: only C4-OH sits on the left ring edge (~1.15 bonds out);
    // C3-OH (~0.58 bond out) stays on the OH side of the −0.75-bond boundary.
    expect(hoHints).toHaveLength(1)
    const ohHints = hints.filter((hint) => hint.side === "OH")
    expect(ohHints.length).toBeGreaterThanOrEqual(2)
  })
})

describe("applyHaworthHOLabels", () => {
  const STYLE_TRANSLATE = /translateX\((-?[\d.]+)px\)\s*translateY\((-?[\d.]+)px\)/

  /**
   * Draw `smiles` exactly like the app does (Haworth reshape in the
   * processGraph hook, label fix immediately after draw) and keep the live
   * svg attached to the document so the DOM can be inspected.
   */
  function labeledSvgOf(smiles: string): {
    svg: SVGSVGElement
    preprocessor: HaworthPreprocessor
  } {
    let captured: { svg: SVGSVGElement; preprocessor: HaworthPreprocessor } | null = null
    SmilesDrawer.parse(smiles, (tree: unknown) => {
      const drawer = new SmilesDrawer.SvgDrawer({ width: 400, height: 300, bondLength: 24 })
      const preprocessor = (
        drawer as unknown as {
          preprocessor: HaworthPreprocessor & { processGraph: (...args: unknown[]) => void }
        }
      ).preprocessor
      const original = preprocessor.processGraph
      preprocessor.processGraph = ((...args: unknown[]) => {
        const result = original.apply(preprocessor, args)
        // Same order as the app: reshape the sugar ring, then label after draw.
        applyHaworthLayout(preprocessor)
        return result
      }) as typeof original
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      document.body.appendChild(svg)
      drawer.draw(tree, svg, "light")
      // Hints must come from the same preprocessor instance that drew the svg
      // so their coordinates line up with the emitted label translates.
      applyHaworthHOLabels(svg, collectOhLabelHints(preprocessor))
      captured = { svg, preprocessor }
    })
    if (captured === null) {
      throw new Error(`no svg captured for ${smiles}`)
    }
    return captured
  }

  function translatedPositionOf(text: Element): { x: number; y: number } | null {
    const parent = text.parentElement
    if (parent === null) {
      return null
    }
    const match = STYLE_TRANSLATE.exec(parent.getAttribute("style") ?? "")
    return match === null ? null : { x: Number(match[1]), y: Number(match[2]) }
  }

  function textOf(svg: SVGSVGElement, content: string): Element[] {
    return Array.from(svg.querySelectorAll("text")).filter(
      (text) => (text.textContent ?? "").trim() === content,
    )
  }

  /**
   * The one left ring-edge hydroxyl (C4) this pass is expected to flip. The
   * CH2OH terminal OH is already drawn as "HO" by the library's own
   * left-direction logic (a separate, pre-existing label), so the flipped
   * label is identified by its parent g landing on the "HO" hint's vertex y.
   */
  function expectRingHoFlips(svg: SVGSVGElement, preprocessor: HaworthPreprocessor): void {
    const hoHints = collectOhLabelHints(preprocessor).filter((hint) => hint.side === "HO")
    expect(hoHints).toHaveLength(1)

    const hoTexts = textOf(svg, "HO")
    const matches = hoTexts.flatMap((text) => {
      const translated = translatedPositionOf(text)
      const hint =
        translated === null
          ? undefined
          : hoHints.find((candidate) => Math.abs(candidate.y - translated.y) < 0.5)
      return hint === undefined || translated === null ? [] : [{ text, translated, hint }]
    })
    expect(matches).toHaveLength(1)
    // C2-OH, C3-OH and the anomeric OH stay "OH"; "O" is untouched.
    expect(textOf(svg, "OH")).toHaveLength(3)
    expect(textOf(svg, "O")).toHaveLength(1)
    // The flipped C4 label plus the library-native CH2OH terminal "HO".
    expect(hoTexts).toHaveLength(2)

    for (const { text, translated, hint } of matches) {
      expect(text.getAttribute("text-anchor")).toBe("end")
      const tspans = Array.from(text.children).filter((child) => child.localName === "tspan")
      expect(tspans.map((tspan) => (tspan.textContent ?? "").trim())).toEqual(["H", "O"])
      for (const tspan of tspans) {
        expect(tspan.hasAttribute("y")).toBe(false)
        expect(tspan.hasAttribute("x")).toBe(false)
      }
      // O centred on the bond: the whole label is shifted right by roughly
      // half the "O" glyph width, not ending exactly at the vertex.
      const offset = translated.x - hint.x
      expect(offset).toBeGreaterThan(2)
      expect(offset).toBeLessThan(9)
    }
  }

  it("flips the left-half ring hydroxyls of β-D-galactose to HO", () => {
    const { svg, preprocessor } = labeledSvgOf(CANDIDATE_BETA_GALACTOSE)
    try {
      expectRingHoFlips(svg, preprocessor)
    } finally {
      svg.remove()
    }
  })

  it("flips the left-half ring hydroxyls of β-D-glucose to HO", () => {
    const { svg, preprocessor } = labeledSvgOf(TRUE_BETA_GLUCOSE)
    try {
      expectRingHoFlips(svg, preprocessor)
    } finally {
      svg.remove()
    }
  })

  it("does not flip the furanose third-vertex hydroxyl (β-D-ribose)", () => {
    const { svg, preprocessor } = labeledSvgOf(CANDIDATE_BETA_RIBOSE)
    try {
      const hints = collectOhLabelHints(preprocessor)
      // Ribose C3-OH is ~13.8 px left of the centroid — inside the ring, not
      // on its left edge — so no ring hydroxyl qualifies for an HO swap.
      expect(hints.length).toBeGreaterThan(0)
      expect(hints.some((hint) => hint.side === "HO")).toBe(false)

      // Any native CH2OH-tail "HO" is fine; none may sit on a ring hint.
      const hintYs = hints.map((hint) => hint.y)
      const hintMatchedHo = textOf(svg, "HO").filter((text) => {
        const translated = translatedPositionOf(text)
        return translated !== null && hintYs.some((hintY) => Math.abs(hintY - translated.y) < 0.5)
      })
      expect(hintMatchedHo).toHaveLength(0)
    } finally {
      svg.remove()
    }
  })

  it("leaves non-sugar hydroxyls alone (alanine)", () => {
    const { svg } = labeledSvgOf("N[C@@H](C)C(=O)O")
    try {
      expect(textOf(svg, "HO")).toHaveLength(0)
    } finally {
      svg.remove()
    }
  })
})

describe("sugar-ring recognition", () => {
  it("recognizes α-D-glucopyranose (anomeric OH down)", () => {
    expectRing(
      TRUE_ALPHA_GLUCOSE,
      [
        { up: [], down: ["O"] },
        { up: [], down: ["O"] },
        { up: ["O"], down: [] },
        { up: [], down: ["O"] },
        { up: ["C"], down: [] },
      ],
      "α-glucose",
    )
  })

  it("recognizes β-D-glucopyranose (anomeric OH up)", () => {
    expectRing(
      TRUE_BETA_GLUCOSE,
      [
        { up: ["O"], down: [] },
        { up: [], down: ["O"] },
        { up: ["O"], down: [] },
        { up: [], down: ["O"] },
        { up: ["C"], down: [] },
      ],
      "β-glucose",
    )
  })

  it("recognizes β-D-galaktopyranóza (C4 epimer)", () => {
    expectRing(
      CANDIDATE_BETA_GALACTOSE,
      [
        { up: ["O"], down: [] },
        { up: [], down: ["O"] },
        { up: ["O"], down: [] },
        { up: ["O"], down: [] },
        { up: ["C"], down: [] },
      ],
      "β-galactose",
    )
  })

  it("recognizes α-D-manopyranóza (C2 epimer)", () => {
    expectRing(
      CANDIDATE_ALPHA_MANNOSE,
      [
        { up: [], down: ["O"] },
        { up: ["O"], down: [] },
        { up: ["O"], down: [] },
        { up: [], down: ["O"] },
        { up: ["C"], down: [] },
      ],
      "α-mannose",
    )
  })

  it("recognizes the ribose ring inside adenosine and AMP (aromatic and kekulé)", () => {
    const ribose: RoleExpectation[] = [
      { up: ["N"], down: [] }, // base at C1' (β)
      { up: [], down: ["O"] }, // C2'
      { up: [], down: ["O"] }, // C3'
      { up: ["C"], down: [] }, // C4' CH2OH
    ]
    expectRing(ADENOSINE, ribose, "adenosine")
    expectRing(AMP, ribose, "AMP")
    expectRing(ADENOSINE_KEKULE, ribose, "adenosine (kekulé)")
    expectRing(AMP_KEKULE, ribose, "AMP (kekulé)")
  })

  it("recognizes β-D-ribóza and 2-deoxy-β-D-ribóza from their isomeric SMILES", () => {
    expectRing(
      CANDIDATE_BETA_RIBOSE,
      [
        { up: ["O"], down: [] },
        { up: [], down: ["O"] },
        { up: [], down: ["O"] },
        { up: ["C"], down: [] },
      ],
      "β-ribose",
    )
    expectRing(
      CANDIDATE_BETA_DEOXYRIBOSE,
      [
        { up: ["O"], down: [] },
        { up: [], down: [] },
        { up: [], down: ["O"] },
        { up: ["C"], down: [] },
      ],
      "2-deoxy-β-ribose",
    )
  })

  it("recognizes β-D-fruktofuranóza (ketose, anomeric C2)", () => {
    const snapshot = snapshotOf(CANDIDATE_BETA_FRUCTOSE)
    const plans = recognizeSugarRings(snapshot)
    if (plans.length === 0) {
      // Structural topology unsupported yet (ketose) — record, don't guess.
      expect(plans).toEqual([])
      return
    }
    expect(plans).toHaveLength(1)
    const plan = plans[0]
    expect(plan.cycle.length).toBe(5)
    const expected: RoleExpectation[] = [
      { up: ["O"], down: ["C"] }, // anomeric C2: OH up (β), CH2OH down
      { up: ["O"], down: [] },
      { up: ["O"], down: [] },
      { up: ["C"], down: [] },
    ]
    for (let role = 0; role < expected.length; role += 1) {
      const roleVertexId = plan.cycle[role]
      const recognized = plan.atoms.find((atom) => atom.vertexId === roleVertexId)
      expect(sidesOf(snapshot, roleVertexId, recognized), `fructose role ${role + 1}`).toEqual(
        expected[role],
      )
    }
  })

  it("refuses rings that are not sugars or lack stereo information", () => {
    // Plain skeletal glucose (no stereo tags) → strict fallback.
    expect(recognizeSugarRings(snapshotOf("OCC1OC(O)C(O)C(O)C1O"))).toEqual([])
    // THF: no anomeric candidate.
    expect(recognizeSugarRings(snapshotOf("C1CCOC1"))).toEqual([])
    // Benzene: aromatic / no ring oxygen.
    expect(recognizeSugarRings(snapshotOf("c1ccccc1"))).toEqual([])
    // Alanine: no rings at all.
    expect(recognizeSugarRings(snapshotOf("N[C@@H](C)C(=O)O"))).toEqual([])
  })
})
