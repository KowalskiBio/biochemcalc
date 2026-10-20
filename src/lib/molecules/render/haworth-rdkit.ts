// Haworth-aware depiction pipeline on top of the RDKit-JS engine.
//
// Phase 2 of the legacy drawer → RDKit migration: the sugar-ring recognition
// and canonical Haworth layout from `haworth-layout.ts` are reused verbatim,
// but their input is a mutable shim built from RDKit's graph snapshot instead
// of legacy drawer's live preprocessor graph. RDKit coordinates are scaled to
// the layout's bond length, the existing pass mutates the shim, and the
// harvested points are scaled back to RDKit's native coordinate size and
// patched into the molecule's V2000 molblock before the final depiction.
//
// Why a shim and not a refactor: `applyHaworthLayout` only reads a small,
// structural surface (`graph.vertices[].{id,position,value,neighbours}`,
// `graph.edges[].{sourceId,targetId,weight,wedge}`, `rings[].{id,members,center}`,
// `opts.bondLength`) and mutates positions/centers/wedges in place. That shape
// is already exported as `LayoutPreprocessor`, so the draw path can stay
// independent of the shim's internals.

import type { Point } from "@/lib/molecules/orientation"
import {
  applyHaworthLayout,
  type HaworthPreprocessor,
  type HOHint,
} from "@/lib/molecules/render/haworth-layout"
import { snapshotFromPreprocessor } from "@/lib/molecules/render/pipeline-snapshot"
import {
  drawWithNaturalSize,
  getMolBlock,
  type Mol,
  type MolGraphSnapshot,
  molblockWithPositions,
  parseMol,
  snapshotFromMol,
} from "@/lib/molecules/render/rdkit-engine"
import {
  type GraphSnapshot,
  recognizeSugarRings,
  type SugarRingRecognition,
} from "@/lib/molecules/render/recognize"

/** Layout + drawing defaults matching the previous pipeline. */
const DEFAULT_WIDTH = 400
const DEFAULT_HEIGHT = 300
const DEFAULT_BOND_LENGTH = 24

/** One exocyclic hydroxyl, addressed by atom index for SVG overlay consumers. */
export interface OhLabelHint {
  atom: number
  side: HOHint["side"]
}

/** One of the three bold Haworth front edges, addressed by atom indices. */
export interface FrontRingBond {
  a: number
  b: number
}

/**
 * Post-draw overlay inputs. Everything is keyed by RDKit atom index; Phase 3
 * can recover the emitted geometry from `<path class='bond-N atom-i atom-j'>`.
 */
export interface HaworthOverlay {
  ohHints: OhLabelHint[]
  frontRingBonds: FrontRingBond[]
}

/** Result of the one entry point Phase 3 consumes. */
export interface PreparedStructure {
  recognized: "haworth" | false
  /** Final depiction markup (RDKit SVG). */
  svg: string
  /** Present only when `recognized === "haworth"`. */
  overlay?: HaworthOverlay
  /**
   * V2000 molblock actually handed to the drawer, with the Haworth coordinates
   * patched in. Diagnostic/testing only; consumers should use `overlay`.
   */
  molblock: string
}

export interface HaworthLayoutOptions {
  width?: number
  height?: number
  bondLength?: number
  /**
   * Draw at a constant on-screen bond length instead of scaling the molecule
   * to fit `width` × `height`. Default false keeps the fixed-box preview.
   */
  natural?: boolean
  /** False skips saccharide recognition entirely; default true. */
  haworth?: boolean
}

interface ResolvedOptions {
  width: number
  height: number
  bondLength: number
  natural: boolean
  haworth: boolean
}

/** Recognition + post-layout geometry, useful for tests and diagnostics. */
export interface HaworthLayoutResult {
  /** Whether at least one sugar ring was reshaped. */
  recognized: boolean
  /** Recognizer snapshot (chemistry, taken before the layout mutations). */
  snapshot: GraphSnapshot
  plans: SugarRingRecognition[]
  /** Mutable shim after the layout pass. */
  preprocessor: HaworthPreprocessor
  /** Final coordinates by atom index. */
  positions: Map<number, Point>
  /** CIP R/S codes reported by RDKit, by atom index. */
  chirality: Map<number, string>
}

