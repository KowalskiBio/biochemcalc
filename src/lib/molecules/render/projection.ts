// Projection renderer — pure geometry for chemistry-teaching projections.
//
// The first projection kind is the Haworth depiction of cyclic saccharides:
// a fixed textbook skeleton per ring form (pyranose hexagon with the ring
// oxygen at the top-right, furanose pentagon with the oxygen on top — both
// slightly wider than tall, see `haworth-polygon.ts`) plus strictly vertical
// substituent bonds labelled by a declarative spec.

import { haworthPolygon } from "@/lib/molecules/render/haworth-polygon"
//
// The spec is the source of truth for stereochemistry (see `HaworthSpec`):
// alpha/beta anomers and D/L series are *consequences* of the declared
// up/down sides, never derived. `drawProjection` returns plain line/text
// geometry (`DrawingElement`); components turn it into SVG and the quiz
// engine chooses rotations (multiples of 90°) and mirrors (enantiomers)
// through the same entry point.

export type HaworthSide = "up" | "down"

export interface HaworthSubstituent {
  /** Ring atom the substituent sits on: "C1"…"C5" depending on the ring. */
  atom: string
  /** Label rendered at the bond end ("OH", "CH₂OH", "Ade", …). */
  group: string
  side: HaworthSide
}

export interface HaworthSpec {
  type: "haworth"
  /** 6 = pyranose, 5 = furanose. */
  ringSize: 5 | 6
  /** Ring position of the anomeric carbon; default 1, 2 for ketofuranoses. */
  anomericCarbon?: number
  substituents: HaworthSubstituent[]
  /** When true, every ring carbon without a substituent on a side gets an "H". */
  showHydrogens?: boolean
}

// Later union members: fischer, chair. The `type` tag is the discriminator.
export type ProjectionSpec = HaworthSpec

export type DrawingElement =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; bold?: boolean }
  | {
      kind: "text"
      x: number
      y: number
      text: string
      anchor?: "start" | "middle" | "end"
      /** Atom-palette fill (see atom-palette.ts); absent means neutral ink. */
      fill?: string
      /** Baseline font size in px (smaller values render as subscripts). */
      fontSize?: number
    }

export interface ProjectionDrawing {
  elements: DrawingElement[]
  width: number
  height: number
}

const BOND = 26
const HYDROGEN_PAD = 7
const PADDING = 14
const TEXT_WIDTH_PER_CHAR = 7
const TEXT_HEIGHT = 13

interface Pt {
  x: number
  y: number
}

interface RingVertex {
  atom: string
  isOxygen: boolean
  pt: Pt
}

/**
 * The ring atoms in cycle order (oxygen last), in fixed Haworth positions.
 * Both polygons are slightly wider than tall (see `haworth-polygon.ts`).
 */
function ringVertices(spec: HaworthSpec): RingVertex[] {
  const anomeric = spec.anomericCarbon ?? 1
  const polygon = haworthPolygon(spec.ringSize)
  if (spec.ringSize === 6) {
    const atoms = ["C1", "C2", "C3", "C4", "C5"]
    return atoms
      .map((atom, index) => ({
        atom,
        isOxygen: false,
        pt: { x: polygon[index].x * BOND, y: polygon[index].y * BOND },
      }))
      .concat({
        atom: "O",
        isOxygen: true,
        pt: { x: polygon[5].x * BOND, y: polygon[5].y * BOND },
      })
  }
  // Furanose atom labels depend on whether the anomeric carbon is C1
  // (aldoses) or C2 (ketoses like fructose).
  const first = anomeric === 2 ? 2 : 1
  const atoms = [`C${first}`, `C${first + 1}`, `C${first + 2}`, `C${first + 3}`, "O"]
  return atoms.map((atom, index) => ({
    atom,
    isOxygen: atom === "O",
    pt: { x: polygon[index].x * BOND, y: polygon[index].y * BOND },
  }))
}

/** Ring atom positions keyed by label — exposed for the golden tests. */
export function ringAtomPositions(spec: HaworthSpec): Record<string, Pt> {
  return Object.fromEntries(ringVertices(spec).map((vertex) => [vertex.atom, vertex.pt]))
}

/** Atom labels a substituent may legally attach to. */
function ringAtomKeys(spec: HaworthSpec): string[] {
  const anomeric = spec.anomericCarbon ?? 1
  if (spec.ringSize === 6) {
    return ["C1", "C2", "C3", "C4", "C5"]
  }
  return anomeric === 2 ? ["C2", "C3", "C4", "C5"] : ["C1", "C2", "C3", "C4"]
}

