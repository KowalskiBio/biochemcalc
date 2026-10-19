import { beforeAll, describe, expect, it } from "vitest"

import {
  ensureRdkit,
  getMolBlock,
  type Mol,
  type MolGraphSnapshot,
  molblockWithPositions,
  parseMol,
  type RdkitModule,
  renderMoleculeSvg,
  snapshotFromMol,
} from "@/lib/molecules/render/rdkit-engine"

// Golden structures supplied by the depiction spike.
const HEME = `CC1=C(C2=CC3=NC(=CC4=C(C(=C([N-]4)C=C5C(=C(C(=N5)C=C1[N-]2)C)C=C)C)C=C)C(=C3CCC(=O)O)C)CCC(=O)O.[Fe+2]`
const CHLOROPHYLL_PUBCHEM = String.raw`CCC1=C(C2=NC1=CC3=C(C4=C([N-]3)C(=C5[C@H]([C@@H](C(=N5)C=C6C(=C(C(=C2)[N-]6)C=C)C)C)CCC(=O)OC/C=C(\C)/CCC[C@H](C)CCC[C@H](C)CCCC(C)C)[C@H](C4=O)C(=O)OC)C)C.[Mg+2]`
const B12 = String.raw`CC1=CC2=C(C=C1C)[N+](=CN2)[C@@H]3[C@@H]([C@@H]([C@H](O3)CO)OP(=O)(O)O[C@H](C)CNC(=O)CC[C@@]4([C@H]([C@@H]5[C@]6([C@@]([C@@H](C(=N6)/C(=C\7/[C@@]([C@@H](/C(=C/C8=N/C(=C(\C4=N5)/C)/[C@H](C8(C)C)CCC(=N)[O-])/N7)CCC(=N)[O-])(C)CC(=O)N)/C)CCC(=N)[O-])(C)CC(=O)N)C)CC(=O)N)C)O.[C]#N.[Co+2]`
const BROKEN_CHLOROPHYLL = `CCC1=C(C2=Cc3c(c(c4n3[Mg]56[N]2=C1C=C7N5C8=C(C(C(=O)C8=C7C)C(=O)OC)C9=[N]6C(=C4)C(C9CCC(=O)OCC=C(C)CCCC(C)CCCC(C)CCCC(C)C)C)C=C)C`
// The task's "β-D-glucose" string (C([C@@H]1...[C@H](O1)...) is a five-membered
// furanose (RDKit atomRings: [1,2,3,4,5]); a real β-D-glucopyranose is needed
// for the required six-membered-ring assertion.
const GLUCOSE = `OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O`

let rdkit: RdkitModule

beforeAll(async () => {
  rdkit = await ensureRdkit()
})

function requireMol(smiles: string): Mol {
  const mol = parseMol(smiles)
  expect(mol).not.toBeNull()
  if (!mol) throw new Error(`Expected ${smiles} to parse`)
  return mol
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function angleAt(
  center: { x: number; y: number },
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  const ax = first.x - center.x
  const ay = first.y - center.y
  const bx = second.x - center.x
  const by = second.y - center.y
  const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by)
  const cosine = denominator === 0 ? 1 : (ax * bx + ay * by) / denominator
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
}

function auditGeometry(snapshot: MolGraphSnapshot): void {
  const positions = snapshot.atoms.map((atom) => atom.pos)
  const lengths = snapshot.bonds.map((bond) =>
    Math.hypot(
      positions[bond.endIdx].x - positions[bond.beginIdx].x,
      positions[bond.endIdx].y - positions[bond.beginIdx].y,
    ),
  )
  const typicalLength = median(lengths)

  for (const length of lengths) {
    expect(length).toBeGreaterThanOrEqual(0.7 * typicalLength)
    expect(length).toBeLessThanOrEqual(1.4 * typicalLength)
  }

  const neighbours: number[][] = snapshot.atoms.map(() => [])
  for (const bond of snapshot.bonds) {
    neighbours[bond.beginIdx].push(bond.endIdx)
    neighbours[bond.endIdx].push(bond.beginIdx)
  }

  let degreeTwoCount = 0
  let inRangeCount = 0
  for (let idx = 0; idx < neighbours.length; idx++) {
    const adjacent = neighbours[idx]
    if (adjacent.length !== 2) continue
    degreeTwoCount++
    const angle = angleAt(positions[idx], positions[adjacent[0]], positions[adjacent[1]])
    expect(angle).toBeLessThanOrEqual(150)
    if (angle >= 100 && angle <= 135) inRangeCount++
  }

  expect(degreeTwoCount).toBeGreaterThan(0)
  expect(inRangeCount / degreeTwoCount).toBeGreaterThanOrEqual(0.95)
}

