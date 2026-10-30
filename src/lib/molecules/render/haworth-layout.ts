// Haworth layout pass for SMILES-rendered structures.
//
// Runs AFTER the graph's own layout: any
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
import {
  centroid,
  collectSubtree,
  heavyNeighboursOf,
  type LayoutPreprocessor,
  place,
  positionOf,
  recomputeRingCenter,
  rotatePositions,
  walkChainOutward,
} from "@/lib/molecules/render/subtree"

/** The mutable graph shape shared by the Haworth passes. */
export type HaworthPreprocessor = LayoutPreprocessor

/** Post-draw label hint: swap a terminal hydroxyl label to "HO" on left-of-ring-centroid. */
export interface HOHint {
  x: number
  y: number
  side: "HO" | "OH"
}

/**
 * A glycosidic-style connection between two recognized rings: a non-ring
 * atom (O, S, N — no element restriction) with exactly two heavy
 * neighbours, each a ring atom of a different plan. `planA` is the lower
 * plan index (links are recorded first-come, and plans are scanned in
 * order), so a BFS from plans[0] walks the whole connected glycan.
 */
interface SugarLink {
  planA: number
  anchorA: number
  bridge: number
  planB: number
  anchorB: number
}

function detectSugarLinks(
  preprocessor: HaworthPreprocessor,
  plans: SugarRingRecognition[],
): SugarLink[] {
  const ringPlanOf = new Map<number, number>()
  plans.forEach((plan, planIndex) => {
    for (const id of plan.cycle) {
      ringPlanOf.set(id, planIndex)
    }
  })
  const elementOf = (id: number): string | undefined =>
    preprocessor.graph.vertices.find((candidate) => candidate.id === id)?.value.element
  const links: SugarLink[] = []
  const seenBridges = new Set<number>()
  plans.forEach((plan, planA) => {
    for (const anchorA of plan.cycle) {
      const neighbours =
        preprocessor.graph.vertices.find((candidate) => candidate.id === anchorA)?.neighbours ?? []
      for (const bridge of neighbours) {
        if (ringPlanOf.has(bridge) || seenBridges.has(bridge)) {
          continue
        }
        const bridgeNeighbours =
          preprocessor.graph.vertices.find((candidate) => candidate.id === bridge)?.neighbours ?? []
        const heavy = bridgeNeighbours.filter((id) => elementOf(id) !== "H")
        if (heavy.length !== 2 || !heavy.includes(anchorA)) {
          continue
        }
        const anchorB = heavy.find((id) => id !== anchorA)
        if (anchorB === undefined) {
          continue
        }
        const planB = ringPlanOf.get(anchorB)
        if (planB === undefined || planB === planA) {
          continue
        }
        seenBridges.add(bridge)
        links.push({ planA, anchorA, bridge, planB, anchorB })
      }
    }
  })
  return links
}

/**
 * A pyrophosphate-bridged dinucleotide (NAD+ family): two ribose rings whose
 * 5′-tails join through a C–O–P–O–P–O–C path instead of a single-atom
 * glycosidic bridge. `planA` keeps the canonical orientation; `planB` is
 * drawn x-mirrored to its left — the textbook linear NAD+ layout
 * ([base B][ribose]–P–O–P–[ribose][base A]).
 */
interface DinucleotideLink {
  planA: number
  planB: number
  anchorA: number
  anchorB: number
  /** Ordered `anchorA → anchorB` internal path (exclusive): C5′, O, P, O, P, O, C5′. */
  path: number[]
}

/**
 * Number of aromatic nitrogens in the ring-system subtree behind the
 * anomeric C (0 when the C carries no N-linked base). Used to pick which
 * ribose stays canonical in a dinucleotide: the richer nucleobase wins
 * (adenine 4 Ns vs nicotinamide 1).
 */
function nucleobaseNitrogenCount(
  preprocessor: HaworthPreprocessor,
  plan: SugarRingRecognition,
): number {
  const anomericAtom = plan.atoms.find((atom) => atom.vertexId === plan.cycle[0])
  if (anomericAtom === undefined) {
    return 0
  }
  const vertexOf = (id: number) =>
    preprocessor.graph.vertices.find((candidate) => candidate.id === id)
  const glycoN = [...anomericAtom.up, ...anomericAtom.down].find(
    (id) =>
      vertexOf(id)?.value.element === "N" && vertexOf(id)?.value.isPartOfAromaticRing === true,
  )
  if (glycoN === undefined) {
    return 0
  }
  const visited = new Set<number>([glycoN])
  const stack = [glycoN]
  let count = 1
  while (stack.length > 0) {
    const current = stack.pop() ?? -1
    for (const next of vertexOf(current)?.neighbours ?? []) {
      const vertex = vertexOf(next)
      if (!visited.has(next) && vertex?.value.isPartOfAromaticRing === true) {
        visited.add(next)
        stack.push(next)
        if (vertex.value.element === "N") {
          count += 1
        }
      }
    }
  }
  return count
}

/**
 * Detect pyrophosphate-bridged dinucleotides before ring placement. Walks an
 * unbranched heavy-atom chain from one ring's 5′-carbon tail to a different
 * ring's tail; requires the strict C–O–P–O–P–O–C middle pattern so ordinary
 * (mono)phosphate tails and glycosidic bridges stay on their own paths.
 * Plans taking part in a disaccharide link are excluded. Each plan serves at
 * most one dinucleotide link. The richer-nucleobase ribose is kept as the
 * canonical `planA`; ties fall to the lower plan index for determinism.
 */
