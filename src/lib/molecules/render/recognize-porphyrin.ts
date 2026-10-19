// Tetrapyrrole recognition for SMILES-rendered structures.
//
// smiles-drawer 2.4.1 classifies the porphyrin/chlorin macrocycle as a
// bridged ring system and draws its pyrroles collapsed; disconnected metal
// fragments drift away from the ring. This recognizer deliberately ignores
// the library's perceived rings (chlorophyll's ring perception is a soup of
// chelate rings) and walks the raw adjacency graph instead:
//
//   - four 5-cycles, each with exactly one N and four C (pyrrole units);
//   - per unit, the two Cα ring neighbours each carry one meso carbon that
//     links to a Cα of a DIFFERENT unit;
//   - the unit/meso graph is exactly one 4-cycle (porphyrin, chlorin,
//     bacteriochlorin all match; open-chain tetrapyrroles do not);
//   - optional fused 5-carbon exo ring (chlorophyll ring E);
//   - optional metal, either a singleton component (heme's .[Fe+2]) or a
//     metal bonded to exactly the four pyrrole nitrogens (chlorophyll Mg).
//
// Strict by design: any ambiguity returns null and the caller keeps the
// library layout.

import type { GraphSnapshot } from "@/lib/molecules/render/recognize"

export interface TetrapyrroleUnit {
  nitrogenId: number
  /** Ordered cycle: [N, αA, βA, βB, αB]. */
  cycle: number[]
  alphaA: number
  betaA: number
  betaB: number
  alphaB: number
  /** Meso carbon attached to αA. */
  mesoA: number
  /** Meso carbon attached to αB. */
  mesoB: number
}

export interface TetrapyrroleExoRing {
  /** Ordered 5-cycle, canonical direction (rotation arbitrary). */
  cycle: number[]
  /** Index into `units` of the unit it is fused to. */
  unitIndex: number
  /** The single edge shared with that unit. */
  sharedEdge: [number, number]
}

export interface TetrapyrroleRecognition {
  units: TetrapyrroleUnit[]
  mesoIds: number[]
  exoRing: TetrapyrroleExoRing | null
  metalVertexId: number | null
  /** True when the metal is a disconnected/zero-bond component. */
  metalIsSingleton: boolean
}

const METAL_ELEMENTS = new Set([
  "Fe",
  "Mg",
  "Co",
  "Zn",
  "Ni",
  "Cu",
  "Mn",
  "Ru",
  "Pd",
  "Pt",
])

function elementOf(snapshot: GraphSnapshot, vertexId: number): string {
  return snapshot.atoms.get(vertexId)?.element ?? ""
}

function neighboursOf(snapshot: GraphSnapshot, vertexId: number): number[] {
  return snapshot.adjacency.get(vertexId) ?? []
}

/** Lexicographically smallest rotation of `cycle` (and its reverse). */
function canonicalCycle(cycle: number[]): number[] {
  const sequences = [cycle, [...cycle].reverse()]
  let best: number[] | null = null
  for (const sequence of sequences) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      const rotated = [...sequence.slice(offset), ...sequence.slice(0, offset)]
      if (best === null || compareLexicographic(rotated, best) < 0) {
        best = rotated
      }
    }
  }
  return best ?? [...cycle]
}

function compareLexicographic(a: number[], b: number[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) {
      return a[index] < b[index] ? -1 : 1
    }
  }
  return a.length - b.length
}

/**
 * Enumerate every simple 5-cycle in the raw adjacency graph, deduplicated by
 * canonical rotation/reversal. Cycles are restricted to C/N vertices; only
 * five bonds are walked, so this stays cheap even for cofactors.
 */
function enumerateFiveCycles(snapshot: GraphSnapshot): number[][] {
  const results = new Map<string, number[]>()
  const atoms = [...snapshot.atoms.keys()].filter((id) => {
    const element = elementOf(snapshot, id)
    return element === "C" || element === "N"
  })
  const cycleLength = 5
  for (const start of atoms) {
    const path: number[] = [start]
    const visited = new Set<number>([start])
    const walk = (current: number): void => {
      if (path.length === cycleLength) {
        if (neighboursOf(snapshot, current).includes(start)) {
          const canonical = canonicalCycle(path)
          results.set(canonical.join(","), canonical)
        }
        return
      }
      for (const neighbour of neighboursOf(snapshot, current)) {
        if (visited.has(neighbour)) {
          continue
        }
        const element = elementOf(snapshot, neighbour)
        if (element !== "C" && element !== "N") {
          continue
        }
        visited.add(neighbour)
        path.push(neighbour)
        walk(neighbour)
        path.pop()
        visited.delete(neighbour)
      }
    }
    walk(start)
  }
  return [...results.values()]
}