function extractAtomPoints(molblock: string): { x: number; y: number }[] {
  const lines = molblock.split(/\r?\n/)
  const atomCount = Number.parseInt(lines[3].slice(0, 3).trim(), 10)
  return lines.slice(4, 4 + atomCount).map((line) => ({
    x: Number.parseFloat(line.slice(0, 10)),
    y: Number.parseFloat(line.slice(10, 20)),
  }))
}

describe("rdkit engine initialization", () => {
  it("shares one init promise across callers", async () => {
    const first = ensureRdkit()
    const second = ensureRdkit()
    expect(first).toBe(second)
    const module = await first
    expect(module.version()).toContain("2026")
  })
})

describe("golden depictions", () => {
  it("parses heme with the expected graph", () => {
    const mol = requireMol(HEME)
    try {
      mol.set_new_coords(true)
      const snapshot = snapshotFromMol(mol)
      expect(snapshot.atoms).toHaveLength(43)
      expect(snapshot.bonds.filter((bond) => bond.order === 2)).toHaveLength(15)
      auditGeometry(snapshot)
    } finally {
      mol.delete()
    }
  }, 30000)

  it("parses chlorophyll a with the expected graph", () => {
    const mol = requireMol(CHLOROPHYLL_PUBCHEM)
    try {
      mol.set_new_coords(true)
      const snapshot = snapshotFromMol(mol)
      expect(snapshot.atoms).toHaveLength(65)
      expect(snapshot.bonds.filter((bond) => bond.order === 2)).toHaveLength(15)
      auditGeometry(snapshot)
    } finally {
      mol.delete()
    }
  }, 30000)

  it("parses vitamin B12 with the expected graph", () => {
    const mol = requireMol(B12)
    try {
      mol.set_new_coords(true)
      const snapshot = snapshotFromMol(mol)
      expect(snapshot.atoms).toHaveLength(93)
      expect(snapshot.bonds.filter((bond) => bond.order === 2)).toHaveLength(18)
      auditGeometry(snapshot)
    } finally {
      mol.delete()
    }
  }, 30000)
})

describe("renderMoleculeSvg", () => {
  it("returns SVG markup for heme", () => {
    const svg = renderMoleculeSvg(HEME, { width: 160, height: 160 })
    expect(svg).toContain("<svg")
    expect(svg).toContain("class='bond-")
  })

  it("returns null for invalid SMILES", () => {
    expect(renderMoleculeSvg("C(C(", { width: 160, height: 160 })).toBeNull()
    expect(renderMoleculeSvg(BROKEN_CHLOROPHYLL, { width: 160, height: 160 })).toBeNull()
  })
})

describe("molblockWithPositions", () => {
  it("round-trips coordinates and moves a single atom", () => {
    const mol = requireMol(HEME)
    let molblock: string
    try {
      mol.set_new_coords(true)
      molblock = getMolBlock(mol)
    } finally {
      mol.delete()
    }

    const points = extractAtomPoints(molblock)
    expect(molblockWithPositions(molblock, points)).toBe(molblock)

    const shifted = points.map((point, idx) =>
      idx === 0 ? { x: point.x + 10, y: point.y - 5 } : point,
    )
    const patched = molblockWithPositions(molblock, shifted)
    const reparsed = rdkit.get_mol(patched)
    expect(reparsed).not.toBeNull()
    if (!reparsed) return
    try {
      expect(reparsed.get_num_atoms()).toBe(43)
      expect(reparsed.get_num_bonds()).toBe(46)
      const molecule = JSON.parse(reparsed.get_json()).molecules[0]
      const coords = molecule.conformers[0].coords
      expect(coords[0][0]).toBeCloseTo(points[0].x + 10, 4)
      expect(coords[0][1]).toBeCloseTo(points[0].y - 5, 4)
    } finally {
      reparsed.delete()
    }
  }, 30000)

  it("throws when the point count does not match", () => {
    const mol = requireMol(HEME)
    try {
      mol.set_new_coords(true)
      const molblock = getMolBlock(mol)
      expect(() => molblockWithPositions(molblock, [])).toThrow()
    } finally {
      mol.delete()
    }
  })
})

describe("snapshotFromMol rings", () => {
  it("finds the pyranose ring of glucose", () => {
    const mol = requireMol(GLUCOSE)
    try {
      const snapshot = snapshotFromMol(mol)
      const sixMemberRings = snapshot.rings.filter((ring) => ring.members.length === 6)
      expect(sixMemberRings).toHaveLength(1)

      const ring = sixMemberRings[0]
      const mean = ring.members.reduce(
        (acc, idx) => {
          acc.x += snapshot.atoms[idx].pos.x
          acc.y += snapshot.atoms[idx].pos.y
          return acc
        },
        { x: 0, y: 0 },
      )
      expect(ring.center.x).toBeCloseTo(mean.x / ring.members.length, 9)
      expect(ring.center.y).toBeCloseTo(mean.y / ring.members.length, 9)
    } finally {
      mol.delete()
    }
  })
})
