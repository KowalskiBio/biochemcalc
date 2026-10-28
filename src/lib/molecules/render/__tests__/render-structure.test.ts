// @vitest-environment jsdom
// Phase 3 truth battery for the RDKit rendering facade: fixed-size output,
// orientation/mirror, the ported Haworth SVG post-passes and the isolated
// metal coordination pass. Geometry is read from path/points attributes only
// (jsdom has no getBBox), the same way the production helpers do.

import { beforeAll, describe, expect, it } from "vitest"
import {
  ATOM_COLOR_NEUTRAL,
  ATOM_COLOR_NEUTRAL_DARK,
  ATOM_COLOR_NITROGEN,
  ATOM_COLOR_OXYGEN,
  ATOM_COLOR_PHOSPHORUS,
  ATOM_COLOR_SULFUR,
  RDKIT_DEFAULT_ATOM_COLORS,
} from "@/lib/molecules/render/atom-palette"
import { ensureRdkit, parseMol, snapshotFromMol } from "@/lib/molecules/render/rdkit-engine"
import {
  type RenderedStructure,
  type RenderStructureOptions,
  renderStructure,
} from "@/lib/molecules/render/render-structure"
import {
  findIsolatedMetal,
  findMacrocycleNitrogens,
  glyphCenter,
} from "@/lib/molecules/render/svg-post"

beforeAll(async () => {
  await ensureRdkit()
})

const TRUE_BETA_GLUCOSE = "C([C@@H]1[C@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O"
const CANDIDATE_BETA_GALACTOSE = "C([C@@H]1[C@@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O"
const ALANINE = "N[C@@H](C)C(=O)O"
const CYSTEINE = "C([C@@H](C(=O)O)N)S"
const AMP = "NC1=NC=NC2=C1N=CN2[C@@H]3O[C@H](COP(=O)(O)O)[C@@H](O)[C@H]3O"
const SUCROSE =
  "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@]2([C@H]([C@@H]([C@H](O2)CO)O)O)CO)O)O)O)O"
const ADENOSINE = "NC1=NC=NC2=C1N=CN2[C@@H]3O[C@H](CO)[C@@H](O)[C@H]3O"
const HEME =
  "CC1=C(C2=CC3=NC(=CC4=C(C(=C([N-]4)C=C5C(=C(C(=N5)C=C1[N-]2)C)C=C)C)C=C)C(=C3CCC(=O)O)C)CCC(=O)O.[Fe+2]"
const B12 = String.raw`CC1=CC2=C(C=C1C)[N+](=CN2)[C@@H]3[C@@H]([C@@H]([C@H](O3)CO)OP(=O)(O)O[C@H](C)CNC(=O)CC[C@@]4([C@H]([C@@H]5[C@]6([C@@]([C@@H](C(=N6)/C(=C\7/[C@@]([C@@H](/C(=C/C8=N/C(=C(\C4=N5)/C)/[C@H](C8(C)C)CCC(=N)[O-])/N7)CCC(=N)[O-])(C)CC(=O)N)/C)CCC(=N)[O-])(C)CC(=O)N)C)CC(=O)N)C)O.[C]#N.[Co+2]`
const BILIRUBIN =
  "CC1=C(C(=C(N1)C=C2C(=C(C(=O)N2)C)C=CC3=C(C(=C(N3)C=C4C(=C(C(=O)N4)C)C)CCC(=O)O)CCC(=O)O)CCC(=O)O)"
const BROKEN_CHLOROPHYLL =
  "CCC1=C(C2=Cc3c(c(c4n3[Mg]56[N]2=C1C=C7N5C8=C(C(C(=O)C8=C7C)C(=O)OC)C9=[N]6C(=C4)C(C9CCC(=O)OCC=C(C)CCCC(C)CCCC(C)CCCC(C)C)C)C=C)C"
const CHOLESTEROL =
  "C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C"
const CHLOROPHYLL_PUBCHEM = String.raw`CCC1=C(C2=NC1=CC3=C(C4=C([N-]3)C(=C5[C@H]([C@@H](C(=N5)C=C6C(=C(C(=C2)[N-]6)C=C)C)C)CCC(=O)OC/C=C(\C)/CCC[C@H](C)CCC[C@H](C)CCCC(C)C)[C@H](C4=O)C(=O)OC)C)C.[Mg+2]`

function render(
  smiles: string,
  overrides: Partial<RenderStructureOptions> = {},
): RenderedStructure {
  const result = renderStructure(smiles, {
    width: 160,
    height: 160,
    theme: "light",
    bondLength: 24,
    ...overrides,
  })
  if (result === null) {
    throw new Error(`renderStructure returned null for ${smiles}`)
  }
  return result
}

