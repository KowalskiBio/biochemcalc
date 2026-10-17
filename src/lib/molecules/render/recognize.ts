// Sugar-ring recognition for SMILES-rendered structures.
//
// Detects sugar-like rings (5/6 members, exactly one ring oxygen, carbons
// otherwise, non-aromatic) in a molecular-graph snapshot and decides the
// Haworth up/down side of every ring substituent from stereochemistry. The
// stereochemistry itself is NOT reparsed: the drawing pipeline already
// annotates every tetrahedral centre with R/S; this module independently
// ranks each centre's neighbours with a small CIP-style priority comparator;
// then, with (ring traversal, R/S, neighbour ranks), the up/down assignment
// is solved by enumerating the tetrahedral arm assignments and keeping the
// one that reproduces the annotated configuration in the drawn geometry.
//
// Strict by design: anything ambiguous (missing stereo, unresolvable
// priority comparison, unusual ring) yields `null` for that ring and the
// caller keeps the plain skeletal drawing — never a wrong Haworth.

export interface SnapshotAtom {
  vertexId: number
  element: string
  /** R/S after the pipeline's stereochemistry annotation, "" when none. */
  chirality: string
  isAromatic: boolean
}

export interface SnapshotRing {
  id: number
  /** Vertex ids in ring cycle order. */
  members: number[]
}

export interface GraphSnapshot {
  atoms: Map<number, SnapshotAtom>
  /** Undirected adjacency (built from snapshot edges). */
  adjacency: Map<number, number[]>
  /** Bond weight per unordered pair; absent pairs default to 1. */
  bondWeightOf: (a: number, b: number) => number
  rings: SnapshotRing[]
}

export interface RecognizedAtom {
  vertexId: number
  /** Exocyclic neighbouring vertices on the up side of the ring. */
  up: number[]
  /** Exocyclic neighbouring vertices on the down side. */
  down: number[]
}

export interface SugarRingRecognition {
  ringId: number
  /** Canonical Haworth cycle: anomeric carbon first … ring oxygen last. */
  cycle: number[]
  oxygenVertexId: number
  atoms: RecognizedAtom[]
}

const ATOMIC_NUMBER: Record<string, number> = {
  H: 1, B: 5, C: 6, N: 7, O: 8, F: 9, P: 15, S: 16, Cl: 17, Br: 35, I: 53,
}

const MAX_DEPTH = 8

function atomicZ(snapshot: GraphSnapshot, vertexId: number): number {
  return ATOMIC_NUMBER[snapshot.atoms.get(vertexId)?.element ?? ""] ?? 0
}

/**
 * CIP-style outward priority comparison for our molecule vocabulary
 * (small organic molecules, common bond orders). The two paths start at the
 * neighbours `left`/`right` of `root` and expand outward; each path keeps
 * its own visited set so it can walk along the ring from its own side but
 * never loop (and never re-enter `root`). Multi-bonds duplicate their target
 * with no further expansion (the CIP duplicate-node rule). Comparison is
 * level-by-level over sorted sphere digests; returns 1 when left outranks
 * right, −1 the opposite, 0 when undecided — the strict caller then refuses
 * to recognize the ring.
 */
