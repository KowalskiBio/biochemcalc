// @vitest-environment jsdom
// Phase 3 truth battery for the RDKit rendering facade: fixed-size output,
// orientation/mirror, the ported Haworth SVG post-passes and the isolated
// metal coordination pass. Geometry is read from path/points attributes only
// (jsdom has no getBBox), the same way the production helpers do.

import { beforeAll, describe, expect, it } from "vitest"
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
  endA: Vec
  endB: Vec
  halfThicknessA: number
  halfThicknessB: number
  midpoint: Vec
  outwardMidpoint: Vec
  innerMidpoint: Vec
}

function quadsOf(svg: Element): Quad[] {
  return Array.from(svg.querySelectorAll("polygon.haworth-front-edge")).map((polygon) => {
    const numbers = numericCoordinates(polygon.getAttribute("points") ?? "")
    if (numbers.length !== 8) {
      throw new Error("malformed haworth-front-edge polygon")
    }
    const vertices = [0, 2, 4, 6].map((index) => ({
      x: numbers[index],
      y: numbers[index + 1],
    }))
    const [p0, p1, p2, p3] = vertices
    const endA = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 }
    const endB = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    return {
      vertices,
      endA,
      endB,
      halfThicknessA: Math.hypot(p0.x - p3.x, p0.y - p3.y) / 2,
      halfThicknessB: Math.hypot(p1.x - p2.x, p1.y - p2.y) / 2,
      midpoint: { x: (endA.x + endB.x) / 2, y: (endA.y + endB.y) / 2 },
      outwardMidpoint: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
      innerMidpoint: { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 },
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

/** Recover the four front ring roles from the three chained quads. */
function frontRingOf(quads: Quad[]): Vec[] {
  const first = quads[0]
  const second = quads[1]
  const third = quads[2]
  const between = (a: Quad, b: Quad): Vec => {
    const candidates = [a.endA, a.endB]
    return candidates.reduce((best, point) =>
      distance(point, b.endA) < distance(best, b.endA) ? point : best,
    )
  }
  return [first.endA, between(first, second), between(second, third), third.endB]
}

function expectFlaresOutward(quad: Quad, ringCenter: Vec, label: string): void {
  expect(distance(quad.outwardMidpoint, ringCenter), `${label}: flares outward`).toBeGreaterThan(
    distance(quad.innerMidpoint, ringCenter),
  )
  expect(quad.outwardMidpoint.y, `${label}: flares down (front side)`).toBeGreaterThan(
    quad.innerMidpoint.y,
  )
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
    // At least one oxygen takes the app's atom-red palette color.
    const oxygens = Array.from(svg.querySelectorAll("text")).filter(
      (node) => node.textContent === "O",
    )
    expect(oxygens.some((node) => node.getAttribute("fill") === "#FF0000")).toBe(true)
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
    expect(rightOxygen?.getAttribute("fill")).toBe("#FF0000")
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
    expect(defaultRender.svg.querySelectorAll("polygon.haworth-front-edge")).toHaveLength(3)

    const skeletal = render(TRUE_BETA_GLUCOSE, { haworth: false })
    expect(skeletal.recognized).toBe(false)
    expect(skeletal.svg.querySelectorAll("polygon.haworth-front-edge")).toHaveLength(0)
  })

  it("draws three graduated edges on beta-D-glucose", () => {
    const quads = quadsOf(render(TRUE_BETA_GLUCOSE).svg)
    expect(quads).toHaveLength(3)
    const close = (actual: number, expected: number): void => {
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.3)
    }
    close(quads[0].halfThicknessA, 1.1)
    close(quads[0].halfThicknessB, 2.2)
    close(quads[1].halfThicknessA, 2.2)
    close(quads[1].halfThicknessB, 2.2)
    close(quads[2].halfThicknessA, 2.2)
    close(quads[2].halfThicknessB, 1.1)

    const ringCenter = centroidOf(frontRingOf(quads))
    quads.forEach((quad, index) => {
      expectFlaresOutward(quad, ringCenter, `glucose edge ${index}`)
    })
  })

  it("draws three tapers on each sucrose ring, both flaring outward-down", () => {
    const quads = quadsOf(render(SUCROSE).svg)
    expect(quads).toHaveLength(6)
    // The two rings are disjoint: group quads by shared endpoints.
    const groups: Quad[][] = []
    for (const quad of quads) {
      const group = groups.find((candidate) =>
        candidate.some(
          (member) =>
            Math.min(
              distance(member.endA, quad.endA),
              distance(member.endA, quad.endB),
              distance(member.endB, quad.endA),
              distance(member.endB, quad.endB),
            ) < 0.5,
        ),
      )
      if (group === undefined) {
        groups.push([quad])
      } else {
        group.push(quad)
      }
    }
    expect(groups.map((group) => group.length)).toEqual([3, 3])
    for (const group of groups) {
      const center = centroidOf(frontRingOf(group))
      group.forEach((quad, index) => {
        expectFlaresOutward(quad, center, `sucrose ring edge ${index}`)
      })
    }
  })

  it("adds front edges to the adenosine furanose without touching the base", () => {
    const { svg, recognized } = render(ADENOSINE)
    expect(recognized).toBe("haworth")
    expect(svg.querySelectorAll("polygon.haworth-front-edge")).toHaveLength(3)
    expect(svg.querySelectorAll("polygon")).toHaveLength(3)
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
    // centred its Mg and added the four coordination lines.
    const golden: Record<string, string> = {
      cholesterol: "ba9366cd",
      chlorophyll: "b9a9b367",
      glucose: "0d66270f",
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
    expect(svg.querySelectorAll("polygon.haworth-front-edge")).toHaveLength(3)
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
  it("uses no black ink in dark mode and keeps the heteroatom palette", () => {
    const { svg } = render(TRUE_BETA_GLUCOSE, { theme: "dark" })
    for (const element of Array.from(svg.querySelectorAll("*"))) {
      for (const attribute of ["fill", "stroke", "style"]) {
        const value = element.getAttribute(attribute)
        if (value !== null) {
          expect(value.toLowerCase()).not.toContain("#000000")
        }
      }
    }
    const styles = Array.from(svg.querySelectorAll("path")).map(
      (path) => path.getAttribute("style") ?? "",
    )
    expect(styles.some((style) => style.includes("#FF0000"))).toBe(true)
  })
})
