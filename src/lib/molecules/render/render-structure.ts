// The single structure-rendering facade used by the UI.
//
// One call turns a SMILES string into a ready-to-inject SVG element:
//   1. RDKit lays out and draws the molecule; recognised sugars take the
//      canonical Haworth path from `haworth-rdkit.ts`.
//   2. Optional orientation/mirror is applied to the 2D coordinates before the
//      final draw: unrecognised molecules rotate + mirror, recognised ones only
//      mirror (their canonical skeleton stays upright), matching the old
//      legacy drawer component semantics.
//   3. The markup is parsed, transplanted into a fresh host <svg>, themed, and
//      decorated with the Haworth overlays (HO label flips, bold front edges)
//      and the isolated-metal coordination passes.
//
// Requires `await ensureRdkit()` before calling.

import { transformPoints } from "@/lib/molecules/orientation"
import { prepareStructureRender } from "@/lib/molecules/render/haworth-rdkit"
import {
  drawWithNaturalSize,
  type Mol,
  molblockWithPositions,
  parseMol,
  snapshotFromMol,
} from "@/lib/molecules/render/rdkit-engine"
import {
  applyBoldFrontEdges,
  applyCoordinationLines,
  applyOhLabelHints,
  applyTheme,
  centerIsolatedMetal,
  type FrontRingBond,
  type OhLabelHint,
  raiseAtomLetters,
} from "@/lib/molecules/render/svg-post"

const SVG_NAMESPACE = "http://www.w3.org/2000/svg"
/** Only these SMILES can carry an isolated metal; skip the extra parse otherwise. */
const ISOLATED_METAL_PATTERN = /\[(?:Fe|Mg|Co)[^\]]*\]/

export interface RenderStructureOptions {
  width: number
  height: number
  /** Coordinate rotation in degrees (ignored for recognised Haworth skeletons). */
  orientationDeg?: number
  /** Mirror across the vertical axis (also ignored for recognised skeletons' orientation). */
  mirror?: boolean
  theme: "light" | "dark"
  /**
   * Erase the atom palette entirely: every bond and label draws in the
   * theme's single neutral ink. Used by Mistr quiz prompts, where colour
   * coding would give away part of the answer. Default false.
   */
  monochrome?: boolean
  /** Bond length used by the Haworth layout and coordination insets. */
  bondLength?: number
  /**
   * Draw at a constant on-screen bond length (default false). The natural
   * canvas grows with the molecule instead of shrinking it to fit
   * `width` × `height`; grids and option lists keep the fixed box.
   */
  natural?: boolean
  /**
   * False disables saccharide auto-recognition, forcing a plain skeletal
   * depiction (and suppressing the Haworth overlay). Default true.
   */
  haworth?: boolean
  /**
   * False disables open-chain Fischer auto-recognition (runs only when no
   * sugar ring is recognized — the two projections stay mutually exclusive).
   * Default true.
   */
  fischer?: boolean
}

export interface RenderedStructure {
  svg: SVGSVGElement
  recognized: "haworth" | "fischer" | false
}

/**
 * Draw a structure with the RDKit pipeline. Returns null when the SMILES does
 * not parse (including molecules Chromium/RDKit reject outright).
 */