function comparePriorities(
  snapshot: GraphSnapshot,
  root: number,
  left: number,
  right: number,
): number {
  interface Sphere {
    entries: number[]
    visited: Set<number>
  }
  const seed = (vertexId: number): Sphere => ({
    entries: [vertexId],
    visited: new Set([root, vertexId]),
  })
  const expand = (sphere: Sphere): number[] => {
    const next: number[] = []
    for (const vertexId of sphere.entries) {
      for (const neighbour of snapshot.adjacency.get(vertexId) ?? []) {
        if (sphere.visited.has(neighbour)) {
          continue
        }
        const weight = snapshot.bondWeightOf(vertexId, neighbour)
        for (let count = 0; count < Math.min(weight, 3); count += 1) {
          // keep duplicates for multiple bonds, but only the first is expanded
          if (count === 0) {
            next.push(neighbour)
            sphere.visited.add(neighbour)
          } else {
            next.push(numberPhantomId(neighbour, count))
          }
        }
      }
    }
    return next
  }
  const digest = (sphere: Sphere, vertexId: number): number[] => {
    if (isPhantom(vertexId)) {
      return [atomicZ(snapshot, phantomSource(vertexId))]
    }
    const children: number[] = []
    for (const neighbour of snapshot.adjacency.get(vertexId) ?? []) {
      if (sphere.visited.has(neighbour)) {
        continue
      }
      const weight = Math.min(snapshot.bondWeightOf(vertexId, neighbour), 3)
      for (let count = 0; count < weight; count += 1) {
        children.push(atomicZ(snapshot, neighbour))
      }
    }
    children.sort((a, b) => b - a)
    return [atomicZ(snapshot, vertexId), ...children]
  }
  const compareLists = (a: number[], b: number[]): number => {
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const av = a[index] ?? 0
      const bv = b[index] ?? 0
      if (av !== bv) {
        return av > bv ? 1 : -1
      }
    }
    return 0
  }
  const leftSphere = seed(left)
  const rightSphere = seed(right)
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    // Direct comparison at this level: sorted child digests per entry.
    const leftDigests = leftSphere.entries
      .map((id) => digest(leftSphere, id))
      .sort((a, b) => -compareLists(a, b))
    const rightDigests = rightSphere.entries
      .map((id) => digest(rightSphere, id))
      .sort((a, b) => -compareLists(a, b))
    let decisive = 0
    for (let index = 0; index < Math.max(leftDigests.length, rightDigests.length); index += 1) {
      const l = leftDigests[index]
      const r = rightDigests[index]
      if (l === undefined) {
        decisive = -1
        break
      }
      if (r === undefined) {
        decisive = 1
        break
      }
      const c = compareLists(l, r)
      if (c !== 0) {
        decisive = c
        break
      }
    }
    if (decisive !== 0) {
      return decisive
    }
    const nextLeft = expand(leftSphere)
    const nextRight = expand(rightSphere)
    if (nextLeft.length === 0 && nextRight.length === 0) {
      return 0
    }
    leftSphere.entries = nextLeft
    rightSphere.entries = nextRight
  }
  return 0
}

// Multiple-bond duplicates are represented by phantom ids derived from the
// source vertex so digests can report the duplicated element without
// expanding anything.
const PHANTOM_BASE = 1_000_000

function numberPhantomId(source: number, copy: number): number {
  return PHANTOM_BASE + source * 10 + copy
}

function isPhantom(vertexId: number): boolean {
  return vertexId >= PHANTOM_BASE
}

function phantomSource(vertexId: number): number {
  return Math.floor((vertexId - PHANTOM_BASE) / 10)
}

function rankSubstituents(
  snapshot: GraphSnapshot,
  centerId: number,
  heavy: number[],
  hydrogens: number[],
): { ranks: Map<number, number>; ok: boolean } {
  const sorted = [...heavy].sort((a, b) => {
    const diff = comparePriorities(snapshot, centerId, a, b)
    return diff === 0 ? a - b : -diff
  })
  const ranks = new Map<number, number>()
  let previous: number | undefined
  for (const vertexId of sorted) {
    if (previous !== undefined && comparePriorities(snapshot, centerId, previous, vertexId) === 0) {
      return { ranks, ok: false }
    }
    previous = vertexId
    ranks.set(vertexId, ranks.size + 1)
  }
  for (const h of hydrogens) {
    ranks.set(h, ranks.size + 1)
  }
  return { ranks, ok: true }
}

interface Vec3 {
  x: number
  y: number
  z: number
}

function determinant(points: Vec3[]): number {
  const [a, b, c, d] = points
  const v1 = { x: a.x - d.x, y: a.y - d.y, z: a.z - d.z }
  const v2 = { x: b.x - d.x, y: b.y - d.y, z: b.z - d.z }
  const v3 = { x: c.x - d.x, y: c.y - d.y, z: c.z - d.z }
  return (
    v1.x * (v2.y * v3.z - v2.z * v3.y) -
    v1.y * (v2.x * v3.z - v2.z * v3.x) +
    v1.z * (v2.x * v3.y - v2.y * v3.x)
  )
}

/**
 * Calibration constant: sign(det(r1,r2,r3,r4)) ↔ R. Pinned against the
 * α/β-D-glucopyranose truth pair in `__tests__/haworth-recognize.test.ts`.
 */
const DET_CONFIG_SIGN = 1

interface SideSolution {
  up: number[]
  down: number[]
}

/**
 * Model tetrahedron of one ring centre: ring neighbours sit in the page
 * plane at their Haworth polygon positions relative to the centre; the two
 * exocyclic arms point outward (opposite the in-plane bisector) tilted +z
 * (up) / −z (down). Enumerate the arm assignments and keep the one whose
 * drawn configuration matches the annotated R/S.
 */
