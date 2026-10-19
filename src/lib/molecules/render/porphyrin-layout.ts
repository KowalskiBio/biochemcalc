// Porphyrin / chlorin post-layout idealizer.
//
// Runs inside the same `processGraph` hook as the Haworth pass. smiles-drawer
// 2.4.1 misclassifies the tetrapyrrole macrocycle as a bridged ring system:
// its pyrroles collapse and a disconnected `.[Fe+2]` / `[Mg+2]` fragment
// floats away. Once `recognizeTetrapyrrole` has proven the 4-unit / 4-meso
// skeleton on the raw graph, this pass replaces the library coordinates with
// a textbook flat macrocycle:
//
//   - four pyrroles as regular pentagons (N inner apex, Cα flanking,
//     Cβ outer), one per cardinal direction;
//   - four meso carbons on the diagonals;
//   - an optional fused exocyclic five-ring (chlorophyll ring E) built
//     around its already-fixed core atoms: simple β–β′ fusions get a
//     regular pentagon on the shared edge, but chlorophyll's isocyclic
//     ring E shares TWO edges with the macrocycle (the α–β pyrrole edge
//     AND the α–meso bond — the γ-meso carbon is a ring-E vertex), so
//     only its two free carbons are placed, completing the chain with
//     single-bond steps bulging outward;
//   - exocyclic substituents rotated to their radial heading, normalized to
//     one bond length, with linear continuations walked outward;
//   - the metal (singleton Fe, or Mg bonded to the four Ns) at the N4
//     centroid.
//
// Core radii: the regular pentagon fixes the Cα radial/lateral offsets; the
// meso radius is then the root that makes each Cα–meso bond exactly one bond
// length. The remaining degree of freedom (how far out the N4 square sits)
// is fixed by requiring the meso C–Cα–C angle to be the sp2 ideal 120°.
// The two values are solved numerically at layout time.

import type { Point } from "@/lib/molecules/orientation"
import {
  bondStrokeNear,
  sampleBondStroke,
} from "@/lib/molecules/render/haworth-layout"
import { kekulizeAromaticRings } from "@/lib/molecules/render/kekulize"
import { snapshotFromPreprocessor } from "@/lib/molecules/render/pipeline-snapshot"
import {
  recognizeTetrapyrrole,
  type TetrapyrroleExoRing,
  type TetrapyrroleRecognition,
  type TetrapyrroleUnit,
} from "@/lib/molecules/render/recognize-porphyrin"
import {
  centroid,
  collectSubtree,
  heavyNeighboursOf,
  type LayoutPreprocessor,
  place,
  positionOf,
  recomputeRingCenters,
  rotatePositions,
  walkChainOutward,
} from "@/lib/molecules/render/subtree"

export type PorphyrinPreprocessor = LayoutPreprocessor

const DEG = Math.PI / 180

/** Regular-pentagon geometry in units of the bond length. */
const PENTAGON_CIRCUMRADIUS = 1 / (2 * Math.sin(Math.PI / 5))
/** Cα radial offset from the N apex, in bond lengths. */
const ALPHA_RADIAL = PENTAGON_CIRCUMRADIUS * (1 - Math.cos(72 * DEG))
/** Cα lateral offset from the unit axis, in bond lengths. */
const ALPHA_LATERAL = PENTAGON_CIRCUMRADIUS * Math.sin(72 * DEG)
/** Cβ radial offset from the N apex, in bond lengths. */
const BETA_RADIAL = PENTAGON_CIRCUMRADIUS * (1 + Math.cos(36 * DEG))
/** Cβ lateral offset from the unit axis, in bond lengths. */
const BETA_LATERAL = PENTAGON_CIRCUMRADIUS * Math.sin(36 * DEG)
/** Distance from a pentagon side to its centroid, in bond lengths. */
const PENTAGON_APOTHEM = 1 / (2 * Math.tan(Math.PI / 5))
/** Ideal sp2 Cα–meso–Cα angle used to pin the N4 square size. */
const TARGET_MESO_ANGLE = 120 * DEG

