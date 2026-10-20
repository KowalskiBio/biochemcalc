// Post-draw passes for the RDKit depiction pipeline.
//
// RDKit emits a self-contained SVG: bond lines are
// `<path class='bond-N atom-i atom-j' d='M x1,y1 L x2,y2'>`, atom labels are
// vector glyph paths named `atom-N` (one path per glyph, so a hydroxyl is an O
// path followed by an H path), and the drawer paints a full-canvas white
// background rect that the app does not want (the host wrapper is
// transparent).
//
// These helpers work on a detached SVG element and are safe under jsdom: all
// geometry is recovered from the `d`/`points` attributes and class tokens, never
// from `getBBox()` (which jsdom does not implement).
//
// Class-token caveat: `atom-1` is a prefix of `atom-11`, so every lookup
// tokenizes the class attribute and tests exact membership.

import type { Point } from "@/lib/molecules/orientation"
import type { MolGraphSnapshot } from "@/lib/molecules/render/rdkit-engine"

const SVG_NAMESPACE = "http://www.w3.org/2000/svg"

/** One terminal hydroxyl, addressed by RDKit atom index. */
export interface OhLabelHint {
  atom: number
  side: "HO" | "OH"
}

/** One bold Haworth front edge, addressed by RDKit atom indices. */
export interface FrontRingBond {
  a: number
  b: number
}

/** Half-thickness at a tapered (thin) front edge, in SVG user units. */
const FRONT_EDGE_THIN = 1.1
/** Half-thickness at the thick end of a front edge, in SVG user units. */
const FRONT_EDGE_THICK = 2.2

/** Front-edge taper per ring role pair: 0→1, 1→2, 2→3. */
const FRONT_EDGE_SEGMENTS = [
  { ta: FRONT_EDGE_THIN, tb: FRONT_EDGE_THICK },
  { ta: FRONT_EDGE_THICK, tb: FRONT_EDGE_THICK },
  { ta: FRONT_EDGE_THICK, tb: FRONT_EDGE_THIN },
] as const

const METAL_ELEMENTS = new Set(["Fe", "Mg", "Co"])

function classTokens(element: Element): string[] {
  return (element.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean)
}

function isGlyphPath(element: Element, atom: number): boolean {
  const tokens = classTokens(element)
  return tokens.includes(`atom-${atom}`) && !tokens.some((token) => token.startsWith("bond-"))
}

function isBondPath(element: Element): boolean {
  return classTokens(element).some((token) => token.startsWith("bond-"))
}

function bondPathFor(svg: Element, a: number, b: number): Element | null {
  const classA = `atom-${a}`
  const classB = `atom-${b}`
  for (const element of Array.from(svg.querySelectorAll("path"))) {
    const tokens = classTokens(element)
    if (tokens.includes(classA) && tokens.includes(classB)) {
      return element
    }
  }
  return null
}

function numericCoordinates(data: string): number[] {
  const matches = data.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  return matches === null ? [] : matches.map(Number)
}

interface Extent {
  min: number
  max: number
}

/** Sum of any `translate(x y)` components already on the element. */
function translateOf(element: Element): Point {
  const transform = element.getAttribute("transform") ?? ""
  const pattern = /translate\(\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*\)/g
  let dx = 0
  let dy = 0
  for (const match of transform.matchAll(pattern)) {
    dx += Number(match[1])
    dy += Number(match[2])
  }
  return { x: dx, y: dy }
}

/** Axis-aligned extent of a path's coordinates parsed from its `d` data. */
function pathExtent(path: Element, axis: 0 | 1): Extent | null {
  const numbers = numericCoordinates(path.getAttribute("d") ?? "")
  if (numbers.length < 2) {
    return null
  }
  const offset = axis === 0 ? translateOf(path).x : translateOf(path).y
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let index = axis; index < numbers.length; index += 2) {
    const value = numbers[index] + offset
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null
}

function unionExtent(paths: Element[], axis: 0 | 1): Extent | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const path of paths) {
    const extent = pathExtent(path, axis)
    if (extent === null) continue
    min = Math.min(min, extent.min)
    max = Math.max(max, extent.max)
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null
}

/** Centre of an atom's glyph box, from its path data. */
export function glyphCenter(svg: Element, atom: number): Point | null {
  const paths = Array.from(svg.querySelectorAll("path")).filter((path) => isGlyphPath(path, atom))
  const x = unionExtent(paths, 0)
  const y = unionExtent(paths, 1)
  if (x === null || y === null) {
    return null
  }
  return { x: (x.min + x.max) / 2, y: (y.min + y.max) / 2 }
}

