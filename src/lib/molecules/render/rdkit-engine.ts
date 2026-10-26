// Adapter around the RDKit-JS WASM engine.
//
// WASM wiring:
// - Browser/Vite: `RDKit_minimal.wasm?url` is copied to an asset URL and passed
//   to emscripten via `locateFile`.
// - Node/vitest: that URL is not readable by emscripten's fs loader, so the
//   package path resolved through createRequire is tried first instead.
//
// The module keeps a single promise so concurrent callers share one init.

import initRDKitModule from "@rdkit/rdkit"
import wasmUrl from "@rdkit/rdkit/RDKit_minimal.wasm?url"

export interface Mol {
  is_valid(): boolean
  set_new_coords(useCoordGen?: boolean): boolean
  get_svg(width: number, height: number): string
  get_svg_with_highlights(details: string): string
  get_json(): string
  get_molblock(): string
  get_smiles(): string
  get_num_atoms(): number
  get_num_bonds(): number
  delete(): void
}

export interface RdkitModule {
  version(): string
  prefer_coordgen(prefer: boolean): void
  get_mol(input: string): Mol | null
}

export interface MolAtomSnapshot {
  idx: number
  element: string
  aromatic: boolean
  pos: { x: number; y: number }
}

export interface MolBondSnapshot {
  beginIdx: number
  endIdx: number
  order: 1 | 1.5 | 2 | 3
}

export interface MolRingSnapshot {
  members: number[]
  center: { x: number; y: number }
}

export interface MolGraphSnapshot {
  /**
   * Atom (and bond) ordering mirrors the source SMILES/molblock parse order,
   * so index-based anchors computed while assembling the input stay valid.
   */
  atoms: MolAtomSnapshot[]
  bonds: MolBondSnapshot[]
  rings: MolRingSnapshot[]
}

export interface RenderMoleculeOptions {
  width: number
  height: number
  fixedBondLength?: number
}

/** Natural-size draw settings: constant on-screen bond length, padded canvas. */
export interface NaturalDrawOptions {
  /** Target on-screen bond length in px (default 24). */
  bondLength?: number
  /** Uniform canvas padding in px (default 12, matching the old drawer). */
  padding?: number
  /** Draw stereochemistry wedges (default RDKit's own setting). */
  wedgeBonds?: boolean
}

/** Matches the old drawer's constant 24 px bond length. */
const DEFAULT_NATURAL_BOND_LENGTH = 24
/** Matches the old `SvgDrawer` padding. */
const DEFAULT_NATURAL_PADDING = 12

interface RdkitJsonAtom {
  z?: number
  aromatic?: boolean
}

interface RdkitJsonBond {
  atoms: [number, number]
  bo?: number | "A"
}

interface RdkitJsonConformer {
  dim?: number
  coords: number[][]
}

interface RdkitJsonExtension {
  name?: string
  aromaticAtoms?: number[]
  aromaticBonds?: number[]
}

interface RdkitJsonMolecule {
  atoms?: RdkitJsonAtom[]
  bonds?: RdkitJsonBond[]
  conformers?: RdkitJsonConformer[]
  extensions?: RdkitJsonExtension[]
}

interface RdkitJson {
  molecules?: RdkitJsonMolecule[]
}

interface NodeModuleApi {
  createRequire(url: string | URL): { resolve(id: string): string }
}

let initPromise: Promise<RdkitModule> | null = null
let readyModule: RdkitModule | null = null

export function ensureRdkit(): Promise<RdkitModule> {
  if (!initPromise) {
    initPromise = initializeRdkit()
      .then((module) => {
        readyModule = module
        return module
      })
      .catch((error: unknown) => {
        initPromise = null
        throw error
      })
  }
  return initPromise
}

export function getRdkitIfReady(): RdkitModule | null {
  return readyModule
}

