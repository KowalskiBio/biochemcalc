import { describe, expect, it } from "vitest"

import { getNitrogenBaseById, NITROGEN_BASES } from "@/lib/molecules/nitrogen-bases"

describe("nitrogen bases dataset", () => {
  it("contains exactly the five basic bases", () => {
    expect(NITROGEN_BASES).toHaveLength(5)
    expect(NITROGEN_BASES.map((b) => b.abbreviation).sort()).toEqual(["A", "C", "G", "T", "U"])
  })

  it("has unique ids, names and abbreviations", () => {
    for (const key of ["id", "name", "abbreviation"] as const) {
      const values = NITROGEN_BASES.map((b) => b[key])
      expect(new Set(values).size).toBe(NITROGEN_BASES.length)
    }
  })

  it("splits into two purines and three pyrimidines", () => {
    const purines = NITROGEN_BASES.filter((b) => b.ringSystem === "purine").map((b) => b.id)
    const pyrimidines = NITROGEN_BASES.filter((b) => b.ringSystem === "pyrimidine").map((b) => b.id)
    expect(purines.sort()).toEqual(["ade", "gua"])
    expect(pyrimidines.sort()).toEqual(["cyt", "thy", "ura"])
  })

  it("marks DNA/RNA membership correctly", () => {
    const dna = NITROGEN_BASES.filter((b) => b.inDna).map((b) => b.abbreviation)
    const rna = NITROGEN_BASES.filter((b) => b.inRna).map((b) => b.abbreviation)
    expect(dna.sort()).toEqual(["A", "C", "G", "T"])
    expect(rna.sort()).toEqual(["A", "C", "G", "U"])
  })

  it("has symmetric pairing", () => {
    for (const base of NITROGEN_BASES) {
      expect(base.pairsWithIds.length).toBeGreaterThan(0)
      for (const partnerId of base.pairsWithIds) {
        const partner = getNitrogenBaseById(partnerId)
        expect(partner, `${base.id} pairs with unknown id ${partnerId}`).toBeDefined()
        expect(partner?.pairsWithIds).toContain(base.id)
      }
    }
  })

  it("pairs with exactly the expected partners", () => {
    expect(getNitrogenBaseById("ade")?.pairsWithIds.sort()).toEqual(["thy", "ura"])
    expect(getNitrogenBaseById("cyt")?.pairsWithIds).toEqual(["gua"])
    expect(getNitrogenBaseById("gua")?.pairsWithIds).toEqual(["cyt"])
    expect(getNitrogenBaseById("thy")?.pairsWithIds).toEqual(["ade"])
    expect(getNitrogenBaseById("ura")?.pairsWithIds).toEqual(["ade"])
  })

  it("has valid achiral SMILES containing nitrogen", () => {
    for (const base of NITROGEN_BASES) {
      expect(base.smiles.length).toBeGreaterThan(0)
      expect(base.smiles).toContain("N")
      expect(base.smiles).not.toContain("@")
    }
  })

  it("has trimmed Czech names and non-empty facts", () => {
    for (const base of NITROGEN_BASES) {
      expect(base.name).toBe(base.name.trim())
      expect(base.facts.length).toBeGreaterThan(0)
    }
  })

  it("lookup helper returns undefined for unknown ids", () => {
    expect(getNitrogenBaseById("adenin")).toBeUndefined()
    expect(getNitrogenBaseById("ade")?.name).toBe("Adenin")
  })
})
