import { describe, expect, it } from "vitest"
import type { Biomolecule } from "@/lib/biomolecules-api"
import { type CategoryQuizConfig, getCategoryQuizConfig } from "@/lib/molecules/quiz/category-quiz"
import {
  ALL_QUIZ_TYPES,
  availableQuizTypes,
  type CharacteristicDef,
  type CharacteristicPredicate,
  type GenerateQuizConfig,
  generateQuizSession,
  type QuizMolecule,
  type QuizQuestionType,
} from "@/lib/molecules/quiz/question-generator"
import { TEST_AMINO_ACIDS, TEST_NITROGEN_BASES } from "./fixtures"

const ALL_TYPES: QuizQuestionType[] = [...ALL_QUIZ_TYPES]
const BASE_TYPES: QuizQuestionType[] = ["nameToStructure", "structureToName"]

const AMINO_ACIDS_SLUG = TEST_AMINO_ACIDS[0]?.categorySlug ?? "aminokyseliny"
const NITROGEN_BASES_SLUG = TEST_NITROGEN_BASES[0]?.categorySlug ?? "dusikate-baze"

function requireConfig(categoryId: string, molecules: typeof TEST_AMINO_ACIDS): CategoryQuizConfig {
  const config = getCategoryQuizConfig(categoryId, molecules)
  if (config === undefined) {
    throw new Error(`No quiz config for category: ${categoryId}`)
  }
  return config
}

function requireCharacteristics(config: CategoryQuizConfig): CharacteristicDef[] {
  if (config.characteristics === undefined) {
    throw new Error("expected characteristic definitions")
  }
  return config.characteristics
}

const AMINO_ACIDS_QUIZ = requireConfig(AMINO_ACIDS_SLUG, TEST_AMINO_ACIDS)
const NITROGEN_BASES_QUIZ = requireConfig(NITROGEN_BASES_SLUG, TEST_NITROGEN_BASES)
const AA_CHARACTERISTICS = requireCharacteristics(AMINO_ACIDS_QUIZ)

const aminoAcidById = new Map<string, QuizMolecule>(
  AMINO_ACIDS_QUIZ.molecules.map((molecule) => [molecule.id, molecule]),
)
const nitrogenBaseById = new Map<string, QuizMolecule>(
  NITROGEN_BASES_QUIZ.molecules.map((molecule) => [molecule.id, molecule]),
)

function getMolecule(id: string, source: Map<string, QuizMolecule>): QuizMolecule {
  const molecule = source.get(id)
  if (molecule === undefined) {
    throw new Error(`Unknown molecule id: ${id}`)
  }
  return molecule
}

function getAminoAcid(id: string): QuizMolecule {
  return getMolecule(id, aminoAcidById)
}

function getNitrogenBase(id: string): QuizMolecule {
  return getMolecule(id, nitrogenBaseById)
}

function defFor(predicate: CharacteristicPredicate, defs: CharacteristicDef[]): CharacteristicDef {
  const def = defs.find((candidate) => candidate.predicate === predicate)
  if (def === undefined) {
    throw new Error(`No characteristic definition for predicate: ${predicate}`)
  }
  return def
}

function aaConfig(
  types: QuizQuestionType[],
  questionCount: number,
  seed: number,
  extra: Partial<GenerateQuizConfig> = {},
): GenerateQuizConfig {
  return {
    types,
    questionCount,
    seed,
    characteristics: AA_CHARACTERISTICS,
    ...extra,
  }
}

describe("availableQuizTypes", () => {
  it("returns all seven types for the full amino-acid dataset", () => {
    expect([...availableQuizTypes(AMINO_ACIDS_QUIZ.molecules, AA_CHARACTERISTICS)].sort()).toEqual(
      [...ALL_TYPES].sort(),
    )
  })

  it("drops letter types when a molecule lacks oneLetter", () => {
    const mocked: QuizMolecule[] = AMINO_ACIDS_QUIZ.molecules.map((molecule, index) =>
      index === 0 ? { ...molecule, oneLetter: "" } : molecule,
    )
    const types = availableQuizTypes(mocked, AA_CHARACTERISTICS)
    expect(types).toHaveLength(3)
    expect(types).not.toContain("nameToLetter")
    expect(types).not.toContain("letterToName")
    expect(types).not.toContain("letterToStructure")
    expect(types).not.toContain("structureToLetter")
    expect(types).toContain("nameToStructure")
    expect(types).toContain("structureToName")
    expect(types).toContain("characteristic")
  })

  it("drops characteristic when no definitions are injected", () => {
    const types = availableQuizTypes(AMINO_ACIDS_QUIZ.molecules)
    expect(types).not.toContain("characteristic")
    expect(types).toContain("nameToStructure")
    expect(types).toContain("structureToName")
  })
})

