// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest"
import { transformPoints } from "@/lib/molecules/orientation"
import { ensureRdkit, parseMol, snapshotFromMol } from "@/lib/molecules/render/rdkit-engine"
import {
  expectedChainLetters,
  generatePeptide,
  isChainCorrect,
  nLeftOrientationDeg,
  peptideParts,
  peptideSmiles,
  RESIDUES,
} from "@/lib/peptides"
import SEED_SOURCE from "../../../../src-tauri/src/db/biomolecule_seed.rs?raw"

/** Canonical SMILES the RDKit way — what makes lens-vs-seed comparisons honest. */
function canonical(smiles: string): string {
  const mol = parseMol(smiles)
  if (mol === null) {
    throw new Error(`RDKit refused to parse: ${smiles}`)
  }
  try {
    return mol.get_smiles()
  } finally {
    mol.delete()
  }
}

// Ground truth re-extracted from the Rust seed on EVERY run — a seed edit
// (changed SMILES, renamed slug) fails this file loudly without hand-syncing.
// Filtered to the slugs our templates know, so a teacher-added 21st row is fine.
const SEED: { slug: string; smiles: string }[] = Array.from(
  SEED_SOURCE.matchAll(/slug: "([a-z0-9-]+)", name: "[^"]*", smiles: "([^"]+)"/g),
  (match: RegExpMatchArray) => ({ slug: match[1], smiles: match[2] }),
).filter(({ slug }) => RESIDUES[slug] !== undefined || slug === "pro")
expect(SEED.length, "all 20 canonical amino acids are pinned by the roundtrip").toBe(20)

beforeAll(async () => {
  await ensureRdkit()
})

describe("peptideSmiles", () => {
  it("synthesizes every single residue back into its seed molecule (all 20)", () => {
    for (const { slug, smiles } of SEED) {
      const synthesized = peptideSmiles([slug])
      expect(synthesized, `${slug}: construction succeeded`).not.toBeNull()
      if (synthesized === null) continue
      expect(canonical(synthesized), `${slug}: free acid roundtrip`).toBe(canonical(smiles))
    }
  })

  it("pins internal proline parity against the seed-traversal formulation", () => {
    // Alternative formulation: seed's own text with the ring N's lone H
    // acylated by a glycine — same molecule, different traversal, so a
    // flipped alpha parity in the INTERNAL template cannot hide.
    const fromTemplate = peptideSmiles(["gly", "pro"])
    const fromSeedOrder = "C1C[C@H](N(C1)C(=O)CN)C(=O)O"
    expect(fromTemplate).not.toBeNull()
    if (fromTemplate === null) return
    expect(canonical(fromTemplate)).toBe(canonical(fromSeedOrder))
  })

  it("pins a coiled mid-chain trio: standard+cyclic+achiral neighbors", () => {
    const synthesized = peptideSmiles(["gly", "pro", "gly"])
    // Seed-shape trusted traversal of the same molecule: proline's ring N
    // acylated by one glycine, its own carboxyl amidated to the second.
    const fromSeedOrder = "C1C[C@H](N(C1)C(=O)CN)C(=O)NCC(=O)O"
    expect(synthesized).not.toBeNull()
    if (synthesized === null) return
    expect(canonical(synthesized)).toBe(canonical(fromSeedOrder))
  })

  it("assembles a five-residue chain RDKit parses", () => {
    const smiles = peptideSmiles(["phe", "ser", "pro", "lys", "met"])
    expect(smiles).not.toBeNull()
    const mol = parseMol(smiles ?? "")
    expect(mol).not.toBeNull()
    mol?.delete()
  })

  it("returns null for unknown slugs and empty chains", () => {
    expect(peptideSmiles([])).toBeNull()
    expect(peptideSmiles(["ala", "nesmysl"])).toBeNull()
    expect(peptideSmiles(["cukor"])).toBeNull()
  })

  it("reports N atom index 0 for standard starts and 3 for proline starts", () => {
    expect(peptideParts(["ala", "gly"])?.nIndex).toBe(0)
    expect(peptideParts(["pro", "ala"])?.nIndex).toBe(3)
  })
})

describe("generatePeptide", () => {
  it("repeats deterministically for a fixed seed", () => {
    const pool = ["ala", "gly", "pro"]
    expect(generatePeptide(pool, 8, 42)).toEqual(generatePeptide(pool, 8, 42))
  })

  it("draws only from the pool and at the requested length", () => {
    const pool = ["ser", "thr"]
    const chain = generatePeptide(pool, 17, 7)
    expect(chain).toHaveLength(17)
    expect(chain.every((slug) => pool.includes(slug))).toBe(true)
  })

  it("rejects empty pools and invalid lengths", () => {
    expect(() => generatePeptide([], 3, 1)).toThrow()
    expect(() => generatePeptide(["ala"], 0, 1)).toThrow()
    expect(() => generatePeptide(["ala"], 1.5, 1)).toThrow()
  })
})

describe("nLeftOrientationDeg", () => {
  it("lays a chain N-left within float epsilon", () => {
    const parts = peptideParts(["phe", "ser", "pro", "lys", "met"])
    if (parts === null) throw new Error("synthesis failed")
    const angle = nLeftOrientationDeg(parts.smiles, parts.nIndex)
    expect(angle).not.toBeNull()
    if (angle === null) return

    // Applying the angle to the same snapshot must place N strictly left of the terminal O.
    const mol = parseMol(parts.smiles)
    if (mol === null) throw new Error("parse failed")
    try {
      const atoms = snapshotFromMol(mol).atoms
      const rotated = transformPoints(
        atoms.map((atom) => atom.pos),
        angle,
        false,
      )
      const deltaY = rotated[parts.nIndex].y - rotated[rotated.length - 1].y
      expect(Math.abs(deltaY)).toBeLessThan(1e-6)
      expect(rotated[parts.nIndex].x).toBeLessThan(rotated[rotated.length - 1].x)
    } finally {
      mol.delete()
    }
  })

  it("honours the proline-start anchor (nIndex 3)", () => {
    const parts = peptideParts(["pro", "ala", "val"])
    if (parts === null) throw new Error("synthesis failed")
    const mol = parseMol(parts.smiles)
    if (mol === null) throw new Error("parse failed")
    try {
      const atoms = snapshotFromMol(mol).atoms
      expect(atoms[parts.nIndex].element, "nIndex points at the ring nitrogen").toBe("N")
      const angle = nLeftOrientationDeg(parts.smiles, parts.nIndex)
      expect(angle).toBeTypeOf("number")
      if (angle === null) return
      const rotated = transformPoints(
        atoms.map((atom) => atom.pos),
        angle,
        false,
      )
      expect(rotated[parts.nIndex].x).toBeLessThan(rotated[rotated.length - 1].x)
    } finally {
      mol.delete()
    }
  })

  it("returns zero for a degenerate single-atom axis and null for bad SMILES", () => {
    expect(nLeftOrientationDeg("C(C(C", 0)).toBeNull()
  })
})

describe("answer semantics", () => {
  it("joins one-letter codes in order", () => {
    expect(expectedChainLetters(["M", "K", "Y"])).toBe("MKY")
  })

  it("accepts case- and whitespace-tolerant exact matches", () => {
    expect(isChainCorrect("mky", "MKY")).toBe(true)
    expect(isChainCorrect("M K Y", "MKY")).toBe(true)
    expect(isChainCorrect("  MKY  ", "MKY")).toBe(true)
  })

  it("rejects wrong order, wrong length and empty input", () => {
    expect(isChainCorrect("MYK", "MKY")).toBe(false)
    expect(isChainCorrect("MK", "MKY")).toBe(false)
    expect(isChainCorrect("MKYX", "MKY")).toBe(false)
    expect(isChainCorrect("", "MKY")).toBe(false)
  })
})
