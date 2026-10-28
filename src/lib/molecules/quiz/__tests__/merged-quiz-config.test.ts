import { describe, expect, it } from "vitest"
import type { Biomolecule } from "@/lib/biomolecules-api"
import {
  type CategoryQuizConfig,
  getCategoryQuizConfig,
  getMergedQuizConfig,
  traitPredicate,
} from "@/lib/molecules/quiz/category-quiz"
import { TEST_SACCHARIDES } from "./fixtures"

const SACCHARIDES_SLUG = TEST_SACCHARIDES[0]?.categorySlug ?? "sacharidy"
const GENERIC_SLUG = "vlastni-tema"

const GENERIC_SEED: Array<Pick<Biomolecule, "slug" | "name" | "smiles" | "traits">> = [
  {
    slug: "ala-x",
    name: "Látka A",
    smiles: "CC",
    traits: { abbreviation: "A", polarity: "hydrophobic" },
  },
  {
    slug: "bet-x",
    name: "Látka B",
    smiles: "CCC",
    traits: { abbreviation: "B", polarity: "hydrophilic" },
  },
  {
    slug: "gam-x",
    name: "Látka G",
    smiles: "CCCC",
    traits: { abbreviation: "G", polarity: "hydrophilic" },
  },
  {
    slug: "del-x",
    name: "Látka D",
    smiles: "CCCCC",
    traits: { abbreviation: "D", polarity: "hydrophilic", charge: "positive" },
  },
  {
    slug: "eps-x",
    name: "Látka E",
    smiles: "CCCCCC",
    traits: { abbreviation: "E", polarity: "hydrophilic", charge: "neutral" },
  },
]

const GENERIC_MOLECULES: Biomolecule[] = GENERIC_SEED.map((molecule, position) => ({
  id: `${GENERIC_SLUG}-${molecule.slug}`,
  categorySlug: GENERIC_SLUG,
  position,
  ...molecule,
}))

const SACCHARIDES_ENTRY = { categoryId: SACCHARIDES_SLUG, molecules: TEST_SACCHARIDES }
const GENERIC_ENTRY = { categoryId: GENERIC_SLUG, molecules: GENERIC_MOLECULES }

function requireConfig(categoryId: string, molecules: Biomolecule[]): CategoryQuizConfig {
  const config = getCategoryQuizConfig(categoryId, molecules)
  if (config === undefined) {
    throw new Error(`No quiz config for category: ${categoryId}`)
  }
  return config
}

function requireMerged(
  entries: { categoryId: string; molecules: Biomolecule[] }[],
): CategoryQuizConfig {
  const config = getMergedQuizConfig(entries)
  if (config === undefined) {
    throw new Error("expected a merged quiz config")
  }
  return config
}

const predicates = (config: CategoryQuizConfig): string[] =>
  (config.characteristics ?? []).map((definition) => definition.predicate)

