// @vitest-environment jsdom
// Disaccharide Haworth layout: both recognized rings must land on their
// canonical polygons without rotating each other, and the glycosidic bridge
// must sit on the correct anomeric side at a full bond length.

import SmilesDrawer from "smiles-drawer"
import { describe, expect, it } from "vitest"
import { applyHaworthLayout, type HaworthPreprocessor } from "@/lib/molecules/render/haworth-layout"
import {
  type PreprocessorLike,
  snapshotFromPreprocessor,
} from "@/lib/molecules/render/pipeline-snapshot"
import {
  type GraphSnapshot,
  HAWORTH_POLYGON,
  recognizeSugarRings,
  type SugarRingRecognition,
} from "@/lib/molecules/render/recognize"

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

// PubChem isomeric SMILES (CID 6134, Galβ1→4Glc; CID 5988, Glcα1↔2βFru).
const LACTOSE =
  "C([C@@H]1[C@@H]([C@@H]([C@H]([C@@H](O1)O[C@@H]2[C@H](O[C@H]([C@@H]([C@H]2O)O)O)CO)O)O)O)O"
const SUCROSE =
  "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@]2([C@H]([C@@H]([C@H](O2)CO)O)O)CO)O)O)O)O"

const BOND = 24

function positionsOf(preprocessor: HaworthPreprocessor, ids: number[]): { x: number; y: number }[] {
  return ids.map((id) => {
    const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === id)
    if (vertex === undefined) {
      throw new Error(`unknown vertex ${id}`)
    }
    return vertex.position
  })
}