type Vec = { x: number; y: number }

function classTokens(element: Element): string[] {
  return (element.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean)
}

function numericCoordinates(data: string): number[] {
  const matches = data.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  return matches === null ? [] : matches.map(Number)
}

interface Extent {
  min: number
  max: number
}

function pathExtent(path: Element, axis: 0 | 1): Extent | null {
  const numbers = numericCoordinates(path.getAttribute("d") ?? "")
  if (numbers.length < 2) return null
  const transform = path.getAttribute("transform") ?? ""
  let offset = 0
  for (const match of transform.matchAll(/translate\(\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*\)/g)) {
    offset += axis === 0 ? Number(match[1]) : Number(match[2])
  }
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let index = axis; index < numbers.length; index += 2) {
    const value = numbers[index] + offset
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return { min, max }
}

function glyphPaths(svg: Element, atom: number): Element[] {
  return Array.from(svg.querySelectorAll("path")).filter((path) => {
    const tokens = classTokens(path)
    return tokens.includes(`atom-${atom}`) && !tokens.some((token) => token.startsWith("bond-"))
  })
}

interface HydroxylGlyphs {
  atom: number
  oxygen: Extent
  hydrogen: Extent
  flipped: boolean
  gap: number
}

function hydroxylGlyphs(svg: Element): HydroxylGlyphs[] {
  const atoms = new Set<number>()
  for (const path of Array.from(svg.querySelectorAll("path"))) {
    const tokens = classTokens(path)
    for (const token of tokens) {
      if (token.startsWith("atom-") && !tokens.some((entry) => entry.startsWith("bond-"))) {
        atoms.add(Number.parseInt(token.slice("atom-".length), 10))
      }
    }
  }
  const hydroxyls: HydroxylGlyphs[] = []
  for (const atom of atoms) {
    const paths = glyphPaths(svg, atom)
    if (paths.length !== 2) continue
    const oxygen = pathExtent(paths[0], 0)
    const hydrogen = pathExtent(paths[1], 0)
    if (oxygen === null || hydrogen === null) continue
    const flipped = hydrogen.max <= oxygen.min
    hydroxyls.push({
      atom,
      oxygen,
      hydrogen,
      flipped,
      gap: flipped ? oxygen.min - hydrogen.max : hydrogen.min - oxygen.max,
    })
  }
  return hydroxyls
}

interface GraphCounts {
  atoms: number
  bonds: number
}

function graphCounts(svg: Element): GraphCounts {
  const atoms = new Set<string>()
  const bonds = new Set<string>()
  for (const path of Array.from(svg.querySelectorAll("path"))) {
    const tokens = classTokens(path)
    for (const token of tokens) {
      if (token.startsWith("atom-")) atoms.add(token)
      if (token.startsWith("bond-")) bonds.add(token)
    }
  }
  return { atoms: atoms.size, bonds: bonds.size }
}

