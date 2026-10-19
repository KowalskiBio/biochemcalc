// @vitest-environment jsdom
// Porphyrin/chlorin idealizer: real smiles-drawer in jsdom, capture the
// preprocessor after its own layout, then assert the reshaped geometry.

import SmilesDrawer from "smiles-drawer"
import { describe, expect, it } from "vitest"
import {
  applyPorphyrinCoordinationLines,
  applyPorphyrinLayout,
  type PorphyrinPreprocessor,
} from "@/lib/molecules/render/porphyrin-layout"
import {
  type PreprocessorLike,
  snapshotFromPreprocessor,
} from "@/lib/molecules/render/pipeline-snapshot"
import type { GraphSnapshot } from "@/lib/molecules/render/recognize"
import {
  recognizeTetrapyrrole,
  type TetrapyrroleRecognition,
} from "@/lib/molecules/render/recognize-porphyrin"

interface Pipeline {
  snapshot: GraphSnapshot
  preprocessor: PorphyrinPreprocessor
  svg: SVGSVGElement
}

const BOND = 24

// PubChem/OE isomeric SMILES for heme b (iron protoporphyrin IX).
const HEME =
  "CC1=C(C2=CC3=NC(=CC4=C(C(=C([N-]4)C=C5C(=C(C(=N5)C=C1[N-]2)C)C=C)C)C=C)C(=C3CCC(=O)O)C)CCC(=O)O.[Fe+2]"
// OpenEye/CCD chlorophyll a.
const CHLOROPHYLL =
  "CCC1=C(C2=Cc3c(c(c4n3[Mg]56[N]2=C1C=C7N5C8=C(C(C(=O)C8=C7C)C(=O)OC)C9=[N]6C(=C4)C(C9CCC(=O)OCC=C(C)CCCC(C)CCCC(C)CCCC(C)C)C)C)C=C)C"
// Open-chain tetrapyrrole negative control (PubChem bilirubin, no stereo marks).
const BILIRUBIN =
  "CC1=C(NC(=C1CCC(=O)O)CC2=C(C(=C(N2)C=C3C(=C(C(=O)N3)C)C=C)C)CCC(=O)O)C=C4C(=C(C(=O)N4)C=C)C"
const CAFFEINE = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"

/**
 * Parse `smiles`, capture the snapshot right after the drawer's own layout,
 * optionally apply the idealizer during the hook (so the drawn SVG shows the
 * final geometry), and return the live preprocessor plus SVG.
 */
function pipelineOf(smiles: string, idealize = false): Pipeline {
  let captured: Pipeline | null = null
  SmilesDrawer.parse(smiles, (tree: unknown) => {
    const drawer = new SmilesDrawer.SvgDrawer({ width: 400, height: 300, bondLength: BOND })
    const preprocessor = (
      drawer as unknown as {
        preprocessor: PorphyrinPreprocessor & { processGraph: (...args: unknown[]) => void }
      }
    ).preprocessor
    const original = preprocessor.processGraph
    preprocessor.processGraph = ((...args: unknown[]) => {
      const result = original.apply(preprocessor, args)
      if (idealize) {
        applyPorphyrinLayout(preprocessor)
      }
      captured = {
        snapshot: snapshotFromPreprocessor(preprocessor as PreprocessorLike),
        preprocessor,
        svg,
      }
      return result
    }) as typeof original
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    document.body.appendChild(svg)
    drawer.draw(tree, svg, "light")
  })
  if (captured === null) {
    throw new Error(`no snapshot captured for ${smiles}`)
  }
  return captured
}

function positionOf(preprocessor: PorphyrinPreprocessor, id: number): { x: number; y: number } {
  const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === id)
  if (vertex === undefined) {
    throw new Error(`unknown vertex ${id}`)
  }
  return vertex.position
}