/** Ring carbon carrying the terminal CH2OH-like group (the D/L reference). */
function terminalAtom(spec: HaworthSpec): string {
  if (spec.ringSize === 6) {
    return "C5"
  }
  return (spec.anomericCarbon ?? 1) === 2 ? "C5" : "C4"
}

/** Shape errors make `parseProjection` fail; semantic codes stay advisory. */
function shapeErrors(value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return ["type.invalid"]
  }
  const spec = value as Record<string, unknown>
  const errors: string[] = []
  if (spec.type !== "haworth") {
    errors.push("type.unknown")
  }
  if (spec.ringSize !== 5 && spec.ringSize !== 6) {
    errors.push("ringSize.invalid")
  }
  const anomeric = spec.anomericCarbon
  if (anomeric !== undefined && anomeric !== 1 && anomeric !== 2) {
    errors.push("anomericCarbon.invalid")
  }
  if (spec.ringSize === 6 && anomeric !== undefined && anomeric !== 1) {
    errors.push("anomericCarbon.invalid")
  }
  if (!Array.isArray(spec.substituents)) {
    errors.push("substituents.missing")
    return errors
  }
  for (const entry of spec.substituents as Record<string, unknown>[]) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.atom !== "string" ||
      entry.atom.length === 0 ||
      typeof entry.group !== "string" ||
      entry.group.length === 0 ||
      (entry.side !== "up" && entry.side !== "down")
    ) {
      errors.push("substituent.malformed")
      break
    }
  }
  if (spec.showHydrogens !== undefined && typeof spec.showHydrogens !== "boolean") {
    errors.push("showHydrogens.invalid")
  }
  return errors
}

/**
 * Parse the raw JSON stored on a molecule row. Returns `null` for anything
 * that isn't a structurally valid projection spec; semantic mistakes are
 * reported separately by `validateProjection`.
 */
export function parseProjection(raw: string | null | undefined): ProjectionSpec | null {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return null
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (shapeErrors(value).length > 0) {
      return null
    }
    const spec = value as HaworthSpec
    return { ...spec, anomericCarbon: spec.anomericCarbon ?? 1 }
  } catch {
    return null
  }
}

const TERMINAL_GROUP = "CH2OH"

/** Compare group labels with unicode subscripts folded to plain digits. */
function normalizeGroup(group: string): string {
  return group.replace(/[₀-₉]/g, (sub) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(sub)))
}

/**
 * Semantic validation of a parsed spec. Returns machine codes (empty =
 * valid); when the molecule's traits are supplied, the declared stereochem
 * is cross-checked against them (anomer alpha/beta vs terminal CH2OH side,
 * ringForm vs ringSize).
 */
