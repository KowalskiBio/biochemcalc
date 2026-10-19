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

/** The live smiles-drawer graph shape shared by both post-layout passes. */
export type HaworthPreprocessor = LayoutPreprocessor

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
  for (const link of links) {
    protectedIds.add(link.bridge)
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
  return true
}

/**
 * Half-thickness of a tapered (thin) front edge, in viewBox user units.
 * Matches the drawer's default bond thickness (1.0) closely enough that the
 * tapered end blends into the underlying plain ring-bond stroke.
 */
const HAWORTH_FRONT_EDGE_THIN = 1.1
/** Half-thickness of the thick front edge, in viewBox user units (1.1 + (4.5−1.1)/3 — a third of the original wedge strength). */
const HAWORTH_FRONT_EDGE_THICK = 2.2

/**
 * The drawer paints plain bonds as `<line>` elements carrying a `stroke`
 * attribute (SvgWrapper.drawLine), coloring each half by its endpoint atom —
 * so a stroke sampled blindly from somewhere in the drawing can be an
 * oxygen-coloured half instead of the neutral C–C ring bond. Per front edge,
 * take the stroke of the bond line whose own midpoint is closest to the
 * segment's midpoint; fall back to the drawing's first stroked bond, then
 * `currentColor`, when nothing coordinates-bearing is found nearby.
 */
export function bondStrokeNear(svgRoot: SVGSVGElement, x: number, y: number): string | null {
  let bestStroke: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const element of Array.from(svgRoot.querySelectorAll("line"))) {
    const stroke = element.getAttribute("stroke")
    if (stroke === null || stroke.trim() === "" || stroke.trim() === "none") {
      continue
    }
    const x1 = Number(element.getAttribute("x1"))
    const y1 = Number(element.getAttribute("y1"))
    const x2 = Number(element.getAttribute("x2"))
    const y2 = Number(element.getAttribute("y2"))
    if ([x1, y1, x2, y2].some((value) => Number.isNaN(value))) {
      continue
    }
    const distance = Math.hypot((x1 + x2) / 2 - x, (y1 + y2) / 2 - y)
    if (distance < bestDistance) {
      bestDistance = distance
      bestStroke = stroke
    }
  }
  return bestStroke
}

export function sampleBondStroke(svgRoot: SVGSVGElement): string {
  for (const element of Array.from(svgRoot.querySelectorAll("line, path"))) {
    const stroke = element.getAttribute("stroke")
    if (stroke !== null && stroke.trim() !== "" && stroke.trim() !== "none") {
      return stroke
    }
  }
  return "currentColor"
}

/**
 * Post-draw pass: render the three front ring bonds of every recognized sugar
 * as graduated bold quads (the classic Haworth "wedge" cue). Both canonical
 * polygons put roles 0–3 on the bottom/front edge, so the same role pairs work
 * for pyranose and furanose rings:
 *
 *   0 → 1  thin at C1, thick at C2
 *   1 → 2  thick at both ends (thickest, uniform)
 *   2 → 3  thick at C3, thin at C4
 *
 * The quads are built from the FINAL preprocessor coordinates (the same world
 * units the drawer bakes into the viewBox) and appended to the svg root. The
 * drawer's own thin ring-bond strokes stay in place: the tapered ends are
 * chosen to match that stroke width, so the bold shape blends into the plain
 * line instead of floating over it.
 */
export function applyHaworthBoldFrontEdges(
  svgRoot: SVGSVGElement,
  preprocessor: HaworthPreprocessor,
): void {
  const plans = recognizeSugarRings(snapshotFromPreprocessor(preprocessor))
  if (plans.length === 0) {
    return
  }
  const fallbackFill = sampleBondStroke(svgRoot)
  const segments: { a: number; b: number; ta: number; tb: number }[] = [
    { a: 0, b: 1, ta: HAWORTH_FRONT_EDGE_THIN, tb: HAWORTH_FRONT_EDGE_THICK },
    { a: 1, b: 2, ta: HAWORTH_FRONT_EDGE_THICK, tb: HAWORTH_FRONT_EDGE_THICK },
    { a: 2, b: 3, ta: HAWORTH_FRONT_EDGE_THICK, tb: HAWORTH_FRONT_EDGE_THIN },
  ]
  for (const plan of plans) {
    const ring: Point[] = []
    for (const vertexId of plan.cycle) {
      const position = positionOf(preprocessor, vertexId)
      if (position === undefined) {
        ring.length = 0
        break
      }
      ring.push({ x: position.x, y: position.y })
    }
    if (ring.length < 4) {
      continue
    }
    const ringCenter = centroid(ring)
    for (const segment of segments) {
      const from = ring[segment.a]
      const to = ring[segment.b]
      const dx = to.x - from.x
      const dy = to.y - from.y
      const length = Math.hypot(dx, dy)
      if (length === 0) {
        continue
      }
      // Unit normal of the bond, flipped to point OUT of the ring (away from
      // the centroid) so the wedge flares outward instead of covering the
      // ring interior. An x-mirrored acceptor only flips x, so this stays
      // correct for mirrored rings (y is unchanged).
      let nx = -dy / length
      let ny = dx / length
      const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
      if (nx * (midpoint.x - ringCenter.x) + ny * (midpoint.y - ringCenter.y) < 0) {
        nx = -nx
        ny = -ny
      }
      const points = [
        { x: from.x + nx * segment.ta, y: from.y + ny * segment.ta },
        { x: to.x + nx * segment.tb, y: to.y + ny * segment.tb },
        { x: to.x - nx * segment.tb, y: to.y - ny * segment.tb },
        { x: from.x - nx * segment.ta, y: from.y - ny * segment.ta },
      ]
      const polygon = svgRoot.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "polygon")
      polygon.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "))
      // Fill from THIS edge's own bond line, not an arbitrary bond elsewhere —
      // atom-coloured bond halves (e.g. around the ring oxygen) would tint it.
      polygon.setAttribute("fill", bondStrokeNear(svgRoot, midpoint.x, midpoint.y) ?? fallbackFill)
      polygon.setAttribute("stroke", "none")
      polygon.setAttribute("class", "haworth-front-edge")
      svgRoot.appendChild(polygon)
    }
  }
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
 * centroid which side the label should read from. OHs on the ring's left
 * edge become "HO" — the classic idiom (hexose C4) — and the label extends
 * into free space, easing overlaps.
 */