function isPyrroleCycle(snapshot: GraphSnapshot, cycle: number[]): boolean {
  if (cycle.length !== 5) {
    return false
  }
  let nitrogenCount = 0
  let carbonCount = 0
  for (const id of cycle) {
    const element = elementOf(snapshot, id)
    if (element === "N") {
      nitrogenCount += 1
    } else if (element === "C") {
      carbonCount += 1
    } else {
      return false
    }
  }
  return nitrogenCount === 1 && carbonCount === 4
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

/** Edges shared by two cycles. */
function sharedCycleEdges(left: number[], right: number[]): [number, number][] {
  const rightEdges = new Set<string>()
  for (let index = 0; index < right.length; index += 1) {
    rightEdges.add(edgeKey(right[index], right[(index + 1) % right.length]))
  }
  const shared: [number, number][] = []
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = left[(index + 1) % left.length]
    if (rightEdges.has(edgeKey(a, b))) {
      shared.push([a, b])
    }
  }
  return shared
}

function findExoRing(
  snapshot: GraphSnapshot,
  cycles: number[][],
  units: TetrapyrroleUnit[],
): TetrapyrroleExoRing | null {
  const unitCycles = units.map((unit) => unit.cycle)
  const candidates: TetrapyrroleExoRing[] = []
  for (const cycle of cycles) {
    if (cycle.some((id) => elementOf(snapshot, id) !== "C")) {
      continue
    }
    const shared: { edge: [number, number]; unitIndex: number }[] = []
    for (let unitIndex = 0; unitIndex < unitCycles.length; unitIndex += 1) {
      const edges = sharedCycleEdges(cycle, unitCycles[unitIndex])
      for (const edge of edges) {
        shared.push({ edge, unitIndex })
      }
    }
    if (shared.length !== 1) {
      continue
    }
    candidates.push({
      cycle,
      unitIndex: shared[0].unitIndex,
      sharedEdge: shared[0].edge,
    })
  }
  // More than one fused exo ring is ambiguous for this idealized skeleton.
  return candidates.length === 1 ? candidates[0] : null
}

function findMetal(
  snapshot: GraphSnapshot,
  nitrogenIds: Set<number>,
): { metalVertexId: number | null; metalIsSingleton: boolean } {
  const candidates: { id: number; singleton: boolean }[] = []
  for (const [id, atom] of snapshot.atoms) {
    if (!METAL_ELEMENTS.has(atom.element)) {
      continue
    }
    const neighbours = neighboursOf(snapshot, id).filter(
      (neighbour) => elementOf(snapshot, neighbour) !== "H",
    )
    // smiles-drawer links disconnected components with a zero-weight '.' edge.
    const connected = neighbours.filter((neighbour) => snapshot.bondWeightOf(id, neighbour) > 0)
    const singleton = connected.length === 0
    const bondedToNitrogens =
      connected.length === nitrogenIds.size &&
      connected.every((neighbour) => nitrogenIds.has(neighbour))
    if (singleton || bondedToNitrogens) {
      candidates.push({ id, singleton })
    }
  }
  if (candidates.length > 1) {
    return { metalVertexId: null, metalIsSingleton: false }
  }
  return {
    metalVertexId: candidates[0]?.id ?? null,
    metalIsSingleton: candidates[0]?.singleton ?? false,
  }
}