export function parseMol(smiles: string): Mol | null {
  const rdkit = getRdkitIfReady()
  if (!rdkit) {
    throw new Error("RDKit is not initialized; await ensureRdkit() before parsing molecules")
  }
  const mol = rdkit.get_mol(smiles)
  if (!mol) return null
  if (!mol.is_valid()) {
    mol.delete()
    return null
  }
  return mol
}

export function getMolBlock(mol: Mol): string {
  return mol.get_molblock()
}

export function snapshotFromMol(mol: Mol): MolGraphSnapshot {
  let molecule = readMoleculeJson(mol)
  let conformer = pickConformer(molecule)
  let coords = conformer?.coords ?? []

  if (coords.length < (molecule.atoms?.length ?? 0)) {
    mol.set_new_coords(true)
    molecule = readMoleculeJson(mol)
    conformer = pickConformer(molecule)
    coords = conformer?.coords ?? []
  }

  const aromaticAtoms = new Set<number>()
  for (const extension of molecule.extensions ?? []) {
    if (extension.name !== "rdkitRepresentation") continue
    for (const idx of extension.aromaticAtoms ?? []) aromaticAtoms.add(idx)
  }

  const rawBonds = molecule.bonds ?? []
  const bonds: MolBondSnapshot[] = rawBonds.map((bond) => ({
    beginIdx: bond.atoms[0],
    endIdx: bond.atoms[1],
    order: normalizeBondOrder(bond.bo),
  }))

  const aromaticBondAtoms = new Set<number>()
  for (let i = 0; i < rawBonds.length; i++) {
    if (bonds[i].order !== 1.5) continue
    aromaticBondAtoms.add(rawBonds[i].atoms[0])
    aromaticBondAtoms.add(rawBonds[i].atoms[1])
  }

  const atoms: MolAtomSnapshot[] = (molecule.atoms ?? []).map((atom, idx) => {
    const point = coords[idx]
    return {
      idx,
      element: elementSymbol(atom.z ?? 6),
      aromatic: atom.aromatic === true || aromaticAtoms.has(idx) || aromaticBondAtoms.has(idx),
      pos: { x: point?.[0] ?? 0, y: point?.[1] ?? 0 },
    }
  })

  return {
    atoms,
    bonds,
    rings: findRings(atoms, bonds),
  }
}

export function molblockWithPositions(
  molblock: string,
  points: { x: number; y: number }[],
): string {
  const linePattern = /([^\r\n]*)(\r?\n|$)/g
  const output: string[] = []
  let atomCount = -1
  let patchedAtoms = 0
  let lineIndex = 0
  let match = linePattern.exec(molblock)

  while (match && match[0] !== "") {
    const content = match[1]
    const lineEnding = match[2]

    if (lineIndex === 3) {
      if (!content.includes("V2000")) {
        throw new Error("Only V2000 molblocks are supported")
      }
      atomCount = Number.parseInt(content.slice(0, 3).trim(), 10)
      if (!Number.isFinite(atomCount)) {
        throw new Error("Invalid V2000 counts line")
      }
      if (points.length !== atomCount) {
        throw new Error(`Point count (${points.length}) does not match atom count (${atomCount})`)
      }
    }

    if (atomCount >= 0 && lineIndex >= 4 && lineIndex < 4 + atomCount) {
      if (content.length < 20) {
        throw new Error(`Invalid atom line at index ${lineIndex}`)
      }
      const point = points[patchedAtoms]
      output.push(
        formatCoordinate(point.x),
        formatCoordinate(point.y),
        content.slice(20),
        lineEnding,
      )
      patchedAtoms++
    } else {
      output.push(content, lineEnding)
    }

    lineIndex++
    match = linePattern.exec(molblock)
  }

  if (atomCount < 0) {
    throw new Error("Molblock has no V2000 counts line")
  }
  if (patchedAtoms !== atomCount) {
    throw new Error(`Patched ${patchedAtoms} atom lines, expected ${atomCount}`)
  }

  return output.join("")
}