export function detectDinucleotideLinks(
  preprocessor: HaworthPreprocessor,
  plans: SugarRingRecognition[],
  excludedPlans: ReadonlySet<number>,
): DinucleotideLink[] {
  const ringPlanOf = new Map<number, number>()
  plans.forEach((plan, planIndex) => {
    for (const id of plan.cycle) {
      ringPlanOf.set(id, planIndex)
    }
  })
  const vertexOf = (id: number) =>
    preprocessor.graph.vertices.find((candidate) => candidate.id === id)
  const heavyOf = (id: number, exclude?: number) =>
    (vertexOf(id)?.neighbours ?? []).filter(
      (neighbour) => neighbour !== exclude && vertexOf(neighbour)?.value.element !== "H",
    )
  const links: DinucleotideLink[] = []
  const claimedPlans = new Set<number>()
  plans.forEach((plan, planBIndex) => {
    if (claimedPlans.has(planBIndex) || excludedPlans.has(planBIndex)) {
      return
    }
    let found: DinucleotideLink | null = null
    for (const anchorB of plan.cycle) {
      if (found !== null) {
        break
      }
      for (const tailB of heavyOf(anchorB)) {
        if (ringPlanOf.has(tailB)) {
          continue
        }
        if (vertexOf(tailB)?.value.element !== "C" || heavyOf(tailB, anchorB).length !== 1) {
          continue
        }
        // Walk toward the partner ring: middle atoms are O/P, phosphorus
        // carries exocyclic oxygens alongside the chain — at branch points
        // follow the continuation that itself continues (pyrophosphate
        // middles keep a heavy continuation; exo leaves are leaves).
        const path = [tailB]
        let previous = anchorB
        let current = heavyOf(tailB, anchorB)[0] ?? -1
        let anchorA = -1
        let planAIndex = -1
        for (;;) {
          if (ringPlanOf.has(current)) {
            break // entered some ring directly: disaccharide territory
          }
          path.push(current)
          const element = vertexOf(current)?.value.element
          const continuations = heavyOf(current, previous)
          if (element === "C") {
            const partner = continuations.find((id) => {
              const candidate = ringPlanOf.get(id)
              return candidate !== undefined && candidate !== planBIndex
            })
            if (partner !== undefined && continuations.length === 1) {
              anchorA = partner
              planAIndex = ringPlanOf.get(partner) ?? -1
            }
            break
          }
          if ((element !== "O" && element !== "P") || continuations.length === 0) {
            break
          }
          const onward = continuations
            .map((id) => ({ id, degree: heavyOf(id, current).length }))
            .sort((left, right) => right.degree - left.degree)
          previous = current
          current = onward[0]?.id ?? -1
          if (path.length > 12) {
            break
          }
        }
        if (planAIndex === -1 || claimedPlans.has(planAIndex) || excludedPlans.has(planAIndex)) {
          continue
        }
        // Strict pyrophosphate shape: C–O–P–O–P–O–C across the anchors
        // (path holds both terminal 5′-carbons; middles excludes them).
        const middles = path.slice(1, -1)
        const expected = ["O", "P", "O", "P", "O"]
        if (
          path.length !== 7 ||
          middles.length !== 5 ||
          middles.some((id, index) => vertexOf(id)?.value.element !== expected[index])
        ) {
          continue
        }
        const countA = nucleobaseNitrogenCount(preprocessor, plans[planAIndex] ?? plan)
        const countB = nucleobaseNitrogenCount(preprocessor, plan)
        const canonicalIsA = countA !== countB ? countA > countB : planAIndex < planBIndex
        // Keep `path` ordered anchorA → anchorB: the walk collected atoms
        // starting at planBIndex's tail, so an end-anchored canonical side
        // needs the reversed sequence, a start-anchored one keeps it.
        found = canonicalIsA
          ? { planA: planAIndex, planB: planBIndex, anchorA, anchorB, path: [...path].reverse() }
          : { planA: planBIndex, planB: planAIndex, anchorA: anchorB, anchorB: anchorA, path }
        claimedPlans.add(planAIndex)
        claimedPlans.add(planBIndex)
        break
      }
    }
    if (found !== null) {
      links.push(found)
    }
  })
  return links
}

/**
 * Place one dinucleotide pair in the NAD+ layout: `planB` x-mirrored to the
 * LEFT of the canonical planA (same horizontal line), both 5′-tails strictly
 * vertical at the plain-substituent length, then the pyrophosphate bridge as
 * a straight run: diagonal ±30° entrances off the tails, then a HORIZONTAL
 * O–P–O–P–O line (P atoms exactly 2 bonds apart, so their labels never
 * overlap), every middle bond at full length. Exocyclic P oxygens point
 * straight out of the line: the double bond up, the single bond down.
 *
 * The flip is REPRESENTATION-only: the ring is mirrored in x, but the
 * substituent pass keeps the canonical arm sides (β base up, D-CH2OH up),
 * which together read as the same molecule — a horizontal flip of the
 * finished Haworth drawing. Unlike the disaccharide link mirror, the arms
 * are NOT swapped (that convention restores molblock CIP flags but draws a
 * flipped ring's down substituents into the ring interior). `null` leaves
 * the plan for the generic fallback.
 */
