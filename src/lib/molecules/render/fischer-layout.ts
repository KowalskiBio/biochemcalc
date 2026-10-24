// Fischer projection for open-chain sugars (aldoses and ketoses).
//
// Recognition runs on the recognizer's GraphSnapshot (the same chemistry
// input the Haworth pass sees) plus RDKit's CIP R/S codes. With the main
// chain drawn vertically and the most-oxidized end at the top, each
// stereocenter's OH goes RIGHT iff (R configuration) == (the drawn-up chain
// neighbour outranks the drawn-down one in the CIP sphere sense). That one
// parity rule reproduces the textbook patterns: D-glucose R/L/R/R,
// D-fructose L/R/R, (R)-glyceraldehyde right.
//
// The drawing deliberately mirrors the declarative projection style:
// vertical spine, terminal labels ("CHO" / "CH2OH", "C=O" for ketoses),
// stereocenters as plain crossings (no carbon letter), OH / HO labels
// following the left-flip idiom.

import { ATOM_COLOR_NEUTRAL, ATOM_COLOR_OXYGEN } from "@/lib/molecules/render/atom-palette"
import type { DrawingElement, ProjectionDrawing } from "@/lib/molecules/render/projection"
import { comparePriorities, type GraphSnapshot } from "@/lib/molecules/render/recognize"

/** One stereocenter on the drawn spine, top→bottom order. */
export interface FischerChainCenter {
  atomIdx: number
  ohSide: "left" | "right"
}

export type FischerSpineSlot =
  | { kind: "label"; text: "CHO" | "CH2OH" }
  | { kind: "carbonyl" }
  | { kind: "center"; center: FischerChainCenter }

export interface FischerRecognition {
  ketone: boolean
  topLabel: "CHO" | "CH2OH"
  bottomLabel: "CH2OH"
  centers: FischerChainCenter[]
  /** Full spine content in drawn order, terminals included. */
  slots: FischerSpineSlot[]
}

/** Mirrors the constants of the declarative projection renderer. */
const BOND = 26
const PADDING = 14
const TEXT_HEIGHT = 20
/** Visible letter size — sized to the 1.5-bond spine step so letters read at
 * the same ink-to-bond ratio as the RDKit skeletal depictions. */
const FONT_SIZE = 16
/**
 * Per-letter slot and ink width at FONT_SIZE, so the runs of one label keep
 * the same breathing room the RDKit depictions give adjacent letters.
 */
const LETTER_STEP = 10
const LETTER_INK = 8
/** The carbonyl-of-subscript "2" gets a slightly narrower advance. */
const SUBSCRIPT_ADVANCE = 7

/** Max chain carbons we accept as an open-chain sugar (aldoses to octoses). */
const MAX_CHAIN_CARBONS = 10

function neighboursOf(snapshot: GraphSnapshot, id: number): number[] {
  return snapshot.adjacency.get(id) ?? []
}

function elementOf(snapshot: GraphSnapshot, id: number): string | undefined {
  return snapshot.atoms.get(id)?.element
}

function hydrogenCount(snapshot: GraphSnapshot, id: number): number {
  return neighboursOf(snapshot, id).filter((neighbour) => elementOf(snapshot, neighbour) === "H")
    .length
}

/** An -OH oxygen: element O carrying at least one (virtual) hydrogen. */
function isOxygenOH(snapshot: GraphSnapshot, id: number): boolean {
  return elementOf(snapshot, id) === "O" && hydrogenCount(snapshot, id) >= 1
}

function ringMemberIds(snapshot: GraphSnapshot): Set<number> {
  const members = new Set<number>()
  for (const ring of snapshot.rings) {
    for (const id of ring.members) {
      members.add(id)
    }
  }
  return members
}

/** sp3 chain carbon: C, not aromatic, not in a ring, single bonds only. */
function isChainCarbon(snapshot: GraphSnapshot, id: number, ringMembers: Set<number>): boolean {
  if (elementOf(snapshot, id) !== "C" || ringMembers.has(id)) {
    return false
  }
  if (snapshot.atoms.get(id)?.isAromatic === true) {
    return false
  }
  return neighboursOf(snapshot, id).every((neighbour) => snapshot.bondWeightOf(id, neighbour) <= 1)
}

interface ChainLeg {
  /** Stereocenters along the leg, in walk order (carbonyl → terminus). */
  centers: number[]
  /** Oh oxygen ids seen on the leg (coverage accounting). */
  hydroxyls: number[]
  /** Terminal CH2OH carbon closing the leg. */
  terminus: number
}