/** The larger root of |Cα − R·(cos45,sin45)| = bondLength. */
function mesoRadiusFor(nitrogenRadius: number, bondLength: number): number {
  const alphaRadial = nitrogenRadius + ALPHA_RADIAL * bondLength
  const alphaLateral = ALPHA_LATERAL * bondLength
  // 2c²R² − 2cR(ar+al) + ar² + al² − s² = 0, with c = 1/√2.
  const middle = Math.SQRT1_2 * (alphaRadial + alphaLateral)
  const constant = alphaRadial * alphaRadial + alphaLateral * alphaLateral - bondLength * bondLength
  const discriminant = middle * middle - constant
  if (discriminant < 0) {
    return Number.NaN
  }
  // Positive root: the meso carbon lies outside the Cα flank.
  return middle + Math.sqrt(discriminant)
}

function mesoAngleFor(nitrogenRadius: number, bondLength: number): number {
  const alphaRadial = nitrogenRadius + ALPHA_RADIAL * bondLength
  const alphaLateral = ALPHA_LATERAL * bondLength
  const mesoRadius = mesoRadiusFor(nitrogenRadius, bondLength)
  if (Number.isNaN(mesoRadius)) {
    return Number.NaN
  }
  const mesoX = mesoRadius * Math.SQRT1_2
  const mesoY = mesoRadius * Math.SQRT1_2
  const a: Point = { x: alphaRadial - mesoX, y: alphaLateral - mesoY }
  const b: Point = { x: alphaLateral - mesoX, y: alphaRadial - mesoY }
  const dot = a.x * b.x + a.y * b.y
  const lengths = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)
  if (lengths === 0) {
    return Number.NaN
  }
  return Math.acos(Math.max(-1, Math.min(1, dot / lengths)))
}

/**
 * Settle the two core radii. The pentagon is regular by construction; the
 * meso radius makes the Cα–meso bonds one bond length, and the N radius is
 * bisected until the meso bond angle hits 120°.
 */
function solveCoreRadii(bondLength: number): { nitrogenRadius: number; mesoRadius: number } {
  let low = 1.2 * bondLength
  let high = 1.62 * bondLength
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2
    const angle = mesoAngleFor(middle, bondLength)
    if (Number.isNaN(angle) || angle < TARGET_MESO_ANGLE) {
      low = middle
    } else {
      high = middle
    }
  }
  let nitrogenRadius = (low + high) / 2
  let mesoRadius = mesoRadiusFor(nitrogenRadius, bondLength)
  if (Number.isNaN(mesoRadius)) {
    nitrogenRadius = 1.46 * bondLength
    mesoRadius = mesoRadiusFor(nitrogenRadius, bondLength)
  }
  return { nitrogenRadius, mesoRadius }
}

function elementOf(preprocessor: PorphyrinPreprocessor, vertexId: number): string {
  return (
    preprocessor.graph.vertices.find((candidate) => candidate.id === vertexId)?.value.element ?? ""
  )
}

function neighboursOf(preprocessor: PorphyrinPreprocessor, vertexId: number): number[] {
  return preprocessor.graph.vertices.find((candidate) => candidate.id === vertexId)?.neighbours ?? []
}

function alphaForMeso(unit: TetrapyrroleUnit, mesoId: number): number {
  return unit.mesoA === mesoId ? unit.alphaA : unit.alphaB
}

function betaForAlpha(unit: TetrapyrroleUnit, alphaId: number): number {
  return unit.alphaA === alphaId ? unit.betaA : unit.betaB
}

interface OrderedUnit {
  unit: TetrapyrroleUnit
  alphaNext: number
  alphaPrev: number
  betaNext: number
  betaPrev: number
  mesoNext: number
  mesoPrev: number
}