interface CipExtension {
  name?: string
  cipCodes?: [number, string][]
}

interface RdkitJsonAtom {
  impHs?: number
}

interface RdkitJsonMolecule {
  atoms?: RdkitJsonAtom[]
  extensions?: CipExtension[]
}

interface RdkitJson {
  molecules?: RdkitJsonMolecule[]
}

interface MolMetadata {
  chirality: Map<number, string>
  implicitHydrogens: Map<number, number>
}

/**
 * Virtual hydrogen vertices: the recognizer was written against a graph where
 * every implicit H is an explicit vertex (legacy drawer's preprocessor), while
 * RDKit's snapshot is heavy-atom only. Ids are kept below the recognizer's
 * phantom range (1_000_000) so they are never mistaken for bond duplicates.
 */
const H_VERTEX_BASE = 500_000

interface LayoutSession {
  mol: Mol
  /** Heavy-atom RDKit graph snapshot (atom indices match the molblock). */
  molSnapshot: MolGraphSnapshot
  /** Recognizer snapshot taken before the layout mutations. */
  graphSnapshot: GraphSnapshot
  chirality: Map<number, string>
  preprocessor: HaworthPreprocessor
  plans: SugarRingRecognition[]
  recognized: boolean
  /** Layout-world units per RDKit coordinate unit (bond length ratio). */
  coordinateScale: number
}

/**
 * Read RDKit's own CIP labels. `get_json()` publishes them under the
 * `rdkitRepresentation` extension; R/S is exactly what the recognizer needs
 * (the legacy drawer pipeline got the same annotation from its own pass).
 */
export function chiralityFromMol(mol: Mol): Map<number, string> {
  return readMolMetadata(mol).chirality
}

function readMolMetadata(mol: Mol): MolMetadata {
  const parsed = JSON.parse(mol.get_json()) as RdkitJson
  const molecule = parsed.molecules?.[0]
  const representation = (molecule?.extensions ?? []).find(
    (extension) => extension.name === "rdkitRepresentation",
  )
  const chirality = new Map<number, string>()
  for (const [atomIdx, code] of representation?.cipCodes ?? []) {
    if (code === "R" || code === "S") {
      chirality.set(atomIdx, code)
    }
  }
  const implicitHydrogens = new Map<number, number>()
  const atoms = molecule?.atoms ?? []
  atoms.forEach((atom, atomIdx) => {
    const count = atom.impHs ?? 0
    if (count > 0) {
      implicitHydrogens.set(atomIdx, count)
    }
  })
  return { chirality, implicitHydrogens }
}

/**
 * Haworth layout for a SMILES string. Recognition runs on a snapshot taken
 * before the pass (chemistry only), then coordinates are harvested after it.
 * Returns null for an unparseable SMILES.
 */
export function haworthLayoutOf(
  smiles: string,
  options: HaworthLayoutOptions = {},
): HaworthLayoutResult | null {
  const opts = resolveOptions(options)
  const session = openSession(smiles, opts)
  if (session === null) {
    return null
  }
  try {
    const positions = new Map<number, Point>()
    for (const vertex of session.preprocessor.graph.vertices) {
      positions.set(vertex.id, { x: vertex.position.x, y: vertex.position.y })
    }
    return {
      recognized: session.recognized,
      snapshot: session.graphSnapshot,
      plans: session.plans,
      preprocessor: session.preprocessor,
      positions,
      chirality: new Map(session.chirality),
    }
  } finally {
    session.mol.delete()
  }
}

/**
 * The Phase 3 entry point: parse SMILES, run the Haworth pass when a sugar is
 * recognized, and return the final SVG plus atom-indexed overlay inputs.
 * Requires `await ensureRdkit()` first (same contract as `parseMol`).
 */