function centroidOf(points: { x: number; y: number }[]): { x: number; y: number } {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/** O/S/N vertex adjacent to ring atoms of two different plans. */
function findBridge(snapshot: GraphSnapshot, plans: SugarRingRecognition[]): number {
  const ringPlanOf = new Map<number, number>()
  plans.forEach((plan, index) => {
    for (const id of plan.cycle) {
      ringPlanOf.set(id, index)
    }
  })
  for (const [id, atom] of snapshot.atoms) {
    if (!["O", "S", "N"].includes(atom.element)) {
      continue
    }
    const neighbourPlans = new Set(
      (snapshot.adjacency.get(id) ?? [])
        .map((neighbour) => ringPlanOf.get(neighbour))
        .filter((plan): plan is number => plan !== undefined),
    )
    if (neighbourPlans.size >= 2) {
      return id
    }
  }
  throw new Error("no glycosidic bridge found")
}

/**
 * Ring atoms must match the canonical polygon (optionally x-mirrored) up to
 * translation. The ring centroid absorbs the translation, so every role's
 * offset from the centroid must equal the polygon role's offset from the
 * polygon centroid, within half a pixel per component.
 */
function expectRingOnPolygon(
  preprocessor: HaworthPreprocessor,
  plan: SugarRingRecognition,
  mirror: boolean,
  label: string,
): void {
  const polygon = HAWORTH_POLYGON[plan.cycle.length as 5 | 6]
  const polygonCenter = centroidOf(polygon)
  const positions = positionsOf(preprocessor, plan.cycle)
  const ringCenter = centroidOf(positions)
  positions.forEach((position, role) => {
    const expected = mirror
      ? { x: 2 * polygonCenter.x - polygon[role].x, y: polygon[role].y }
      : polygon[role]
    const dx = position.x - ringCenter.x - (expected.x - polygonCenter.x) * BOND
    const dy = position.y - ringCenter.y - (expected.y - polygonCenter.y) * BOND
    expect(Math.abs(dx), `${label} role ${role} x`).toBeLessThanOrEqual(0.5)
    expect(Math.abs(dy), `${label} role ${role} y`).toBeLessThanOrEqual(0.5)
  })
}

function expectDisjointX(
  left: { x: number; y: number }[],
  right: { x: number; y: number }[],
  label: string,
): void {
  const leftMax = Math.max(...left.map((position) => position.x))
  const rightMin = Math.min(...right.map((position) => position.x))
  const rightMax = Math.max(...right.map((position) => position.x))
  const leftMin = Math.min(...left.map((position) => position.x))
  expect(leftMax < rightMin || rightMax < leftMin, `${label}: ring x-bboxes disjoint`).toBe(true)
}

describe("disaccharide Haworth layout", () => {
  it("places both lactose rings canonically with a β-up glycosidic bridge", () => {
    const pipeline = pipelineOf(LACTOSE)
    const plans = recognizeSugarRings(pipeline.snapshot)
    expect(plans).toHaveLength(2)
    expect(applyHaworthLayout(pipeline.preprocessor)).toBe(true)

    const bridge = findBridge(pipeline.snapshot, plans)
    const bridgeNeighbours = pipeline.snapshot.adjacency.get(bridge) ?? []
    const donorIndex = plans.findIndex((plan) => bridgeNeighbours.includes(plan.cycle[0]))
    expect(donorIndex, "donor plan has an anomeric carbon on the bridge").toBeGreaterThanOrEqual(0)
    const acceptorIndex = donorIndex === 0 ? 1 : 0
    const donor = plans[donorIndex]
    const acceptor = plans[acceptorIndex]

    // Both rings sit on the canonical polygon up to translation.
    expectRingOnPolygon(pipeline.preprocessor, donor, false, "lactose donor")
    expectRingOnPolygon(pipeline.preprocessor, acceptor, false, "lactose acceptor")

    const donorAnchorId = donor.cycle[0]
    const acceptorAnchorId = acceptor.cycle.find((id) => bridgeNeighbours.includes(id))
    if (acceptorAnchorId === undefined) {
      throw new Error("acceptor anchor missing")
    }
    const [donorAnchor] = positionsOf(pipeline.preprocessor, [donorAnchorId])
    const [bridgePosition] = positionsOf(pipeline.preprocessor, [bridge])
    const [acceptorAnchor] = positionsOf(pipeline.preprocessor, [acceptorAnchorId])

    // Donor bond: β points up (smaller y), tilted toward +x at −72°.
    expect(bridgePosition.y).toBeLessThan(donorAnchor.y)
    expect(bridgePosition.x).toBeGreaterThan(donorAnchor.x)
    const donorLength = Math.hypot(
      bridgePosition.x - donorAnchor.x,
      bridgePosition.y - donorAnchor.y,
    )
    expect(donorLength).toBeGreaterThanOrEqual(0.8 * BOND)
    expect(donorLength).toBeLessThanOrEqual(BOND)
    const angleDegrees =
      (Math.atan2(bridgePosition.y - donorAnchor.y, bridgePosition.x - donorAnchor.x) * 180) /
      Math.PI
    expect(Math.abs(angleDegrees - -72)).toBeLessThanOrEqual(6)

    // Acceptor arrival: the glc C4 bond goes down and 18° toward the left —
    // a normal Haworth substituent on the acceptor ring, one full bond long.
    expect(bridgePosition.x).toBeLessThan(acceptorAnchor.x)
    expect(bridgePosition.y).toBeGreaterThan(acceptorAnchor.y)
    const acceptorLength = Math.hypot(
      acceptorAnchor.x - bridgePosition.x,
      acceptorAnchor.y - bridgePosition.y,
    )
    expect(Math.abs(acceptorLength - BOND)).toBeLessThanOrEqual(1.2)
    const acceptorAngle =
      (Math.atan2(bridgePosition.y - acceptorAnchor.y, bridgePosition.x - acceptorAnchor.x) * 180) /
      Math.PI
    expect(Math.abs(acceptorAngle - 108)).toBeLessThanOrEqual(6)

    expectDisjointX(
      positionsOf(pipeline.preprocessor, donor.cycle),
      positionsOf(pipeline.preprocessor, acceptor.cycle),
      "lactose",
    )

    // Every edge touching the glycosidic bridge is drawn as a plain line.
    const bridgeEdges = (pipeline.preprocessor.graph.edges ?? []).filter(
      (edge) => edge.sourceId === bridge || edge.targetId === bridge,
    )
    expect(bridgeEdges.length).toBeGreaterThan(0)
    for (const edge of bridgeEdges) {
      expect(edge.wedge ?? "").toBe("")
    }
  })

  it("places sucrose with canonical glucose and a mirrored fructofuranose", () => {
    const pipeline = pipelineOf(SUCROSE)
    const plans = recognizeSugarRings(pipeline.snapshot)
    expect(plans).toHaveLength(2)
    expect(applyHaworthLayout(pipeline.preprocessor)).toBe(true)

    const glucose = plans.find((plan) => plan.cycle.length === 6)
    const fructose = plans.find((plan) => plan.cycle.length === 5)
    if (glucose === undefined || fructose === undefined) {
      throw new Error("expected one pyranose and one furanose")
    }

    // Glucose stays canonical; fructose lands on the x-mirrored polygon.
    expectRingOnPolygon(pipeline.preprocessor, glucose, false, "sucrose glucose")
    expectRingOnPolygon(pipeline.preprocessor, fructose, true, "sucrose fructose")

    // The fructose anomeric carbon faces the bridge: leftmost ring atom.
    const fructosePositions = positionsOf(pipeline.preprocessor, fructose.cycle)
    const fructoseAnomeric = fructosePositions[0]
    for (let index = 1; index < fructosePositions.length; index += 1) {
      expect(fructoseAnomeric.x, "fructose anomeric is leftmost").toBeLessThan(
        fructosePositions[index].x,
      )
    }

    const bridge = findBridge(pipeline.snapshot, plans)
    const bridgeNeighbours = pipeline.snapshot.adjacency.get(bridge) ?? []
    expect(bridgeNeighbours, "glucose anomeric on the bridge").toContain(glucose.cycle[0])
    expect(bridgeNeighbours, "fructose anomeric on the bridge").toContain(fructose.cycle[0])

    const [glucoseAnchor] = positionsOf(pipeline.preprocessor, [glucose.cycle[0]])
    const [bridgePosition] = positionsOf(pipeline.preprocessor, [bridge])
    const [fructoseAnchor] = positionsOf(pipeline.preprocessor, [fructose.cycle[0]])

    // Glucose donor: α points down (larger y), one full bond.
    expect(bridgePosition.y).toBeGreaterThan(glucoseAnchor.y)
    const donorLength = Math.hypot(
      bridgePosition.x - glucoseAnchor.x,
      bridgePosition.y - glucoseAnchor.y,
    )
    expect(Math.abs(donorLength - BOND)).toBeLessThanOrEqual(1.2)

    // Fructose acceptor: the mirrored ring draws its canonical up bridge on
    // the DOWN side — below the anomeric carbon, tilted 18° left — and a
    // downward bond keeps the full bond length.
    expect(bridgePosition.x).toBeLessThan(fructoseAnchor.x)
    expect(bridgePosition.y).toBeGreaterThan(fructoseAnchor.y)
    const acceptorLength = Math.hypot(
      fructoseAnchor.x - bridgePosition.x,
      fructoseAnchor.y - bridgePosition.y,
    )
    expect(Math.abs(acceptorLength - BOND)).toBeLessThanOrEqual(1.2)
    const acceptorAngle =
      (Math.atan2(bridgePosition.y - fructoseAnchor.y, bridgePosition.x - fructoseAnchor.x) * 180) /
      Math.PI
    expect(Math.abs(acceptorAngle - 108)).toBeLessThanOrEqual(6)

    // The x-mirrored fructose must still read as D: every drawn side is
    // swapped back, so C5 CH2OH is down, C3-OH down, C4-OH up, the C2
    // CH2OH carbon up, and the glycosidic (C2) oxygen down.
    const elementOf = (id: number): string => {
      const atom = pipeline.snapshot.atoms.get(id)
      if (atom === undefined) {
        throw new Error(`unknown atom ${id}`)
      }
      return atom.element
    }
    const recognized = (vertexId: number) => {
      const atom = fructose.atoms.find((candidate) => candidate.vertexId === vertexId)
      if (atom === undefined) {
        throw new Error(`no recognized atom for ${vertexId}`)
      }
      return atom
    }
    const substituentWithElement = (vertexId: number, element: string): number => {
      const atom = recognized(vertexId)
      const match = [...atom.up, ...atom.down].find((id) => elementOf(id) === element)
      if (match === undefined) {
        throw new Error(`no ${element} substituent on ${vertexId}`)
      }
      return match
    }
    const yOf = (id: number): number => positionsOf(pipeline.preprocessor, [id])[0].y

    // cycle[0]=C2 anomeric, [1]=C3, [2]=C4, [3]=C5, [4]=ring O.
    const c5Chain = substituentWithElement(fructose.cycle[3], "C")
    expect(yOf(c5Chain), "C5 CH2OH drawn below C5").toBeGreaterThan(yOf(fructose.cycle[3]))
    const c3Hydroxyl = substituentWithElement(fructose.cycle[1], "O")
    expect(yOf(c3Hydroxyl), "C3-OH drawn below C3").toBeGreaterThan(yOf(fructose.cycle[1]))
    const c4Hydroxyl = substituentWithElement(fructose.cycle[2], "O")
    expect(yOf(c4Hydroxyl), "C4-OH drawn above C4").toBeLessThan(yOf(fructose.cycle[2]))
    const c2Chain = [...recognized(fructose.cycle[0]).up, ...recognized(fructose.cycle[0]).down]
      .filter((id) => id !== bridge)
      .find((id) => elementOf(id) === "C")
    if (c2Chain === undefined) {
      throw new Error("no C2 CH2OH carbon")
    }
    expect(yOf(c2Chain), "C2 CH2OH drawn above C2").toBeLessThan(yOf(fructose.cycle[0]))
    expect(yOf(bridge), "glycosidic O drawn below C2").toBeGreaterThan(yOf(fructose.cycle[0]))

    expectDisjointX(
      positionsOf(pipeline.preprocessor, glucose.cycle),
      positionsOf(pipeline.preprocessor, fructose.cycle),
      "sucrose",
    )
  })
})