export function recognizeTetrapyrrole(snapshot: GraphSnapshot): TetrapyrroleRecognition | null {
  const cycles = enumerateFiveCycles(snapshot)
  const pyrroleCycles = cycles.filter((cycle) => isPyrroleCycle(snapshot, cycle))
  if (pyrroleCycles.length !== 4) {
    return null
  }
  const nitrogenIds = new Set(
    pyrroleCycles.map((cycle) => {
      const nitrogen = cycle.find((id) => elementOf(snapshot, id) === "N")
      if (nitrogen === undefined) {
        throw new Error("pyrrole cycle without nitrogen")
      }
      return nitrogen
    }),
  )
  if (nitrogenIds.size !== 4) {
    return null
  }
  // The four pyrrole rings must be disjoint (no fused/shared unit rings).
  const unitAtomOwners = new Map<number, number>()
  for (let unitIndex = 0; unitIndex < pyrroleCycles.length; unitIndex += 1) {
    for (const id of pyrroleCycles[unitIndex]) {
      if (unitAtomOwners.has(id)) {
        return null
      }
      unitAtomOwners.set(id, unitIndex)
    }
  }

  // Rotate each canonical cycle to start at its nitrogen; the two adjacent
  // atoms are the α carbons, the remaining two are the β carbons.
  const preliminary = pyrroleCycles.map((cycle) => {
    const nitrogenIndex = cycle.findIndex((id) => elementOf(snapshot, id) === "N")
    const rotated = [...cycle.slice(nitrogenIndex), ...cycle.slice(0, nitrogenIndex)]
    return rotated
  })

  const alphaUnit = new Map<number, number>()
  preliminary.forEach((cycle, unitIndex) => {
    // α carbons are the nitrogen's two ring neighbours.
    alphaUnit.set(cycle[1], unitIndex)
    alphaUnit.set(cycle[4], unitIndex)
  })

  const units: TetrapyrroleUnit[] = []
  for (let unitIndex = 0; unitIndex < preliminary.length; unitIndex += 1) {
    const cycle = preliminary[unitIndex]
    const unitSet = new Set(cycle)
    const alphaA = cycle[1]
    const alphaB = cycle[4]
    const mesoFor = (alpha: number): number | null => {
      const candidates = neighboursOf(snapshot, alpha).filter((neighbour) => {
        if (unitSet.has(neighbour) || elementOf(snapshot, neighbour) !== "C") {
          return false
        }
        if (unitAtomOwners.has(neighbour)) {
          return false
        }
        return neighboursOf(snapshot, neighbour).some((second) => {
          const owner = alphaUnit.get(second)
          return owner !== undefined && owner !== unitIndex
        })
      })
      return candidates.length === 1 ? candidates[0] : null
    }
    const mesoA = mesoFor(alphaA)
    const mesoB = mesoFor(alphaB)
    if (mesoA === null || mesoB === null || mesoA === mesoB) {
      return null
    }
    units.push({
      nitrogenId: cycle[0],
      cycle,
      alphaA,
      betaA: cycle[2],
      betaB: cycle[3],
      alphaB,
      mesoA,
      mesoB,
    })
  }

  // Every meso must bridge exactly two α carbons of different units, and the
  // unit/meso graph must close into one 4-cycle.
  const mesoIds = [...new Set(units.flatMap((unit) => [unit.mesoA, unit.mesoB]))]
  if (mesoIds.length !== 4) {
    return null
  }
  const mesoUnits = new Map<number, number[]>()
  for (const mesoId of mesoIds) {
    const attached = neighboursOf(snapshot, mesoId)
      .map((neighbour) => alphaUnit.get(neighbour))
      .filter((unitIndex): unitIndex is number => unitIndex !== undefined)
    const unique = [...new Set(attached)]
    if (unique.length !== 2) {
      return null
    }
    mesoUnits.set(mesoId, unique)
  }
  const visitedUnits = new Set<number>([0])
  const queue = [0]
  while (queue.length > 0) {
    const unitIndex = queue.shift()
    if (unitIndex === undefined) {
      break
    }
    const unit = units[unitIndex]
    for (const mesoId of [unit.mesoA, unit.mesoB]) {
      for (const other of mesoUnits.get(mesoId) ?? []) {
        if (!visitedUnits.has(other)) {
          visitedUnits.add(other)
          queue.push(other)
        }
      }
    }
  }
  if (visitedUnits.size !== 4) {
    return null
  }

  const exoRing = findExoRing(snapshot, cycles, units)
  const metal = findMetal(snapshot, nitrogenIds)
  return {
    units,
    mesoIds,
    exoRing,
    metalVertexId: metal.metalVertexId,
    metalIsSingleton: metal.metalIsSingleton,
  }
}