export function prepareStructureRender(
  smiles: string,
  options: HaworthLayoutOptions = {},
): PreparedStructure | null {
  const opts = resolveOptions(options)
  const session = openSession(smiles, opts)
  if (session === null) {
    return null
  }
  const { mol } = session
  try {
    if (!session.recognized) {
      return {
        recognized: false,
        svg: opts.natural
          ? drawWithNaturalSize(mol, { bondLength: opts.bondLength, wedgeBonds: true })
          : mol.get_svg(opts.width, opts.height),
        molblock: getMolBlock(mol),
      }
    }

    const atomCount = session.molSnapshot.atoms.length
    const points = session.preprocessor.graph.vertices
      .filter((vertex) => vertex.id < atomCount)
      .map((vertex) => ({
        // Back to RDKit's native (~1-unit bond) coordinate scale so the
        // drawer keeps its standard label/font sizing.
        x: vertex.position.x / session.coordinateScale,
        y: vertex.position.y / session.coordinateScale,
      }))
    const molblock = restoreStereochemistry(
      molblockWithPositions(getMolBlock(mol), points),
      session.chirality,
    )
    const placed = parseMol(molblock)
    if (placed === null) {
      throw new Error("RDKit could not reparse the Haworth-positioned molblock")
    }
    try {
      const drawnAtomCount = mol.get_num_atoms()
      const drawnBondCount = mol.get_num_bonds()
      if (placed.get_num_atoms() !== drawnAtomCount || placed.get_num_bonds() !== drawnBondCount) {
        throw new Error(
          `Haworth round-trip changed the graph: ${placed.get_num_atoms()}/${placed.get_num_bonds()} vs ${drawnAtomCount}/${drawnBondCount}`,
        )
      }
      return {
        recognized: "haworth",
        svg: opts.natural
          ? drawWithNaturalSize(placed, { bondLength: opts.bondLength, wedgeBonds: false })
          : drawMol(placed, opts, false),
        overlay: overlayOf(session, opts),
        molblock,
      }
    } finally {
      placed.delete()
    }
  } finally {
    mol.delete()
  }
}

/**
 * Parse + recognize + lay out, keeping the live Mol for the caller to draw.
 * `null` means the SMILES did not parse.
 */
function openSession(smiles: string, opts: ResolvedOptions): LayoutSession | null {
  const mol = parseMol(smiles)
  if (mol === null) {
    return null
  }
  try {
    mol.set_new_coords(true)
    const snapshot = snapshotFromMol(mol)
    const metadata = readMolMetadata(mol)
    const coordinateScale = opts.bondLength / medianBondLength(snapshot)
    const preprocessor = buildPreprocessor(snapshot, metadata, opts.bondLength, coordinateScale)
    const recognizerSnapshot = snapshotFromPreprocessor(preprocessor)
    const plans = opts.haworth ? recognizeSugarRings(recognizerSnapshot) : []
    const recognized = plans.length > 0 ? applyHaworthLayout(preprocessor) : false
    return {
      mol,
      molSnapshot: snapshot,
      graphSnapshot: recognizerSnapshot,
      chirality: metadata.chirality,
      preprocessor,
      plans,
      recognized,
      coordinateScale,
    }
  } catch (error) {
    mol.delete()
    throw error
  }
}

/**
 * Build the mutable preprocessor-shaped shim from RDKit's graph. RDKit draws
 * with ~1-unit bonds; the layout expects the legacy drawer's 24-unit world,
 * so every coordinate (and ring center) is uniformly scaled first. Atoms the
 * layout does not touch stay in that same world; `prepareStructureRender`
 * divides by the same scale before patching the molblock.
 */
