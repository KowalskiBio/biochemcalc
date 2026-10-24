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
import {
  ATOM_COLOR_NEUTRAL,
  ATOM_COLOR_NEUTRAL_DARK,
  RDKIT_DEFAULT_ATOM_COLORS,
} from "@/lib/molecules/render/atom-palette"
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
const MITER_MAX_FACTOR = 1.6

export function applyBoldFrontEdges(
  svg: Element,
  bonds: FrontRingBond[],
  cyclePositions?: { id: number; position: Point }[][],
): void {
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

    // The cap ends are joints onto the neighbouring thin ring edges, computed
    // ENTIRELY in the drawn SVG's coordinate frame: joint candidates would be
    // meaningless if the neighbour vertices came from the layouter's own
    // world (≈20–240 px apart, which is what made earlier attempts invisible).
    // Neighbour directions come from the neighbouring bond paths' own drawn
    // segments, never from layout-world positions.
    interface OffsetEdge {
      from: Point
      to: Point
      dx: number
      dy: number
      length: number
      nx: number
      ny: number
      ta: number
      tb: number
    }

    const segmentToOffsetEdge = (segment: { from: Point; to: Point }): OffsetEdge | null => {
      const dx = segment.to.x - segment.from.x
      const dy = segment.to.y - segment.from.y
      const length = Math.hypot(dx, dy)
      if (length < 1e-9) {
        return null
      }
      return {
        from: segment.from,
        to: segment.to,
        dx,
        dy,
        length,
        nx: -dy / length,
        ny: dx / length,
        ta: 0,
        tb: 0,
      }
    }

    const groupCycle = cyclePositions?.[base / 3]
    const neighbourInfo = (atomA: number, atomB: number): { from: Point; to: Point } | null => {
      const path = bondPathFor(svg, atomA, atomB)
      if (path === null) {
        return null
      }
      return parseSegment(path)
    }

    const cycleIndexForVertex = (
      vertexRole: 0 | 3,
    ): { prevSegment: OffsetEdge | null; nextSegment: OffsetEdge | null } => {
      if (groupCycle === undefined || groupCycle.length < 4) {
        return { prevSegment: null, nextSegment: null }
      }
      const mainRoleEntry = groupCycle[vertexRole]
      const prevRoleEntry =
        vertexRole === 0 ? groupCycle[groupCycle.length - 1] : groupCycle[vertexRole - 1]
      const nextRoleEntry = vertexRole === 3 ? groupCycle[4] : groupCycle[vertexRole + 1]
      if (
        mainRoleEntry === undefined ||
        prevRoleEntry === undefined ||
        nextRoleEntry === undefined
      ) {
        return { prevSegment: null, nextSegment: null }
      }
      const prevSegment = neighbourInfo(prevRoleEntry.id, mainRoleEntry.id)
      const nextSegment = neighbourInfo(mainRoleEntry.id, nextRoleEntry.id)
      return {
        prevSegment: prevSegment === null ? null : segmentToOffsetEdge(prevSegment),
        nextSegment: nextSegment === null ? null : segmentToOffsetEdge(nextSegment),
      }
    }
    const edges: OffsetEdge[] = []
    let skip = false
    for (let index = 0; index < 3; index += 1) {
      const from = ring[index]
      const to = ring[index + 1]
      const dx = to.x - from.x
      const dy = to.y - from.y
      const length = Math.hypot(dx, dy)
      if (length < 1e-9) {
        skip = true
        break
      }
      let nx = -dy / length
      let ny = dx / length
      const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
      if (nx * (midpoint.x - ringCenter.x) + ny * (midpoint.y - ringCenter.y) < 0) {
        nx = -nx
        ny = -ny
      }
      const taper = FRONT_EDGE_SEGMENTS[index]
      edges.push({ from, to, dx, dy, length, nx, ny, ta: taper.ta, tb: taper.tb })
    }
    if (skip) {
      continue
    }

    // Offset-miter join: the outer (or inner) tips of two adjacent edges at a
    // shared vertex are the intersection of the two offset lines. When the
    // lines are nearly parallel the tips average into a captured corner.
    const miter = (
      startPoint: Point,
      directionA: { x: number; y: number },
      endPoint: Point,
      directionB: { x: number; y: number },
    ): Point => {
      // startPoint + s·directionA == endPoint + t·directionB
      const cross = directionA.x * directionB.y - directionA.y * directionB.x
      if (Math.abs(cross) < 1e-9) {
        return {
          x: (startPoint.x + endPoint.x) / 2,
          y: (startPoint.y + endPoint.y) / 2,
        }
      }
      const rx = endPoint.x - startPoint.x
      const ry = endPoint.y - startPoint.y
      const s = (rx * directionB.y - ry * directionB.x) / cross
      return { x: startPoint.x + s * directionA.x, y: startPoint.y + s * directionA.y }
    }

    const corners: Point[] = []
    // Given the full cycle, the caps become micro-joints at the adjacent thin ring
    // edges instead — closing the barely-visible wedge at hexose/pentose C1/C4.
    const cappedEnd = (vertex: Point, edge: OffsetEdge, sign: 1 | -1): Point => ({
      x: vertex.x + sign * edge.nx * edge.tb,
      y: vertex.y + sign * edge.ny * edge.tb,
    })
    const cappedStart = (vertex: Point, edge: OffsetEdge, sign: 1 | -1): Point => ({
      x: vertex.x + sign * edge.nx * edge.ta,
      y: vertex.y + sign * edge.ny * edge.ta,
    })

    const joint = (
      vertex: Point,
      offsetLineStart: (sign: 1 | -1) => Point,
      offsetDirection: { x: number; y: number },
      neighborDirection: { x: number; y: number },
      oppositeFallback: Point,
      width: number,
    ): Point => {
      const candidate = miter(offsetLineStart(1), offsetDirection, vertex, neighborDirection)
      const distanceToVertex = Math.hypot(candidate.x - vertex.x, candidate.y - vertex.y)
      if (
        !Number.isFinite(candidate.x) ||
        !Number.isFinite(candidate.y) ||
        distanceToVertex > MITER_MAX_FACTOR * width
      ) {
        return oppositeFallback
      }
      return candidate
    }

    const startOuter =
      groupCycle !== undefined &&
      groupCycle.length >= 4 &&
      groupCycle[groupCycle.length - 1] !== undefined
        ? (() => {
            const { prevSegment } = cycleIndexForVertex(0)
            if (prevSegment === null) {
              return cappedStart(ring[0], edges[0], 1)
            }
            const neighbourDirection = {
              x: prevSegment.dx / prevSegment.length,
              y: prevSegment.dy / prevSegment.length,
            }
            return joint(
              ring[0],
              (sign) => ({
                x: ring[0].x + sign * edges[0].nx * edges[0].ta,
                y: ring[0].y + sign * edges[0].ny * edges[0].ta,
              }),
              { x: edges[0].dx / edges[0].length, y: edges[0].dy / edges[0].length },
              neighbourDirection,
              cappedStart(ring[0], edges[0], 1),
              edges[0].ta,
            )
          })()
        : cappedStart(ring[0], edges[0], 1)
    const endOuter =
      groupCycle !== undefined && groupCycle.length >= 5 && groupCycle[4] !== undefined
        ? (() => {
            const { nextSegment } = cycleIndexForVertex(3)
            if (nextSegment === null) {
              return cappedEnd(ring[3], edges[2], 1)
            }
            const neighbourDirection = {
              x: nextSegment.dx / nextSegment.length,
              y: nextSegment.dy / nextSegment.length,
            }
            return joint(
              ring[3],
              (sign) => ({
                x: ring[3].x + sign * edges[2].nx * edges[2].tb,
                y: ring[3].y + sign * edges[2].ny * edges[2].tb,
              }),
              { x: edges[2].dx / edges[2].length, y: edges[2].dy / edges[2].length },
              neighbourDirection,
              cappedEnd(ring[3], edges[2], 1),
              edges[2].tb,
            )
          })()
        : cappedEnd(ring[3], edges[2], 1)
    const miterOuter1 = miter(
      { x: ring[1].x + edges[0].nx * edges[0].tb, y: ring[1].y + edges[0].ny * edges[0].tb },
      { x: edges[0].dx, y: edges[0].dy },
      { x: ring[1].x + edges[1].nx * edges[1].ta, y: ring[1].y + edges[1].ny * edges[1].ta },
      { x: edges[1].dx, y: edges[1].dy },
    )
    const miterOuter2 = miter(
      { x: ring[2].x + edges[1].nx * edges[1].tb, y: ring[2].y + edges[1].ny * edges[1].tb },
      { x: edges[1].dx, y: edges[1].dy },
      { x: ring[2].x + edges[2].nx * edges[2].ta, y: ring[2].y + edges[2].ny * edges[2].ta },
      { x: edges[2].dx, y: edges[2].dy },
    )
    const startInner =
      groupCycle !== undefined &&
      groupCycle.length >= 4 &&
      groupCycle[groupCycle.length - 1] !== undefined
        ? (() => {
            const { prevSegment } = cycleIndexForVertex(0)
            if (prevSegment === null) {
              return cappedStart(ring[0], edges[0], -1)
            }
            const neighbourDirection = {
              x: prevSegment.dx / prevSegment.length,
              y: prevSegment.dy / prevSegment.length,
            }
            return joint(
              ring[0],
              (sign) => ({
                x: ring[0].x - sign * edges[0].nx * edges[0].ta,
                y: ring[0].y - sign * edges[0].ny * edges[0].ta,
              }),
              { x: edges[0].dx / edges[0].length, y: edges[0].dy / edges[0].length },
              neighbourDirection,
              cappedStart(ring[0], edges[0], -1),
              edges[0].ta,
            )
          })()
        : cappedStart(ring[0], edges[0], -1)
    const endInner =
      groupCycle !== undefined && groupCycle.length >= 5 && groupCycle[4] !== undefined
        ? (() => {
            const { nextSegment } = cycleIndexForVertex(3)
            if (nextSegment === null) {
              return cappedEnd(ring[3], edges[2], -1)
            }
            const neighbourDirection = {
              x: nextSegment.dx / nextSegment.length,
              y: nextSegment.dy / nextSegment.length,
            }
            return joint(
              ring[3],
              (sign) => ({
                x: ring[3].x - sign * edges[2].nx * edges[2].tb,
                y: ring[3].y - sign * edges[2].ny * edges[2].tb,
              }),
              { x: edges[2].dx / edges[2].length, y: edges[2].dy / edges[2].length },
              neighbourDirection,
              cappedEnd(ring[3], edges[2], -1),
              edges[2].tb,
            )
          })()
        : cappedEnd(ring[3], edges[2], -1)
    const miterInner1 = miter(
      { x: ring[1].x - edges[0].nx * edges[0].tb, y: ring[1].y - edges[0].ny * edges[0].tb },
      { x: edges[0].dx, y: edges[0].dy },
      { x: ring[1].x - edges[1].nx * edges[1].ta, y: ring[1].y - edges[1].ny * edges[1].ta },
      { x: edges[1].dx, y: edges[1].dy },
    )
    const miterInner2 = miter(
      { x: ring[2].x - edges[1].nx * edges[1].tb, y: ring[2].y - edges[1].ny * edges[1].tb },
      { x: edges[1].dx, y: edges[1].dy },
      { x: ring[2].x - edges[2].nx * edges[2].ta, y: ring[2].y - edges[2].ny * edges[2].ta },
      { x: edges[2].dx, y: edges[2].dy },
    )

    // Outline: outer caps at both ends with mitered joins at the two shared
    // front carbons, mirrored inner line running back from role 3 to role 0.
    // One polygon per ring.
    corners.push(
      startOuter,
      miterOuter1,
      miterOuter2,
      endOuter,
      endInner,
      miterInner2,
      miterInner1,
      startInner,
    )
    if (corners.some((corner) => !Number.isFinite(corner.x) || !Number.isFinite(corner.y))) {
      continue
    }
    const polygonFill = strokeOf(paths[0]) ?? fallbackFill
    const polygon = svg.ownerDocument.createElementNS(SVG_NAMESPACE, "polygon")
    polygon.setAttribute("points", corners.map((corner) => `${corner.x},${corner.y}`).join(" "))
    polygon.setAttribute("fill", polygonFill)
    polygon.setAttribute("stroke", "none")
    polygon.setAttribute("class", "haworth-front-edge")
    svg.appendChild(polygon)

    // Junction seal at each ring end: here the band, the neighbouring thin
    // ring bond AND the hydroxyl bond meet — a three-way stroke junction.
    // The interior miters seal two same-width strokes, but no pair of cap
    // corners can close three incident strokes of two widths; a round union
    // dot of the band's local half-thickness does, exactly like a round
    // linecap, and it swallows the OH bond's root into the same ink.
    const sealAt = (vertex: Point, halfThickness: number, ...capCorners: Point[]): void => {
      const reach = Math.max(
        halfThickness,
        ...capCorners.map((corner) => Math.hypot(corner.x - vertex.x, corner.y - vertex.y)),
      )
      const seal = svg.ownerDocument.createElementNS(SVG_NAMESPACE, "circle")
      seal.setAttribute("cx", String(vertex.x))
      seal.setAttribute("cy", String(vertex.y))
      seal.setAttribute("r", String(reach))
      seal.setAttribute("fill", polygonFill)
      seal.setAttribute("stroke", "none")
      seal.setAttribute("class", "haworth-front-cap")
      svg.appendChild(seal)
    }
    sealAt(ring[0], edges[0].ta, startOuter, startInner)
    sealAt(ring[3], edges[2].tb, endOuter, endInner)
  }
}