function placeDinucleotidePair(
  preprocessor: HaworthPreprocessor,
  planB: SugarRingRecognition,
  link: DinucleotideLink,
  bondLength: number,
): { positions: Map<number, Point>; mirrored: boolean } | null {
  const anchorAPosition = positionOf(preprocessor, link.anchorA)
  if (anchorAPosition === undefined) {
    return null
  }
  const tailLength = bondLength * 0.9 // matches plain upward substituents (UP_BOND_FACTOR)
  const c5a = { x: anchorAPosition.x, y: anchorAPosition.y - tailLength }
  // Span for a 4-bond horizontal middle run plus the two diagonal entrances.
  const span = bondLength * (4 + 2 * Math.cos(Math.PI / 6))
  const c5b = { x: c5a.x - span, y: c5a.y }
  const anchorBTarget = { x: c5b.x, y: c5b.y + tailLength }
  const polygon = HAWORTH_POLYGON[planB.cycle.length as 5 | 6]
  if (polygon === undefined) {
    return null
  }
  const polygonCenter = centroid(polygon)
  const role = planB.cycle.indexOf(link.anchorB)
  const polygonAnchor = polygon[role]
  if (role < 0 || polygonAnchor === undefined) {
    return null
  }
  const localAnchor = { x: 2 * polygonCenter.x - polygonAnchor.x, y: polygonAnchor.y }
  const offset = {
    x: anchorBTarget.x - localAnchor.x * bondLength,
    y: anchorBTarget.y - localAnchor.y * bondLength,
  }
  const positions = new Map<number, Point>()
  planB.cycle.forEach((vertexId, index) => {
    const local = polygon[index] ?? polygonCenter
    const target = {
      x: offset.x + (2 * polygonCenter.x - local.x) * bondLength,
      y: offset.y + local.y * bondLength,
    }
    positions.set(vertexId, target)
    place(preprocessor, vertexId, target)
  })
  const tailA = link.path[0]
  const tailB = link.path[link.path.length - 1]
  const middles = [...link.path.slice(1, -1)].reverse()
  if (tailA === undefined || tailB === undefined || middles.length !== 5) {
    return null
  }
  place(preprocessor, tailA, c5a)
  place(preprocessor, tailB, c5b)
  // Middle run: each 5′-oxygen leaves its tail up-and-in at 30° off
  // vertical, then the O–P–O–P–O chain runs HORIZONTAL (the textbook
  // straight pyrophosphate line); with the span above the two P atoms land
  // exactly two bonds apart with the central O centred between them.
  const fromLeftTail = { x: Math.cos(-Math.PI / 6), y: Math.sin(-Math.PI / 6) }
  const fromRightTail = { x: Math.cos((-5 * Math.PI) / 6), y: Math.sin((-5 * Math.PI) / 6) }
  const oLeftPosition = {
    x: c5b.x + fromLeftTail.x * bondLength,
    y: c5b.y + fromLeftTail.y * bondLength,
  }
  const pLeftPosition = { x: oLeftPosition.x + bondLength, y: oLeftPosition.y }
  const oRightPosition = {
    x: c5a.x + fromRightTail.x * bondLength,
    y: c5a.y + fromRightTail.y * bondLength,
  }
  const pRightPosition = { x: oRightPosition.x - bondLength, y: oRightPosition.y }
  const oMiddlePosition = {
    x: (pLeftPosition.x + pRightPosition.x) / 2,
    y: (pLeftPosition.y + pRightPosition.y) / 2,
  }
  const middlePositions = [
    oLeftPosition,
    pLeftPosition,
    oMiddlePosition,
    pRightPosition,
    oRightPosition,
  ]
  middles.forEach((id, index) => {
    const target = middlePositions[index]
    if (target !== undefined) {
      place(preprocessor, id, target)
    }
  })
  // Exocyclic P oxygens (P=O / P–O− or –OH): the chain is horizontal, so
  // they point straight out of it — the double bond up, the single bond down.
  const phosphateBondLength = preprocessor.opts?.bondLength ?? bondLength
  const pathSet = new Set(link.path)
  const edges = preprocessor.graph.edges ?? []
  for (const middleIndex of [1, 3] as const) {
    const phosphorus = middles[middleIndex]
    const pPosition = positionOf(preprocessor, phosphorus ?? -1)
    if (phosphorus === undefined || pPosition === undefined) {
      continue
    }
    const exoOxygens = heavyNeighboursOf(preprocessor, phosphorus)
      .filter((id) => !pathSet.has(id))
      .sort((left, right) => {
        const orderOf = (oxygen: number): number =>
          edges.find(
            (edge) =>
              (edge.sourceId === phosphorus && edge.targetId === oxygen) ||
              (edge.sourceId === oxygen && edge.targetId === phosphorus),
          )?.weight ?? 1
        return orderOf(right) - orderOf(left)
      })
    exoOxygens.forEach((oxygen, slot) => {
      const target = {
        x: pPosition.x,
        y: pPosition.y + (slot === 0 ? -1 : 1) * phosphateBondLength,
      }
      const currentPosition = positionOf(preprocessor, oxygen)
      if (currentPosition !== undefined) {
        const shift = { x: target.x - currentPosition.x, y: target.y - currentPosition.y }
        const dragged = collectSubtree(preprocessor, oxygen, new Set(pathSet))
        for (const draggedId of dragged) {
          const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === draggedId)
          if (vertex !== undefined) {
            vertex.position.x += shift.x
            vertex.position.y += shift.y
          }
        }
      }
    })
  }
  return { positions, mirrored: false }
}

/** Snap one ring onto the canonical polygon at its current centroid. */
function placeCanonicalPlan(
  preprocessor: HaworthPreprocessor,
  plan: SugarRingRecognition,
  bondLength: number,
): Map<number, Point> {
  const polygon = HAWORTH_POLYGON[plan.cycle.length as 5 | 6]
  const polygonCenter = centroid(polygon)
  const currentPositions = plan.cycle.map((id) => positionOf(preprocessor, id) ?? { x: 0, y: 0 })
  const offset = {
    x: centroid(currentPositions).x - polygonCenter.x * bondLength,
    y: centroid(currentPositions).y - polygonCenter.y * bondLength,
  }
  const positions = new Map<number, Point>()
  plan.cycle.forEach((vertexId, role) => {
    const target = {
      x: offset.x + polygon[role].x * bondLength,
      y: offset.y + polygon[role].y * bondLength,
    }
    positions.set(vertexId, target)
    place(preprocessor, vertexId, target)
  })
  return positions
}