/**
 * Walk a sp3 polyhydroxy leg outward from the chain neighbour `start`,
 * coming from `previous`. Every intermediate carbon must carry exactly one
 * -OH and continue linearly; the leg must close on a CH2OH terminus.
 */
function walkChainLeg(
  snapshot: GraphSnapshot,
  start: number,
  previous: number,
  ringMembers: Set<number>,
): ChainLeg | null {
  const centers: number[] = []
  const hydroxyls: number[] = []
  let current = start
  let prev = previous
  for (let step = 0; step < MAX_CHAIN_CARBONS + 2; step += 1) {
    if (!isChainCarbon(snapshot, current, ringMembers)) {
      return null
    }
    const carbons = neighboursOf(snapshot, current).filter(
      (id) => elementOf(snapshot, id) === "C" && id !== prev,
    )
    const hydroxyl = neighboursOf(snapshot, current).filter((id) => isOxygenOH(snapshot, id))
    if (carbons.length === 0) {
      // Terminal slot: must be CH2OH (exactly one -OH, two virtual Hs).
      if (hydroxyl.length === 1 && hydrogenCount(snapshot, current) === 2) {
        hydroxyls.push(hydroxyl[0])
        return { centers, hydroxyls, terminus: current }
      }
      return null
    }
    if (carbons.length !== 1 || hydroxyl.length !== 1) {
      return null
    }
    hydroxyls.push(hydroxyl[0])
    centers.push(current)
    prev = current
    current = carbons[0]
  }
  return null
}

/** Carbonyl detection: a lone aldehyde (top terminal) or an internal ketone. */
interface CarbonylHit {
  carbonyl: number
  oxygen: number
  kind: "aldehyde" | "ketone"
  /** Carbon neighbours of the carbonyl carbon (one for aldehyde, two for ketone). */
  arms: number[]
}

function findCarbonyl(snapshot: GraphSnapshot, ringMembers: Set<number>): CarbonylHit | null {
  let found: CarbonylHit | null = null
  for (const atom of snapshot.atoms.values()) {
    if (atom.element !== "C" || atom.isAromatic || ringMembers.has(atom.vertexId)) {
      continue
    }
    const id = atom.vertexId
    const doubleOxygens = neighboursOf(snapshot, id).filter(
      (neighbour) =>
        elementOf(snapshot, neighbour) === "O" && snapshot.bondWeightOf(id, neighbour) === 2,
    )
    if (doubleOxygens.length !== 1) {
      continue
    }
    // Acids/esters/anhydrides carry a second oxygen neighbour — not sugars.
    const anyOxygens = neighboursOf(snapshot, id).filter(
      (neighbour) => elementOf(snapshot, neighbour) === "O",
    )
    if (anyOxygens.length !== 1) {
      continue
    }
    const carbons = neighboursOf(snapshot, id).filter(
      (neighbour) => elementOf(snapshot, neighbour) === "C",
    )
    const hydrogens = hydrogenCount(snapshot, id)
    const kind =
      carbons.length === 1 && hydrogens === 1
        ? "aldehyde"
        : carbons.length === 2 && hydrogens === 0
          ? "ketone"
          : null
    if (kind === null || found !== null) {
      return null
    }
    found = { carbonyl: id, oxygen: doubleOxygens[0], kind, arms: carbons }
  }
  return found
}

/**
 * Recognize an open-chain aldose/ketose. Returns null for anything else:
 * cyclic forms, branched chains, chains carrying anything but C/O/H.
 */