function appendTranslate(element: Element, dx: number, dy: number): void {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return
  }
  const existing = element.getAttribute("transform")
  const translate = `translate(${dx} ${dy})`
  element.setAttribute("transform", existing === null ? translate : `${existing} ${translate}`)
}

/**
 * Flip selected hydroxyl labels from "OH" to "HO". RDKit always draws the O
 * glyph first and the H glyph after it; for a hint whose side is "HO" the H
 * glyph is translated left of the O glyph, keeping the O (and therefore the
 * label's right edge / bond anchor) in place and preserving RDKit's own
 * inter-glyph gap.
 */
export function applyOhLabelHints(svg: Element, hints: OhLabelHint[]): void {
  for (const hint of hints) {
    if (hint.side !== "HO") {
      continue
    }
    const paths = Array.from(svg.querySelectorAll("path")).filter((path) =>
      isGlyphPath(path, hint.atom),
    )
    if (paths.length < 2) {
      continue
    }
    // RDKit emits the element glyph first, then its hydrogens.
    const oxygen = paths[0]
    const hydrogens = paths.slice(1)
    const oxygenExtent = pathExtent(oxygen, 0)
    const hydrogenExtent = unionExtent(hydrogens, 0)
    if (oxygenExtent === null || hydrogenExtent === null) {
      continue
    }
    // Already to the left (a previous pass, or a different label): leave it.
    if (hydrogenExtent.max <= oxygenExtent.min) {
      continue
    }
    const gap = hydrogenExtent.min - oxygenExtent.max
    const dx = oxygenExtent.min - gap - hydrogenExtent.max
    if (!Number.isFinite(dx) || Math.abs(dx) < 0.01) {
      continue
    }
    for (const hydrogen of hydrogens) {
      appendTranslate(hydrogen, dx, 0)
    }
  }
}

function parseSegment(path: Element): { from: Point; to: Point } | null {
  const data = path.getAttribute("d") ?? ""
  const match = /M\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/.exec(data)
  if (match === null) {
    return null
  }
  return {
    from: { x: Number(match[1]), y: Number(match[2]) },
    to: { x: Number(match[3]), y: Number(match[4]) },
  }
}

function strokeOf(path: Element): string | null {
  const style = path.getAttribute("style") ?? ""
  const fromStyle = /stroke:\s*(#[0-9a-fA-F]{3,8})/.exec(style)
  if (fromStyle !== null) {
    return fromStyle[1]
  }
  const attribute = path.getAttribute("stroke")
  return attribute !== null && attribute.trim() !== "" && attribute !== "none" ? attribute : null
}

function sampleBondStroke(svg: Element): string {
  for (const path of Array.from(svg.querySelectorAll("path"))) {
    if (!isBondPath(path)) continue
    const stroke = strokeOf(path)
    if (stroke !== null) {
      return stroke
    }
  }
  return "currentColor"
}

function bondStrokeNear(svg: Element, point: Point): string {
  let nearest: string | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const path of Array.from(svg.querySelectorAll("path"))) {
    if (!isBondPath(path)) continue
    const segment = parseSegment(path)
    const stroke = strokeOf(path)
    if (segment === null || stroke === null) continue
    const midpoint = {
      x: (segment.from.x + segment.to.x) / 2,
      y: (segment.from.y + segment.to.y) / 2,
    }
    const distance = Math.hypot(midpoint.x - point.x, midpoint.y - point.y)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = stroke
    }
  }
  return nearest ?? sampleBondStroke(svg)
}