/**
 * Place the acceptor ring so its anchor vertex lands one acceptor-side bond
 * (LB) back along the tilted-substituent ray from the bridge — side-aware,
 * with the same 18° CHAIN_BIAS toward free space as the donor. If the
 * canonical polygon puts the anchor vertex on the wrong x side (facing away
 * from the bridge) the polygon is mirrored in x about its centroid. A pure
 * x-mirror flips the effective chirality reading, so a mirrored ring also
 * swaps up/down on every substituent (two flips compose to identity),
 * keeping each stereocentre's R/S — the textbook flipped furanose of
 * sucrose.
 *
 * With opposite anchor sides the donor and acceptor tilts are parallel, so
 * the bridge draws as one straight diagonal (the classic β1→4 / sucrose
 * look); with equal sides the two rays meet in a sharp V (α links).
 */
function placeLinkedPlan(
  preprocessor: HaworthPreprocessor,
  planB: SugarRingRecognition,
  anchorB: number,
  bridgePosition: Point,
  direction: number,
  sideB: number,
  bondLength: number,
): { positions: Map<number, Point>; mirrored: boolean } {
  const polygon = HAWORTH_POLYGON[planB.cycle.length as 5 | 6]
  const polygonCenter = centroid(polygon)
  const role = planB.cycle.indexOf(anchorB)
  const polygonAnchor = polygon[role] ?? polygonCenter
  const anchorSide = Math.sign(polygonAnchor.x - polygonCenter.x)
  const mirror = anchorSide !== 0 && anchorSide === direction
  const localAnchor = mirror
    ? { x: 2 * polygonCenter.x - polygonAnchor.x, y: polygonAnchor.y }
    : polygonAnchor
  // Anchor x-side after mirroring; fallback points away from the donor.
  const drawnOutward = anchorSide !== 0 ? (mirror ? -anchorSide : anchorSide) : -direction
  // The canonical side is read from the unmirrored recognition; a mirrored
  // ring draws it swapped (see the mirror-in-x note above).
  const drawnSideB = mirror ? -sideB : sideB
  const LB = bondLength * (drawnSideB < 0 ? 0.9 : 1)
  const desiredB =
    drawnOutward !== 0
      ? Math.atan2(drawnSideB, drawnOutward * Math.tan(Math.PI / 10))
      : (drawnSideB * Math.PI) / 2
  const targetAnchor = {
    x: bridgePosition.x - Math.cos(desiredB) * LB,
    y: bridgePosition.y - Math.sin(desiredB) * LB,
  }
  const offset = {
    x: targetAnchor.x - localAnchor.x * bondLength,
    y: targetAnchor.y - localAnchor.y * bondLength,
  }
  const positions = new Map<number, Point>()
  planB.cycle.forEach((vertexId, index) => {
    const local = polygon[index]
    const mirrored = mirror ? { x: 2 * polygonCenter.x - local.x, y: local.y } : local
    const target = {
      x: offset.x + mirrored.x * bondLength,
      y: offset.y + mirrored.y * bondLength,
    }
    positions.set(vertexId, target)
    place(preprocessor, vertexId, target)
  })
  return { positions, mirrored: mirror }
}

/**
 * Verticalize one plan's exocyclic substituents after EVERY ring has been
 * placed. `protectedIds` covers all plans' ring atoms plus the glycosidic
 * bridges: subtree walks stop before a neighbouring ring and pre-placed
 * bridges are skipped outright, so a disaccharide's second ring can no
 * longer be rotated by the first ring's substituent pass.
 */
