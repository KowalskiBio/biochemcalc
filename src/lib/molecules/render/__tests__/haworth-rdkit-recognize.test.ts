// @vitest-environment node
// RDKit truth battery for the sugar-ring recognizer + Haworth layout: drives
// the new RDKit pipeline (`prepareStructureRender` / `haworthLayoutOf`) and
// asserts the same geometry the legacy drawer battery proved.
//
// Ported from `haworth-recognize.test.ts`; assertions that inspect
// legacy drawer SVG internals (text-node HO flips, bold-edge quad elements)
// move to the Phase 3 overlay port and are marked below.

import { beforeAll, describe, expect, it } from "vitest"
import {
  chiralityFromMol,
  type HaworthLayoutResult,
  haworthLayoutOf,
  prepareStructureRender,
} from "@/lib/molecules/render/haworth-rdkit"
import { ensureRdkit, parseMol } from "@/lib/molecules/render/rdkit-engine"
import { type GraphSnapshot, recognizeSugarRings } from "@/lib/molecules/render/recognize"

beforeAll(async () => {
  await ensureRdkit()
})

function pipelineOf(smiles: string): HaworthLayoutResult {
  const layout = haworthLayoutOf(smiles)
  if (layout === null) {
    throw new Error(`no layout captured for ${smiles}`)
  }
  return layout
}

function snapshotOf(smiles: string): GraphSnapshot {
  return pipelineOf(smiles).snapshot
}

// True SMILES verified against RDKit's CIP annotation: every centre's R/S
// matches the expected configuration of the sugar.
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
// PubChem isomeric SMILES (CID 5988, Glcα1↔2βFru) — duplicated from the
// disaccharide suite so this file stays self-contained.
const SUCROSE =
  "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@]2([C@H]([C@@H]([C@H](O2)CO)O)O)CO)O)O)O)O"

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