export function renderStructure(
  smiles: string,
  options: RenderStructureOptions,
): RenderedStructure | null {
  const natural = options.natural === true
  const prepared = prepareStructureRender(smiles, {
    width: options.width,
    height: options.height,
    bondLength: options.bondLength,
    natural,
    haworth: options.haworth,
    fischer: options.fischer,
  })
  if (prepared === null) {
    return null
  }

  let markup = prepared.svg
  let molblock = prepared.molblock
  const recognized = prepared.recognized
  const orientationDeg = options.orientationDeg ?? 0
  const mirror = options.mirror === true

  if (recognized === "haworth") {
    // RDKit treats molblock coordinates as y-up and flips them into the SVG's
    // y-down screen space, while the canonical Haworth polygon is authored in
    // screen coordinates. Negate y before the final draw so ring O stays
    // top-right and the front edges (roles 0–3) stay on the bottom/front side;
    // an explicit mirror then flips x on top of that.
    const flipped = sugarMolblock(molblock, mirror)
    if (flipped !== null) {
      molblock = flipped
      markup =
        drawMolblock(molblock, {
          width: options.width,
          height: options.height,
          bondLength: options.bondLength,
          wedgeBonds: false,
          natural,
        }) ?? prepared.svg
    }
  } else if (recognized === false && (orientationDeg !== 0 || mirror)) {
    const transformed = transformedMolblock(molblock, orientationDeg, mirror)
    if (transformed !== null) {
      molblock = transformed.molblock
      markup =
        drawMolblock(molblock, {
          width: options.width,
          height: options.height,
          bondLength: options.bondLength,
          wedgeBonds: true,
          natural,
        }) ?? prepared.svg
    }
  }

  const host = transplant(markup)
  if (host === null) {
    return null
  }

  applyTheme(host, options.theme, options.monochrome === true)

  if (recognized === "haworth" && prepared.overlay !== undefined) {
    // A mirrored sugar flips left/right, so the HO hints flip with it.
    const hints: OhLabelHint[] = prepared.overlay.ohHints.map((hint) =>
      mirror ? { atom: hint.atom, side: hint.side === "HO" ? "OH" : "HO" } : hint,
    )
    applyOhLabelHints(host, hints)
    const frontBonds: FrontRingBond[] = prepared.overlay.frontRingBonds
    applyBoldFrontEdges(host, frontBonds, prepared.overlay.cyclePositions)
  }

  if (ISOLATED_METAL_PATTERN.test(smiles)) {
    const snapshot = snapshotOfMolblock(molblock)
    if (snapshot !== null) {
      const site = centerIsolatedMetal(host, snapshot)
      if (site !== null) {
        // Insets are screen units: let the pass measure the drawn bond length
        // rather than reuse the (layout-world) bondLength option.
        applyCoordinationLines(host, site)
      }
    }
  }

  // Letters are the read layer: after every decoration pass so nothing —
  // front-edge bands, seals, coordination lines, or a crossing bond — can
  // paint over a heteroatom glyph.
  raiseAtomLetters(host)

  return { svg: host, recognized }
}

/** Mirror/rotate a molblock's atom coordinates, returning the patched block. */
function transformedMolblock(
  molblock: string,
  orientationDeg: number,
  mirror: boolean,
): { molblock: string } | null {
  const mol = parseMol(molblock)
  if (mol === null) {
    return null
  }
  let positions: { x: number; y: number }[]
  try {
    positions = snapshotFromMol(mol).atoms.map((atom) => atom.pos)
  } finally {
    mol.delete()
  }
  const transformed = transformPoints(
    positions.map((position) => ({ ...position })),
    orientationDeg,
    mirror,
  )
  return { molblock: molblockWithPositions(molblock, transformed) }
}

/**
 * Screen-orient a Haworth molblock: negate y (RDKit's screen flip) and apply
 * the optional enantiomer mirror. Recognised skeletons ignore rotation.
 */
function sugarMolblock(molblock: string, mirror: boolean): string | null {
  const mol = parseMol(molblock)
  if (mol === null) {
    return null
  }
  let positions: { x: number; y: number }[]
  try {
    positions = snapshotFromMol(mol).atoms.map((atom) => ({ x: atom.pos.x, y: -atom.pos.y }))
  } finally {
    mol.delete()
  }
  const transformed = mirror ? transformPoints(positions, 0, true) : positions
  return molblockWithPositions(molblock, transformed)
}

interface DrawOptions {
  width: number
  height: number
  bondLength?: number
  wedgeBonds: boolean
  natural: boolean
}

function drawMolblock(molblock: string, options: DrawOptions): string | null {
  const mol = parseMol(molblock)
  if (mol === null) {
    return null
  }
  try {
    return drawMol(mol, options)
  } finally {
    mol.delete()
  }
}

function drawMol(mol: Mol, options: DrawOptions): string {
  if (options.natural) {
    return drawWithNaturalSize(mol, {
      bondLength: options.bondLength,
      wedgeBonds: options.wedgeBonds,
    })
  }
  return mol.get_svg_with_highlights(
    JSON.stringify({
      width: options.width,
      height: options.height,
      wedgeBonds: options.wedgeBonds,
    }),
  )
}

function snapshotOfMolblock(molblock: string) {
  const mol = parseMol(molblock)
  if (mol === null) {
    return null
  }
  try {
    return snapshotFromMol(mol)
  } finally {
    mol.delete()
  }
}

/**
 * Parse the RDKit markup and move its children into a fresh SVG element. The
 * host keeps the drawer's viewBox/size so fixed-size and grow measurements see
 * the same coordinate system as before.
 */
function transplant(markup: string): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml")
  const source = parsed.documentElement
  if (source === null || source.localName !== "svg") {
    return null
  }
  const host = document.createElementNS(SVG_NAMESPACE, "svg")
  for (const attribute of ["viewBox", "width", "height", "preserveAspectRatio"]) {
    const value = source.getAttribute(attribute)
    if (value !== null) {
      host.setAttribute(attribute, value)
    }
  }
  host.setAttribute("xmlns", SVG_NAMESPACE)
  for (const child of Array.from(source.childNodes)) {
    host.appendChild(document.importNode(child, true))
  }
  return host
}
