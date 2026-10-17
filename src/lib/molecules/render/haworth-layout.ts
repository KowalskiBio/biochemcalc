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
  // ring. Bond lengths are side-aware: upward substituents are shortened so
  // their labels never reach into the ring interior.
  const blocked = new Set(ringIds)
  const ringCenterWorld = {
    x: offset.x + polygonCenter.x * bondLength,
    y: offset.y + polygonCenter.y * bondLength,
  }
  const CHAIN_BIAS = Math.PI / 10 // tilt chains ±18° toward free space
  const UP_BOND_FACTOR = 0.9
  /** Pure -CH2OH tails: continuation bond turns 60° off the chain, i.e. the textbook 120° interior angle. */
  const CH2OH_TURN = Math.PI / 3
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
        const continuationIds = (atomInfo.neighbours ?? []).filter(
          (neighbour) =>
            neighbour !== atom.vertexId &&
            preprocessor.graph.vertices.find((candidate) => candidate.id === neighbour)?.value
              .element !== "H",
        )
        const isChain = outwardX !== 0 && continuationIds.length > 0
        // Pure -CH2OH tail: the chain atom carries exactly one heavy
        // continuation (the terminal OH) — draw its first bond strictly
        // vertical (textbook), no tilt.
        const continuationId = isChain ? continuationIds[0] : undefined
        const continuationAtom =
          continuationId === undefined
            ? undefined
            : preprocessor.graph.vertices.find((c) => c.id === continuationId)
        const isPureTail =
          continuationAtom !== undefined &&
          (continuationAtom.neighbours ?? []).filter(
            (n) =>
              n !== substituentId &&
              preprocessor.graph.vertices.find((candidate) => candidate.id === n)?.value
                .element !== "H",
          ).length === 0
        const isTiltedChain = isChain && !isPureTail
        // Rotate the whole subtree around the ring atom so the bond becomes
        // vertical (tilted chains lean 18° toward free space; pure CH2OH
        // tails stay exactly vertical), then normalize its length.
        const current = { x: atomInfo.position.x, y: atomInfo.position.y }
        const heading = Math.atan2(current.y - anchor.y, current.x - anchor.x)
        const desired = isTiltedChain
          ? Math.atan2(group.direction, outwardX * Math.tan(CHAIN_BIAS))
          : group.direction * (Math.PI / 2)
        const subtree = collectSubtree(preprocessor, substituentId, new Set(blocked))
        rotatePositions(preprocessor, subtree, anchor, desired - heading)

        const rotated = preprocessor.graph.vertices.find((c) => c.id === substituentId)
        if (rotated !== undefined) {
          const targetLength = bondLength * (group.direction < 0 ? UP_BOND_FACTOR : 1)
          const target = {
            x: anchor.x + Math.cos(desired) * targetLength,
            y: anchor.y + Math.sin(desired) * targetLength,
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

        // Pure -CH2OH tail: after the chain atom lands vertically on its
        // ray, give its continuation →O bond a full 60° turn on the
        // away-from-ring side — the textbook 120° interior angle of the
        // chain — instead of whatever near-linear remnant survived the
        // rigid rotation.
        if (isPureTail && continuationId !== undefined) {
          const chainVertex = preprocessor.graph.vertices.find((c) => c.id === substituentId)
          const continuation = preprocessor.graph.vertices.find((c) => c.id === continuationId)
          if (chainVertex !== undefined && continuation !== undefined) {
            const continuationAngle = Math.atan2(
              group.direction,
              (outwardX === 0 ? 1 : outwardX) * Math.tan(CH2OH_TURN),
            )
            const childSubtree = collectSubtree(
              preprocessor,
              continuationId,
              new Set([...blocked, substituentId]),
            )
            rotatePositions(
              preprocessor,
              childSubtree,
              { x: chainVertex.position.x, y: chainVertex.position.y },
              continuationAngle -
                Math.atan2(
                  continuation.position.y - chainVertex.position.y,
                  continuation.position.x - chainVertex.position.x,
                ),
            )
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

/** Post-draw label hint: swap a terminal hydroxyl label to "HO" on left-of-ring-centroid. */
export interface HOHint {
  x: number
  y: number
  side: "HO" | "OH"
}

/**
 * Collect the "HO"-swap hints for a freshly laid-out drawing: for every
 * terminal hydroxyl substituent (-OH, single bond, no other heavy atoms) of
 * every recognized sugar ring, decide by its position relative to the ring
 * centroid which side the label should read from. Left-half OHs become "HO"
 * — the classic idiom (hexose C4 is always left — and it pulls the label
 * into free space, easing overlaps).
 */
export function collectOhLabelHints(preprocessor: HaworthPreprocessor): HOHint[] {
  const snapshot = snapshotFromPreprocessor(preprocessor)
  const plans = recognizeSugarRings(snapshot)
  const hints: HOHint[] = []
  for (const plan of plans) {
    const positions = plan.cycle
      .map((id) => preprocessor.graph.vertices.find((candidate) => candidate.id === id)?.position)
      .filter((position): position is { x: number; y: number } => position !== undefined)
    if (positions.length === 0) {
      continue
    }
    const centroidX = positions.reduce((sum, position) => sum + position.x, 0) / positions.length
    for (const atom of plan.atoms) {
      for (const substituentId of [...atom.up, ...atom.down]) {
        const substituent = preprocessor.graph.vertices.find(
          (candidate) => candidate.id === substituentId,
        )
        if (substituent === undefined || substituent.value.element !== "O") {
          continue
        }
        const heavyNeighbours = (substituent.neighbours ?? []).filter(
          (neighbour) =>
            preprocessor.graph.vertices.find((candidate) => candidate.id === neighbour)?.value
              .element !== "H",
        )
        if (heavyNeighbours.length > 1) {
          continue
        }
        hints.push({
          x: substituent.position.x,
          y: substituent.position.y,
          side: substituent.position.x < centroidX ? "HO" : "OH",
        })
      }
    }
  }
  return hints
}

/**
 * Post-draw label fix: applies the "HO" swap to the hydroxyl <text> nodes
 * the library drew, matching hints to the closest "OH" text node within a
 * few pixels and anchoring the label left so it hangs off the ring.
 */
export function applyHaworthHOLabels(svgRoot: SVGSVGElement, hints: HOHint[]): void {
  const texts = Array.from(svgRoot.querySelectorAll("text"))
  const ohTexts = texts.filter((node) => (node.textContent ?? "").trim() === "OH")
  for (const hint of hints) {
    if (hint.side !== "HO") {
      continue
    }
    let nearest: Element | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const node of ohTexts) {
      const x = Number(node.getAttribute("x") ?? Number.NaN)
      const y = Number(node.getAttribute("y") ?? Number.NaN)
      const distance = Math.hypot(x - hint.x, y - hint.y)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = node
      }
    }
    if (nearest !== null && nearestDistance < 5) {
      nearest.textContent = "HO"
      nearest.setAttribute("text-anchor", "end")
    }
  }
}