export function recognizeOpenChainSugar(
  snapshot: GraphSnapshot,
  chirality: Map<number, string>,
): FischerRecognition | null {
  const ringMembers = ringMemberIds(snapshot)
  const carbonyl = findCarbonyl(snapshot, ringMembers)
  if (carbonyl === null) {
    return null
  }

  // Every heavy atom is C or O — rules out amino acids / nucleotides.
  let heavyTotal = 0
  for (const atom of snapshot.atoms.values()) {
    if (atom.element === "H") {
      continue
    }
    if (atom.element !== "C" && atom.element !== "O") {
      return null
    }
    heavyTotal += 1
  }

  const ketone = carbonyl.kind === "ketone"
  let chainOrder: number[]
  let topLabel: "CHO" | "CH2OH"
  const hydroxyls: number[] = [carbonyl.oxygen]

  if (!ketone) {
    const leg = walkChainLeg(snapshot, carbonyl.arms[0], carbonyl.carbonyl, ringMembers)
    if (leg === null) {
      return null
    }
    topLabel = "CHO"
    chainOrder = [carbonyl.carbonyl, ...leg.centers, leg.terminus]
    hydroxyls.push(...leg.hydroxyls)
  } else {
    if (carbonyl.arms.length !== 2) {
      return null
    }
    const legA = walkChainLeg(snapshot, carbonyl.arms[0], carbonyl.carbonyl, ringMembers)
    const legB = walkChainLeg(snapshot, carbonyl.arms[1], carbonyl.carbonyl, ringMembers)
    if (legA === null || legB === null) {
      return null
    }
    // The carbonyl sits as close to the top as possible: the shorter leg is
    // drawn upward; determinism on ties by first atom index.
    const aShorter =
      legA.centers.length !== legB.centers.length
        ? legA.centers.length < legB.centers.length
        : carbonyl.arms[0] < carbonyl.arms[1]
    const up = aShorter ? legA : legB
    const down = aShorter ? legB : legA
    topLabel = "CH2OH"
    chainOrder = [
      up.terminus,
      ...[...up.centers].reverse(),
      carbonyl.carbonyl,
      ...down.centers,
      down.terminus,
    ]
    hydroxyls.push(...up.hydroxyls, ...down.hydroxyls)
  }

  if (chainOrder.length < 3 || chainOrder.length > MAX_CHAIN_CARBONS + 2) {
    return null
  }

  // Coverage: the walked chain plus its oxygens must be the whole molecule.
  const covered = new Set<number>([...chainOrder, ...hydroxyls])
  if (covered.size !== heavyTotal) {
    return null
  }

  // Stereocenters: the middle spine atoms EXCLUDING the carbonyl carbon
  // (mid-chain for ketoses): every one must carry an R/S code.
  const centerAtomSet = new Set(
    chainOrder.filter(
      (id, index) => index > 0 && index < chainOrder.length - 1 && id !== carbonyl.carbonyl,
    ),
  )
  if (
    centerAtomSet.size === 0 ||
    [...centerAtomSet].some((id) => chirality.get(id) === undefined)
  ) {
    return null
  }

  const centers: FischerChainCenter[] = []
  for (let index = 1; index < chainOrder.length - 1; index += 1) {
    const center = chainOrder[index]
    if (!centerAtomSet.has(center)) {
      continue
    }
    const code = chirality.get(center)
    if (code !== "R" && code !== "S") {
      return null
    }
    const drawnUp = chainOrder[index - 1]
    const drawnDown = chainOrder[index + 1]
    const comparison = comparePriorities(snapshot, center, drawnUp, drawnDown)
    if (comparison === 0) {
      return null
    }
    const ohSide: "left" | "right" = (code === "R") === (comparison === 1) ? "right" : "left"
    centers.push({ atomIdx: center, ohSide })
  }

  const slots: FischerSpineSlot[] = [{ kind: "label", text: topLabel }]
  if (ketone) {
    // Label the carbonyl position on the spine where it occurs (topSlots
    // cover the leg above it; fructose: straight after the top CH2OH).
    const carbonylIndex = chainOrder.indexOf(carbonyl.carbonyl)
    for (let index = 1; index < chainOrder.length - 1; index += 1) {
      if (index === carbonylIndex) {
        // The ketone position renders as an unlabeled carbonyl vertex with a
        // real double bond to its oxygen (see drawFischer), never a "C=O".
        slots.push({ kind: "carbonyl" })
        continue
      }
      const center = centers.find((candidate) => candidate.atomIdx === chainOrder[index])
      if (center !== undefined) {
        slots.push({ kind: "center", center })
      }
    }
  } else {
    for (const center of centers) {
      slots.push({ kind: "center", center })
    }
  }
  slots.push({ kind: "label", text: "CH2OH" })

  return { ketone, topLabel, bottomLabel: "CH2OH", centers, slots }
}

const STROKE_WIDTH = 1.5
const BOLD_STROKE_WIDTH = STROKE_WIDTH * 2.2