/**
 * Walk the unit/meso graph into a cyclic order, with each unit's "next"
 * α/β pointing at the meso shared with the following unit. The direction is
 * then reconciled with the library's current coarse arrangement so the
 * idealization does not flip the molecule.
 */
function orderUnits(
  preprocessor: PorphyrinPreprocessor,
  recognition: TetrapyrroleRecognition,
): OrderedUnit[] | null {
  const units = recognition.units
  const ordered: OrderedUnit[] = []
  let current = units[0]
  let nextMeso = current.mesoA
  let previousMeso = current.mesoB
  for (let index = 0; index < 4; index += 1) {
    const alphaNext = alphaForMeso(current, nextMeso)
    const alphaPrev = alphaForMeso(current, previousMeso)
    ordered.push({
      unit: current,
      alphaNext,
      alphaPrev,
      betaNext: betaForAlpha(current, alphaNext),
      betaPrev: betaForAlpha(current, alphaPrev),
      mesoNext: nextMeso,
      mesoPrev: previousMeso,
    })
    if (index === 3) {
      break
    }
    const other = units.find(
      (candidate) =>
        candidate !== current &&
        (candidate.mesoA === nextMeso || candidate.mesoB === nextMeso),
    )
    if (other === undefined) {
      return null
    }
    const followingMeso = other.mesoA === nextMeso ? other.mesoB : other.mesoA
    current = other
    previousMeso = nextMeso
    nextMeso = followingMeso
  }
  if (
    ordered[3].mesoNext !== ordered[0].mesoPrev ||
    new Set(ordered.map((item) => item.mesoNext)).size !== 4
  ) {
    return null
  }

  // Signed area of the current unit centres in graph order. Increasing our
  // placement angle produces a positive area, so reverse a negative walk.
  const unitCentres = ordered.map((item) => {
    const points = item.unit.cycle
      .map((id) => positionOf(preprocessor, id))
      .filter((position): position is Point => position !== undefined)
    return pointer(points)
  })
  if (unitCentres.some((point) => point === null)) {
    return null
  }
  const centres = unitCentres as Point[]
  let signedArea = 0
  for (let index = 0; index < centres.length; index += 1) {
    const next = centres[(index + 1) % centres.length]
    signedArea += centres[index].x * next.y - next.x * centres[index].y
  }
  if (signedArea < 0) {
    ordered.reverse()
    for (const item of ordered) {
      ;[item.alphaNext, item.alphaPrev] = [item.alphaPrev, item.alphaNext]
      ;[item.betaNext, item.betaPrev] = [item.betaPrev, item.betaNext]
      ;[item.mesoNext, item.mesoPrev] = [item.mesoPrev, item.mesoNext]
    }
  }
  return ordered
}

/** Centroid of possibly-empty points, or null when it has no members. */
function pointer(points: Point[]): Point | null {
  return points.length === 0 ? null : centroid(points)
}

/** Orient an exocyclic 5-cycle so vertices 0→1 are the shared edge. */
function orientExoCycle(cycle: number[], sharedA: number, sharedB: number): number[] {
  const indexA = cycle.indexOf(sharedA)
  const indexB = cycle.indexOf(sharedB)
  if (indexA < 0 || indexB < 0) {
    return [...cycle]
  }
  if (cycle[(indexA + 1) % cycle.length] === sharedB) {
    return [...cycle.slice(indexA), ...cycle.slice(0, indexA)]
  }
  const reversed = [...cycle].reverse()
  const reversedA = reversed.indexOf(sharedA)
  return [...reversed.slice(reversedA), ...reversed.slice(0, reversedA)]
}

/**
 * Chlorophyll ring E fuses onto the macrocycle through the α–β pyrrole
 * edge, and its pentagon spans the γ-meso carbon: three of the five ring
 * atoms (β–α–meso, e.g. C13–C14–C15 in phorbine numbering) are already
 * part of the idealized core. Only the two free carbons get placed, as a
 * symmetric cap on the meso–β chord with every edge one bond length.
 * Because the fused α corner sits at 126° (sp² external of the pyrrole),
 * the pentagon cannot be regular; equal edges + outward bulge is the
 * closest honest shape — the standard textbook depiction does the same.
 */