function keyOf(point: Point): string {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`
}

function centroidOf(points: Point[]): Point {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/**
 * Bold, graduated Haworth front edges. Same geometry as the former
 * legacy drawer pass: thin at C1, thick across C2–C3, thin again at C4, with
 * the quad flaring away from the ring centre. The bond direction comes from
 * the `{a,b}` pair, so the taper follows the canonical ring traversal even
 * when RDKit wrote the underlying path in the opposite order.
 */
export function applyBoldFrontEdges(svg: Element, bonds: FrontRingBond[]): void {
  const fallbackFill = sampleBondStroke(svg)
  for (let base = 0; base + 2 < bonds.length; base += 3) {
    const group = bonds.slice(base, base + 3)
    const segments: { from: Point; to: Point }[] = []
    const paths: Element[] = []
    for (const bond of group) {
      const path = bondPathFor(svg, bond.a, bond.b)
      const segment = path === null ? null : parseSegment(path)
      if (path === null || segment === null) {
        segments.length = 0
        break
      }
      paths.push(path)
      segments.push(segment)
    }
    if (segments.length !== 3) {
      continue
    }

    // Recover the four ring positions from the shared endpoints of the chain
    // 0–1–2–3, then orient each segment from role i to role i+1.
    const [first, second, third] = segments
    const p1 = sharedEndpoint(first, second)
    const p2 = sharedEndpoint(second, third)
    if (p1 === null || p2 === null) {
      continue
    }
    const rolePositions = [otherEndpoint(first, p1), p1, p2, otherEndpoint(third, p2)]
    if (rolePositions.some((point) => point === null)) {
      continue
    }
    const ring = rolePositions as Point[]
    const ringCenter = centroidOf(ring)

    for (let index = 0; index < 3; index += 1) {
      const from = ring[index]
      const to = ring[index + 1]
      const dx = to.x - from.x
      const dy = to.y - from.y
      const length = Math.hypot(dx, dy)
      if (length === 0) continue
      let nx = -dy / length
      let ny = dx / length
      const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
      if (nx * (midpoint.x - ringCenter.x) + ny * (midpoint.y - ringCenter.y) < 0) {
        nx = -nx
        ny = -ny
      }
      const taper = FRONT_EDGE_SEGMENTS[index]
      const corners = [
        { x: from.x + nx * taper.ta, y: from.y + ny * taper.ta },
        { x: to.x + nx * taper.tb, y: to.y + ny * taper.tb },
        { x: to.x - nx * taper.tb, y: to.y - ny * taper.tb },
        { x: from.x - nx * taper.ta, y: from.y - ny * taper.ta },
      ]
      const polygon = svg.ownerDocument.createElementNS(SVG_NAMESPACE, "polygon")
      polygon.setAttribute("points", corners.map((corner) => `${corner.x},${corner.y}`).join(" "))
      polygon.setAttribute("fill", strokeOf(paths[index]) ?? fallbackFill)
      polygon.setAttribute("stroke", "none")
      polygon.setAttribute("class", "haworth-front-edge")
      svg.appendChild(polygon)
    }
  }
}

function sharedEndpoint(
  first: { from: Point; to: Point },
  second: { from: Point; to: Point },
): Point | null {
  for (const point of [first.from, first.to]) {
    const key = keyOf(point)
    if (key === keyOf(second.from) || key === keyOf(second.to)) {
      return point
    }
  }
  return null
}

function otherEndpoint(segment: { from: Point; to: Point }, shared: Point): Point | null {
  if (keyOf(segment.from) === keyOf(shared)) return segment.to
  if (keyOf(segment.to) === keyOf(shared)) return segment.from
  return null
}

function isWhite(fill: string): boolean {
  const normalized = fill.trim().toLowerCase()
  return normalized === "#fff" || normalized === "#ffffff" || normalized === "white"
}

/**
 * Theme the depiction. The RDKit background rect is always removed (the app's
 * wrapper is transparent). Light leaves the black ink alone; dark recolours
 * neutral black strokes/fills to white and leaves the heteroatom palette
 * (red oxygen, blue nitrogen, …) untouched.
 */
export function applyTheme(svg: Element, theme: "light" | "dark"): void {
  for (const rect of Array.from(svg.querySelectorAll("rect"))) {
    const style = rect.getAttribute("style") ?? ""
    const fill = rect.getAttribute("fill") ?? ""
    if (/fill:\s*#fff(?:fff)?\b/i.test(style) || isWhite(fill)) {
      rect.remove()
    }
  }
  if (theme !== "dark") {
    return
  }
  for (const element of Array.from(svg.querySelectorAll("*"))) {
    for (const attribute of ["fill", "stroke"]) {
      const value = element.getAttribute(attribute)
      if (value !== null && /^#000000$/i.test(value.trim())) {
        element.setAttribute(attribute, "#FFFFFF")
      }
    }
    const style = element.getAttribute("style")
    if (style !== null) {
      element.setAttribute("style", style.replace(/#000000/gi, "#FFFFFF"))
    }
  }
}

function adjacencyOf(snapshot: MolGraphSnapshot): number[][] {
  const adjacency = snapshot.atoms.map(() => [] as number[])
  for (const bond of snapshot.bonds) {
    adjacency[bond.beginIdx].push(bond.endIdx)
    adjacency[bond.endIdx].push(bond.beginIdx)
  }
  return adjacency
}

/**
 * The four macrocycle nitrogens of a porphyrin/corrin-type metal site: N with
 * degree 2 whose two neighbours are carbons, sitting in a five-membered ring.
 *
 * Two stages, both requiring exactly four matches so ordinary N-heterocycles
 * cannot accidentally trigger the metal passes:
 *
 * 1. Strict: the five-ring is not fused to any other perceived (5/6-membered)
 *    ring — porphyrins (heme) and corrins (B12) resolve here. The strict stage
 *    keeps fused imidazoles (adenine, the B12 benzimidazole ligand) out.
 * 2. Broadened: only reached when the strict stage missed, and then the
 *    five-ring may be fused, but solely to carbocyclic partner rings. This is
 *    chlorophyll: ring E (a cyclopentanone) annelates pyrrole ring C, so its
 *    nitrogen never survives the strict stage and the metal pass would bail.
 *    Purine-type fusions stay excluded because their partner rings carry
 *    nitrogens; B12 stays on stage one and never evaluates stage two.
 */
export function findMacrocycleNitrogens(snapshot: MolGraphSnapshot): number[] | null {
  const adjacency = adjacencyOf(snapshot)
  const elementOf = (index: number): string | undefined => snapshot.atoms[index]?.element

  const edgeRings = new Map<string, number[]>()
  snapshot.rings.forEach((ring, ringIndex) => {
    const members = ring.members
    for (let index = 0; index < members.length; index += 1) {
      const a = Math.min(members[index], members[(index + 1) % members.length])
      const b = Math.max(members[index], members[(index + 1) % members.length])
      const key = `${a}-${b}`
      const list = edgeRings.get(key)
      if (list === undefined) {
        edgeRings.set(key, [ringIndex])
      } else {
        list.push(ringIndex)
      }
    }
  })

  const fusedPartners = (ringIndex: number): number[] => {
    const members = snapshot.rings[ringIndex].members
    const partners = new Set<number>()
    for (let index = 0; index < members.length; index += 1) {
      const a = Math.min(members[index], members[(index + 1) % members.length])
      const b = Math.max(members[index], members[(index + 1) % members.length])
      for (const other of edgeRings.get(`${a}-${b}`) ?? []) {
        if (other !== ringIndex) {
          partners.add(other)
        }
      }
    }
    return [...partners]
  }

  const fiveRingIndexes = (atomIdx: number): number[] => {
    const indexes: number[] = []
    snapshot.rings.forEach((ring, ringIndex) => {
      if (ring.members.length === 5 && ring.members.includes(atomIdx)) {
        indexes.push(ringIndex)
      }
    })
    return indexes
  }

  const candidates = snapshot.atoms.filter((atom) => {
    if (elementOf(atom.idx) !== "N") return false
    const neighbours = adjacency[atom.idx]
    if (neighbours.length !== 2) return false
    if (!neighbours.every((neighbour) => elementOf(neighbour) === "C")) return false
    return fiveRingIndexes(atom.idx).length > 0
  })

  const strict = candidates.filter((atom) =>
    fiveRingIndexes(atom.idx).some((ringIndex) => fusedPartners(ringIndex).length === 0),
  )
  if (strict.length === 4) {
    return strict.map((atom) => atom.idx)
  }

  const isCarbocycle = (ringIndex: number): boolean =>
    snapshot.rings[ringIndex].members.every((member) => elementOf(member) === "C")
  const broadened = candidates.filter((atom) =>
    fiveRingIndexes(atom.idx).some((ringIndex) =>
      fusedPartners(ringIndex).every((partner) => isCarbocycle(partner)),
    ),
  )
  return broadened.length === 4 ? broadened.map((atom) => atom.idx) : null
}

/** The single isolated metal (Fe/Mg/Co) with no heavy-atom bonds, if any. */
export function findIsolatedMetal(snapshot: MolGraphSnapshot): number | null {
  const adjacency = adjacencyOf(snapshot)
  const metals = snapshot.atoms.filter((atom) => METAL_ELEMENTS.has(atom.element))
  if (metals.length !== 1) {
    return null
  }
  const metal = metals[0]
  return adjacency[metal.idx].length === 0 ? metal.idx : null
}

export interface CoordinationSite {
  metal: number
  metalPosition: Point
  nitrogens: { atom: number; position: Point }[]
}

/**
 * Centre an isolated metal on the centroid of its four nitrogen labels. RDKit
 * emits the disconnected ion wherever CoordGen left it, which is rarely the
 * macrocycle cavity. Glyph extents are read from path data, so this works
 * without layout metrics.
 */
export function centerIsolatedMetal(
  svg: Element,
  snapshot: MolGraphSnapshot,
): CoordinationSite | null {
  const nitrogens = findMacrocycleNitrogens(snapshot)
  if (nitrogens === null) {
    return null
  }
  const metal = findIsolatedMetal(snapshot)
  if (metal === null) {
    return null
  }
  const labelled: { atom: number; position: Point }[] = []
  for (const atom of nitrogens) {
    const position = glyphCenter(svg, atom)
    if (position === null) {
      return null
    }
    labelled.push({ atom, position })
  }
  const target = centroidOf(labelled.map((entry) => entry.position))
  const metalCenter = glyphCenter(svg, metal)
  if (metalCenter === null) {
    return null
  }
  const metalPaths = Array.from(svg.querySelectorAll("path")).filter((path) =>
    isGlyphPath(path, metal),
  )
  for (const path of metalPaths) {
    appendTranslate(path, target.x - metalCenter.x, target.y - metalCenter.y)
  }
  return { metal, metalPosition: target, nitrogens: labelled }
}

/**
 * Median on-screen bond length, measured from the drawn bond segments. The
 * coordination insets are in screen user units, so a dense molecule (B12 at
 * 160 px) needs smaller insets than a sparse one (heme).
 */
function screenBondLength(svg: Element): number | null {
  const lengths: number[] = []
  for (const path of Array.from(svg.querySelectorAll("path"))) {
    if (!isBondPath(path)) continue
    const segment = parseSegment(path)
    if (segment === null) continue
    const length = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y)
    if (length > 1e-6) {
      lengths.push(length)
    }
  }
  if (lengths.length === 0) return null
  lengths.sort((a, b) => a - b)
  const middle = Math.floor(lengths.length / 2)
  return lengths.length % 2 === 0 ? (lengths[middle - 1] + lengths[middle]) / 2 : lengths[middle]
}

/**
 * The four shortened metal–nitrogen coordination strokes. Plain (not dashed)
 * lines, contracted at both ends to clear the atom labels — same insets as the
 * legacy pass: min(6, 0.22 · bondLength) at nitrogen, 0.7× that at
 * the metal. The bond length is measured from the drawing unless supplied, so
 * the insets stay proportional for both heme and the much denser B12.
 */
export function applyCoordinationLines(
  svg: Element,
  site: CoordinationSite,
  options: { bondLength?: number } = {},
): void {
  const bondLength = options.bondLength ?? screenBondLength(svg) ?? 24
  const nitrogenInset = Math.min(6, bondLength * 0.22)
  const metalInset = nitrogenInset * 0.7
  for (const nitrogen of site.nitrogens) {
    const dx = site.metalPosition.x - nitrogen.position.x
    const dy = site.metalPosition.y - nitrogen.position.y
    const distance = Math.hypot(dx, dy)
    if (distance <= nitrogenInset + metalInset) {
      continue
    }
    const ux = dx / distance
    const uy = dy / distance
    const from = {
      x: nitrogen.position.x + ux * nitrogenInset,
      y: nitrogen.position.y + uy * nitrogenInset,
    }
    const to = {
      x: site.metalPosition.x - ux * metalInset,
      y: site.metalPosition.y - uy * metalInset,
    }
    const line = svg.ownerDocument.createElementNS(SVG_NAMESPACE, "line")
    line.setAttribute("x1", String(from.x))
    line.setAttribute("y1", String(from.y))
    line.setAttribute("x2", String(to.x))
    line.setAttribute("y2", String(to.y))
    line.setAttribute(
      "stroke",
      bondStrokeNear(svg, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }),
    )
    line.setAttribute("stroke-width", "1")
    line.setAttribute("stroke-linecap", "round")
    line.setAttribute("class", "porphyrin-coordination")
    svg.appendChild(line)
  }
}