// Atom colours (ATOM_COLOR_OXYGEN / ATOM_COLOR_NEUTRAL) come from the shared
// app palette — see atom-palette.ts — so a Fischer projection matches the
// RDKit depictions exactly; the dark-theme ink swap in applyTheme takes care
// of the neutral parts.
/** Plain SVG markup for shared drawing elements, styled like a projection. */
export function drawingToSvg(drawing: ProjectionDrawing): string {
  const parts: string[] = []
  for (const element of drawing.elements) {
    if (element.kind === "line") {
      const width = element.bold === true ? BOLD_STROKE_WIDTH : STROKE_WIDTH
      parts.push(
        `<line x1='${element.x1}' y1='${element.y1}' x2='${element.x2}' y2='${element.y2}' stroke='${ATOM_COLOR_NEUTRAL}' stroke-width='${width}' stroke-linecap='round'/>`,
      )
    } else {
      const fill = element.fill ?? ATOM_COLOR_NEUTRAL
      const fontSize = element.fontSize ?? FONT_SIZE
      const text = element.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      // Raise the SVG text's optical midpoint to the model y instead of the
      // em-box middle — RDKit centers atom ink on the atom point, so letters
      // read vertically centered against the bond (dy = −0.1 · font-size).
      const dy = -(fontSize * 0.1).toFixed(2)
      parts.push(
        `<text x='${element.x}' y='${element.y}' dy='${dy}' font-size='${fontSize}' dominant-baseline='central' text-anchor='${element.anchor ?? "middle"}' fill='${fill}'>${text}</text>`,
      )
    }
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${drawing.width} ${drawing.height}' width='${drawing.width}' height='${drawing.height}'>${parts.join("")}</svg>`
}

/** Subscript digits sit this many px below the label baseline. */
const SUBSCRIPT_DROP = 5
const SUBSCRIPT_SIZE = 12

/** Ink-to-bond-end adjacency for right-side (OH) labels — they nearly touch
 * their bond, matching the RDKit depictions. */
const BOND_LABEL_GAP = 2
/** Left-side (HO) labels sit a little further out — they read better with
 * extra room on the bond side and there is no handed-count of the bond ending
 * against the outer H that would argue for the same tightness. */
const LEFT_BOND_LABEL_GAP = 6

interface TextRun {
  text: string
  x: number
  y: number
  fill: string
  fontSize?: number
}

/** Vertical spacing between two spine slots. */
const SPINE_STEP = BOND * 1.5
/** Horizontal arm length from the spine to a side label zone. */
const ARM = BOND * 0.8

function textWidth(text: string, fontSize?: number): number {
  return text.length * ((fontSize ?? FONT_SIZE) * 0.5)
}

/**
 * Terminal labels ("CHO" / "CH2OH") as per-letter runs: the carbon letter
 * sits exactly on the bond, the "2" renders as a real subscript (smaller and
 * dropped below the baseline), oxygens take the app's atom palette. Every
 * letter occupies a LETTER_STEP-wide slot so adjacent letters never crowd.
 */
function terminalLabelRuns(text: "CHO" | "CH2OH", centerX: number, y: number): TextRun[] {
  const runs: TextRun[] = []
  let x = centerX - LETTER_INK / 2
  runs.push({ text: "C", x, y, fill: ATOM_COLOR_NEUTRAL })
  x += LETTER_STEP
  runs.push({ text: "H", x, y, fill: ATOM_COLOR_NEUTRAL })
  x += LETTER_STEP
  if (text === "CH2OH") {
    runs.push({
      text: "2",
      x,
      y: y + SUBSCRIPT_DROP,
      fill: ATOM_COLOR_NEUTRAL,
      fontSize: SUBSCRIPT_SIZE,
    })
    x += SUBSCRIPT_ADVANCE
  }
  runs.push({ text: "O", x, y, fill: ATOM_COLOR_OXYGEN })
  x += LETTER_STEP
  if (text === "CH2OH") {
    runs.push({ text: "H", x, y, fill: ATOM_COLOR_NEUTRAL })
  }
  return runs
}

/**
 * The classic Fischer projection as shared drawing elements, atom-colored
 * (red oxygens) and typed like the rest of the app — natural size, padded.
 */
export function drawFischer(recognition: FischerRecognition): ProjectionDrawing {
  const elements: DrawingElement[] = []
  const spineX = 0
  const bodyOf = (slot: FischerSpineSlot): number =>
    slot.kind === "label" ? TEXT_HEIGHT / 2 + 2 : 0

  recognition.slots.forEach((slot, index) => {
    const y = index * SPINE_STEP
    if (slot.kind === "label") {
      for (const run of terminalLabelRuns(slot.text, spineX, y)) {
        elements.push({
          kind: "text",
          x: run.x,
          y: run.y,
          text: run.text,
          anchor: "start",
          fill: run.fill,
          ...(run.fontSize !== undefined ? { fontSize: run.fontSize } : {}),
        })
      }
      return
    }
    if (slot.kind === "carbonyl") {
      // Ketone vertex: unlabeled carbon on the spine, oxygen to the RIGHT as
      // a proper double bond — two short parallel strokes ending at a red O.
      elements.push({ kind: "line", x1: spineX, y1: y - 2, x2: spineX + ARM, y2: y - 2 })
      elements.push({ kind: "line", x1: spineX, y1: y + 2, x2: spineX + ARM, y2: y + 2 })
      elements.push({
        kind: "text",
        x: spineX + ARM + BOND_LABEL_GAP,
        y,
        text: "O",
        anchor: "start",
        fill: ATOM_COLOR_OXYGEN,
      })
      return
    }
    // Crossing: horizontal arm; the hydroxyl reads "HO" on the LEFT of the
    // ring and "OH" on the RIGHT of the ring (the O is always adjacent to its
    // bond — the same flip idiom the Haworth pass uses). Each letter occupies
    // its own LETTER_STEP slot so adjacent letters keep the app's breathing
    // room instead of crowding like they did at raw character steps, and the
    // outermost letter's ink touches the bond end like everywhere else.
    elements.push({ kind: "line", x1: spineX - ARM, y1: y, x2: spineX + ARM, y2: y })
    const ohLeft = slot.center.ohSide === "left"
    if (ohLeft) {
      const bondEndX = spineX - ARM - LEFT_BOND_LABEL_GAP
      const ox = bondEndX - LETTER_INK
      elements.push({
        kind: "text",
        x: ox - LETTER_STEP,
        y,
        text: "H",
        anchor: "start",
        fill: ATOM_COLOR_NEUTRAL,
      })
      elements.push({
        kind: "text",
        x: ox,
        y,
        text: "O",
        anchor: "start",
        fill: ATOM_COLOR_OXYGEN,
      })
    } else {
      const ox = spineX + ARM + BOND_LABEL_GAP
      elements.push({
        kind: "text",
        x: ox,
        y,
        text: "O",
        anchor: "start",
        fill: ATOM_COLOR_OXYGEN,
      })
      elements.push({
        kind: "text",
        x: ox + LETTER_STEP,
        y,
        text: "H",
        anchor: "start",
        fill: ATOM_COLOR_NEUTRAL,
      })
    }
    elements.push({
      kind: "text",
      x: ohLeft ? spineX + ARM + BOND_LABEL_GAP : spineX - ARM - LEFT_BOND_LABEL_GAP - LETTER_INK,
      y,
      text: "H",
      anchor: "start",
      fill: ATOM_COLOR_NEUTRAL,
    })
  })

  // Vertical spine segments between consecutive slots, gapped at labels.
  for (let index = 0; index < recognition.slots.length - 1; index += 1) {
    const upperY = index * SPINE_STEP + bodyOf(recognition.slots[index])
    const lowerY = (index + 1) * SPINE_STEP - bodyOf(recognition.slots[index + 1])
    if (lowerY - upperY > 1) {
      elements.push({ kind: "line", x1: spineX, y1: upperY, x2: spineX, y2: lowerY })
    }
  }

  // Measure and shift so the drawing sits at PADDING from its top-left.
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const element of elements) {
    if (element.kind === "line") {
      minX = Math.min(minX, element.x1, element.x2)
      maxX = Math.max(maxX, element.x1, element.x2)
      minY = Math.min(minY, element.y1, element.y2)
      maxY = Math.max(maxY, element.y1, element.y2)
    } else {
      const fontSize = element.fontSize ?? FONT_SIZE
      const width = textWidth(element.text, fontSize)
      const half = element.anchor === "middle" ? width / 2 : element.anchor === "start" ? 0 : width
      const left = element.x - half
      minX = Math.min(minX, left)
      maxX = Math.max(maxX, left + width)
      minY = Math.min(minY, element.y - (fontSize * TEXT_HEIGHT) / 11 / 2)
      maxY = Math.max(maxY, element.y + (fontSize * TEXT_HEIGHT) / 11 / 2)
    }
  }
  if (!Number.isFinite(minX)) {
    minX = minY = 0
    maxX = maxY = 1
  }
  const shiftX = PADDING - minX
  const shiftY = PADDING - minY
  const shifted: DrawingElement[] = elements.map((element) =>
    element.kind === "line"
      ? {
          ...element,
          x1: element.x1 + shiftX,
          y1: element.y1 + shiftY,
          x2: element.x2 + shiftX,
          y2: element.y2 + shiftY,
        }
      : { ...element, x: element.x + shiftX, y: element.y + shiftY },
  )
  return {
    elements: shifted,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
  }
}