function placeBridgedExoRing(
  preprocessor: PorphyrinPreprocessor,
  exoRing: TetrapyrroleExoRing,
  fixedCore: Set<number>,
  bondLength: number,
  macroCentre: Point,
): boolean {
  const cycle = exoRing.cycle
  // Rotations/reversals of the cycle whose first three vertices are the
  // fixed core run [outside β, fusion α, meso].
  const candidates: number[][] = []
  for (const sequence of [cycle, [...cycle].reverse()]) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      const rotated = [...sequence.slice(offset), ...sequence.slice(0, offset)]
      candidates.push(rotated)
    }
  }
  const triple = candidates.find(
    (ordered) =>
      fixedCore.has(ordered[0]) && fixedCore.has(ordered[1]) && fixedCore.has(ordered[2]) &&
      !fixedCore.has(ordered[3]) && !fixedCore.has(ordered[4]),
  )
  if (triple === undefined) {
    return false
  }
  const positionA = positionOf(preprocessor, triple[0])
  const positionF = positionOf(preprocessor, triple[2])
  if (positionA === undefined || positionF === undefined) {
    return false
  }
  // Anchors of the cap: the meso (triple[2]) and the outer β (triple[0]).
  const midX = (positionA.x + positionF.x) / 2
  const midY = (positionA.y + positionF.y) / 2
  const chordX = positionA.x - positionF.x
  const chordY = positionA.y - positionF.y
  const chord = Math.hypot(chordX, chordY)
  const alongDistance = (chord - bondLength) / 2
  const height = Math.sqrt(Math.max(bondLength * bondLength - alongDistance * alongDistance, 0))
  if (chord <= 0 || height <= 0) {
    return false
  }
  const along: Point = { x: chordX / chord, y: chordY / chord }
  let normal: Point = { x: -along.y, y: along.x }
  const outwardProbe = { x: midX + normal.x * height, y: midY + normal.y * height }
  const inwardProbe = { x: midX - normal.x * height, y: midY - normal.y * height }
  if (
    Math.hypot(inwardProbe.x - macroCentre.x, inwardProbe.y - macroCentre.y) >
    Math.hypot(outwardProbe.x - macroCentre.x, outwardProbe.y - macroCentre.y)
  ) {
    normal = { x: -normal.x, y: -normal.y }
  }
  place(preprocessor, triple[3], {
    x: midX - (bondLength / 2) * along.x + normal.x * height,
    y: midY - (bondLength / 2) * along.y + normal.y * height,
  })
  place(preprocessor, triple[4], {
    x: midX + (bondLength / 2) * along.x + normal.x * height,
    y: midY + (bondLength / 2) * along.y + normal.y * height,
  })
  return true
}

/**
 * Build the fused exocyclic ring on its fixed shared edge. The regular
 * pentagon is placed on whichever side points away from the macrocycle
 * centroid.
 */