function buildPreprocessor(
  snapshot: MolGraphSnapshot,
  metadata: MolMetadata,
  bondLength: number,
  scale: number,
): HaworthPreprocessor {
  const adjacency = snapshot.atoms.map(() => [] as number[])
  for (const bond of snapshot.bonds) {
    adjacency[bond.beginIdx].push(bond.endIdx)
    adjacency[bond.endIdx].push(bond.beginIdx)
  }

  const vertices: HaworthPreprocessor["graph"]["vertices"] = snapshot.atoms.map((atom) => ({
    id: atom.idx,
    position: { x: atom.pos.x * scale, y: atom.pos.y * scale },
    value: {
      element: atom.element,
      chirality: metadata.chirality.get(atom.idx) ?? "",
      isPartOfAromaticRing: atom.aromatic,
    },
    neighbours: [...adjacency[atom.idx]],
  }))
  const edges: NonNullable<HaworthPreprocessor["graph"]["edges"]> = snapshot.bonds.map((bond) => ({
    sourceId: bond.beginIdx,
    targetId: bond.endIdx,
    weight: bond.order,
    wedge: "",
  }))

  // Synthesize the implicit hydrogens as movable leaf vertices. They take part
  // in recognition/priority ranking exactly like legacy drawer's H vertices,
  // but they are never patched into the molblock (see harvested points).
  for (const atom of snapshot.atoms) {
    const count = metadata.implicitHydrogens.get(atom.idx) ?? 0
    for (let copy = 0; copy < count; copy += 1) {
      const id = H_VERTEX_BASE + atom.idx * 10 + copy
      const angle = (Math.PI * 2 * copy) / Math.max(count, 1)
      const parentPosition = { x: atom.pos.x * scale, y: atom.pos.y * scale }
      vertices.push({
        id,
        position: {
          x: parentPosition.x + Math.cos(angle) * bondLength * 0.5,
          y: parentPosition.y + Math.sin(angle) * bondLength * 0.5,
        },
        value: { element: "H", chirality: "", isPartOfAromaticRing: false },
        neighbours: [atom.idx],
      })
      adjacency[atom.idx].push(id)
      vertices[atom.idx].neighbours.push(id)
      edges.push({ sourceId: atom.idx, targetId: id, weight: 1, wedge: "" })
    }
  }

  return {
    graph: { vertices, edges },
    rings: snapshot.rings.map((ring, id) => ({
      id,
      members: [...ring.members],
      center: { x: ring.center.x * scale, y: ring.center.y * scale },
    })),
    opts: { bondLength },
  }
}

function medianBondLength(snapshot: MolGraphSnapshot): number {
  const lengths: number[] = []
  for (const bond of snapshot.bonds) {
    const begin = snapshot.atoms[bond.beginIdx]?.pos
    const end = snapshot.atoms[bond.endIdx]?.pos
    if (begin === undefined || end === undefined) {
      continue
    }
    const length = Math.hypot(end.x - begin.x, end.y - begin.y)
    if (length > 1e-9) {
      lengths.push(length)
    }
  }
  if (lengths.length === 0) {
    return 1
  }
  lengths.sort((a, b) => a - b)
  const middle = Math.floor(lengths.length / 2)
  return lengths.length % 2 === 0 ? (lengths[middle - 1] + lengths[middle]) / 2 : lengths[middle]
}

interface MolblockBond {
  /** Zero-based line index in the molblock. */
  line: number
  begin: number
  end: number
  stereo: number
}

function readMolblockBonds(molblock: string): MolblockBond[] {
  const lines = molblock.split(/\r?\n/)
  const counts = lines[3]
  if (counts === undefined) {
    return []
  }
  const atomCount = Number.parseInt(counts.slice(0, 3).trim(), 10)
  const bondCount = Number.parseInt(counts.slice(3, 6).trim(), 10)
  const bonds: MolblockBond[] = []
  for (let index = 0; index < bondCount; index += 1) {
    const line = 4 + atomCount + index
    const content = lines[line]
    if (content === undefined) {
      break
    }
    bonds.push({
      line,
      begin: Number.parseInt(content.slice(0, 3).trim(), 10) - 1,
      end: Number.parseInt(content.slice(3, 6).trim(), 10) - 1,
      stereo: Number.parseInt(content.slice(9, 12).trim(), 10),
    })
  }
  return bonds
}

function writeMolblockBondStereo(molblock: string, updates: Map<number, number>): string {
  const lines = molblock.split(/\r?\n/)
  for (const [line, stereo] of updates) {
    const content = lines[line]
    if (content === undefined) {
      continue
    }
    lines[line] = `${content.slice(0, 9)}${String(stereo).padStart(3)}${content.slice(12)}`
  }
  return lines.join("\n")
}