export function validateProjection(
  spec: ProjectionSpec,
  traits?: Record<string, string>,
): string[] {
  const errors = shapeErrors(spec)
  const keys = ringAtomKeys(spec)

  const perAtom = new Map<string, HaworthSubstituent[]>()
  for (const substituent of spec.substituents) {
    if (!keys.includes(substituent.atom)) {
      if (!errors.includes("substituent.unknownAtom")) {
        errors.push("substituent.unknownAtom")
      }
      continue
    }
    const list = perAtom.get(substituent.atom) ?? []
    list.push(substituent)
    perAtom.set(substituent.atom, list)
  }
  for (const list of perAtom.values()) {
    if (list.length > 2 && !errors.includes("substituent.tooMany")) {
      errors.push("substituent.tooMany")
    }
    if (
      list.length === 2 &&
      list[0].side === list[1].side &&
      !errors.includes("substituent.sameSide")
    ) {
      errors.push("substituent.sameSide")
    }
  }

  if (traits !== undefined) {
    const ringForm = traits.ringForm
    if (ringForm === "pyranose" && spec.ringSize !== 6) {
      errors.push("ringForm.mismatch")
    }
    if (ringForm === "furanose" && spec.ringSize !== 5) {
      errors.push("ringForm.mismatch")
    }
    const anomer = traits.anomer
    if (anomer === "alpha" || anomer === "beta") {
      const anomericAtom = keys[0]
      const anomericOh = spec.substituents.find(
        (substituent) => substituent.atom === anomericAtom && substituent.group === "OH",
      )
      const terminal = spec.substituents.find(
        (substituent) =>
          substituent.atom === terminalAtom(spec) &&
          normalizeGroup(substituent.group) === TERMINAL_GROUP,
      )
      if (anomericOh !== undefined && terminal !== undefined) {
        const sameSide = anomericOh.side === terminal.side
        const expectedBeta = anomer === "beta"
        if (sameSide !== expectedBeta) {
          errors.push("anomer.mismatch")
        }
      }
    }
  }
  return errors
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function textBox(element: Extract<DrawingElement, { kind: "text" }>): Box {
  const width = element.text.length * TEXT_WIDTH_PER_CHAR
  const anchor = element.anchor ?? "middle"
  let minX = element.x
  if (anchor === "middle") {
    minX = element.x - width / 2
  } else if (anchor === "end") {
    minX = element.x - width
  }
  return {
    minX,
    minY: element.y - TEXT_HEIGHT / 2,
    maxX: minX + width,
    maxY: element.y + TEXT_HEIGHT / 2,
  }
}

function boundingBox(elements: DrawingElement[]): Box {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const element of elements) {
    const boxes: Box[] =
      element.kind === "line"
        ? [
            { minX: element.x1, minY: element.y1, maxX: element.x1, maxY: element.y1 },
            { minX: element.x2, minY: element.y2, maxX: element.x2, maxY: element.y2 },
          ]
        : [textBox(element)]
    for (const box of boxes) {
      minX = Math.min(minX, box.minX)
      minY = Math.min(minY, box.minY)
      maxX = Math.max(maxX, box.maxX)
      maxY = Math.max(maxY, box.maxY)
    }
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Ring edges plus substituent bonds and labels, unshifted. The ring oxygen is
 * drawn as an "O" label with its two edges shortened so they don't cross it;
 * the lowest ring edge(s) — the ones facing the viewer — are marked bold.
 */
function buildElements(spec: ProjectionSpec): DrawingElement[] {
  const vertices = ringVertices(spec)
  const elements: DrawingElement[] = []
  const maxY = Math.max(...vertices.map((vertex) => vertex.pt.y))

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]
    const next = vertices[(index + 1) % vertices.length]
    let from = current.pt
    let to = next.pt
    // Shorten edges at the ring oxygen so the "O" label stays readable.
    if (current.isOxygen) {
      from = {
        x: current.pt.x + (next.pt.x - current.pt.x) * 0.2,
        y: current.pt.y + (next.pt.y - current.pt.y) * 0.2,
      }
    }
    if (next.isOxygen) {
      to = {
        x: next.pt.x + (current.pt.x - next.pt.x) * 0.2,
        y: next.pt.y + (current.pt.y - next.pt.y) * 0.2,
      }
    }
    const bold =
      Math.abs(current.pt.y - maxY) < 0.01 &&
      Math.abs(next.pt.y - maxY) < 0.01 &&
      !current.isOxygen &&
      !next.isOxygen
    elements.push({ kind: "line", x1: from.x, y1: from.y, x2: to.x, y2: to.y, bold })
  }

  const oxygen = vertices.find((vertex) => vertex.isOxygen)
  if (oxygen !== undefined) {
    elements.push({ kind: "text", x: oxygen.pt.x, y: oxygen.pt.y, text: "O", anchor: "middle" })
  }

  const positions = ringAtomPositions(spec)
  const substituents: HaworthSubstituent[] = [...spec.substituents]
  if (spec.showHydrogens === true) {
    for (const vertex of vertices) {
      if (vertex.isOxygen) {
        continue
      }
      const onAtom = substituents.filter((substituent) => substituent.atom === vertex.atom)
      if (!onAtom.some((substituent) => substituent.side === "up")) {
        substituents.push({ atom: vertex.atom, group: "H", side: "up" })
      }
      if (!onAtom.some((substituent) => substituent.side === "down")) {
        substituents.push({ atom: vertex.atom, group: "H", side: "down" })
      }
    }
  }

  // Strictly vertical substituent bonds; upward bonds are slightly shortened
  // so their labels never reach into the ring interior.
  const UP_BOND_FACTOR = 0.9

  /**
   * OH label direction convention: an OH on the LEFT half of the ring reads
   * "HO" anchored LEFT of its bond — the classic skeletal-formula idiom (so
   * hexose C4, being a left-half carbon, always gets "HO"), which also pulls
   * the label out of crowded ring areas. Right-half OHs keep a centred "OH".
   */
  interface LabelPlacement {
    text: string
    anchor: "start" | "middle" | "end"
  }

  function ohPlacement(group: string, anchorX: number, ringCentroidX: number): LabelPlacement {
    if (group === "OH" && anchorX < ringCentroidX) {
      return { text: "HO", anchor: "end" }
    }
    return { text: group, anchor: "middle" }
  }

  const ringCentroid = {
    x: vertices.reduce((sum, vertex) => sum + vertex.pt.x, 0) / vertices.length,
    y: vertices.reduce((sum, vertex) => sum + vertex.pt.y, 0) / vertices.length,
  }
  for (const substituent of substituents) {
    const base = positions[substituent.atom]
    if (base === undefined) {
      continue
    }
    const direction = substituent.side === "up" ? -1 : 1
    const endY = base.y + direction * (direction < 0 ? BOND * UP_BOND_FACTOR : BOND)
    elements.push({ kind: "line", x1: base.x, y1: base.y, x2: base.x, y2: endY })
    const label = ohPlacement(substituent.group, base.x, ringCentroid.x)
    elements.push({
      kind: "text",
      x: base.x,
      y: endY + direction * HYDROGEN_PAD,
      text: label.text,
      anchor: label.anchor,
    })
  }

  return elements
}