function placeExoRing(
  preprocessor: PorphyrinPreprocessor,
  exoRing: TetrapyrroleExoRing,
  fixedCore: Set<number>,
  bondLength: number,
  macroCentre: Point,
): void {
  // Chlorophyll's isocyclic ring E contains a meso carbon: three of its
  // five atoms already sit on the idealized core. Rebuilding a regular
  // pentagon would drag the meso off its square corner, so only the two
  // free carbons get capped around the fixed run instead.
  const fixedCount = exoRing.cycle.filter((id) => fixedCore.has(id)).length
  if (fixedCount > 2 && placeBridgedExoRing(preprocessor, exoRing, fixedCore, bondLength, macroCentre)) {
    return
  }
  const [sharedA, sharedB] = exoRing.sharedEdge
  const positionA = positionOf(preprocessor, sharedA)
  const positionB = positionOf(preprocessor, sharedB)
  if (positionA === undefined || positionB === undefined) {
    return
  }
  const ordered = orientExoCycle(exoRing.cycle, sharedA, sharedB)
  const edgeX = positionB.x - positionA.x
  const edgeY = positionB.y - positionA.y
  const edgeLength = Math.hypot(edgeX, edgeY)
  if (edgeLength === 0) {
    return
  }
  const along: Point = { x: edgeX / edgeLength, y: edgeY / edgeLength }
  let normal: Point = { x: -along.y, y: along.x }
  const side = bondLength * PENTAGON_APOTHEM
  const midpoint = {
    x: (positionA.x + positionB.x) / 2,
    y: (positionA.y + positionB.y) / 2,
  }
  const outward = {
    x: midpoint.x + normal.x * side,
    y: midpoint.y + normal.y * side,
  }
  const inward = {
    x: midpoint.x - normal.x * side,
    y: midpoint.y - normal.y * side,
  }
  if (Math.hypot(inward.x - macroCentre.x, inward.y - macroCentre.y) >
      Math.hypot(outward.x - macroCentre.x, outward.y - macroCentre.y)) {
    normal = { x: -normal.x, y: -normal.y }
  }

  // Regular-pentagon local coordinates with side 0→1 along `along` and the
  // remaining vertices on the +normal side.
  const cos72 = Math.cos(72 * DEG)
  const sin72 = Math.sin(72 * DEG)
  const local: Point[] = [
    { x: 0, y: 0 },
    { x: bondLength, y: 0 },
    { x: bondLength * (1 + cos72), y: bondLength * sin72 },
    { x: bondLength * 0.5, y: bondLength * (sin72 + Math.sin(36 * DEG)) },
    { x: -bondLength * cos72, y: bondLength * sin72 },
  ]
  ordered.forEach((vertexId, index) => {
    if (index === 0) {
      return
    }
    const point = local[index]
    place(preprocessor, vertexId, {
      x: positionA.x + along.x * point.x + normal.x * point.y,
      y: positionA.y + along.y * point.x + normal.y * point.y,
    })
  })
}

function translateSubtree(
  preprocessor: PorphyrinPreprocessor,
  ids: number[],
  dx: number,
  dy: number,
): void {
  for (const id of ids) {
    const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === id)
    if (vertex !== undefined) {
      vertex.position.x += dx
      vertex.position.y += dy
    }
  }
}

/**
 * Rotate every exocyclic substituent of the placed core onto its outward
 * radial heading, normalize its first bond, then walk linear continuations
 * outward. All core atoms are fenced off, so substituent moves never drag
 * the macrocycle.
 */
function layoutSubstituents(
  preprocessor: PorphyrinPreprocessor,
  coreIds: Set<number>,
  metalVertexId: number | null,
  bondLength: number,
  macroCentre: Point,
  moved: Set<number>,
): void {
  const blocked = new Set(coreIds)
  const handled = new Set<number>()
  const ringMembers = new Set<number>()
  for (const ring of preprocessor.rings) {
    for (const id of ring.members) {
      ringMembers.add(id)
    }
  }

  const coreOrder = [...coreIds]
  for (const coreId of coreOrder) {
    const anchor = positionOf(preprocessor, coreId)
    if (anchor === undefined) {
      continue
    }
    const radial = Math.atan2(anchor.y - macroCentre.y, anchor.x - macroCentre.x)
    for (const substituentId of neighboursOf(preprocessor, coreId)) {
      if (
        coreIds.has(substituentId) ||
        substituentId === metalVertexId ||
        handled.has(substituentId) ||
        elementOf(preprocessor, substituentId) === "H"
      ) {
        continue
      }
      const current = positionOf(preprocessor, substituentId)
      if (current === undefined) {
        continue
      }
      const heading = Math.atan2(current.y - anchor.y, current.x - anchor.x)
      const subtree = collectSubtree(preprocessor, substituentId, new Set(blocked))
      rotatePositions(preprocessor, subtree, anchor, radial - heading)

      const rotated = positionOf(preprocessor, substituentId)
      if (rotated !== undefined) {
        translateSubtree(
          preprocessor,
          subtree,
          anchor.x + Math.cos(radial) * bondLength - rotated.x,
          anchor.y + Math.sin(radial) * bondLength - rotated.y,
        )
      }
      for (const id of subtree) {
        handled.add(id)
        moved.add(id)
      }

      // Linear chains continue outward from their already-placed first bond;
      // branch points and rings stop the walk (their subtree keeps the rigid
      // transform from above).
      if (heavyNeighboursOf(preprocessor, substituentId, coreId).length === 1) {
        walkChainOutward(
          preprocessor,
          substituentId,
          coreId,
          radial,
          bondLength,
          ringMembers,
          blocked,
        )
      }
    }
  }
}

