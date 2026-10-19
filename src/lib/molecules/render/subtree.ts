// Shared coordinate primitives for the post-layout idealizers.
//
// These helpers operate on the preprocessor-shaped graph the Haworth pass uses
// and are deliberately side-effect-only: they move vertex positions / ring
// centers in place. Extracted from `haworth-layout.ts` so the layout passes
// share one implementation of subtree walks, rigid rotations and bond
// normalization.

import type { Point } from "@/lib/molecules/orientation"

export interface PositionedVertex {
  id: number
  position: Point
  value: {
    element: string
    chirality?: string
    isPartOfAromaticRing?: boolean
  }
  neighbours: number[]
}

export interface LayoutPreprocessor {
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
export function place(preprocessor: LayoutPreprocessor, vertexId: number, target: Point): void {
  const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === vertexId)
  if (vertex !== undefined) {
    vertex.position.x = target.x
    vertex.position.y = target.y
  }
}

/** Read a vertex's current (post-placement) position. */
export function positionOf(preprocessor: LayoutPreprocessor, vertexId: number): Point | undefined {
  return preprocessor.graph.vertices.find((candidate) => candidate.id === vertexId)?.position
}

export function centroid(points: Point[]): Point {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/** Rotate all `ids` around `pivot` by `delta` radians (screen-space, y-down). */
export function rotatePositions(
  preprocessor: LayoutPreprocessor,
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

/** DFS from `start`, never entering a blocked atom (ring atoms / bridges). */
export function collectSubtree(
  preprocessor: LayoutPreprocessor,
  start: number,
  blocked: Set<number>,
  out: number[] = [],
): number[] {
  out.push(start)
  blocked.add(start)
  for (const neighbour of preprocessor.graph.vertices.find((v) => v.id === start)?.neighbours ??
    []) {
    if (!blocked.has(neighbour)) {
      collectSubtree(preprocessor, neighbour, blocked, out)
    }
  }
  return out
}

/** Heavy (non-H) neighbours of `id`, optionally excluding the atom we came from. */
export function heavyNeighboursOf(
  preprocessor: LayoutPreprocessor,
  id: number,
  excludeId?: number,
): number[] {
  return (
    preprocessor.graph.vertices.find((candidate) => candidate.id === id)?.neighbours ?? []
  ).filter(
    (neighbour) =>
      neighbour !== excludeId &&
      preprocessor.graph.vertices.find((candidate) => candidate.id === neighbour)?.value.element !==
        "H",
  )
}

/**
 * Walk a chain substituent outward from its already-placed first bond. Every
 * linear continuation turns the same target heading and is normalized to a
 * full bond length, so long tails march away from the core instead of
 * stacking into a clump. The walk stops before ANY ring, at a protected atom,
 * and at branch points; a branch point's remaining subtree keeps the last
 * rigid transform.
 */
export function walkChainOutward(
  preprocessor: LayoutPreprocessor,
  startId: number,
  previousId: number,
  target: number,
  bondLength: number,
  ringMembers: Set<number>,
  blocked: Set<number>,
): void {
  let currentId = startId
  let previous = previousId
  for (;;) {
    const continuations = heavyNeighboursOf(preprocessor, currentId, previous)
    if (continuations.length !== 1) {
      return
    }
    const nextId = continuations[0]
    if (ringMembers.has(nextId) || blocked.has(nextId)) {
      return
    }
    const current = positionOf(preprocessor, currentId)
    const next = positionOf(preprocessor, nextId)
    if (current === undefined || next === undefined) {
      return
    }
    const pivot = { x: current.x, y: current.y }
    const heading = Math.atan2(next.y - pivot.y, next.x - pivot.x)
    const subtree = collectSubtree(preprocessor, nextId, new Set(blocked))
    rotatePositions(preprocessor, subtree, pivot, target - heading)
    const rotatedNext = positionOf(preprocessor, nextId)
    if (rotatedNext !== undefined) {
      const shiftX = pivot.x + Math.cos(target) * bondLength - rotatedNext.x
      const shiftY = pivot.y + Math.sin(target) * bondLength - rotatedNext.y
      if (Math.abs(shiftX) > 0.01 || Math.abs(shiftY) > 0.01) {
        for (const id of subtree) {
          const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === id)
          if (vertex !== undefined) {
            vertex.position.x += shiftX
            vertex.position.y += shiftY
          }
        }
      }
    }
    blocked.add(nextId)
    previous = currentId
    currentId = nextId
  }
}

/**
 * Recompute one ring's center from a set of member ids. Used by the Haworth
 * pass for its recognized ring (single-ring, legacy behavior).
 */
export function recomputeRingCenter(
  preprocessor: LayoutPreprocessor,
  ringId: number,
  memberIds: number[],
): void {
  const ring = preprocessor.rings.find((candidate) => candidate.id === ringId)
  const positions = memberIds
    .map((id) => preprocessor.graph.vertices.find((candidate) => candidate.id === id)?.position)
    .filter((position): position is Point => position !== undefined)
  if (ring !== undefined && positions.length === memberIds.length) {
    ring.center.x = centroid(positions).x
    ring.center.y = centroid(positions).y
  }
}

/**
 * Recompute every ring center whose membership overlaps the moved atom set.
 * Ring centers drive aromatic circles and the side chosen for in-ring double
 * bonds, so leaving one behind floats its decoration away from the ring.
 */
export function recomputeRingCenters(
  preprocessor: LayoutPreprocessor,
  movedIds: Set<number>,
): void {
  for (const ring of preprocessor.rings) {
    if (ring.members.some((id) => movedIds.has(id))) {
      recomputeRingCenter(preprocessor, ring.id, ring.members)
    }
  }
}