export function renderMoleculeSvg(smiles: string, opts: RenderMoleculeOptions): string | null {
  const mol = parseMol(smiles)
  if (!mol) return null

  try {
    mol.set_new_coords(true)
    const details: Record<string, number> = {
      width: opts.width,
      height: opts.height,
    }
    if (opts.fixedBondLength) details.fixedBondLength = opts.fixedBondLength
    return mol.get_svg_with_highlights(JSON.stringify(details))
  } finally {
    mol.delete()
  }
}

/**
 * Canvas dimensions that let RDKit draw `snapshot` at a constant on-screen
 * bond length. Bonds are measured in the snapshot's coordinate units (RDKit
 * layouts use ~1-unit bonds), scaled to `bondLength` px and padded like the
 * old drawer. Call it with the molecule's FINAL coordinates, i.e. after any
 * orientation/mirror/Haworth coordinate work.
 */
export function naturalCanvasSize(
  snapshot: Pick<MolGraphSnapshot, "atoms" | "bonds">,
  bondLength = DEFAULT_NATURAL_BOND_LENGTH,
  padding = DEFAULT_NATURAL_PADDING,
): { width: number; height: number } {
  const median = medianBondLength(snapshot)
  const scale = bondLength / (median > 0 ? median : 1)
  const bounds = coordinateBounds(snapshot.atoms)
  if (bounds === null) {
    const side = Math.max(1, Math.ceil(2 * padding))
    return { width: side, height: side }
  }
  return {
    width: Math.max(1, Math.ceil(bounds.width * scale + 2 * padding)),
    height: Math.max(1, Math.ceil(bounds.height * scale + 2 * padding)),
  }
}

/**
 * Draw a molecule at natural size: compute the padded canvas from its current
 * coordinates, then pass that canvas together with `fixedBondLength` so RDKit
 * draws at the target bond length instead of scaling the molecule to fit a
 * fixed box.
 */
export function drawWithNaturalSize(mol: Mol, options: NaturalDrawOptions = {}): string {
  const bondLength = options.bondLength ?? DEFAULT_NATURAL_BOND_LENGTH
  const padding = options.padding ?? DEFAULT_NATURAL_PADDING
  const snapshot = snapshotFromMol(mol)
  const { width, height } = naturalCanvasSize(snapshot, bondLength, padding)
  const details: Record<string, number | boolean> = {
    width,
    height,
    fixedBondLength: bondLength,
    // The canvas already carries the old drawer's 12 px margin, so RDKit's
    // default 5% padding would otherwise force a slight fit-to-canvas shrink.
    padding: 0,
  }
  if (options.wedgeBonds !== undefined) {
    details.wedgeBonds = options.wedgeBonds
  }
  return mol.get_svg_with_highlights(JSON.stringify(details))
}

function coordinateBounds(atoms: MolAtomSnapshot[]): { width: number; height: number } | null {
  if (atoms.length === 0) {
    return null
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const atom of atoms) {
    minX = Math.min(minX, atom.pos.x)
    minY = Math.min(minY, atom.pos.y)
    maxX = Math.max(maxX, atom.pos.x)
    maxY = Math.max(maxY, atom.pos.y)
  }
  return { width: maxX - minX, height: maxY - minY }
}