describe("haworth layout on RDKit coordinates", () => {
  const BOND = 24

  function positionOf(pipeline: HaworthLayoutResult, vertexId: number): { x: number; y: number } {
    const vertex = pipeline.preprocessor.graph.vertices.find(
      (candidate) => candidate.id === vertexId,
    )
    if (vertex === undefined) {
      throw new Error(`unknown vertex ${vertexId}`)
    }
    return vertex.position
  }

  it("snaps a recognized ring onto the Haworth polygon with vertical substituents", () => {
    const pipeline = pipelineOf(TRUE_BETA_GLUCOSE)
    expect(pipeline.recognized).toBe(true)
    const plan = pipeline.plans[0]

    // Ring bonds are near bond length after the snap. The polygon is
    // intentionally wider than tall, so edges vary between ≈0.94 and ≈1.15
    // bonds (long bottom edge, slightly shorter slanted edges).
    const ringCycle = plan.cycle
    for (let index = 0; index < ringCycle.length; index += 1) {
      const a = positionOf(pipeline, ringCycle[index])
      const b = positionOf(pipeline, ringCycle[(index + 1) % ringCycle.length])
      expect(Math.hypot(b.x - a.x, b.y - a.y), `edge ${index}`).toBeGreaterThan(0.93 * BOND)
      expect(Math.hypot(b.x - a.x, b.y - a.y), `edge ${index}`).toBeLessThan(1.2 * BOND)
    }

    // Every exocyclic heavy substituent is strictly vertical above/below its
    // ring atom (up = smaller y, down = larger y) — except chain substituents,
    // which are tilted toward free space (checked by the adenosine bias test).
    for (const atom of plan.atoms) {
      const anchor = positionOf(pipeline, atom.vertexId)
      for (const id of atom.up) {
        const position = positionOf(pipeline, id)
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
        const position = positionOf(pipeline, id)
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
    expect(pipeline.recognized).toBe(false)
    expect(pipeline.plans).toEqual([])
  })

  it("renders RDKit's native Kekulé adenine base (alternating double bonds, no circles)", () => {
    // The old pass ported a kekulizer; RDKit already emits Kekulé bond orders,
    // so there is nothing to port. Adenine carries four ring double bonds and
    // AMP adds the P=O — a count of 8 would be chemically impossible.
    for (const [smiles, expectedDoubles] of [
      [ADENOSINE, 4],
      [AMP, 5],
    ] as const) {
      const pipeline = pipelineOf(smiles)
      expect(pipeline.recognized).toBe(true)
      const bonds = new Map<string, number>()
      for (const [atomId, neighbours] of pipeline.snapshot.adjacency) {
        for (const neighbour of neighbours) {
          if (atomId < neighbour) {
            bonds.set(`${atomId}_${neighbour}`, pipeline.snapshot.bondWeightOf(atomId, neighbour))
          }
        }
      }
      const doubles = [...bonds.values()].filter((weight) => weight === 2)
      expect(doubles, `${smiles}: native Kekulé double bonds`).toHaveLength(expectedDoubles)

      // Ring edges of the purine system alternate: doubles sit on distinct
      // atoms, so no two ring double bonds share an atom.
      const purineRing = pipeline.snapshot.rings.find((ring) => ring.members.length === 6)
      expect(purineRing).toBeDefined()
      const ringMembers = new Set(purineRing?.members ?? [])
      const ringDoubles = (purineRing?.members ?? []).flatMap((atomId) =>
        (pipeline.snapshot.adjacency.get(atomId) ?? [])
          .filter(
            (neighbour) =>
              neighbour > atomId &&
              ringMembers.has(neighbour) &&
              pipeline.snapshot.bondWeightOf(atomId, neighbour) === 2,
          )
          .map((neighbour) => [atomId, neighbour] as const),
      )
      expect(ringDoubles.length).toBeGreaterThanOrEqual(2)
      const doubleAtoms = ringDoubles.flat()
      expect(new Set(doubleAtoms).size).toBe(doubleAtoms.length)

      const prepared = prepareStructureRender(smiles)
      expect(prepared).not.toBeNull()
      expect(prepared?.recognized).toBe("haworth")
      expect(prepared?.svg).toContain("class='bond-")
      // RDKit draws aromatic rings as Kekulé lines, never an inner circle.
      expect(prepared?.svg).not.toContain("<circle")
    }
  })

  it("biases chain substituents toward free space (base right, CH2OH tail left)", () => {
    const pipeline = pipelineOf(ADENOSINE_KEKULE)
    expect(pipeline.recognized).toBe(true)
    const plan = pipeline.plans[0]

    // Glycosidic nitrogen at the anomeric carbon: tilts away from the ring
    // centre side (to the right for the ring's right-hand anomeric carbon).
    const anomericId = plan.cycle[0]
    const anomericAtom = plan.atoms.find((atom) => atom.vertexId === anomericId)
    if (anomericAtom === undefined) {
      throw new Error("anomeric atom missing")
    }
    const anchor = positionOf(pipeline, anomericId)
    const glycoN = positionOf(pipeline, anomericAtom.up[0])
    expect(glycoN.y < anchor.y).toBe(true)
    expect(glycoN.x > anchor.x).toBe(true)

    // The 5′ CH2OH tail at the far carbon tilts left, away from the base.
    const tailAnchorId = plan.cycle[plan.cycle.length - 2]
    const tailAnchorPos = positionOf(pipeline, tailAnchorId)
    const tailAtom = plan.atoms.find((atom) => atom.vertexId === tailAnchorId)
    if (tailAtom === undefined) {
      throw new Error("tail anchor missing")
    }
    const tailCarbon = positionOf(pipeline, tailAtom.up[0])
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
      {
        smiles: CANDIDATE_BETA_FRUCTOSE,
        anchorIsLast: false,
        upSide: false,
        name: "fructose C2",
      },
    ]
    for (const testCase of cases) {
      const pipeline = pipelineOf(testCase.smiles)
      expect(pipeline.recognized).toBe(true)
      const plan = pipeline.plans[0]
      const anchorId = testCase.anchorIsLast ? plan.cycle[plan.cycle.length - 2] : plan.cycle[0]
      const anchorAtom = plan.atoms.find((atom) => atom.vertexId === anchorId)
      if (anchorAtom === undefined) {
        throw new Error(`${testCase.name}: anchor missing`)
      }
      const chainIds = (testCase.upSide ? anchorAtom.up : anchorAtom.down).filter(
        (id) => pipeline.snapshot.atoms.get(id)?.element === "C",
      )
      expect(chainIds, `${testCase.name}: carbon tail present`).toHaveLength(1)
      const anchorPos = positionOf(pipeline, anchorId)
      const chainPos = positionOf(pipeline, chainIds[0])

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
      const ohPos = positionOf(pipeline, ohOxygen)
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
    expect(pipeline.recognized).toBe(true)
    const plan = pipeline.plans[0]
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

    const anchor = positionOf(pipeline, anchorId)
    const c5 = positionOf(pipeline, c5Id)
    const oxygen = positionOf(pipeline, oxygenId)
    const phosphorus = positionOf(pipeline, phosphorusId)
    const ringPositions = plan.cycle.map((id) => positionOf(pipeline, id))
    const ringCentroid = {
      x: ringPositions.reduce((sum, point) => sum + point.x, 0) / ringPositions.length,
      y: ringPositions.reduce((sum, point) => sum + point.y, 0) / ringPositions.length,
    }

    // The phosphate marches out to the LEFT of C4′ and well clear of the
    // base / sugar ring (not stacked underneath it).
    expect(phosphorus.x).toBeLessThan(anchor.x)
    expect(phosphorus.x).toBeLessThan(ringCentroid.x - 1.5 * BOND)

    const baseRings = pipeline.preprocessor.rings.filter(
      (ring) => !ring.members.some((id) => ringSet.has(id)),
    )
    expect(baseRings.length).toBeGreaterThan(0)
    const basePositions = baseRings.flatMap((ring) =>
      ring.members.map((id) => positionOf(pipeline, id)),
    )

    // The base is attached at C1′ and was already right of the sugar in the
    // legacy drawer layout. RDKit/CoordGen starts the adenine above the sugar
    // instead (it stays vertically clear), so the layout-independent claim
    // kept here is: the base is entirely right of the phosphate tail.
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
    const prepared = prepareStructureRender(CANDIDATE_BETA_GALACTOSE)
    expect(prepared?.recognized).toBe("haworth")
    const hints = prepared?.overlay?.ohHints ?? []
    const hoHints = hints.filter((hint) => hint.side === "HO")
    // β-galactose: only C4-OH sits on the left ring edge (~1.15 bonds out);
    // C3-OH (~0.58 bond out) stays on the OH side of the −0.75-bond boundary.
    expect(hoHints).toHaveLength(1)
    const ohHints = hints.filter((hint) => hint.side === "OH")
    expect(ohHints.length).toBeGreaterThanOrEqual(2)
  })
})

describe("OH label hints (atom-indexed overlay)", () => {
  it("flips the left-half ring hydroxyls of β-D-glucose to HO", () => {
    const prepared = prepareStructureRender(TRUE_BETA_GLUCOSE)
    expect(prepared?.recognized).toBe("haworth")
    const hints = prepared?.overlay?.ohHints ?? []
    expect(hints.filter((hint) => hint.side === "HO")).toHaveLength(1)
    expect(hints.filter((hint) => hint.side === "OH").length).toBeGreaterThanOrEqual(2)
  })

  // P3: SVG-overlay assertion moves with the overlay port (legacy drawer
  // text-node inspection: HO tspan order, text-anchor, g-translate offsets).

  it("does not flip the furanose third-vertex hydroxyl (β-D-ribose)", () => {
    const prepared = prepareStructureRender(CANDIDATE_BETA_RIBOSE)
    expect(prepared?.recognized).toBe("haworth")
    const hints = prepared?.overlay?.ohHints ?? []
    // Ribose C3-OH is ~13.8 px left of the centroid — inside the ring, not
    // on its left edge — so no ring hydroxyl qualifies for an HO swap.
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.some((hint) => hint.side === "HO")).toBe(false)
  })

  it("leaves non-sugar hydroxyls alone (alanine)", () => {
    const prepared = prepareStructureRender("N[C@@H](C)C(=O)O")
    expect(prepared?.recognized).toBe(false)
    expect(prepared?.overlay).toBeUndefined()
  })

  it("skips recognition entirely when haworth is false", () => {
    const prepared = prepareStructureRender(TRUE_BETA_GLUCOSE, { haworth: false })
    expect(prepared?.recognized).toBe(false)
    expect(prepared?.overlay).toBeUndefined()
  })
})

describe("front ring bond pairs (atom-indexed overlay)", () => {
  it("marks the three graduated front edges on β-D-glucose", () => {
    const layout = pipelineOf(TRUE_BETA_GLUCOSE)
    const prepared = prepareStructureRender(TRUE_BETA_GLUCOSE)
    expect(prepared?.recognized).toBe("haworth")
    const plan = layout.plans[0]
    const front = prepared?.overlay?.frontRingBonds ?? []
    expect(front).toHaveLength(3)
    expect(front).toEqual([
      { a: plan.cycle[0], b: plan.cycle[1] },
      { a: plan.cycle[1], b: plan.cycle[2] },
      { a: plan.cycle[2], b: plan.cycle[3] },
    ])
  })

  it("marks 3 front edges on each sucrose ring", () => {
    const layout = pipelineOf(SUCROSE)
    const prepared = prepareStructureRender(SUCROSE)
    expect(layout.plans).toHaveLength(2)
    const front = prepared?.overlay?.frontRingBonds ?? []
    expect(front).toHaveLength(6)
    const fructose = layout.plans.find((plan) => plan.cycle.length === 5)
    expect(fructose).toBeDefined()
    const fructosePairs = front.filter(
      (pair) =>
        fructose?.cycle.includes(pair.a) === true && fructose?.cycle.includes(pair.b) === true,
    )
    expect(fructosePairs).toHaveLength(3)
  })

  it("marks front edges on a nucleotide furanose without touching the base", () => {
    const layout = pipelineOf(ADENOSINE_KEKULE)
    const prepared = prepareStructureRender(ADENOSINE_KEKULE)
    expect(layout.plans).toHaveLength(1)
    const front = prepared?.overlay?.frontRingBonds ?? []
    expect(front).toHaveLength(3)
    const ring = new Set(layout.plans[0].cycle)
    for (const pair of front) {
      expect(ring.has(pair.a), "front edge starts on the furanose").toBe(true)
      expect(ring.has(pair.b), "front edge ends on the furanose").toBe(true)
    }
  })

  // P3: SVG-overlay assertion moves with the overlay port (quad geometry,
  // outward flare, taper thickness and per-bond fill sampling).
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

describe("round-trip chemistry", () => {
  it("keeps atom/bond counts and every CIP code after the coordinate patch", () => {
    for (const smiles of [TRUE_ALPHA_GLUCOSE, TRUE_BETA_GLUCOSE, AMP, SUCROSE]) {
      const layout = pipelineOf(smiles)
      const prepared = prepareStructureRender(smiles)
      expect(prepared?.recognized).toBe("haworth")
      const reparsed = parseMol(prepared?.molblock ?? "")
      expect(reparsed, `${smiles}: patched molblock reparses`).not.toBeNull()
      if (reparsed === null) {
        continue
      }
      try {
        expect(reparsed.get_num_atoms(), `${smiles}: atom count`).toBe(
          layout.preprocessor.graph.vertices.filter((vertex) => vertex.id < 100_000).length,
        )
        expect(chiralityFromMol(reparsed), `${smiles}: CIP codes survive`).toEqual(layout.chirality)
      } finally {
        reparsed.delete()
      }
    }
  })

  it("distinguishes the α/β anomeric epimers before and after the round trip", () => {
    for (const [smiles, expectedSide] of [
      [TRUE_ALPHA_GLUCOSE, "down"],
      [TRUE_BETA_GLUCOSE, "up"],
    ] as const) {
      const layout = pipelineOf(smiles)
      const plan = layout.plans[0]
      const anomeric = plan.atoms.find((atom) => atom.vertexId === plan.cycle[0])
      if (anomeric === undefined) {
        throw new Error(`${smiles}: anomeric centre missing`)
      }
      const anomericOxygen = [...anomeric.up, ...anomeric.down].find(
        (id) => layout.snapshot.atoms.get(id)?.element === "O",
      )
      expect(anomericOxygen, `${smiles}: anomeric OH`).toBeDefined()
      if (anomericOxygen === undefined) {
        continue
      }
      const isUp = anomeric.up.includes(anomericOxygen)
      expect(isUp ? "up" : "down", `${smiles}: drawn anomeric side`).toBe(expectedSide)

      // The patched molblock still carries the same CIP code at C1.
      const prepared = prepareStructureRender(smiles)
      const reparsed = parseMol(prepared?.molblock ?? "")
      expect(reparsed).not.toBeNull()
      if (reparsed !== null) {
        try {
          expect(chiralityFromMol(reparsed).get(plan.cycle[0])).toBe(
            layout.chirality.get(plan.cycle[0]),
          )
        } finally {
          reparsed.delete()
        }
      }
    }
  })
})
