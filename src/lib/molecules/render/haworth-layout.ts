// Haworth layout pass for SMILES-rendered structures.
//
// Runs AFTER smiles-drawer's own layout (inside the processGraph hook): any
// sugar ring the recognizer proved out gets snapped into the canonical
// Haworth skeleton — ring atoms onto the fixed polygon, exocyclic
// substituents strictly vertical above/below their ring atom, the
// substituents' subtrees rotated to follow, and the annotated stereo wedges
// on affected bonds blanked (plain bonds, Haworth convention). Everything
// else in the drawing keeps the library layout, so complex molecules
// (nucleotides, cofactors) render in full with only the sugar ring
// reshaped.

import type { Point } from "@/lib/molecules/orientation"
import { kekulizeAromaticRings } from "@/lib/molecules/render/kekulize"
import { snapshotFromPreprocessor } from "@/lib/molecules/render/pipeline-snapshot"
import {
  HAWORTH_POLYGON,
  recognizeSugarRings,
  type SugarRingRecognition,
} from "@/lib/molecules/render/recognize"

interface PositionedVertex {
  id: number
  position: Point
  value: {
    element: string
    chirality?: string
    isPartOfAromaticRing?: boolean
  }
  neighbours: number[]
}

export interface HaworthPreprocessor {
  graph: {
    vertices: PositionedVertex[]
    edges?: {
      sourceId: number
      targetId: number
      weight?: number
      wedge?: string
      isPartOfAromaticRing?: boolean
    }[]
  }
  rings: { id: number; members: number[]; center: Point }[]
  opts?: { bondLength?: number }
}

/** Move a vertex to an absolute position (positions are Vector2-like). */
function place(preprocessor: HaworthPreprocessor, vertexId: number, target: Point): void {
  const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === vertexId)
  if (vertex !== undefined) {
    vertex.position.x = target.x
    vertex.position.y = target.y
  }
}

function centroid(points: Point[]): Point {
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  )
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/** Rotate all `ids` around `pivot` by `delta` radians (screen-space, y-down). */
function rotatePositions(
  preprocessor: HaworthPreprocessor,
  ids: number[],
  pivot: Point,
  delta: number,
): void {
  const cos = Math.cos(delta)
  const sin = Math.sin(delta)
  for (const id of ids) {
    const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === id)
    if (vertex === undefined) {
      continue
    }
    const dx = vertex.position.x - pivot.x
    const dy = vertex.position.y - pivot.y
    // Screen-space rotation (y-down): same convention as orientation.ts.
    vertex.position.x = pivot.x + dx * cos - dy * sin
    vertex.position.y = pivot.y + dx * sin + dy * cos
  }
}

/** DFS from `start` without re-entering the ring atoms of `plan`. */
function collectSubtree(
  preprocessor: HaworthPreprocessor,
  start: number,
  blocked: Set<number>,
  out: number[] = [],
): number[] {
  out.push(start)
  blocked.add(start)
  for (const neighbour of preprocessor.graph.vertices.find((v) => v.id === start)?.neighbours ?? []) {
    if (!blocked.has(neighbour)) {
      collectSubtree(preprocessor, neighbour, blocked, out)
    }
  }
  return out
}