/**
 * The Haworth layout moves substituents rigidly, but V2000 stereo lives in
 * bond wedge flags whose meaning depends on the drawn 2D arrangement. When a
 * ring snaps into an orientation mirrored relative to RDKit's input layout
 * (AMP's furanose, sucrose's fructose), every flag on that ring would imply
 * the opposite R/S. Reparse candidate flags and flip the one wedged bond of
 * each disagreeing centre; RDKit reports only the original CIP codes for a
 * wedge-free drawing, so this keeps the round-tripped chemistry faithful.
 */
function restoreStereochemistry(molblock: string, desired: Map<number, string>): string {
  if (desired.size === 0) {
    return molblock
  }
  const actual = chiralityOfMolblock(molblock)
  const updates = new Map<number, number>()
  const bonds = readMolblockBonds(molblock)
  for (const [atomIdx, code] of desired) {
    if (actual.get(atomIdx) === code) {
      continue
    }
    const wedged = bonds.filter(
      (bond) => bond.stereo !== 0 && (bond.begin === atomIdx || bond.end === atomIdx),
    )
    if (wedged.length !== 1) {
      continue
    }
    updates.set(wedged[0].line, wedged[0].stereo === 1 ? 6 : 1)
  }
  return updates.size === 0 ? molblock : writeMolblockBondStereo(molblock, updates)
}

function chiralityOfMolblock(molblock: string): Map<number, string> {
  const mol = parseMol(molblock)
  if (mol === null) {
    return new Map()
  }
  try {
    return chiralityFromMol(mol)
  } finally {
    mol.delete()
  }
}

function drawMol(mol: Mol, opts: ResolvedOptions, wedgeBonds: boolean): string {
  const details: Record<string, number | boolean> = {
    width: opts.width,
    height: opts.height,
    wedgeBonds,
  }
  return mol.get_svg_with_highlights(JSON.stringify(details))
}

/**
 * Atom-indexed OH hints plus the front-edge pairs for the SVG post-passes,
 * computed from the post-layout shim. The label
 * side rule (left ring edge beyond −0.75 bond) is kept byte-for-byte.
 */
function overlayOf(session: LayoutSession, opts: ResolvedOptions): HaworthOverlay {
  const { preprocessor, plans } = session
  const snapshot = snapshotFromPreprocessor(preprocessor)
  const elementOf = (id: number): string | undefined => snapshot.atoms.get(id)?.element
  const positionOf = (id: number): Point | undefined =>
    preprocessor.graph.vertices.find((vertex) => vertex.id === id)?.position

  const ohHints: OhLabelHint[] = []
  const frontRingBonds: FrontRingBond[] = []
  for (const plan of plans) {
    const ringPositions = plan.cycle
      .map((id) => positionOf(id))
      .filter((position): position is Point => position !== undefined)
    if (ringPositions.length === 0) {
      continue
    }
    const centroidX =
      ringPositions.reduce((sum, position) => sum + position.x, 0) / ringPositions.length
    for (const atom of plan.atoms) {
      for (const substituentId of [...atom.up, ...atom.down]) {
        if (elementOf(substituentId) !== "O") {
          continue
        }
        const heavyNeighbours = (snapshot.adjacency.get(substituentId) ?? []).filter(
          (neighbour) => elementOf(neighbour) !== "H",
        )
        if (heavyNeighbours.length > 1) {
          continue
        }
        const position = positionOf(substituentId)
        if (position === undefined) {
          continue
        }
        ohHints.push({
          atom: substituentId,
          side: position.x < centroidX - 0.75 * opts.bondLength ? "HO" : "OH",
        })
      }
    }
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 3],
    ] as const) {
      if (plan.cycle[a] !== undefined && plan.cycle[b] !== undefined) {
        frontRingBonds.push({ a: plan.cycle[a], b: plan.cycle[b] })
      }
    }
  }
  return { ohHints, frontRingBonds }
}

function resolveOptions(options: HaworthLayoutOptions): ResolvedOptions {
  return {
    width: options.width ?? DEFAULT_WIDTH,
    height: options.height ?? DEFAULT_HEIGHT,
    bondLength: options.bondLength ?? DEFAULT_BOND_LENGTH,
    natural: options.natural === true,
    haworth: options.haworth !== false,
  }
}