describe("generateQuizSession determinism", () => {
  it("produces identical questions for the same seed", () => {
    const config = aaConfig(ALL_TYPES, 24, 1234)
    const first = generateQuizSession(AMINO_ACIDS_QUIZ.molecules, config)
    const second = generateQuizSession(AMINO_ACIDS_QUIZ.molecules, config)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it("produces different sessions for different seeds", () => {
    const first = generateQuizSession(AMINO_ACIDS_QUIZ.molecules, aaConfig(ALL_TYPES, 24, 1))
    const second = generateQuizSession(AMINO_ACIDS_QUIZ.molecules, aaConfig(ALL_TYPES, 24, 2))
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second))
  })
})

describe("question invariants", () => {
  it("holds across 200 seeds and all seven types", () => {
    for (let seed = 0; seed < 200; seed++) {
      const questions = generateQuizSession(
        AMINO_ACIDS_QUIZ.molecules,
        aaConfig(ALL_TYPES, 7, seed),
      )
      expect(questions).toHaveLength(7)

      for (const question of questions) {
        expect(question.options).toHaveLength(4)
        expect(new Set(question.options.map((option) => option.key)).size).toBe(4)

        const correctOptions = question.options.filter((option) => option.correct)
        expect(correctOptions).toHaveLength(1)
        expect(correctOptions[0].moleculeId).toBe(question.targetId)

        for (const option of question.options) {
          if (option.display === "structure") {
            const angle = option.orientationDeg
            if (typeof angle !== "number") {
              throw new Error("structure option is missing orientationDeg")
            }
            expect(angle).toBeGreaterThanOrEqual(0)
            expect(angle).toBeLessThan(360)
            expect(option.smiles).toBeDefined()
          }
        }

        const distractorIds = question.options
          .filter((option) => !option.correct)
          .map((option) => option.moleculeId)
        for (const id of distractorIds) {
          expect(id).not.toBe(question.targetId)
        }
        expect(new Set(distractorIds).size).toBe(distractorIds.length)
      }
    }
  })
})

describe("distractor preference", () => {
  it("favours same side-chain class distractors for nameToStructure", () => {
    let sameClassCount = 0
    let distractorCount = 0

    for (let seed = 0; seed < 300; seed++) {
      const questions = generateQuizSession(
        AMINO_ACIDS_QUIZ.molecules,
        aaConfig(["nameToStructure"], 4, seed),
      )
      for (const question of questions) {
        const target = getAminoAcid(question.targetId)
        for (const option of question.options) {
          if (option.correct) {
            continue
          }
          distractorCount++
          if (getAminoAcid(option.moleculeId).classKey === target.classKey) {
            sameClassCount++
          }
        }
      }
    }

    const rate = sameClassCount / distractorCount
    // Uniform sampling would sit around 0.2; the preference should be far above.
    expect(distractorCount).toBeGreaterThan(1000)
    expect(rate).toBeGreaterThan(0.5)
  })
})

describe("target queue", () => {
  it("never repeats the same target twice in a row", () => {
    const questions = generateQuizSession(AMINO_ACIDS_QUIZ.molecules, aaConfig(ALL_TYPES, 21, 99))
    expect(questions).toHaveLength(21)
    for (let i = 1; i < questions.length; i++) {
      expect(questions[i].targetId).not.toBe(questions[i - 1].targetId)
    }
  })
})

describe("characteristic questions", () => {
  it("picks a predicate with enough matches and exactly one matching option", () => {
    for (let seed = 0; seed < 100; seed++) {
      const questions = generateQuizSession(
        AMINO_ACIDS_QUIZ.molecules,
        aaConfig(["characteristic"], 6, seed),
      )
      for (const question of questions) {
        expect(question.prompt.kind).toBe("characteristic")
        const predicate = question.prompt.predicate
        if (predicate === undefined) {
          throw new Error("characteristic question is missing its predicate")
        }

        const def = defFor(predicate, AA_CHARACTERISTICS)
        const matches = AMINO_ACIDS_QUIZ.molecules.filter((molecule) => def.matches(molecule))
        const nonMatches = AMINO_ACIDS_QUIZ.molecules.filter((molecule) => !def.matches(molecule))
        expect(matches.length).toBeGreaterThanOrEqual(1)
        expect(nonMatches.length).toBeGreaterThanOrEqual(3)

        const matchingOptions = question.options.filter((option) =>
          def.matches(getAminoAcid(option.moleculeId)),
        )
        expect(matchingOptions).toHaveLength(1)
        expect(question.options.filter((option) => option.correct)).toHaveLength(1)

        for (const option of question.options) {
          expect(option.display).toBe("name")
        }
      }
    }
  })

  it("skips the type safely when characteristic is requested without definitions", () => {
    expect(
      generateQuizSession(AMINO_ACIDS_QUIZ.molecules, {
        types: ["characteristic"],
        questionCount: 5,
        seed: 3,
      }),
    ).toEqual([])
  })
})