export function collectOhLabelHints(preprocessor: HaworthPreprocessor): HOHint[] {
  const snapshot = snapshotFromPreprocessor(preprocessor)
  const plans = recognizeSugarRings(snapshot)
  const bondLength = preprocessor.opts?.bondLength ?? 24
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
        // Only the ring EDGE flips, not everything left of the centre. At
        // bond 24 the canonical pyranose C4 hydroxyl sits ~27.6 px left of
        // the centroid, while pyranose C3 and the furanose third vertex
        // (ribose C3 / fructose C4) sit only ~13.8 px left. A −0.75 bond
        // (−18 px) boundary separates the two positionally, with no
        // per-sugar semantics needed.
        hints.push({
          x: substituent.position.x,
          y: substituent.position.y,
          side: substituent.position.x < centroidX - 0.75 * bondLength ? "HO" : "OH",
        })
      }
    }
  }
  return hints
}

/**
 * Post-draw label fix for left-edge hydroxyls. The library draws every atom
 * label as a `<text class="element">` inside a `<g>` whose vertex position is
 * baked into `style` as `transform: translateX(<x>px) translateY(<y>px)`.
 * The `<text>` itself has no x/y anchors (up/down labels instead stack their
 * tspans vertically via `x="0px"` and `y="±0.9i em"`), and an "OH" label is a
 * text with two tspans ("O", "H"). We therefore match candidates by the
 * parent g's translate and drop the tspan stacking attributes.
 *
 * A right/up/down label's g-translate x is the vertex x MINUS half the
 * measured element width, whereas the library's own left-direction labels
 * use vertex x PLUS half the width — centred on the bond end. To reproduce
 * that without measuring text, capture the candidate's original gx and set
 * the new translate x to `hint.x + |hint.x - gx|`: the same half-glyph shift
 * on the correct side, so the O glyph sits on the bond and the H extends
 * left. Keeping translate y = hint.y preserves the true vertex height.
 * Finally the existing tspans are re-appended in H→O order (preserving each
 * letter's fill colour) with `text-anchor="end"`, so the whole "HO" grows
 * leftward into free space.
 */
export function applyHaworthHOLabels(svgRoot: SVGSVGElement, hints: HOHint[]): void {
  const STYLE_TRANSLATE = /translateX\((-?[\d.]+)px\)\s*translateY\((-?[\d.]+)px\)/
  interface Candidate {
    text: Element
    parent: Element
    gx: number
    gy: number
  }
  const candidates: Candidate[] = []
  for (const text of Array.from(svgRoot.querySelectorAll("text"))) {
    if ((text.textContent ?? "").trim() !== "OH") {
      continue
    }
    const parent = text.parentElement
    if (parent === null || parent.localName !== "g") {
      continue
    }
    const match = STYLE_TRANSLATE.exec(parent.getAttribute("style") ?? "")
    if (match === null) {
      continue
    }
    candidates.push({ text, parent, gx: Number(match[1]), gy: Number(match[2]) })
  }

  const remaining = [...candidates]
  for (const hint of hints) {
    if (hint.side !== "HO") {
      continue
    }
    let nearestIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    remaining.forEach((candidate, index) => {
      const distance = Math.hypot(candidate.gx - hint.x, candidate.gy - hint.y)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })
    // The g-translate x differs from the vertex x by half the "O" glyph width
    // (≈4–6 px); sibling hydroxyl labels are >25 px apart at bond length 24,
    // so 9 px is unambiguous.
    if (nearestIndex < 0 || nearestDistance >= 9) {
      continue
    }
    const candidate = remaining[nearestIndex]
    const tspans = Array.from(candidate.text.children).filter(
      (child) => child.localName === "tspan",
    )
    const first = (tspans[0]?.textContent ?? "").trim()
    const second = (tspans[1]?.textContent ?? "").trim()
    const isHydroxyl =
      tspans.length === 2 &&
      ((first === "O" && second === "H") || (first === "H" && second === "O"))
    if (!isHydroxyl) {
      // Never corrupt a label whose internals don't look like O + H.
      continue
    }
    remaining.splice(nearestIndex, 1)

    // Keep the library's half-glyph shift so the O glyph stays centred on the
    // bond; the abs also works for a rare left-direction candidate (gx =
    // vertex + half width).
    const centeredX = hint.x + Math.abs(hint.x - candidate.gx)
    candidate.parent.setAttribute(
      "style",
      `transform: translateX(${centeredX}px) translateY(${hint.y}px)`,
    )
    const oxygen = tspans.find((tspan) => (tspan.textContent ?? "").trim() === "O")
    const hydrogen = tspans.find((tspan) => (tspan.textContent ?? "").trim() === "H")
    if (oxygen === undefined || hydrogen === undefined) {
      continue
    }
    for (const tspan of tspans) {
      tspan.removeAttribute("x")
      tspan.removeAttribute("y")
    }
    // appendChild moves the existing nodes, keeping their per-letter colours.
    candidate.text.appendChild(hydrogen)
    candidate.text.appendChild(oxygen)
    candidate.text.setAttribute("text-anchor", "end")
  }
}