function mirror(elements: DrawingElement[], box: Box): DrawingElement[] {
  const cx = (box.minX + box.maxX) / 2
  return elements.map((element) => {
    if (element.kind === "line") {
      return { ...element, x1: 2 * cx - element.x1, x2: 2 * cx - element.x2 }
    }
    // Mirroring flips geometry: text anchors flip with it so labels keep
    // hugging their attachment end (an "outward"-leaning HO label must lean
    // outward in the mirrored depiction too).
    const anchor =
      element.anchor === "start" ? "end" : element.anchor === "end" ? "start" : element.anchor
    return { ...element, x: 2 * cx - element.x, anchor }
  })
}

function rotate(elements: DrawingElement[], box: Box, degrees: number): DrawingElement[] {
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  const turn = (pt: { x: number; y: number }): Pt => {
    const dx = pt.x - cx
    const dy = pt.y - cy
    switch (degrees) {
      case 90:
        // Clockwise in screen coordinates (y grows downward).
        return { x: cx - dy, y: cy + dx }
      case 180:
        return { x: cx - dx, y: cy - dy }
      case 270:
        return { x: cx + dy, y: cy - dx }
      default:
        return pt
    }
  }
  return elements.map((element) =>
    element.kind === "line"
      ? {
          ...element,
          ...{
            x1: turn({ x: element.x1, y: element.y1 }).x,
            y1: turn({ x: element.x1, y: element.y1 }).y,
          },
          ...{
            x2: turn({ x: element.x2, y: element.y2 }).x,
            y2: turn({ x: element.x2, y: element.y2 }).y,
          },
        }
      : {
          ...element,
          ...{
            x: turn({ x: element.x, y: element.y }).x,
            y: turn({ x: element.x, y: element.y }).y,
          },
        },
  )
}

/**
 * Render a projection spec into plain line/text geometry. `opts.mirror`
 * yields the enantiomer depiction (every stereocenter flips); `rotateDeg`
 * accepts multiples of 90 (projection depictions keep their reading
 * convention, so arbitrary angles are never used for Haworth).
 */
export function drawProjection(
  spec: ProjectionSpec,
  opts?: { rotateDeg?: number; mirror?: boolean },
): ProjectionDrawing {
  let elements = buildElements(spec)
  const rotateDeg = (opts?.rotateDeg ?? 0) % 360
  if (opts?.mirror === true) {
    elements = mirror(elements, boundingBox(elements))
  }
  if (rotateDeg === 90 || rotateDeg === 180 || rotateDeg === 270) {
    elements = rotate(elements, boundingBox(elements), rotateDeg)
  }
  const box = boundingBox(elements)
  const shifted = elements.map((element) =>
    element.kind === "line"
      ? {
          ...element,
          x1: element.x1 - box.minX + PADDING,
          y1: element.y1 - box.minY + PADDING,
          x2: element.x2 - box.minX + PADDING,
          y2: element.y2 - box.minY + PADDING,
        }
      : { ...element, x: element.x - box.minX + PADDING, y: element.y - box.minY + PADDING },
  )
  return {
    elements: shifted,
    width: box.maxX - box.minX + 2 * PADDING,
    height: box.maxY - box.minY + 2 * PADDING,
  }
}