/**
 * Run tetrapyrrole recognition + idealization inside the `processGraph` hook.
 * Returns true when a porphyrin/chlorin skeleton was reshaped.
 */
export function applyPorphyrinLayout(preprocessor: PorphyrinPreprocessor): boolean {
  const snapshot = snapshotFromPreprocessor(preprocessor)
  const recognition = recognizeTetrapyrrole(snapshot)
  if (recognition === null) {
    return false
  }

  // Alternating double bonds instead of aromatic circles (chlorophyll's
  // aromatic input is partially lowercase; heme is already Kekulé).
  kekulizeAromaticRings(preprocessor)

  const bondLength = preprocessor.opts?.bondLength ?? 24
  const ordered = orderUnits(preprocessor, recognition)
  if (ordered === null) {
    return false
  }
  const nitrogenPositions = recognition.units
    .map((unit) => positionOf(preprocessor, unit.nitrogenId))
    .filter((position): position is Point => position !== undefined)
  if (nitrogenPositions.length !== 4) {
    return false
  }
  const macroCentre = centroid(nitrogenPositions)
  const { nitrogenRadius, mesoRadius } = solveCoreRadii(bondLength)

  // Snapshot the original location is intentionally ignored: the idealizer
  // always produces the canonical upright square, which the caller treats as
  // "recognized" (no random orientation).
  const baseAngle = -Math.PI / 2
  const moved = new Set<number>()
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index]
    const angle = baseAngle + index * (Math.PI / 2)
    const axis: Point = { x: Math.cos(angle), y: Math.sin(angle) }
    const lateral: Point = { x: -axis.y, y: axis.x }
    const at = (radial: number, side: number): Point => ({
      x: macroCentre.x + axis.x * radial + lateral.x * side,
      y: macroCentre.y + axis.y * radial + lateral.y * side,
    })

    const placeAtom = (vertexId: number, target: Point): void => {
      place(preprocessor, vertexId, target)
      moved.add(vertexId)
    }

    placeAtom(item.unit.nitrogenId, {
      x: macroCentre.x + axis.x * nitrogenRadius,
      y: macroCentre.y + axis.y * nitrogenRadius,
    })
    placeAtom(
      item.alphaNext,
      at(nitrogenRadius + ALPHA_RADIAL * bondLength, ALPHA_LATERAL * bondLength),
    )
    placeAtom(
      item.alphaPrev,
      at(nitrogenRadius + ALPHA_RADIAL * bondLength, -ALPHA_LATERAL * bondLength),
    )
    placeAtom(
      item.betaNext,
      at(nitrogenRadius + BETA_RADIAL * bondLength, BETA_LATERAL * bondLength),
    )
    placeAtom(
      item.betaPrev,
      at(nitrogenRadius + BETA_RADIAL * bondLength, -BETA_LATERAL * bondLength),
    )
    const mesoAngle = angle + Math.PI / 4
    placeAtom(item.mesoNext, {
      x: macroCentre.x + Math.cos(mesoAngle) * mesoRadius,
      y: macroCentre.y + Math.sin(mesoAngle) * mesoRadius,
    })
  }

  const coreIds = new Set<number>(moved)
  if (recognition.exoRing !== null) {
    placeExoRing(preprocessor, recognition.exoRing, coreIds, bondLength, macroCentre)
    for (const id of recognition.exoRing.cycle) {
      moved.add(id)
      coreIds.add(id)
    }
  }

  // Substituents are laid out before the metal: a disconnected `.[Fe+2]`
  // hangs off a carboxyl oxygen by a zero-weight '.' edge and would
  // otherwise be carried along by that substituent's rigid rotation.
  layoutSubstituents(
    preprocessor,
    coreIds,
    recognition.metalVertexId,
    bondLength,
    macroCentre,
    moved,
  )

  if (recognition.metalVertexId !== null) {
    place(preprocessor, recognition.metalVertexId, macroCentre)
    moved.add(recognition.metalVertexId)
  }

  // Every ring touched by the core (pyrroles, the perceived 16-membered
  // macrocycle, chlorophyll's chelate rings, ring E) needs its center moved:
  // double-bond side selection and aromatic circles read it.
  recomputeRingCenters(preprocessor, moved)
  return true
}