function resolveSides(
  center: { x: number; y: number },
  prev: { x: number; y: number },
  next: { x: number; y: number },
  ranks: Map<number, number>,
  ringPrev: number,
  ringNext: number,
  armAtoms: number[],
  annotated: string,
): SideSolution | null {
  if (armAtoms.length !== 2) {
    return null
  }
  const bisX = prev.x - center.x + (next.x - center.x)
  const bisY = prev.y - center.y + (next.y - center.y)
  const bisLength = Math.hypot(bisX, bisY)
  if (bisLength < 1e-9) {
    return null
  }
  const armUp: Vec3 = { x: -bisX / bisLength, y: -bisY / bisLength, z: 1 }
  const armDown: Vec3 = { x: armUp.x, y: armUp.y, z: -1 }
  const ordered = [...ranks.entries()].sort((a, b) => a[1] - b[1]).map(([vertexId]) => vertexId)
  const solutions: SideSolution[] = [
    { up: [armAtoms[0]], down: [armAtoms[1]] },
    { up: [armAtoms[1]], down: [armAtoms[0]] },
  ]
  for (const solution of solutions) {
    const points: Vec3[] = []
    let missing = false
    for (const vertexId of ordered) {
      if (vertexId === ringPrev) {
        points.push({ x: prev.x - center.x, y: prev.y - center.y, z: 0 })
      } else if (vertexId === ringNext) {
        points.push({ x: next.x - center.x, y: next.y - center.y, z: 0 })
      } else if (solution.up.includes(vertexId)) {
        points.push(armUp)
      } else if (solution.down.includes(vertexId)) {
        points.push(armDown)
      } else {
        missing = true
        break
      }
    }
    if (missing) {
      return null
    }
    const config = Math.sign(determinant(points)) * DET_CONFIG_SIGN > 0 ? "R" : "S"
    if (config === annotated) {
      return solution
    }
  }
  return null
}

/** Cyclic traversal of a ring from its member list + snapshot adjacency. */
function cycleOrder(ring: SnapshotRing, snapshot: GraphSnapshot): number[] | null {
  const members = new Set(ring.members)
  const order: number[] = [ring.members[0]]
  const remaining = new Set(ring.members.slice(1))
  while (remaining.size > 0) {
    const last = order[order.length - 1]
    const next = (snapshot.adjacency.get(last) ?? []).find((n) => remaining.has(n) && members.has(n))
    if (next === undefined) {
      return null
    }
    order.push(next)
    remaining.delete(next)
  }
  const last = order[order.length - 1]
  return (snapshot.adjacency.get(last) ?? []).includes(order[0]) ? order : null
}

/** The anomeric carbon: adjacent to the ring O, bearing an exocyclic O or N. */
function isAnomericCandidate(
  vertexId: number,
  snapshot: GraphSnapshot,
  cycleSet: Set<number>,
): boolean {
  return (snapshot.adjacency.get(vertexId) ?? []).some((neighbour) => {
    if (cycleSet.has(neighbour)) {
      return false
    }
    const element = snapshot.atoms.get(neighbour)?.element
    return element === "O" || element === "N"
  })
}

/** Haworth polygon positions (unit bond) shared by recognizer and layout. */
export const HAWORTH_POLYGON: Record<5 | 6, { x: number; y: number }[]> = {
  6: [
    { x: 1.5, y: 0.86603 }, // anomeric C (right)
    { x: 1, y: 1.73205 },
    { x: 0, y: 1.73205 },
    { x: -0.5, y: 0.86603 },
    { x: 0, y: 0 },
    { x: 1, y: 0 }, // ring O (top right)
  ],
  5: [
    { x: 0.80902, y: -0.26287 }, // anomeric C (right)
    { x: 0.5, y: 0.68819 },
    { x: -0.5, y: 0.68819 },
    { x: -0.80902, y: -0.26287 },
    { x: 0, y: -0.85065 }, // ring O (top)
  ],
}

/**
 * Recognize sugar-like rings, one recognition per qualifying ring. Anything
 * ambiguous is skipped (caller keeps the skeletal drawing for that ring).
 */
