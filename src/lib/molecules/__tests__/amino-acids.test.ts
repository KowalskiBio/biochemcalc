import { describe, expect, it } from "vitest"
import {
  AMINO_ACIDS,
  canMirrorStructure,
  getAminoAcidByOneLetter,
} from "@/lib/molecules/amino-acids"

function isUnique(values: string[]): boolean {
  return new Set(values).size === values.length
}

function requireOne(letter: string) {
  const aminoAcid = getAminoAcidByOneLetter(letter)
  if (aminoAcid === undefined) {
    throw new Error(`Expected amino acid for letter "${letter}" to exist`)
  }
  return aminoAcid
}

describe("AMINO_ACIDS dataset", () => {
  it("contains exactly the 20 canonical amino acids", () => {
    expect(AMINO_ACIDS).toHaveLength(20)
  })

  it("has globally unique id, name, oneLetter and threeLetter fields", () => {
    expect(isUnique(AMINO_ACIDS.map((aa) => aa.id))).toBe(true)
    expect(isUnique(AMINO_ACIDS.map((aa) => aa.name))).toBe(true)
    expect(isUnique(AMINO_ACIDS.map((aa) => aa.oneLetter))).toBe(true)
    expect(isUnique(AMINO_ACIDS.map((aa) => aa.threeLetter))).toBe(true)
  })

  it("uses a single uppercase A-Z letter for every oneLetter code", () => {
    for (const aminoAcid of AMINO_ACIDS) {
      expect(aminoAcid.oneLetter).toMatch(/^[A-Z]$/)
    }
  })

  it("marks exactly glycine as achiral and allows mirroring only for it", () => {
    const achiral = AMINO_ACIDS.filter((aa) => aa.achiral)
    expect(achiral).toHaveLength(1)
    expect(achiral[0].threeLetter).toBe("Gly")
    expect(canMirrorStructure(achiral[0])).toBe(true)

    // L-alanine is chiral, so its depiction must never be mirrored.
    expect(canMirrorStructure(requireOne("A"))).toBe(false)
  })

  it("flags exactly the essential amino acids", () => {
    const essential = AMINO_ACIDS.filter((aa) => aa.essential).map((aa) => aa.oneLetter)
    expect(essential.sort()).toEqual(["F", "I", "K", "L", "M", "T", "V", "W"])
  })

  it("keeps charge at pH 7 consistent with the side-chain class", () => {
    for (const aminoAcid of AMINO_ACIDS) {
      // Biconditional: negative charge if and only if the side chain is acidic.
      expect(aminoAcid.chargeAtPh7 === "negative").toBe(aminoAcid.sideChain === "acidic")
      if (aminoAcid.chargeAtPh7 === "positive") {
        expect(aminoAcid.sideChain).toBe("basic")
      }
    }
  })

  it("gives every structure a nitrogen and preserves stereochemistry in SMILES", () => {
    for (const aminoAcid of AMINO_ACIDS) {
      expect(aminoAcid.smiles).toContain("N")
    }

    for (const aminoAcid of AMINO_ACIDS.filter((aa) => !aa.achiral)) {
      expect(aminoAcid.smiles).toContain("@")
    }

    expect(requireOne("G").smiles).not.toContain("@")
  })

  it("looks up amino acids case-insensitively and returns undefined for unknowns", () => {
    expect(getAminoAcidByOneLetter("g")?.name).toBe("Glycin")
    expect(getAminoAcidByOneLetter("G")?.name).toBe("Glycin")
    expect(getAminoAcidByOneLetter("g")).toEqual(getAminoAcidByOneLetter("G"))

    for (const aminoAcid of AMINO_ACIDS) {
      expect(getAminoAcidByOneLetter(aminoAcid.oneLetter.toLowerCase())).toEqual(aminoAcid)
    }

    expect(getAminoAcidByOneLetter("Z")).toBeUndefined()
    expect(getAminoAcidByOneLetter("1")).toBeUndefined()
  })

  it("stores trimmed names and at least one fact per amino acid", () => {
    for (const aminoAcid of AMINO_ACIDS) {
      expect(aminoAcid.name).toBe(aminoAcid.name.trim())
      expect(Array.isArray(aminoAcid.facts)).toBe(true)
      expect(aminoAcid.facts.length).toBeGreaterThan(0)
    }
  })
})