/**
 * Post-draw coordination strokes for an isolated metal (heme's `.[Fe+2]`).
 * In-ring metals (chlorophyll Mg) already have graph bonds drawn by the
 * library, so only singleton metals get appended lines. Plain (not dashed)
 * strokes are shortened at both ends to clear the atom labels, and the
 * stroke color is sampled from nearby bond lines the same way the Haworth
 * front-edge pass does.
 */
export function applyPorphyrinCoordinationLines(
  svgRoot: SVGSVGElement,
  preprocessor: PorphyrinPreprocessor,
): void {
  const recognition = recognizeTetrapyrrole(snapshotFromPreprocessor(preprocessor))
  if (
    recognition === null ||
    recognition.metalVertexId === null ||
    !recognition.metalIsSingleton
  ) {
    return
  }
  const metalPosition = positionOf(preprocessor, recognition.metalVertexId)
  if (metalPosition === undefined) {
    return
  }
  const bondLength = preprocessor.opts?.bondLength ?? 24
  const nitrogenInset = Math.min(6, bondLength * 0.22)
  const metalInset = nitrogenInset * 0.7
  const fallbackStroke = sampleBondStroke(svgRoot)
  const namespace = "http://www.w3.org/2000/svg"

  for (const unit of recognition.units) {
    const nitrogenPosition = positionOf(preprocessor, unit.nitrogenId)
    if (nitrogenPosition === undefined) {
      continue
    }
    const dx = metalPosition.x - nitrogenPosition.x
    const dy = metalPosition.y - nitrogenPosition.y
    const distance = Math.hypot(dx, dy)
    if (distance <= nitrogenInset + metalInset) {
      continue
    }
    const ux = dx / distance
    const uy = dy / distance
    const from = {
      x: nitrogenPosition.x + ux * nitrogenInset,
      y: nitrogenPosition.y + uy * nitrogenInset,
    }
    const to = {
      x: metalPosition.x - ux * metalInset,
      y: metalPosition.y - uy * metalInset,
    }
    const line = svgRoot.ownerDocument.createElementNS(namespace, "line")
    line.setAttribute("x1", String(from.x))
    line.setAttribute("y1", String(from.y))
    line.setAttribute("x2", String(to.x))
    line.setAttribute("y2", String(to.y))
    line.setAttribute(
      "stroke",
      bondStrokeNear(svgRoot, (from.x + to.x) / 2, (from.y + to.y) / 2) ?? fallbackStroke,
    )
    line.setAttribute("stroke-width", "1")
    line.setAttribute("stroke-linecap", "round")
    line.setAttribute("class", "porphyrin-coordination")
    svgRoot.appendChild(line)
  }
}
