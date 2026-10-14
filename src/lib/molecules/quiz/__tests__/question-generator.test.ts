import { describe, expect, it } from "vitest"
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

const ALL_TYPES: QuizQuestionType[] = [...ALL_QUIZ_TYPES]
const BASE_TYPES: QuizQuestionType[] = ["nameToStructure", "structureToName"]

function requireConfig(categoryId: string): CategoryQuizConfig {
  const config = getCategoryQuizConfig(categoryId)
  if (config === undefined) {
    throw new Error(`Unknown category: ${categoryId}`)
  }
  return config
}

function requireCharacteristics(config: CategoryQuizConfig): CharacteristicDef[] {
  if (config.characteristics === undefined) {
    throw new Error("expected characteristic definitions")
  }
  return config.characteristics
}

const AMINO_ACIDS_QUIZ = requireConfig("aminokyseliny")
const NITROGEN_BASES_QUIZ = requireConfig("dusikate-baze")
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
        const target = getAminoAcid(question.targetId)

        expect(question.options).toHaveLength(4)
        expect(new Set(question.options.map((option) => option.key)).size).toBe(4)

        const correctOptions = question.options.filter((option) => option.correct)
        expect(correctOptions).toHaveLength(1)
        expect(correctOptions[0].moleculeId).toBe(question.targetId)
        expect(correctOptions[0].mirror === true).toBe(false)

        for (const option of question.options) {
          if (option.display === "structure") {
            const angle = option.orientationDeg
            if (typeof angle !== "number") {
              throw new Error("structure option is missing orientationDeg")
            }
            expect(angle).toBeGreaterThanOrEqual(0)
            expect(angle).toBeLessThan(360)
            expect(option.smiles).toBeDefined()
            expect(typeof option.mirror).toBe("boolean")
            if (option.mirror === true) {
              expect(option.correct).toBe(false)
              expect(option.moleculeId).toBe(question.targetId)
              expect(target.achiral).toBe(false)
            }
          } else {
            expect(option.mirror === true).toBe(false)
          }
        }

        const distractors = question.options.filter((option) => !option.correct)
        const plainDistractorIds = distractors
          .filter((option) => option.mirror !== true)
          .map((option) => option.moleculeId)
        for (const id of plainDistractorIds) {
          expect(id).not.toBe(question.targetId)
        }
        expect(new Set(plainDistractorIds).size).toBe(plainDistractorIds.length)
      }
    }
  })

  it("can produce mirror decoys for chiral targets but never for glycine", () => {
    let sawMirror = false

    for (let seed = 0; seed < 60; seed++) {
      const questions = generateQuizSession(
        AMINO_ACIDS_QUIZ.molecules,
        aaConfig(["nameToStructure", "letterToStructure"], 8, seed),
      )
      for (const question of questions) {
        const target = getAminoAcid(question.targetId)
        for (const option of question.options) {
          if (option.mirror === true) {
            sawMirror = true
            expect(option.correct).toBe(false)
            expect(option.moleculeId).toBe(question.targetId)
            expect(target.achiral).toBe(false)
          }
        }
      }
    }

    expect(sawMirror).toBe(true)
  })

  it("omits mirror decoys when disabled", () => {
    for (let seed = 0; seed < 40; seed++) {
      const questions = generateQuizSession(
        AMINO_ACIDS_QUIZ.molecules,
        aaConfig(["nameToStructure", "letterToStructure"], 6, seed, { mirrorDecoys: false }),
      )
      for (const question of questions) {
        expect(question.options.some((option) => option.mirror === true)).toBe(false)
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
          if (option.correct || option.mirror === true) {
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

  it("holds question invariants with zero mirror decoys across 50 seeds", () => {
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
          expect(option.mirror === true).toBe(false)
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

  it("returns undefined for an unknown category id", () => {
    expect(getCategoryQuizConfig("neznamy")).toBeUndefined()
  })
})