function medianBondLength(snapshot: Pick<MolGraphSnapshot, "atoms" | "bonds">): number {
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

async function initializeRdkit(): Promise<RdkitModule> {
  // Under node/vitest the browser `?url` path is not resolvable by emscripten's
  // fs loader, which prints an ENOENT to stderr before the init fails. Resolve
  // the real package path first there and keep `?url` as the browser default.
  if (isNodeRuntime()) {
    try {
      const resolvedPath = await resolveNodeWasmPath()
      return await initWithWasmLocation(() => resolvedPath)
    } catch {
      return initWithWasmLocation(() => wasmUrl)
    }
  }
  return initWithWasmLocation(() => wasmUrl)
}

async function initWithWasmLocation(locateFile: () => string): Promise<RdkitModule> {
  const module = (await initRDKitModule({ locateFile })) as unknown as RdkitModule
  module.prefer_coordgen(true)
  return module
}

function isNodeRuntime(): boolean {
  if (import.meta.env?.MODE === "test") return true
  const runtime = globalThis as { process?: { versions?: { node?: string } } }
  return Boolean(runtime.process?.versions?.node)
}

async function resolveNodeWasmPath(): Promise<string> {
  const moduleName = "node:module"
  const nodeModule = (await import(/* @vite-ignore */ moduleName)) as NodeModuleApi
  return nodeModule.createRequire(import.meta.url).resolve("@rdkit/rdkit/RDKit_minimal.wasm")
}

function readMoleculeJson(mol: Mol): RdkitJsonMolecule {
  const parsed = JSON.parse(mol.get_json()) as RdkitJson
  const molecule = parsed.molecules?.[0]
  if (!molecule) throw new Error("RDKit molecule JSON contained no molecule")
  return molecule
}

function pickConformer(molecule: RdkitJsonMolecule): RdkitJsonConformer | undefined {
  return (
    molecule.conformers?.find((conformer) => (conformer.dim ?? 2) === 2) ?? molecule.conformers?.[0]
  )
}

function normalizeBondOrder(order: number | "A" | undefined): 1 | 1.5 | 2 | 3 {
  if (order === "A" || order === 1.5) return 1.5
  if (order === 2) return 2
  if (order === 3) return 3
  return 1
}

function findRings(atoms: MolAtomSnapshot[], bonds: MolBondSnapshot[]): MolRingSnapshot[] {
  const adjacency: number[][] = atoms.map(() => [])
  for (const bond of bonds) {
    adjacency[bond.beginIdx].push(bond.endIdx)
    adjacency[bond.endIdx].push(bond.beginIdx)
  }

  const seen = new Set<string>()
  const rings: MolRingSnapshot[] = []

  for (let start = 0; start < atoms.length; start++) {
    const path = [start]
    const visited = new Set([start])

    const walk = (node: number) => {
      if (path.length >= 6) {
        if (adjacency[node].includes(start) && path.length >= 5) {
          recordRing(path)
        }
        return
      }
      for (const next of adjacency[node]) {
        if (next === start) {
          if (path.length >= 5) recordRing(path)
          continue
        }
        if (next < start || visited.has(next)) continue
        visited.add(next)
        path.push(next)
        walk(next)
        path.pop()
        visited.delete(next)
      }
    }

    const recordRing = (members: number[]) => {
      const key = [...members].sort((a, b) => a - b).join(",")
      if (seen.has(key)) return
      seen.add(key)
      const center = members.reduce(
        (acc, idx) => {
          acc.x += atoms[idx].pos.x
          acc.y += atoms[idx].pos.y
          return acc
        },
        { x: 0, y: 0 },
      )
      rings.push({
        members: [...members],
        center: { x: center.x / members.length, y: center.y / members.length },
      })
    }

    walk(start)
  }

  return rings
}

function formatCoordinate(value: number): string {
  const text = Object.is(value, -0) ? "-0.0000" : value.toFixed(4)
  if (text.length > 10) {
    throw new Error(`Coordinate ${text} does not fit in a V2000 field`)
  }
  return text.padStart(10, " ")
}

const ELEMENT_SYMBOLS: Record<number, string> = {
  1: "H",
  2: "He",
  3: "Li",
  4: "Be",
  5: "B",
  6: "C",
  7: "N",
  8: "O",
  9: "F",
  10: "Ne",
  11: "Na",
  12: "Mg",
  13: "Al",
  14: "Si",
  15: "P",
  16: "S",
  17: "Cl",
  18: "Ar",
  19: "K",
  20: "Ca",
  24: "Cr",
  25: "Mn",
  26: "Fe",
  27: "Co",
  28: "Ni",
  29: "Cu",
  30: "Zn",
  33: "As",
  34: "Se",
  35: "Br",
  42: "Mo",
  53: "I",
  78: "Pt",
}

function elementSymbol(z: number): string {
  return ELEMENT_SYMBOLS[z] ?? `#${z}`
}