function bondGeometry(svg: Element): string[] {
  return Array.from(svg.querySelectorAll("path"))
    .filter((path) => classTokens(path).some((token) => token.startsWith("bond-")))
    .map((path) => path.getAttribute("d") ?? "")
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/**
 * Lengths of the drawn bond segments, in SVG user units (pixels here).
 * Hashed stereobonds are drawn as a pile of tiny dash segments that carry the
 * same `bond-N` class, so only segments close to the longest one count.
 */
function drawnBondLengths(svg: Element): number[] {
  const lengths: number[] = []
  for (const data of bondGeometry(svg)) {
    const match = /M\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/.exec(data)
    if (match === null) continue
    const length = Math.hypot(
      Number(match[3]) - Number(match[1]),
      Number(match[4]) - Number(match[2]),
    )
    if (length > 1e-6) lengths.push(length)
  }
  if (lengths.length === 0) return []
  const longest = Math.max(...lengths)
  return lengths.filter((length) => length >= 0.5 * longest)
}

function drawnWidth(svg: Element): number {
  return Number.parseFloat(svg.getAttribute("width") ?? "")
}

interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

function viewBoxOf(svg: Element): ViewBox {
  const [x, y, width, height] = (svg.getAttribute("viewBox") ?? "").trim().split(/\s+/).map(Number)
  return { x, y, width, height }
}

function contentExtent(svg: Element, axis: 0 | 1): Extent | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const path of Array.from(svg.querySelectorAll("path"))) {
    const extent = pathExtent(path, axis)
    if (extent === null) continue
    min = Math.min(min, extent.min)
    max = Math.max(max, extent.max)
  }
  for (const polygon of Array.from(svg.querySelectorAll("polygon"))) {
    const numbers = numericCoordinates(polygon.getAttribute("points") ?? "")
    for (let index = axis; index < numbers.length; index += 2) {
      min = Math.min(min, numbers[index])
      max = Math.max(max, numbers[index])
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null
}

function expectInsideCanvas(svg: Element): void {
  const viewBox = viewBoxOf(svg)
  const x = contentExtent(svg, 0)
  const y = contentExtent(svg, 1)
  expect(x).not.toBeNull()
  expect(y).not.toBeNull()
  if (x === null || y === null) return
  expect(x.min).toBeGreaterThanOrEqual(viewBox.x - 0.5)
  expect(y.min).toBeGreaterThanOrEqual(viewBox.y - 0.5)
  expect(x.max).toBeLessThanOrEqual(viewBox.x + viewBox.width + 0.5)
  expect(y.max).toBeLessThanOrEqual(viewBox.y + viewBox.height + 0.5)
}

/** Stable 32-bit FNV-1a digest; enough to pin byte-identical markup. */
function digest(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

interface Quad {
  vertices: Vec[]
  halfThicknessA: number
  halfThicknessB: number
  outwardMidpoint: Vec
  innerMidpoint: Vec
}

/**
 * The welded outline of one ring's front edge: outer cap at role0, the two
 * outer miters at the shared front carbons, outer cap at role3, then the
 * mirrored inner line back. Eight points per polygon.
 */
function quadsOf(svg: Element): Quad[] {
  return Array.from(svg.querySelectorAll("polygon.haworth-front-edge")).map((polygon) => {
    const numbers = numericCoordinates(polygon.getAttribute("points") ?? "")
    if (numbers.length !== 16) {
      throw new Error(`malformed haworth-front-edge polygon: ${numbers.length / 2} points`)
    }
    const vertices = Array.from({ length: 8 }, (_, index) => ({
      x: numbers[index * 2],
      y: numbers[index * 2 + 1],
    }))
    const [
      outerCapStart,
      outerMiter1,
      outerMiter2,
      outerCapEnd,
      innerCapEnd,
      innerMiter2,
      innerMiter1,
      innerCapStart,
    ] = vertices
    return {
      vertices,
      halfThicknessA: distance(outerCapStart, innerCapStart) / 2,
      halfThicknessB: distance(outerCapEnd, innerCapEnd) / 2,
      outwardMidpoint: {
        x: (outerMiter1.x + outerMiter2.x) / 2,
        y: (outerMiter1.y + outerMiter2.y) / 2,
      },
      innerMidpoint: {
        x: (innerMiter1.x + innerMiter2.x) / 2,
        y: (innerMiter1.y + innerMiter2.y) / 2,
      },
    }
  })
}

function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function centroidOf(points: Vec[]): Vec {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

function snapshotOf(smiles: string) {
  const mol = parseMol(smiles)
  if (mol === null) {
    throw new Error(`cannot parse ${smiles}`)
  }
  try {
    mol.set_new_coords(true)
    return snapshotFromMol(mol)
  } finally {
    mol.delete()
  }
}

describe("Fischer projections", () => {
  const OPEN_GLUCOSE = "C([C@H]([C@H]([C@@H]([C@H](C=O)O)O)O)O)O"
  const OPEN_FRUCTOSE = "O=C(CO)[C@@H](O)[C@H](O)[C@H](O)CO"

  function textsOf(svg: SVGSVGElement): string[] {
    return Array.from(svg.querySelectorAll("text"), (node) => node.textContent ?? "")
  }

  it("renders an open-chain aldose as a Fischer projection", () => {
    const { svg, recognized } = render(OPEN_GLUCOSE)
    expect(recognized).toBe("fischer")
    const texts = textsOf(svg)
    // Terminal labels are decomposed into per-letter runs; never a whole word.
    for (const whole of ["CHO", "CH2OH", "C=O", "="]) {
      expect(texts.some((text) => text.includes(whole))).toBe(false)
    }
    expect(texts.filter((text) => text === "C")).toHaveLength(2)
    expect(texts.filter((text) => text === "2")).toHaveLength(1)
    expect(texts.filter((text) => text === "O").length).toBeGreaterThan(0)
    // At least one oxygen takes the app atom palette's oxygen red.
    const oxygens = Array.from(svg.querySelectorAll("text")).filter(
      (node) => node.textContent === "O",
    )
    expect(oxygens.some((node) => node.getAttribute("fill") === ATOM_COLOR_OXYGEN)).toBe(true)
  })

  it("raises letters onto their bond's vertical midline (optical offset used by everything else)", () => {
    const { svg } = render(OPEN_GLUCOSE)
    // dy = −0.1 · font-size per letter class: cap letters get −1.60 at the
    // 16 px base size, the subscript "2" gets −1.20 at its 12 px size — the
    // ink's optical midpoint then lines up with the horizontal bond instead of
    // hanging slightly below it as plain `dominant-baseline: central` leaves it.
    const capLetters = Array.from(svg.querySelectorAll("text")).filter(
      (node) => node.textContent === "O" || node.textContent === "H" || node.textContent === "C",
    )
    expect(capLetters.length).toBeGreaterThan(0)
    for (const node of capLetters) {
      const dy = Number(node.getAttribute("dy"))
      expect(Math.abs(dy + 1.6), "dy ≈ −0.1 × 16").toBeLessThan(0.001)
    }
    const subscript = Array.from(svg.querySelectorAll("text")).find(
      (node) => node.textContent === "2",
    )
    expect(Math.abs(Number(subscript?.getAttribute("dy")) + 1.2)).toBeLessThan(0.001)
  })

  it("suppresses the Fischer projection when fischer is false", () => {
    const { svg, recognized } = render(OPEN_GLUCOSE, { fischer: false })
    expect(recognized).toBe(false)
    expect(textsOf(svg)).not.toContain("CHO")
  })

  it("renders an open-chain ketose with a real double bond, never '='", () => {
    const { svg, recognized } = render(OPEN_FRUCTOSE)
    expect(recognized).toBe("fischer")
    const texts = textsOf(svg)
    expect(texts).not.toContain("CHO")
    expect(texts.some((text) => text.includes("="))).toBe(false)
    expect(texts.filter((text) => text === "2")).toHaveLength(2)
    const oxygens = Array.from(svg.querySelectorAll("text")).filter(
      (node) => node.textContent === "O",
    )
    // The ketone's oxygen is red and sits right of the spine.
    const verticalXValues = Array.from(svg.querySelectorAll("line"))
      .filter((line) => Number(line.getAttribute("x1")) === Number(line.getAttribute("x2")))
      .map((line) => Number(line.getAttribute("x1")))
    const spineXs = new Set(verticalXValues)
    expect(spineXs.size).toBe(1)
    const spineX = verticalXValues[0]
    const rightOxygen = oxygens.find((node) => Number(node.getAttribute("x")) > spineX + 20)
    expect(rightOxygen?.getAttribute("fill")).toBe(ATOM_COLOR_OXYGEN)
  })

  it("keeps cyclic sugars on the Haworth path (mutual exclusion)", () => {
    const { svg, recognized } = render(TRUE_BETA_GLUCOSE)
    expect(recognized).toBe("haworth")
    expect(textsOf(svg)).not.toContain("CHO")
  })

  it("never inflates non-sugars into a Fischer projection", () => {
    const { svg, recognized } = render(ALANINE)
    expect(recognized).toBe(false)
    expect(textsOf(svg)).not.toContain("CHO")
  })
})

describe("renderStructure", () => {
  it("draws into a fixed-size, transparent host", () => {
    const { svg, recognized } = render(ALANINE)
    expect(recognized).toBe(false)
    expect(svg.getAttribute("viewBox")).toBe("0 0 160 160")
    expect(svg.getAttribute("width")).toBe("160px")
    expect(svg.getAttribute("height")).toBe("160px")
    expect(svg.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg")
    expect(svg.querySelector("rect")).toBeNull()
  })

  it("rotates a skeletal depiction without changing the graph", () => {
    const base = render(ALANINE)
    const rotated = render(ALANINE, { orientationDeg: 90 })
    expect(bondGeometry(rotated.svg)).not.toEqual(bondGeometry(base.svg))
    expect(graphCounts(rotated.svg)).toEqual(graphCounts(base.svg))
  })

  it("mirrors a skeletal depiction", () => {
    const base = render(ALANINE)
    const mirrored = render(ALANINE, { mirror: true })
    expect(bondGeometry(mirrored.svg)).not.toEqual(bondGeometry(base.svg))
    expect(graphCounts(mirrored.svg)).toEqual(graphCounts(base.svg))
  })

  it("returns null for an unparseable SMILES", () => {
    expect(
      renderStructure(BROKEN_CHLOROPHYLL, { width: 160, height: 160, theme: "light" }),
    ).toBeNull()
    expect(renderStructure("C(C(", { width: 160, height: 160, theme: "light" })).toBeNull()
  })
})

describe("Haworth HO labels", () => {
  function expectOneHoFlip(smiles: string): void {
    const { svg, recognized } = render(smiles)
    expect(recognized).toBe("haworth")
    const hydroxyls = hydroxylGlyphs(svg)
    const flipped = hydroxyls.filter((hydroxyl) => hydroxyl.flipped)
    expect(flipped).toHaveLength(1)
    const unflipped = hydroxyls.filter((hydroxyl) => !hydroxyl.flipped)
    expect(unflipped.length).toBeGreaterThan(0)
    // The H glyph keeps RDKit's own inter-glyph gap while its right edge moves
    // left of the O glyph; the O glyph (the bond anchor) never moves.
    const reference = unflipped[0].gap
    expect(Math.abs(flipped[0].gap - reference)).toBeLessThanOrEqual(0.6)
    expect(flipped[0].gap).toBeGreaterThan(0)
  }

  it("flips the left ring-edge hydroxyl of beta-D-glucose", () => {
    expectOneHoFlip(TRUE_BETA_GLUCOSE)
  })

  it("flips the left ring-edge hydroxyl of beta-D-galactose", () => {
    expectOneHoFlip(CANDIDATE_BETA_GALACTOSE)
  })

  it("leaves non-sugar hydroxyls alone (alanine)", () => {
    const { svg, recognized } = render(ALANINE)
    expect(recognized).toBe(false)
    expect(hydroxylGlyphs(svg).filter((hydroxyl) => hydroxyl.flipped)).toHaveLength(0)
  })
})

describe("Haworth bold front edges", () => {
  it("skips recognition and front edges when haworth is false", () => {
    const defaultRender = render(TRUE_BETA_GLUCOSE)
    expect(defaultRender.recognized).toBe("haworth")
    expect(defaultRender.svg.querySelectorAll("polygon.haworth-front-edge")).toHaveLength(1)

    const skeletal = render(TRUE_BETA_GLUCOSE, { haworth: false })
    expect(skeletal.recognized).toBe(false)
    expect(skeletal.svg.querySelectorAll("polygon.haworth-front-edge")).toHaveLength(0)
  })

  it("draws one welded, outline — no seam between the front carbons", () => {
    const { svg } = render(TRUE_BETA_GLUCOSE)
    const quads = quadsOf(svg)
    expect(quads).toHaveLength(1)
    const outline = quads[0]

    // Endpoint caps keep their thick tapers from the quad form: role0 ends
    // 1.1 wide, role3 ends 1.1 wide (full-width measured corner-to-corner).
    const close = (actual: number, expected: number): void => {
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.3)
    }
    close(outline.halfThicknessA, 1.1)
    close(outline.halfThicknessB, 1.1)

    // Weld continuity: near the two shared front carbons there is exactly one
    // outline corner per side (the offset-miter join) — earlier each segment
    // ended at its own vertex and a wedge opened between quads.
    const outerMiters = [outline.vertices[1], outline.vertices[2]]
    const innerMiters = [outline.vertices[5], outline.vertices[6]]
    expect(outerMiters).toHaveLength(2)
    expect(innerMiters).toHaveLength(2)
    const centroid = centroidOf(outline.vertices)
    for (const corner of outerMiters) {
      expect(distance(corner, centroid)).toBeGreaterThan(0.01)
    }

    // Ring-end micro-joints: cap ends joined onto the neighbouring thin ring
    // edges (C1–ring-O and C4–next-carbon), clamped so they can't overshoot.
    // The regression pinning their exact geometry is the byte digest above;
    // here we assert the front band remains a single bounded, non-degenerate
    // outline with a real joint point at each end (never a NaN elsewhere).
    expect(Number.isFinite(outline.vertices[0].x)).toBe(true)
    expect(Number.isFinite(outline.vertices[3].x)).toBe(true)
    expect(Number.isFinite(outline.vertices[0].y)).toBe(true)
    expect(Number.isFinite(outline.vertices[3].y)).toBe(true)

    // Junction seals: each ring end is a three-way stroke junction (band +
    // thin ring bond + hydroxyl bond) sealed by a round dot at the vertex.
    const caps = Array.from(svg.querySelectorAll("circle.haworth-front-cap"))
    expect(caps).toHaveLength(2)
    for (const [outer, inner] of [
      [outline.vertices[0], outline.vertices[7]],
      [outline.vertices[3], outline.vertices[4]],
    ] as const) {
      // The cap midpoint is the ring vertex itself (cap passes through it).
      const vertex = { x: (outer.x + inner.x) / 2, y: (outer.y + inner.y) / 2 }
      const cap = caps.find(
        (element) =>
          distance(
            { x: Number(element.getAttribute("cx")), y: Number(element.getAttribute("cy")) },
            vertex,
          ) <= 0.5,
      )
      expect(cap !== undefined).toBe(true)
      if (cap === undefined) continue
      const radius = Number(cap.getAttribute("r"))
      // Round-cap range: band half-thickness 1.1 up to the joint clamp 1.6 × 1.1.
      expect(radius).toBeGreaterThanOrEqual(1.09)
      expect(radius).toBeLessThanOrEqual(1.78)
    }
  })

  it("welds both sucrose rings into continuous outlines flaring outward-down", () => {
    const { svg } = render(SUCROSE)
    const quads = quadsOf(svg)
    expect(quads).toHaveLength(2)
    expect(svg.querySelectorAll("circle.haworth-front-cap")).toHaveLength(4)
    for (const outline of quads) {
      // Flare direction: each outline's outer cusps (miters) sit beyond the
      // inner side on the outward-down axis from the ring's own geometry —
      // the same outward normal that used to expand each quad.
      const outerCusps = [outline.vertices[1], outline.vertices[2]]
      const innerCusps = [outline.vertices[5], outline.vertices[6]]
      const outerY = Math.min(...outerCusps.map((point) => point.y))
      const innerY = Math.min(...innerCusps.map((point) => point.y))
      expect(outerY).toBeGreaterThanOrEqual(innerY)
      expect(distance(outline.outwardMidpoint, outline.innerMidpoint)).toBeGreaterThan(1)
    }
  })

  it("adds front edges to the adenosine furanose without touching the base", () => {
    const { svg, recognized } = render(ADENOSINE)
    expect(recognized).toBe("haworth")
    expect(svg.querySelectorAll("polygon.haworth-front-edge")).toHaveLength(1)
    expect(svg.querySelectorAll("polygon")).toHaveLength(1)
    expect(svg.querySelectorAll("circle.haworth-front-cap")).toHaveLength(2)
  })
})

describe("atom glyph z-order", () => {
  it("draws atom letters above every bond line and decoration", () => {
    const isConstruction = (element: Element): boolean => {
      const tokens = (element.getAttribute("class") ?? "").split(/\s+/)
      if (tokens.some((token) => token.startsWith("bond-"))) return true
      if (
        tokens.includes("haworth-front-edge") ||
        tokens.includes("haworth-front-cap") ||
        tokens.includes("porphyrin-coordination")
      ) {
        return true
      }
      // Classless paths are unlabeled line art (RDKit's wedge/hashed stereo
      // strokes carry no class); letters always carry an atom-N token.
      return element.localName === "path" && !tokens.some((token) => token.startsWith("atom-"))
    }
    const isLetter = (element: Element): boolean => {
      if (element.localName !== "path") return false
      const tokens = (element.getAttribute("class") ?? "").split(/\s+/)
      return tokens.some((token) => token.startsWith("atom-")) && !isConstruction(element)
    }
    for (const smiles of [TRUE_BETA_GLUCOSE, CHOLESTEROL, CHLOROPHYLL_PUBCHEM]) {
      const children = Array.from(render(smiles).svg.children)
      const letterIndices = children
        .map((element, index) => (isLetter(element) ? index : -1))
        .filter((index) => index >= 0)
      const deepestConstruction = Math.max(
        -1,
        ...children.map((element, index) => (isConstruction(element) ? index : -1)),
      )
      expect(letterIndices.length).toBeGreaterThan(0)
      for (const letterIndex of letterIndices) {
        expect(letterIndex, `${smiles}: letters paint after all construction`).toBeGreaterThan(
          deepestConstruction,
        )
      }
      // No letter may end up buried between construction layers either.
      const trailing = children.slice(deepestConstruction + 1)
      expect(
        trailing.every(isLetter),
        `${smiles}: trailing non-letter wall after deepest construction: ${trailing
          .map((element) => `${element.localName}.${element.getAttribute("class") ?? ""}`)
          .join("|")}`,
      ).toBe(true)
    }
  })
})

describe("isolated-metal coordination", () => {
  it("centres heme iron on the four pyrrole nitrogens and draws four lines", () => {
    const { svg } = render(HEME)
    const lines = Array.from(svg.querySelectorAll("line.porphyrin-coordination"))
    expect(lines).toHaveLength(4)

    const snapshot = snapshotOf(HEME)
    const nitrogens = findMacrocycleNitrogens(snapshot)
    const metal = findIsolatedMetal(snapshot)
    expect(nitrogens).not.toBeNull()
    expect(metal).not.toBeNull()
    if (nitrogens === null || metal === null) return
    const nitrogenCenters = nitrogens.map((atom) => {
      const center = glyphCenter(svg, atom)
      if (center === null) throw new Error(`missing N glyph ${atom}`)
      return center
    })
    const expected = centroidOf(nitrogenCenters)
    const actual = glyphCenter(svg, metal)
    expect(actual).not.toBeNull()
    if (actual === null) return
    expect(distance(actual, expected)).toBeLessThanOrEqual(2)
  })

  it("draws four coordination lines on vitamin B12 and none on bilirubin", () => {
    expect(render(B12).svg.querySelectorAll("line.porphyrin-coordination")).toHaveLength(4)
    expect(render(BILIRUBIN).svg.querySelectorAll("line.porphyrin-coordination")).toHaveLength(0)
  })

  it("centres chlorophyll magnesium and draws four lines despite the annelated ring E", () => {
    const { svg } = render(CHLOROPHYLL_PUBCHEM)
    const lines = Array.from(svg.querySelectorAll("line.porphyrin-coordination"))
    expect(lines).toHaveLength(4)

    const snapshot = snapshotOf(CHLOROPHYLL_PUBCHEM)
    const nitrogens = findMacrocycleNitrogens(snapshot)
    const metal = findIsolatedMetal(snapshot)
    expect(nitrogens).not.toBeNull()
    expect(metal).not.toBeNull()
    if (nitrogens === null || metal === null) return
    const nitrogenCenters = nitrogens.map((atom) => {
      const center = glyphCenter(svg, atom)
      if (center === null) throw new Error(`missing N glyph ${atom}`)
      return center
    })
    const expected = centroidOf(nitrogenCenters)
    const actual = glyphCenter(svg, metal)
    expect(actual).not.toBeNull()
    if (actual === null) return
    expect(distance(actual, expected)).toBeLessThanOrEqual(2)
  })
})

describe("natural-size rendering", () => {
  it("keeps fixed-size output byte-identical to the pre-change pipeline", () => {
    // Digests recorded from the fixed-size path before natural sizing existed.
    // The opt-in flag must not disturb grids, previews or option lists.
    // Chlorophyll's digest was re-recorded after the annelated-ring fix
    // centred its Mg and added the four coordination lines; all three were
    // re-recorded when the atom-palette remap recoloured the heteroatoms, and
    // again when the neutral ink moved to the theme's paper tones.
    // digest was re-recorded when the three front-edge quads welded into one
    // mitered outline, then again when the cap ends became micro-joints at the
    // neighbouring thin ring edges on BOTH sides (C1/C4 of hexose; pentoses),
    // and again when round junction seals closed each ring end (band + thin
    // ring bond + hydroxyl bond meet there — a three-way stroke junction).
    // All three re-recorded once more when atom letters were raised to the
    // top z-layer so construction strokes can never paint over a glyph.
    const golden: Record<string, string> = {
      cholesterol: "6f8480a5",
      chlorophyll: "8a1ceabe",
      glucose: "cb50ca23",
    }
    expect(digest(render(CHOLESTEROL, { natural: false }).svg.outerHTML)).toBe(golden.cholesterol)
    expect(digest(render(CHLOROPHYLL_PUBCHEM, { natural: false }).svg.outerHTML)).toBe(
      golden.chlorophyll,
    )
    expect(digest(render(TRUE_BETA_GLUCOSE, { natural: false }).svg.outerHTML)).toBe(golden.glucose)
    // The explicit false and the omitted default are the same code path.
    expect(render(CHOLESTEROL).svg.outerHTML).toBe(
      render(CHOLESTEROL, { natural: false }).svg.outerHTML,
    )
  })

  it("draws large molecules at natural size instead of shrinking into the box", () => {
    for (const smiles of [CHOLESTEROL, CHLOROPHYLL_PUBCHEM]) {
      expect(drawnWidth(render(smiles, { natural: false }).svg)).toBe(160)
      const natural = render(smiles, { natural: true }).svg
      expect(drawnWidth(natural)).toBeGreaterThan(300)
      expectInsideCanvas(natural)
    }
  })

  it("keeps a constant ~24 px bond length for small and large molecules", () => {
    for (const smiles of [CHOLESTEROL, CHLOROPHYLL_PUBCHEM, TRUE_BETA_GLUCOSE]) {
      const lengths = drawnBondLengths(render(smiles, { natural: true }).svg)
      expect(lengths.length).toBeGreaterThan(0)
      const typical = median(lengths)
      expect(typical).toBeGreaterThanOrEqual(21)
      expect(typical).toBeLessThanOrEqual(27)
    }
  })

  it("keeps the Haworth overlays and the drawing inside the natural canvas", () => {
    const { svg, recognized } = render(TRUE_BETA_GLUCOSE, { natural: true })
    expect(recognized).toBe("haworth")
    expect(svg.querySelectorAll("polygon.haworth-front-edge")).toHaveLength(1)
    expectInsideCanvas(svg)
  })

  it("swaps the natural canvas dimensions for a 90 degree rotation", () => {
    const upright = viewBoxOf(render(CHOLESTEROL, { natural: true }).svg)
    const rotated = viewBoxOf(render(CHOLESTEROL, { natural: true, orientationDeg: 90 }).svg)
    expect(Math.abs(rotated.width - upright.height) / upright.height).toBeLessThan(0.1)
    expect(Math.abs(rotated.height - upright.width) / upright.width).toBeLessThan(0.1)
  })
})

describe("theme", () => {
  it("swaps the neutral ink for the dark one in dark mode", () => {
    const { svg } = render(TRUE_BETA_GLUCOSE, { theme: "dark" })
    for (const element of Array.from(svg.querySelectorAll("*"))) {
      for (const attribute of ["fill", "stroke", "style"]) {
        const value = element.getAttribute(attribute)
        if (value !== null) {
          expect(value.toLowerCase()).not.toContain(ATOM_COLOR_NEUTRAL.toLowerCase())
        }
      }
    }
    expect(svg.outerHTML.toLowerCase()).toContain(ATOM_COLOR_NEUTRAL_DARK.toLowerCase())
  })

  it("recolours heteroatoms to the app palette in both themes, with no RDKit hex left", () => {
    // Glucose covers oxygen, alanine adds nitrogen, cysteine adds sulfur,
    // AMP adds phosphorus. The theme never re-tints the palette — like the
    // calculations variable accents, the same hexes serve light and dark.
    const cases: [name: string, smiles: string, accent: string][] = [
      ["glucose", TRUE_BETA_GLUCOSE, ATOM_COLOR_OXYGEN],
      ["alanine", ALANINE, ATOM_COLOR_NITROGEN],
      ["cysteine", CYSTEINE, ATOM_COLOR_SULFUR],
      ["amp", AMP, ATOM_COLOR_PHOSPHORUS],
    ]
    const legacy = Object.keys(RDKIT_DEFAULT_ATOM_COLORS)
    for (const [name, smiles, accent] of cases) {
      for (const theme of ["light", "dark"] as const) {
        const markup = render(smiles, { theme }).svg.outerHTML.toLowerCase()
        expect(markup, `${name} (${theme}) carries its accent`).toContain(accent.toLowerCase())
        for (const hex of legacy) {
          expect(markup, `${name} (${theme}) drops RDKit's ${hex}`).not.toContain(hex.toLowerCase())
        }
      }
    }
  })
})

describe("monochrome", () => {
  it("draws the whole structure — bonds and labels — in the single theme ink", () => {
    // Mistr's quiz prompt hides the atom colour coding, so alanine's
    // nitrogen and oxygen crush to the neutral ink along with the bonds,
    // and nothing of the palette (or the other theme's ink) survives.
    const cases: [theme: "light" | "dark", ink: string][] = [
      ["light", ATOM_COLOR_NEUTRAL],
      ["dark", ATOM_COLOR_NEUTRAL_DARK],
    ]
    const hidden = Object.values(RDKIT_DEFAULT_ATOM_COLORS).concat(
      ATOM_COLOR_NEUTRAL,
      ATOM_COLOR_NEUTRAL_DARK,
    )
    for (const [theme, ink] of cases) {
      const markup = render(ALANINE, { theme, monochrome: true }).svg.outerHTML.toLowerCase()
      expect(markup, `alanine monochrome (${theme}) uses the ink`).toContain(ink.toLowerCase())
      for (const colour of hidden) {
        if (colour === ink) continue
        expect(markup, `alanine monochrome (${theme}) hides ${colour}`).not.toContain(
          colour.toLowerCase(),
        )
      }
    }
  })
})