function centroidOf(points: { x: number; y: number }[]): { x: number; y: number } {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

function interiorAngleDegrees(
  previous: { x: number; y: number },
  vertex: { x: number; y: number },
  next: { x: number; y: number },
): number {
  const ax = previous.x - vertex.x
  const ay = previous.y - vertex.y
  const bx = next.x - vertex.x
  const by = next.y - vertex.y
  const cosine = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI
}

function cycleAngles(
  preprocessor: PorphyrinPreprocessor,
  cycle: number[],
): number[] {
  const positions = cycle.map((id) => positionOf(preprocessor, id))
  return positions.map((_, index) =>
    interiorAngleDegrees(
      positions[(index + positions.length - 1) % positions.length],
      positions[index],
      positions[(index + 1) % positions.length],
    ),
  )
}

function radiiAndAngles(
  preprocessor: PorphyrinPreprocessor,
  ids: number[],
): { radii: number[]; angles: number[]; centre: { x: number; y: number } } {
  const positions = ids.map((id) => positionOf(preprocessor, id))
  const centre = centroidOf(positions)
  return {
    centre,
    radii: positions.map((position) => Math.hypot(position.x - centre.x, position.y - centre.y)),
    angles: positions
      .map((position) => ((Math.atan2(position.y - centre.y, position.x - centre.x) * 180) / Math.PI + 360) % 360)
      .sort((a, b) => a - b),
  }
}

function expectEvenAngularSpacing(angles: number[], label: string): void {
  for (let index = 0; index < angles.length; index += 1) {
    const next = angles[(index + 1) % angles.length]
    const difference = ((next - angles[index] + 360) % 360)
    expect(Math.abs(difference - 90), `${label} spacing ${difference.toFixed(2)}°`).toBeLessThanOrEqual(3)
  }
}

function coreEdges(recognition: TetrapyrroleRecognition): [number, number][] {
  const edges = new Map<string, [number, number]>()
  const add = (a: number, b: number): void => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`
    edges.set(key, [a, b])
  }
  for (const unit of recognition.units) {
    for (let index = 0; index < unit.cycle.length; index += 1) {
      add(unit.cycle[index], unit.cycle[(index + 1) % unit.cycle.length])
    }
    add(unit.alphaA, unit.mesoA)
    add(unit.alphaB, unit.mesoB)
  }
  if (recognition.exoRing !== null) {
    const cycle = recognition.exoRing.cycle
    for (let index = 0; index < cycle.length; index += 1) {
      add(cycle[index], cycle[(index + 1) % cycle.length])
    }
  }
  return [...edges.values()]
}

function orientation(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function segmentsCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const epsilon = 1e-6
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  const straddles = (p: number, q: number): boolean =>
    (p > epsilon && q < -epsilon) || (p < -epsilon && q > epsilon)
  return straddles(o1, o2) && straddles(o3, o4)
}

function countCoreCrossings(
  preprocessor: PorphyrinPreprocessor,
  recognition: TetrapyrroleRecognition,
): number {
  const edges = coreEdges(recognition)
  let crossings = 0
  for (let left = 0; left < edges.length; left += 1) {
    const [a, b] = edges[left]
    for (let right = left + 1; right < edges.length; right += 1) {
      const [c, d] = edges[right]
      if (a === c || a === d || b === c || b === d) {
        continue
      }
      if (
        segmentsCross(positionOf(preprocessor, a), positionOf(preprocessor, b), positionOf(preprocessor, c), positionOf(preprocessor, d))
      ) {
        crossings += 1
      }
    }
  }
  return crossings
}

function expectIdealizedCore(
  preprocessor: PorphyrinPreprocessor,
  recognition: TetrapyrroleRecognition,
  label: string,
): { nitrogenRadiiDeviation: number; metalOffset: number; crossings: number } {
  // Pyrrole pentagons: every interior angle is 108° ± 4°.
  for (const unit of recognition.units) {
    for (const angle of cycleAngles(preprocessor, unit.cycle)) {
      expect(Math.abs(angle - 108), `${label} pyrrole angle ${angle.toFixed(2)}°`).toBeLessThanOrEqual(4)
    }
  }

  const nitrogenIds = recognition.units.map((unit) => unit.nitrogenId)
  const nitrogens = radiiAndAngles(preprocessor, nitrogenIds)
  const meanRadius = nitrogens.radii.reduce((sum, radius) => sum + radius, 0) / nitrogens.radii.length
  const nitrogenRadiiDeviation =
    Math.max(...nitrogens.radii.map((radius) => Math.abs(radius - meanRadius))) / meanRadius
  expect(nitrogenRadiiDeviation, `${label} N radius deviation`).toBeLessThan(0.05)
  expectEvenAngularSpacing(nitrogens.angles, `${label} N`)

  const mesos = radiiAndAngles(preprocessor, recognition.mesoIds)
  const meanMeso = mesos.radii.reduce((sum, radius) => sum + radius, 0) / mesos.radii.length
  const mesoDeviation =
    Math.max(...mesos.radii.map((radius) => Math.abs(radius - meanMeso))) / meanMeso
  expect(mesoDeviation, `${label} meso radius deviation`).toBeLessThan(0.05)
  expectEvenAngularSpacing(mesos.angles, `${label} meso`)

  // Every macrocycle + ring-E bond is one bond length.
  for (const [a, b] of coreEdges(recognition)) {
    const length = Math.hypot(
      positionOf(preprocessor, a).x - positionOf(preprocessor, b).x,
      positionOf(preprocessor, a).y - positionOf(preprocessor, b).y,
    )
    expect(length, `${label} core bond ${a}-${b}`).toBeGreaterThanOrEqual(0.9 * BOND)
    expect(length, `${label} core bond ${a}-${b}`).toBeLessThanOrEqual(1.1 * BOND)
  }

  let metalOffset = 0
  if (recognition.metalVertexId !== null) {
    const metal = positionOf(preprocessor, recognition.metalVertexId)
    metalOffset = Math.hypot(metal.x - nitrogens.centre.x, metal.y - nitrogens.centre.y)
    expect(metalOffset, `${label} metal offset`).toBeLessThan(0.5)
  }

  const crossings = countCoreCrossings(preprocessor, recognition)
  expect(crossings, `${label} core crossings`).toBe(0)
  return { nitrogenRadiiDeviation, metalOffset, crossings }
}

describe("porphyrin recognition", () => {
  it("recognizes heme as four pyrroles, four mesos and a singleton iron", () => {
    const pipeline = pipelineOf(HEME)
    const recognition = recognizeTetrapyrrole(pipeline.snapshot)
    expect(recognition).not.toBeNull()
    if (recognition === null) {
      return
    }
    expect(recognition.units).toHaveLength(4)
    expect(recognition.mesoIds).toHaveLength(4)
    expect(recognition.exoRing).toBeNull()
    expect(recognition.metalVertexId).not.toBeNull()
    expect(recognition.metalIsSingleton).toBe(true)
    if (recognition.metalVertexId !== null) {
      expect(
        pipeline.snapshot.atoms.get(recognition.metalVertexId)?.element,
      ).toBe("Fe")
    }
  })

  it("recognizes chlorophyll a with its fused ring E and in-ring magnesium", () => {
    const pipeline = pipelineOf(CHLOROPHYLL)
    const recognition = recognizeTetrapyrrole(pipeline.snapshot)
    expect(recognition).not.toBeNull()
    if (recognition === null) {
      return
    }
    expect(recognition.units).toHaveLength(4)
    expect(recognition.mesoIds).toHaveLength(4)
    expect(recognition.exoRing).not.toBeNull()
    expect(recognition.exoRing?.cycle).toHaveLength(5)
    expect(recognition.metalVertexId).not.toBeNull()
    expect(recognition.metalIsSingleton).toBe(false)
    if (recognition.metalVertexId !== null) {
      expect(pipeline.snapshot.atoms.get(recognition.metalVertexId)?.element).toBe("Mg")
    }
  })

  it("rejects open-chain tetrapyrroles and non-tetrapyrroles", () => {
    expect(recognizeTetrapyrrole(pipelineOf(BILIRUBIN).snapshot)).toBeNull()
    expect(recognizeTetrapyrrole(pipelineOf(CAFFEINE).snapshot)).toBeNull()
    expect(applyPorphyrinLayout(pipelineOf(BILIRUBIN).preprocessor)).toBe(false)
    expect(applyPorphyrinLayout(pipelineOf(CAFFEINE).preprocessor)).toBe(false)
  })
})

describe("porphyrin idealizer geometry", () => {
  it("draws heme b as a flat square macrocycle with centered iron", () => {
    const pipeline = pipelineOf(HEME)
    const recognition = recognizeTetrapyrrole(pipeline.snapshot)
    expect(recognition).not.toBeNull()
    if (recognition === null) {
      return
    }
    expect(applyPorphyrinLayout(pipeline.preprocessor)).toBe(true)
    const metrics = expectIdealizedCore(pipeline.preprocessor, recognition, "heme")
    // Keep the measured values visible in verbose test output.
    console.info("heme metrics", metrics)
  })

  it("draws chlorophyll a flat, including the outward fused ring E", () => {
    const pipeline = pipelineOf(CHLOROPHYLL)
    const recognition = recognizeTetrapyrrole(pipeline.snapshot)
    expect(recognition).not.toBeNull()
    if (recognition === null) {
      return
    }
    expect(applyPorphyrinLayout(pipeline.preprocessor)).toBe(true)
    const metrics = expectIdealizedCore(pipeline.preprocessor, recognition, "chlorophyll")

    const exoRing = recognition.exoRing
    expect(exoRing).not.toBeNull()
    if (exoRing !== null) {
      const capAngles = cycleAngles(pipeline.preprocessor, exoRing.cycle)
      for (const angle of capAngles) {
        // Ring E shares three consecutive atoms with the macrocycle (β–α–meso),
        // so its pentagon cannot be regular: the fused α corner is pinned near
        // 123° by the pyrrole's sp² exterior angle and the two completion
        // vertices bulge outward with exact bond-length edges. Assert the
        // pentagon stays convex and undistorted-in-shape (no inversion), not
        // that it reaches the impossible 108° ideal.
        expect(angle, `ring E angle ${angle.toFixed(2)}°`).toBeGreaterThan(85)
        expect(angle, `ring E angle ${angle.toFixed(2)}°`).toBeLessThan(135)
      }
      const nitrogenCentre = centroidOf(
        recognition.units.map((unit) => positionOf(pipeline.preprocessor, unit.nitrogenId)),
      )
      const exoCentre = centroidOf(
        exoRing.cycle.map((id) => positionOf(pipeline.preprocessor, id)),
      )
      const sharedMidpoint = {
        x:
          (positionOf(pipeline.preprocessor, exoRing.sharedEdge[0]).x +
            positionOf(pipeline.preprocessor, exoRing.sharedEdge[1]).x) /
          2,
        y:
          (positionOf(pipeline.preprocessor, exoRing.sharedEdge[0]).y +
            positionOf(pipeline.preprocessor, exoRing.sharedEdge[1]).y) /
          2,
      }
      expect(
        Math.hypot(exoCentre.x - nitrogenCentre.x, exoCentre.y - nitrogenCentre.y),
        "ring E lies outside the shared edge",
      ).toBeGreaterThan(
        Math.hypot(sharedMidpoint.x - nitrogenCentre.x, sharedMidpoint.y - nitrogenCentre.y),
      )
    }
    console.info("chlorophyll metrics", metrics)
  })
})

describe("porphyrin post-draw coordination", () => {
  it("appends four plain N→Fe strokes only for the singleton heme metal", () => {
    const heme = pipelineOf(HEME, true)
    applyPorphyrinCoordinationLines(heme.svg, heme.preprocessor)
    const hemeLines = Array.from(heme.svg.querySelectorAll("line.porphyrin-coordination"))
    expect(hemeLines).toHaveLength(4)
    for (const line of hemeLines) {
      expect(line.getAttribute("stroke-dasharray")).toBeNull()
      expect(line.getAttribute("stroke")).toBeTruthy()
    }
    heme.svg.remove()

    const chlorophyll = pipelineOf(CHLOROPHYLL, true)
    applyPorphyrinCoordinationLines(chlorophyll.svg, chlorophyll.preprocessor)
    expect(chlorophyll.svg.querySelectorAll("line.porphyrin-coordination")).toHaveLength(0)
    chlorophyll.svg.remove()
  })
})