/** Apply one recognized plan onto the preprocessor's coordinates. */
function applyPlan(
  preprocessor: HaworthPreprocessor,
  plan: SugarRingRecognition,
  bondLength: number,
): void {
  const polygon = HAWORTH_POLYGON[plan.cycle.length as 5 | 6]
  const ringIds = plan.cycle
  const currentPositions = ringIds.map((id) => {
    const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === id)
    return vertex?.position ?? { x: 0, y: 0 }
  })
  const polygonCenter = centroid(polygon)
  const offset = {
    x: centroid(currentPositions).x - polygonCenter.x * bondLength,
    y: centroid(currentPositions).y - polygonCenter.y * bondLength,
  }

  // 1. Ring atoms onto the canonical polygon.
  const ringPositions = new Map<number, Point>()
  ringIds.forEach((vertexId, role) => {
    const target = {
      x: offset.x + polygon[role].x * bondLength,
      y: offset.y + polygon[role].y * bondLength,
    }
    ringPositions.set(vertexId, target)
    place(preprocessor, vertexId, target)
  })

  // 2. Exocyclic substituents strictly vertical; subtrees rotated to follow.
  // Chain substituents (CH2OH, N-linked bases, phosphate tails) are biased
  // toward their free side relative to the ring centroid so they clear the
  // ring and, e.g. the glycosidic base and the 5′ tail, part ways instead of
  // colliding above the ring.
  const blocked = new Set(ringIds)
  const ringCenterWorld = {
    x: offset.x + polygonCenter.x * bondLength,
    y: offset.y + polygonCenter.y * bondLength,
  }
  const CHAIN_BIAS = Math.PI / 6 // tilt chains ±30° toward free space
  for (const atom of plan.atoms) {
    const anchor = ringPositions.get(atom.vertexId)
    if (anchor === undefined) {
      continue
    }
    const outwardX = Math.sign(anchor.x - ringCenterWorld.x)
    const groups: { ids: number[]; direction: number }[] = [
      { ids: atom.up, direction: -1 },
      { ids: atom.down, direction: 1 },
    ]
    for (const group of groups) {
      for (const substituentId of group.ids) {
        const atomInfo = preprocessor.graph.vertices.find(
          (candidate) => candidate.id === substituentId,
        )
        if (atomInfo === undefined) {
          continue
        }
        const isChain =
          outwardX !== 0 &&
          (atomInfo.neighbours ?? []).some(
            (neighbour) =>
              neighbour !== atom.vertexId &&
              preprocessor.graph.vertices.find((candidate) => candidate.id === neighbour)?.value
                .element !== "H",
          )
        // Rotate the whole subtree around the ring atom so the bond becomes
        // vertical (or chain-biased): one motion landing the substituent on
        // its ray with the distance preserved and the subtree following.
        const current = { x: atomInfo.position.x, y: atomInfo.position.y }
        const heading = Math.atan2(current.y - anchor.y, current.x - anchor.x)
        const desired = isChain
          ? Math.atan2(group.direction, outwardX * Math.tan(CHAIN_BIAS))
          : group.direction * (Math.PI / 2)
        const subtree = collectSubtree(preprocessor, substituentId, new Set(blocked))
        rotatePositions(preprocessor, subtree, anchor, desired - heading)
        // The library's original anchor→substituent vector may be longer or
        // shorter than one bond (the ring was refit); normalize the distance
        // so every substituent bond is exactly one bond length long, shifting
        // its subtree along by the same translation.
        const rotated = preprocessor.graph.vertices.find((c) => c.id === substituentId)
        if (rotated !== undefined) {
          const target = {
            x: anchor.x + Math.cos(desired) * bondLength,
            y: anchor.y + Math.sin(desired) * bondLength,
          }
          const shiftX = target.x - rotated.position.x
          const shiftY = target.y - rotated.position.y
          if (Math.abs(shiftX) > 0.01 || Math.abs(shiftY) > 0.01) {
            for (const id of subtree) {
              const vertex = preprocessor.graph.vertices.find((c) => c.id === id)
              if (vertex !== undefined) {
                vertex.position.x += shiftX
                vertex.position.y += shiftY
              }
            }
          }
        }
        blocked.add(substituentId)
      }
    }
  }

  // 3. Blank stereo wedges on every touched bond (Haworth draws plain lines).
  const touched = new Set<number>([...ringIds])
  for (const atom of plan.atoms) {
    for (const id of [...atom.up, ...atom.down]) {
      touched.add(id)
    }
  }
  for (const edge of preprocessor.graph.edges ?? []) {
    if (touched.has(edge.sourceId) || touched.has(edge.targetId)) {
      edge.wedge = ""
    }
  }

  // 4. Recompute the ring center (aromatic circle / label placement).
  const ring = preprocessor.rings.find((candidate) => candidate.id === plan.ringId)
  const newPositions = ringIds
    .map((id) => preprocessor.graph.vertices.find((candidate) => candidate.id === id)?.position)
    .filter((position): position is Point => position !== undefined)
  if (ring !== undefined && newPositions.length === ringIds.length) {
    ring.center.x = centroid(newPositions).x
    ring.center.y = centroid(newPositions).y
  }
}

/**
 * Run sugar recognition + Haworth reshaping inside the processGraph hook.
 * Returns true when at least one ring was reshaped — the caller then keeps
 * the drawing canonical (no random orientation) and lets any explicit
 * enantiomer mirror apply to the whole drawing as usual.
 */
export function applyHaworthLayout(preprocessor: HaworthPreprocessor): boolean {
  const snapshot = snapshotFromPreprocessor(preprocessor)
  const plans = recognizeSugarRings(snapshot)
  if (plans.length === 0) {
    return false
  }
  // Textbook look for any fused aromatic system inside the structure
  // (nucleotide bases): alternating double bonds instead of inner circles.
  kekulizeAromaticRings(preprocessor)
  const bondLength = preprocessor.opts?.bondLength ?? 24
  for (const plan of plans) {
    applyPlan(preprocessor, plan, bondLength)
  }
  return true
}