describe("getMergedQuizConfig", () => {
  it("keeps each category's letters and distractor classes", () => {
    const merged = requireMerged([SACCHARIDES_ENTRY, GENERIC_ENTRY])
    expect(merged.molecules).toHaveLength(TEST_SACCHARIDES.length + GENERIC_MOLECULES.length)

    const byId = new Map(merged.molecules.map((molecule) => [molecule.id, molecule]))
    const glucose = byId.get("glukoza-a")
    const substanceA = byId.get("ala-x")
    if (glucose === undefined || substanceA === undefined) {
      throw new Error("merged molecule pool is missing an entry")
    }

    // Saccharides have no quiz letters and keep their ring-form grouping.
    expect(glucose.oneLetter).toBeUndefined()
    expect(glucose.classKey).toBe("pyranose")
    // The generic adapter's abbreviation stays the letter, polarity the class.
    expect(substanceA.oneLetter).toBe("A")
    expect(substanceA.classKey).toBe("hydrophobic")
  })

  it("re-qualifies characteristics against the merged molecule pool", () => {
    // Sugars now ship only the deoxy predicate by policy (anomer/ringForm
    // retired); it qualifies already in the category adapter.
    expect(predicates(requireConfig(SACCHARIDES_SLUG, TEST_SACCHARIDES))).toContain(
      traitPredicate("deoxy", "true"),
    )
    // and nothing else — the retired sugar-class prompts stay out.
    expect(predicates(requireConfig(SACCHARIDES_SLUG, TEST_SACCHARIDES))).not.toContain(
      traitPredicate("anomer", "alpha"),
    )
    expect(predicates(requireConfig(SACCHARIDES_SLUG, TEST_SACCHARIDES))).not.toContain(
      traitPredicate("anomer", "beta"),
    )

    // Hydrophilic matches 4 of the 5 generic molecules — one distractor.
    expect(predicates(requireConfig(GENERIC_SLUG, GENERIC_MOLECULES))).not.toContain(
      traitPredicate("polarity", "hydrophilic"),
    )

    const merged = requireMerged([SACCHARIDES_ENTRY, GENERIC_ENTRY])
    const mergedPredicates = predicates(merged)
    // Merged, the single non-distractor hydrophilic predicate finds its pool.
    expect(mergedPredicates).toContain(traitPredicate("polarity", "hydrophilic"))
    // Predicates that already qualified keep qualifying.
    expect(mergedPredicates).toContain(traitPredicate("polarity", "hydrophobic"))
    expect(mergedPredicates).toContain(traitPredicate("deoxy", "true"))
    expect(mergedPredicates).not.toContain(traitPredicate("anomer", "beta"))
  })

  it("drops characteristics that still lack three distractors", () => {
    // Two tiny categories: neither can fill three distractors alone, and
    // after merging the all-hydrophobic predicate still has only one
    // non-matching molecule, so it stays out.
    const tinyHydrophobic: Biomolecule[] = ["a", "b", "c"].map((suffix, position) => ({
      id: `tiny-a-${suffix}`,
      categorySlug: "tiny-a",
      slug: suffix,
      name: `A ${suffix}`,
      smiles: "CC",
      position,
      traits: { polarity: "hydrophobic" },
    }))
    const tinyMixed: Biomolecule[] = [
      {
        id: "tiny-b-x",
        categorySlug: "tiny-b",
        slug: "x",
        name: "B x",
        smiles: "CCC",
        position: 0,
        traits: { polarity: "hydrophilic", charge: "positive" },
      },
    ]

    const mergedPredicates = predicates(
      requireMerged([
        { categoryId: "tiny-a", molecules: tinyHydrophobic },
        { categoryId: "tiny-b", molecules: tinyMixed },
      ]),
    )
    // 1 match + 3 non-matches now qualifies; 3 matches + 1 non-match doesn't.
    expect(mergedPredicates).toContain(traitPredicate("polarity", "hydrophilic"))
    expect(mergedPredicates).toContain(traitPredicate("charge", "positive"))
    expect(mergedPredicates).not.toContain(traitPredicate("polarity", "hydrophobic"))
  })

  it("dedupes molecule ids defensively, keeping the first occurrence", () => {
    const merged = requireMerged([SACCHARIDES_ENTRY, SACCHARIDES_ENTRY])
    expect(merged.molecules).toHaveLength(TEST_SACCHARIDES.length)
    expect(new Set(merged.molecules.map((molecule) => molecule.id)).size).toBe(
      TEST_SACCHARIDES.length,
    )
  })

  it("returns undefined for an empty entry list", () => {
    expect(getMergedQuizConfig([])).toBeUndefined()
  })

  it("returns undefined when no entry produces a config", () => {
    expect(
      getMergedQuizConfig([
        { categoryId: SACCHARIDES_SLUG, molecules: [] },
        { categoryId: GENERIC_SLUG, molecules: [] },
      ]),
    ).toBeUndefined()
  })
})