/**
 * Atom letters are the read layer: raise every atom glyph above all
 * construction strokes (bonds, front-edge bands/seals, coordination lines).
 * RDKit-JS draws letters as `<path class="atom-N">` with no `bond-*` token,
 * so z-order is a stable child reorder — glyphs move to the end in their
 * original order, everything else is untouched. Runs last so overlap from
 * any decoration pass can never swallow a heteroatom letter.
 */
export function raiseAtomLetters(svg: Element): void {
  const glyphs: Element[] = []
  for (const child of Array.from(svg.children)) {
    if (child.localName !== "path") continue
    const tokens = classTokens(child)
    if (tokens.some((token) => token.startsWith("atom-")) && !isBondPath(child)) {
      glyphs.push(child)
    }
  }
  for (const glyph of glyphs) {
    svg.appendChild(glyph)
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
 * Recolour RDKit's legacy heteroatom hexes to the app atom palette
 * (atom-palette.ts). RDKit carries each glyph's hue twice — a fill/stroke
 * attribute plus an inline `style="fill:#…"` fragment — and the remap table
 * is keyed uppercase, so both the attribute pass and the style regex match
 * case-insensitively. Runs before the light/dark ink switch: the heteroatom
 * palette is theme-independent, like the calculations variable accents it
 * derives from, and none of its hexes is the neutral ink the dark pass
 * touches.
 */
function remapAtomPalette(svg: Element): void {
  for (const element of Array.from(svg.querySelectorAll("*"))) {
    for (const attribute of ["fill", "stroke"]) {
      const value = element.getAttribute(attribute)
      const replacement =
        value === null ? undefined : RDKIT_DEFAULT_ATOM_COLORS[value.trim().toUpperCase()]
      if (replacement !== undefined) {
        element.setAttribute(attribute, replacement)
      }
    }
    const style = element.getAttribute("style")
    if (style?.includes("#")) {
      element.setAttribute(
        "style",
        style.replace(
          /#[0-9a-f]{6}/gi,
          (match) => RDKIT_DEFAULT_ATOM_COLORS[match.toUpperCase()] ?? match,
        ),
      )
    }
  }
}

/**
 * Rewrite every neutral-ink source to the theme's ink: RDKit's own carbon
 * black #000000 (bonds and C/H labels) plus the light app ink itself (which
 * the hand-drawn Fischer labels stamp directly), so the dark theme swaps
 * both for the near-white ink. Case-insensitive on attributes and inline
 * style fragments, like the heteroatom remap.
 */
function applyNeutralInk(svg: Element, ink: string): void {
  const source = new RegExp(`#000000|${ATOM_COLOR_NEUTRAL}`, "gi")
  const sourceExact = new RegExp(`^(?:#000000|${ATOM_COLOR_NEUTRAL})$`, "i")
  for (const element of Array.from(svg.querySelectorAll("*"))) {
    for (const attribute of ["fill", "stroke"]) {
      const value = element.getAttribute(attribute)
      if (value !== null && sourceExact.test(value.trim())) {
        element.setAttribute(attribute, ink)
      }
    }
    const style = element.getAttribute("style")
    if (style?.includes("#")) {
      element.setAttribute("style", style.replace(source, ink))
    }
  }
}

/**
 * Crush every colour in the depiction to the single neutral ink. Used by
 * Mistr's quiz prompt, where atom colour coding would give away part of the
 * answer: bonds and heteroatom labels alike end up one flat ink, the light
 * or dark neutral depending on the theme. Only hex colours are rewritten —
 * `fill="none"` markers survive.
 */
function applyMonochromeInk(svg: Element, ink: string): void {
  for (const element of Array.from(svg.querySelectorAll("*"))) {
    for (const attribute of ["fill", "stroke"]) {
      const value = element.getAttribute(attribute)
      if (value !== null && /^#[0-9a-f]{6}$/i.test(value.trim())) {
        element.setAttribute(attribute, ink)
      }
    }
    const style = element.getAttribute("style")
    if (style?.includes("#")) {
      element.setAttribute("style", style.replace(/#[0-9a-f]{6}/gi, ink))
    }
  }
}

/**
 * Theme the depiction. The RDKit background rect is always removed (the app's
 * wrapper is transparent). In monochrome mode the whole structure then takes
 * the theme's neutral ink and returns (Mistr prompts hide the atom colours);
 * otherwise RDKit's carbon black settles to the theme's neutral ink (the
 * light paper ink or, in dark mode, the near-white one) and its heteroatom
 * hexes are recoloured to the app atom palette (same hexes in both themes —
 * see atom-palette.ts).
 */
export function applyTheme(svg: Element, theme: "light" | "dark", monochrome = false): void {
  for (const rect of Array.from(svg.querySelectorAll("rect"))) {
    const style = rect.getAttribute("style") ?? ""
    const fill = rect.getAttribute("fill") ?? ""
    if (/fill:\s*#fff(?:fff)?\b/i.test(style) || isWhite(fill)) {
      rect.remove()
    }
  }
  const ink = theme === "dark" ? ATOM_COLOR_NEUTRAL_DARK : ATOM_COLOR_NEUTRAL
  if (monochrome) {
    applyMonochromeInk(svg, ink)
    return
  }
  applyNeutralInk(svg, ink)
  remapAtomPalette(svg)
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