export function recognizeSugarRings(snapshot: GraphSnapshot): SugarRingRecognition[] {
  const plans: SugarRingRecognition[] = []
  for (const ring of snapshot.rings) {
    const plan = recognizeSingleRing(snapshot, ring)
    if (plan !== null) {
      plans.push(plan)
    }
  }
  return plans
}

function recognizeSingleRing(snapshot: GraphSnapshot, ring: SnapshotRing): SugarRingRecognition | null {
  if (ring.members.length !== 5 && ring.members.length !== 6) {
    return null
  }
  const elementOf = (id: number): string => snapshot.atoms.get(id)?.element ?? ""
  const ringAtoms = ring.members.map((id) => snapshot.atoms.get(id))
  if (
    ringAtoms.some((atom) => atom === undefined || atom.isAromatic) ||
    ring.members.some((id) => !["C", "O"].includes(elementOf(id))) ||
    ring.members.filter((id) => elementOf(id) === "O").length !== 1
  ) {
    return null
  }
  const cycle = cycleOrder(ring, snapshot)
  if (cycle === null) {
    return null
  }
  // Rotate the cycle so the ring oxygen comes first.
  const oxygenIndex = cycle.findIndex((id) => elementOf(id) === "O")
  const oxygen = cycle[oxygenIndex]
  const rotated = [...cycle.slice(oxygenIndex + 1), ...cycle.slice(0, oxygenIndex)]
  const cycleSet = new Set(cycle)
  const startForward = isAnomericCandidate(rotated[0], snapshot, cycleSet)
  const startBackward = isAnomericCandidate(rotated[rotated.length - 1], snapshot, cycleSet)
  let order: number[]
  if (startForward && !startBackward) {
    order = rotated
  } else if (startBackward && !startForward) {
    order = [...rotated].reverse()
  } else {
    return null
  }
  // `order` starts at the anomeric carbon; the oxygen closes the loop. The
  // polygon is indexed by PHYSICAL ring size (6 = pyranose, 5 = furanose):
  // carbons occupy indices 0..carbonCount-1, the oxygen sits at carbonCount.
  const polySize = ring.members.length as 5 | 6
  const carbonCount = order.length
  const polygon = HAWORTH_POLYGON[polySize]
  const atoms: RecognizedAtom[] = []

  for (let role = 0; role < carbonCount; role += 1) {
    const vertexId = order[role]
    const atom = snapshot.atoms.get(vertexId)
    if (atom === undefined) {
      return null
    }
    const prevVertex = role === 0 ? oxygen : order[role - 1]
    const nextVertex = role === carbonCount - 1 ? oxygen : order[role + 1]
    const centrePt = polygon[role]
    const prevPt = role === 0 ? polygon[carbonCount] : polygon[role - 1]
    const nextPt = role === carbonCount - 1 ? polygon[carbonCount] : polygon[role + 1]

    const heavy: number[] = []
    const hydrogens: number[] = []
    const exocyclic: number[] = []
    for (const neighbour of snapshot.adjacency.get(vertexId) ?? []) {
      if (neighbour === prevVertex || neighbour === nextVertex) {
        continue
      }
      if (elementOf(neighbour) === "H") {
        hydrogens.push(neighbour)
      } else {
        exocyclic.push(neighbour)
        heavy.push(neighbour)
      }
    }
    heavy.push(prevVertex, nextVertex)

    // Achiral centre (deoxy position): no config to solve; both Hs are free.
    if (atom.chirality !== "R" && atom.chirality !== "S") {
      if (exocyclic.length !== 0) {
        return null // substituent without stereo info — must not guess
      }
      atoms.push({ vertexId, up: [...hydrogens], down: [...hydrogens] })
      continue
    }
    // Substituent topology: one exocyclic heavy + one H (standard centre) or
    // two exocyclic heavies (ketose anomer). Anything else is unusual here.
    const armAtoms = [...exocyclic, ...hydrogens]
    if (armAtoms.length !== 2) {
      return null
    }
    const ranked = rankSubstituents(snapshot, vertexId, [...new Set(heavy)], hydrogens)
    if (!ranked.ok) {
      return null
    }
    const sides = resolveSides(
      centrePt,
      prevPt,
      nextPt,
      ranked.ranks,
      prevVertex,
      nextVertex,
      armAtoms,
      atom.chirality,
    )
    if (sides === null) {
      return null
    }
    atoms.push({ vertexId, ...sides })
  }

  return {
    ringId: ring.id,
    cycle: [...order, oxygen],
    oxygenVertexId: oxygen,
    atoms,
  }
}