function applyPlan(
  preprocessor: HaworthPreprocessor,
  plan: SugarRingRecognition,
  bondLength: number,
  protectedIds: Set<number>,
  mirrorThis: boolean,
): void {
  const ringIds = plan.cycle
  // Final coordinates from the global placement pass (never a pre-placement
  // snapshot — a linked ring may have been moved after the root snapped).
  const ringPositions = new Map<number, Point>()
  for (const id of ringIds) {
    const position = positionOf(preprocessor, id)
    if (position !== undefined) {
      ringPositions.set(id, { x: position.x, y: position.y })
    }
  }
  // Exocyclic substituents strictly vertical; subtrees rotated to follow.
  // Chain substituents (CH2OH, N-linked bases, phosphate tails) are biased
  // toward their free side relative to the ring centroid so they clear the
  // ring. After that first bond, a linear chain is laid out as an outward
  // 60° diagonal walk (each continuation turns the same 60° off vertical
  // toward free space, full bond length): rings and branch points stop the
  // walk, leaving their remaining subtree with the last rigid transform.
  // Bond lengths are side-aware: plain upward substituents are shortened so
  // their labels never reach into the ring interior; chain links (first bond
  // and continuations) keep the full bond length.
  const blocked = new Set(protectedIds)
  // Every ring atom (sugar AND aromatic base rings) fences the walk off.
  const ringMembers = new Set<number>()
  for (const ring of preprocessor.rings) {
    for (const id of ring.members) {
      ringMembers.add(id)
    }
  }
  const ringCenterWorld = centroid([...ringPositions.values()])
  const CHAIN_BIAS = Math.PI / 10 // tilt chains ±18° toward free space
  const UP_BOND_FACTOR = 0.9
  /** Every chain continuation turns 60° off vertical toward free space (the textbook 120° interior angle for -CH2OH tails). */
  const CH2OH_TURN = Math.PI / 3
  for (const atom of plan.atoms) {
    const anchor = ringPositions.get(atom.vertexId)
    if (anchor === undefined) {
      continue
    }
    const outwardX = Math.sign(anchor.x - ringCenterWorld.x)
    // A ring mirrored in x has its chirality reading flipped; swapping the
    // two drawn arms restores it (mirror + swap = identity on every centre).
    const groups: { ids: number[]; direction: number }[] = mirrorThis
      ? [
          { ids: atom.up, direction: 1 },
          { ids: atom.down, direction: -1 },
        ]
      : [
          { ids: atom.up, direction: -1 },
          { ids: atom.down, direction: 1 },
        ]
    for (const group of groups) {
      for (const substituentId of group.ids) {
        // Glycosidic bridges were positioned by the link pass — rotating or
        // shifting their subtree here would drag the whole other ring.
        if (protectedIds.has(substituentId)) {
          continue
        }
        const atomInfo = preprocessor.graph.vertices.find(
          (candidate) => candidate.id === substituentId,
        )
        if (atomInfo === undefined) {
          continue
        }
        const continuationIds = heavyNeighboursOf(preprocessor, substituentId, atom.vertexId)
        const isChain = outwardX !== 0 && continuationIds.length > 0
        // Pure -CH2OH tail: the chain atom carries exactly one heavy
        // continuation (the terminal OH) — draw its first bond strictly
        // vertical (textbook), no tilt.
        const continuationId = isChain ? continuationIds[0] : undefined
        const isPureTail =
          continuationId !== undefined &&
          heavyNeighboursOf(preprocessor, continuationId, substituentId).length === 0
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
          // Plain upward substituents stay short so labels clear the ring;
          // chain links keep the full bond length because the walk now sends
          // them outward (this also makes the first tail link match the rest).
          const targetLength =
            bondLength * (group.direction < 0 && !isTiltedChain ? UP_BOND_FACTOR : 1)
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

        // Nucleobase on the anomeric carbon (purines, pyrimidines, pseudo-
        // bases): the N-glycosidic nitrogen is sp2 — its two ring bonds sit
        // at ±120° around the N–C1′ bond, so the base's ring-bond bisector
        // lies exactly on the bond line, pointing away from the sugar
        // (trigonal rule; base-agnostic, unlike the former long-axis snap
        // that misread the pyrimidine N1→C4 symmetry chord). The chain pass
        // above fixes the bond; rotate the rigid aromatic subtree around the
        // N until its bisector matches the bond heading, whatever the source
        // layout handed in. Handedness is canonical: identify the ring
        // neighbour that steps directly into a ring nitrogen — purine C8,
        // pyrimidine C2. Pyrimidines (six-ring N) keep it on the + side of
        // the bond axis (second ring N to the right); purines (five-ring N)
        // keep it on the − side, so the fused six-ring swings right of the
        // bond line instead of towering over the sugar. A base arriving on
        // the wrong side is a mirrored engine variant, flipped back rigidly
        // across the bond axis. Bases with no ring-N marker (nicotinamide)
        // fall back to the ring neighbour whose lone ring continuation
        // carries a substituent (the C3 carboxamide), on the six-ring +
        // side. Pivoting on the glycosidic N leaves the just-placed
        // glycosidic bond untouched.
        if (
          atom.vertexId === plan.cycle[0] &&
          atomInfo.value.element === "N" &&
          atomInfo.value.isPartOfAromaticRing === true
        ) {
          const anchorPosition = positionOf(preprocessor, atom.vertexId)
          const glycoNPosition = positionOf(preprocessor, substituentId)
          const ringNeighbours = heavyNeighboursOf(
            preprocessor,
            substituentId,
            atom.vertexId,
          ).filter(
            (neighbour) =>
              preprocessor.graph.vertices.find((candidate) => candidate.id === neighbour)?.value
                .isPartOfAromaticRing === true,
          )
          if (
            anchorPosition !== undefined &&
            glycoNPosition !== undefined &&
            ringNeighbours.length === 2
          ) {
            const outward = {
              x: glycoNPosition.x - anchorPosition.x,
              y: glycoNPosition.y - anchorPosition.y,
            }
            const outwardLength = Math.hypot(outward.x, outward.y)
            const unitFromN = (neighbour: number | undefined): Point | undefined => {
              if (neighbour === undefined) {
                return undefined
              }
              const point = positionOf(preprocessor, neighbour)
              if (point === undefined) {
                return undefined
              }
              const dx = point.x - glycoNPosition.x
              const dy = point.y - glycoNPosition.y
              const length = Math.hypot(dx, dy)
              return length < 1e-9 ? undefined : { x: dx / length, y: dy / length }
            }
            const firstBond = unitFromN(ringNeighbours[0])
            const secondBond = unitFromN(ringNeighbours[1])
            const bisector =
              firstBond !== undefined && secondBond !== undefined
                ? { x: firstBond.x + secondBond.x, y: firstBond.y + secondBond.y }
                : undefined
            if (
              outwardLength > 1e-6 &&
              bisector !== undefined &&
              Math.hypot(bisector.x, bisector.y) > 1e-6
            ) {
              rotatePositions(
                preprocessor,
                subtree,
                glycoNPosition,
                Math.atan2(outward.y, outward.x) - Math.atan2(bisector.y, bisector.x),
              )
              // Canonical parity (textbook pose): the marked ring neighbour
              // — purine C8 / pyrimidine C2, recognised by its lone ring
              // continuation being a nitrogen — belongs on the ring-size
              // side of the bond axis: five-ring glyco N (purines) on the −
              // side, six-ring glyco N (pyrimidines) on the + side. Mirror a
              // source-mirrored variant back across that axis.
              const marked =
                ringNeighbours.find((neighbour) => {
                  const continuations = heavyNeighboursOf(
                    preprocessor,
                    neighbour,
                    substituentId,
                  ).filter((id) => ringMembers.has(id))
                  return (
                    continuations.length === 1 &&
                    preprocessor.graph.vertices.find(
                      (candidate) => candidate.id === continuations[0],
                    )?.value.element === "N"
                  )
                }) ??
                // Unmarked bases (nicotinamide): fall back to the ring
                // neighbour whose lone ring continuation carries a non-ring
                // substituent (the C3 carboxamide) for its canonical side.
                ringNeighbours.find((neighbour) => {
                  const continuations = heavyNeighboursOf(
                    preprocessor,
                    neighbour,
                    substituentId,
                  ).filter((id) => ringMembers.has(id))
                  const ringStep = continuations[0]
                  if (continuations.length !== 1 || ringStep === undefined) {
                    return false
                  }
                  return heavyNeighboursOf(preprocessor, ringStep, neighbour).some(
                    (id) => !ringMembers.has(id),
                  )
                })
              const outwardUnit = {
                x: outward.x / outwardLength,
                y: outward.y / outwardLength,
              }
              const markedPosition =
                marked !== undefined ? positionOf(preprocessor, marked) : undefined
              // The glyco N's own ring size picks the canonical side.
              const glycoRingMembers = preprocessor.rings.find((ring) =>
                ring.members.includes(substituentId),
              )?.members.length
              const canonicalSide = glycoRingMembers === 5 ? -1 : 1
              if (markedPosition !== undefined) {
                const side =
                  outwardUnit.x * (markedPosition.y - glycoNPosition.y) -
                  outwardUnit.y * (markedPosition.x - glycoNPosition.x)
                if (side * canonicalSide < 0) {
                  mirrorAcrossAxis(preprocessor, subtree, glycoNPosition, outwardUnit)
                }
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
        } else if (isTiltedChain) {
          // General chain: continue outward in 60°-off-vertical steps so
          // the rest of the tail marches diagonally away from the ring.
          // Rings, protected atoms and branch points stop the walk.
          const walkTarget = Math.atan2(
            group.direction,
            (outwardX === 0 ? 1 : outwardX) * Math.tan(CH2OH_TURN),
          )
          walkChainOutward(
            preprocessor,
            substituentId,
            atom.vertexId,
            walkTarget,
            bondLength,
            ringMembers,
            blocked,
          )
        }
        blocked.add(substituentId)
      }
    }
  }

  // Blank stereo wedges on every touched bond (Haworth draws plain lines).
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

  // Recompute the ring center (aromatic circle / label placement).
  recomputeRingCenter(preprocessor, plan.ringId, ringIds)
}

/** Reflect ids across the axis line through `pivot` (unit direction). */
function mirrorAcrossAxis(
  preprocessor: HaworthPreprocessor,
  ids: number[],
  pivot: Point,
  axisUnit: Point,
): void {
  for (const id of ids) {
    const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === id)
    if (vertex === undefined) {
      continue
    }
    const vx = vertex.position.x - pivot.x
    const vy = vertex.position.y - pivot.y
    const projection = vx * axisUnit.x + vy * axisUnit.y
    vertex.position.x = pivot.x + 2 * projection * axisUnit.x - vx
    vertex.position.y = pivot.y + 2 * projection * axisUnit.y - vy
  }
}

/**
 * Order a ring's members around its cycle, starting at `start`. Traversal
 * prefers a non-sugar neighbour for the first step so a shared fused edge is
 * walked last (closure order: sharedA → ring body → sharedB). Returns null
 * when the members do not form a simple cycle.
 */
function orderedRingCycle(
  preprocessor: HaworthPreprocessor,
  members: number[],
  start: number,
  sugarSet: Set<number>,
): number[] | null {
  const memberSet = new Set(members)
  const neighboursOf = (id: number): number[] =>
    preprocessor.graph.vertices.find((candidate) => candidate.id === id)?.neighbours ?? []
  const ordered = [start]
  let previous = -1
  let current = start
  while (ordered.length < members.length) {
    const candidates = neighboursOf(current).filter(
      (id) =>
        memberSet.has(id) &&
        id !== previous &&
        (id !== start || ordered.length === members.length - 1),
    )
    const next = candidates.find((id) => id !== start && !sugarSet.has(id)) ?? candidates[0]
    if (next === undefined) {
      return null
    }
    ordered.push(next)
    previous = current
    current = next
  }
  return ordered
}

/**
 * A fused 3′,5′-cyclic phosphodiester (cAMP family): its six-ring shares one
 * sugar edge (C3′–C4′) and the generic substituent pass treats BOTH ring
 * oxygens as independent chain tails, tearing the loop apart (the phosphorus
 * lands on top of the base). Rebuild the loop as a regular hexagon fused on
 * the shared edge on the side AWAY from the sugar centroid — the textbook
 * cAMP bulge to the left. Exocyclic substituents on the moved atoms (P=O,
 * P–OH) are dragged along rigidly.
 */
function rebuildCyclicDiesters(
  preprocessor: HaworthPreprocessor,
  plan: SugarRingRecognition,
): void {
  const sugarSet = new Set(plan.cycle)
  const elementOf = (id: number): string | undefined =>
    preprocessor.graph.vertices.find((candidate) => candidate.id === id)?.value.element
  for (const ring of preprocessor.rings) {
    if (ring.members.length !== 6) {
      continue
    }
    const shared = ring.members.filter((id) => sugarSet.has(id))
    if (shared.length !== 2) {
      continue
    }
    const neighboursOfA =
      preprocessor.graph.vertices.find((candidate) => candidate.id === shared[0])?.neighbours ?? []
    if (!neighboursOfA.includes(shared[1])) {
      continue
    }
    const phosphorusIds = ring.members.filter((id) => elementOf(id) === "P")
    if (phosphorusIds.length !== 1) {
      continue
    }
    const ordered = orderedRingCycle(preprocessor, ring.members, shared[0], sugarSet)
    if (ordered === null || ordered.length !== 6 || ordered[5] !== shared[1]) {
      continue
    }
    const a = positionOf(preprocessor, shared[0])
    const b = positionOf(preprocessor, shared[1])
    if (a === undefined || b === undefined) {
      continue
    }
    const side = Math.hypot(b.x - a.x, b.y - a.y)
    if (side < 1e-6) {
      continue
    }
    const sugarCentroid = centroid(
      plan.cycle
        .map((id) => positionOf(preprocessor, id))
        .filter((point): point is Point => point !== undefined),
    )
    const direction = { x: (b.x - a.x) / side, y: (b.y - a.y) / side }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const perpendicular = { x: -direction.y, y: direction.x }
    const external =
      perpendicular.x * (mid.x - sugarCentroid.x) + perpendicular.y * (mid.y - sugarCentroid.y) > 0
        ? perpendicular
        : { x: -perpendicular.x, y: -perpendicular.y }
    // Regular hexagon: circumradius equals its side, center apothem away.
    const center = {
      x: mid.x + (external.x * Math.sqrt(3) * side) / 2,
      y: mid.y + (external.y * Math.sqrt(3) * side) / 2,
    }
    const angleA = Math.atan2(a.y - center.y, a.x - center.x)
    const angleB = Math.atan2(b.y - center.y, b.x - center.x)
    let delta = angleB - angleA
    while (delta > Math.PI) {
      delta -= 2 * Math.PI
    }
    while (delta < -Math.PI) {
      delta += 2 * Math.PI
    }
    // From a, the five external steps sweep 300° around the center to reach b.
    const stepSign = delta < 0 ? 1 : -1
    const memberSet = new Set(ring.members)
    for (let k = 1; k <= 4; k += 1) {
      const id = ordered[k]
      const angle = angleA + stepSign * (Math.PI / 3) * k
      const target = {
        x: center.x + side * Math.cos(angle),
        y: center.y + side * Math.sin(angle),
      }
      const previousPosition = positionOf(preprocessor, id)
      if (previousPosition !== undefined) {
        const shift = { x: target.x - previousPosition.x, y: target.y - previousPosition.y }
        const exocyclicNeighbours = (
          preprocessor.graph.vertices.find((candidate) => candidate.id === id)?.neighbours ?? []
        ).filter((n) => !memberSet.has(n) && elementOf(n) !== "H")
        for (const neighbour of exocyclicNeighbours) {
          const dragged = collectSubtree(preprocessor, neighbour, new Set(memberSet))
          for (const draggedId of dragged) {
            const vertex = preprocessor.graph.vertices.find((c) => c.id === draggedId)
            if (vertex !== undefined) {
              vertex.position.x += shift.x
              vertex.position.y += shift.y
            }
          }
        }
      }
      place(preprocessor, id, target)
    }

    // Re-aim the phosphorus's two exocyclic oxygens (P=O / P–O): the rigid
    // drag above keeps whatever heading they inherited, which can draw the
    // P=O almost exactly along a P–O ring bond. The free slots at a fused
    // hexagon vertex are the two directions outward ±60°, each 120° clear of
    // both ring bonds; the double bond takes the leading one.
    const phosphorusId = phosphorusIds[0]
    const phosphorusIndex = ordered.indexOf(phosphorusId)
    const phosphorusPosition = positionOf(preprocessor, phosphorusId)
    if (phosphorusIndex > 0 && phosphorusPosition !== undefined) {
      const previousRing = positionOf(
        preprocessor,
        ordered[(phosphorusIndex + ordered.length - 1) % ordered.length],
      )
      const nextRing = positionOf(preprocessor, ordered[(phosphorusIndex + 1) % ordered.length])
      if (previousRing !== undefined && nextRing !== undefined) {
        const unitToward = (target: Point): Point => {
          const dx = target.x - phosphorusPosition.x
          const dy = target.y - phosphorusPosition.y
          const length = Math.hypot(dx, dy)
          return length < 1e-9 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length }
        }
        const towardPrevious = unitToward(previousRing)
        const towardNext = unitToward(nextRing)
        const bisectorLength = Math.hypot(
          towardPrevious.x + towardNext.x,
          towardPrevious.y + towardNext.y,
        )
        if (bisectorLength > 1e-6) {
          const outwardHeading = Math.atan2(
            -((towardPrevious.y + towardNext.y) / bisectorLength),
            -((towardPrevious.x + towardNext.x) / bisectorLength),
          )
          const phosphorusBondLength = preprocessor.opts?.bondLength ?? 24
          const edges = preprocessor.graph.edges ?? []
          const exoOxygens = (
            preprocessor.graph.vertices.find((candidate) => candidate.id === phosphorusId)
              ?.neighbours ?? []
          )
            .filter((neighbour) => !memberSet.has(neighbour) && elementOf(neighbour) === "O")
            .sort((left, right) => {
              const orderOf = (oxygen: number): number =>
                edges.find(
                  (edge) =>
                    (edge.sourceId === phosphorusId && edge.targetId === oxygen) ||
                    (edge.sourceId === oxygen && edge.targetId === phosphorusId),
                )?.weight ?? 1
              return orderOf(right) - orderOf(left)
            })
          exoOxygens.forEach((oxygen, slot) => {
            const angle = outwardHeading + (slot === 0 ? 1 : -1) * (Math.PI / 3)
            const target = {
              x: phosphorusPosition.x + Math.cos(angle) * phosphorusBondLength,
              y: phosphorusPosition.y + Math.sin(angle) * phosphorusBondLength,
            }
            const currentPosition = positionOf(preprocessor, oxygen)
            if (currentPosition !== undefined) {
              const shift = { x: target.x - currentPosition.x, y: target.y - currentPosition.y }
              const dragged = collectSubtree(
                preprocessor,
                oxygen,
                new Set([...memberSet, phosphorusId]),
              )
              for (const draggedId of dragged) {
                const vertex = preprocessor.graph.vertices.find((c) => c.id === draggedId)
                if (vertex !== undefined) {
                  vertex.position.x += shift.x
                  vertex.position.y += shift.y
                }
              }
            }
          })
        }
      }
    }
    recomputeRingCenter(preprocessor, ring.id, ring.members)
  }
}

/**
 * Run sugar recognition + Haworth reshaping on a preprocessor-shaped graph.
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

  // Glycosidic links between recognized rings (O / S / N bridges alike).
  // Every ring atom and every bridge is protected for the whole pass: ring
  // placement coordinates all rings first, then each substituent walk is
  // fenced off from every ring, not just its own.
  const links = detectSugarLinks(preprocessor, plans)
  const protectedIds = new Set<number>()
  for (const plan of plans) {
    for (const id of plan.cycle) {
      protectedIds.add(id)
    }
  }
  const sugarLinkedPlans = new Set<number>()
  for (const link of links) {
    protectedIds.add(link.bridge)
    sugarLinkedPlans.add(link.planA)
    sugarLinkedPlans.add(link.planB)
  }
  // Pyrophosphate-bridged dinucleotides (NAD+ family): the whole tail-to-tail
  // path is protected so neither ribose's chain walk claims it.
  const dinucleotideLinks = detectDinucleotideLinks(preprocessor, plans, sugarLinkedPlans)
  for (const link of dinucleotideLinks) {
    for (const id of link.path) {
      protectedIds.add(id)
    }
  }

  // 1. Ring placement: BFS over links, BEFORE any substituent layout.
  const placed = plans.map(() => false)
  // Which plans were x-mirrored by the link pass (root/unreachable: false).
  const mirrored = plans.map(() => false)
  const ringPositions = new Map<number, Point>()
  const remember = (positions: Map<number, Point>): void => {
    for (const [id, position] of positions) {
      ringPositions.set(id, position)
    }
  }
  // Root ring: canonical polygon at its current library-layout centroid.
  remember(placeCanonicalPlan(preprocessor, plans[0], bondLength))
  placed[0] = true
  const queue: number[] = [0]
  while (queue.length > 0) {
    const planIndex = queue.shift()
    if (planIndex === undefined) {
      break
    }
    const plan = plans[planIndex]
    for (const link of links) {
      if (link.planA !== planIndex || placed[link.planB]) {
        continue
      }
      const anchorAtom = plan.atoms.find((atom) => atom.vertexId === link.anchorA)
      // Anomeric up/down side; unknown fallback is down (+1).
      const side = anchorAtom?.up.includes(link.bridge)
        ? -1
        : anchorAtom?.down.includes(link.bridge)
          ? 1
          : 1
      const anchor = positionOf(preprocessor, link.anchorA) ?? { x: 0, y: 0 }
      const placedRing = plan.cycle
        .map((id) => ringPositions.get(id))
        .filter((position): position is Point => position !== undefined)
      const centerA = centroid(placedRing)
      let outwardX = Math.sign(anchor.x - centerA.x)
      if (outwardX === 0) {
        outwardX = 1
      }
      // Existing chain-bias tilt (18°), honoring the anomeric up/down side.
      // A mirrored donor draws its canonical side swapped.
      const drawnSide = mirrored[planIndex] ? -side : side
      const desired =
        outwardX !== 0
          ? Math.atan2(drawnSide, outwardX * Math.tan(Math.PI / 10))
          : (drawnSide * Math.PI) / 2
      const length = bondLength * (drawnSide < 0 ? 0.9 : 1)
      const bridgePosition = {
        x: anchor.x + Math.cos(desired) * length,
        y: anchor.y + Math.sin(desired) * length,
      }
      place(preprocessor, link.bridge, bridgePosition)
      // Acceptor-side anomeric up/down side (unknown fallback is down, +1).
      const acceptorPlan = plans[link.planB]
      const acceptorAnchorAtom = acceptorPlan.atoms.find((atom) => atom.vertexId === link.anchorB)
      const sideB = acceptorAnchorAtom?.up.includes(link.bridge)
        ? -1
        : acceptorAnchorAtom?.down.includes(link.bridge)
          ? 1
          : 1
      // Acceptor lands one side-aware bond back along its tilted ray; its
      // polygon is x-mirrored when the anchor vertex faces the wrong way.
      const acceptorLayout = placeLinkedPlan(
        preprocessor,
        acceptorPlan,
        link.anchorB,
        bridgePosition,
        outwardX,
        sideB,
        bondLength,
      )
      remember(acceptorLayout.positions)
      mirrored[link.planB] = acceptorLayout.mirrored
      placed[link.planB] = true
      queue.push(link.planB)
    }
  }
  // Dinucleotide pairs: keep the richer-nucleobase ribose canonical, mirror
  // the partner ribose to its left and lay the bridge across the middle.
  for (const link of dinucleotideLinks) {
    const planA = plans[link.planA]
    const planB = plans[link.planB]
    if (planA === undefined || planB === undefined) {
      continue
    }
    if (placed[link.planA] !== true) {
      remember(placeCanonicalPlan(preprocessor, planA, bondLength))
      placed[link.planA] = true
    }
    const pair = placeDinucleotidePair(preprocessor, planB, link, bondLength)
    if (pair !== null) {
      remember(pair.positions)
      mirrored[link.planB] = pair.mirrored
      placed[link.planB] = true
    }
  }
  // Rings not reachable through a link keep the plain monosaccharide
  // treatment (canonical at current centroid, no mirror).
  plans.forEach((plan, index) => {
    if (placed[index]) {
      return
    }
    remember(placeCanonicalPlan(preprocessor, plan, bondLength))
    placed[index] = true
  })

  // 2. Substituent pass + per-plan wedges/ring centre, after ALL rings land.
  plans.forEach((plan, index) => {
    applyPlan(preprocessor, plan, bondLength, protectedIds, mirrored[index])
  })

  // 3. Fused cyclic phosphodiesters (cAMP family): the substituent pass tore
  // their six-member loop apart, so rebuild each as a fused hexagon last of
  // all, on the external side of its shared sugar edge.
  for (const plan of plans) {
    rebuildCyclicDiesters(preprocessor, plan)
  }
  return true
}