describe("nitrogen bases category", () => {
  it("offers exactly the two name/structure types", () => {
    const types = availableQuizTypes(
      NITROGEN_BASES_QUIZ.molecules,
      NITROGEN_BASES_QUIZ.characteristics,
    )
    expect([...types].sort()).toEqual([...BASE_TYPES].sort())
  })

  it("holds question invariants across 50 seeds", () => {
    for (let seed = 0; seed < 50; seed++) {
      const questions = generateQuizSession(NITROGEN_BASES_QUIZ.molecules, {
        types: BASE_TYPES,
        questionCount: 2,
        seed,
      })
      expect(questions).toHaveLength(2)

      for (const question of questions) {
        const target = getNitrogenBase(question.targetId)

        expect(question.options).toHaveLength(4)
        expect(new Set(question.options.map((option) => option.key)).size).toBe(4)

        const correctOptions = question.options.filter((option) => option.correct)
        expect(correctOptions).toHaveLength(1)
        expect(correctOptions[0].moleculeId).toBe(question.targetId)

        for (const option of question.options) {
          if (option.display === "structure") {
            const angle = option.orientationDeg
            if (typeof angle !== "number") {
              throw new Error("structure option is missing orientationDeg")
            }
            expect(angle).toBeGreaterThanOrEqual(0)
            expect(angle).toBeLessThan(360)
            expect(option.smiles).toBeDefined()
          }
        }

        const plainDistractorIds = question.options
          .filter((option) => !option.correct)
          .map((option) => option.moleculeId)
        for (const id of plainDistractorIds) {
          expect(id).not.toBe(question.targetId)
        }
        expect(new Set(plainDistractorIds).size).toBe(plainDistractorIds.length)
        expect(target.classKey === "purine" || target.classKey === "pyrimidine").toBe(true)
      }
    }
  })

  it("prefers same ring-system distractors for a strong majority of purine targets", () => {
    let purineTargets = 0
    let purineTargetsWithPurineDistractor = 0

    for (let seed = 0; seed < 300; seed++) {
      const questions = generateQuizSession(NITROGEN_BASES_QUIZ.molecules, {
        types: ["nameToStructure"],
        questionCount: 4,
        seed,
      })
      for (const question of questions) {
        const target = getNitrogenBase(question.targetId)
        if (target.classKey !== "purine") {
          continue
        }
        purineTargets++
        const hasPurineDistractor = question.options.some(
          (option) => !option.correct && getNitrogenBase(option.moleculeId).classKey === "purine",
        )
        if (hasPurineDistractor) {
          purineTargetsWithPurineDistractor++
        }
      }
    }

    expect(purineTargets).toBeGreaterThan(100)
    expect(purineTargetsWithPurineDistractor / purineTargets).toBeGreaterThan(0.5)
  })

  it("returns undefined when the category has no molecules", () => {
    expect(getCategoryQuizConfig("aminokyseliny", [])).toBeUndefined()
    expect(getCategoryQuizConfig("neznamy", [])).toBeUndefined()
  })
})

describe("generic category adapter", () => {
  // A teacher-made category: abbreviations double as quiz letters, each
  // charge/polarity value with enough material becomes a predicate.
  const customSeed: Array<Pick<Biomolecule, "slug" | "name" | "smiles" | "traits">> = [
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
  const customMolecules: Biomolecule[] = customSeed.map((molecule, position) => ({
    id: `vlastni-${molecule.slug}`,
    categorySlug: "vlastni-kategorie",
    position,
    ...molecule,
  }))

  it("derives letters from abbreviations and predicates from trait values", () => {
    const config = requireConfig("vlastni-kategorie", customMolecules)
    expect(config.molecules.every((molecule) => (molecule.oneLetter ?? "").length > 0)).toBe(true)
    expect(config.molecules[0].classKey).toBe("hydrophobic")

    const predicates = (config.characteristics ?? []).map((def) => def.predicate)
    // polarity:hydrophobic (1 match, 4 non-matches) and charge:positive /
    // charge:neutral qualify; polarity:hydrophilic leaves only 1 non-match.
    expect(predicates).toContain("polarity:hydrophobic")
    expect(predicates).toContain("charge:positive")
    expect(predicates).toContain("charge:neutral")
    expect(predicates).not.toContain("polarity:hydrophilic")

    const types = availableQuizTypes(config.molecules, config.characteristics)
    expect(types).toContain("nameToLetter")
    expect(types).toContain("nameToStructure")
    expect(types).toContain("characteristic")
  })

  it("drops letter types when any molecule lacks an abbreviation", () => {
    const withoutAbbreviation = customMolecules.map((molecule, index) =>
      index === 0
        ? { ...molecule, traits: { polarity: molecule.traits.polarity ?? "" } }
        : molecule,
    )
    const config = requireConfig("vlastni-kategorie", withoutAbbreviation)
    expect(config.molecules.every((molecule) => molecule.oneLetter === undefined)).toBe(true)
    const types = availableQuizTypes(config.molecules, config.characteristics)
    expect(types).not.toContain("nameToLetter")
    expect(types).not.toContain("letterToName")
    expect(types).toContain("nameToStructure")
  })
})
