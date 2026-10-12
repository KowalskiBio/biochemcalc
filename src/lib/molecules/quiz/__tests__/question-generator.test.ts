import { describe, expect, it } from "vitest"
import { AMINO_ACIDS, type AminoAcid } from "@/lib/molecules/amino-acids"
import {
  ALL_QUIZ_TYPES,
  availableQuizTypes,
  generateQuizSession,
  moleculeMatchesPredicate,
} from "@/lib/molecules/quiz/question-generator"

const ALL_TYPES = [...ALL_QUIZ_TYPES]
const moleculeById = new Map<string, AminoAcid>(AMINO_ACIDS.map((m) => [m.id, m]))

function getMolecule(id: string): AminoAcid {
  const molecule = moleculeById.get(id)
  if (molecule === undefined) {
    throw new Error(`Unknown molecule id: ${id}`)
  }
  return molecule
}

describe("availableQuizTypes", () => {
  it("returns all seven types for the full dataset", () => {
    expect([...availableQuizTypes(AMINO_ACIDS)].sort()).toEqual([...ALL_TYPES].sort())
  })

  it("drops letter types when a molecule lacks oneLetter", () => {
    const mocked: AminoAcid[] = AMINO_ACIDS.map((molecule, index) =>
      index === 0 ? { ...molecule, oneLetter: "" } : molecule,
    )
    const types = availableQuizTypes(mocked)
    expect(types).toHaveLength(3)
    expect(types).not.toContain("nameToLetter")
    expect(types).not.toContain("letterToName")
    expect(types).not.toContain("letterToStructure")
    expect(types).not.toContain("structureToLetter")
    expect(types).toContain("nameToStructure")
    expect(types).toContain("structureToName")
    expect(types).toContain("characteristic")
  })
})

describe("generateQuizSession determinism", () => {
  it("produces identical questions for the same seed", () => {
    const config = { types: ALL_TYPES, questionCount: 24, seed: 1234 }
    const first = generateQuizSession(AMINO_ACIDS, config)
    const second = generateQuizSession(AMINO_ACIDS, config)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it("produces different sessions for different seeds", () => {
    const first = generateQuizSession(AMINO_ACIDS, { types: ALL_TYPES, questionCount: 24, seed: 1 })
    const second = generateQuizSession(AMINO_ACIDS, {
      types: ALL_TYPES,
      questionCount: 24,
      seed: 2,
    })
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second))
  })
})

describe("question invariants", () => {
  it("holds across 200 seeds and all seven types", () => {
    for (let seed = 0; seed < 200; seed++) {
      const questions = generateQuizSession(AMINO_ACIDS, {
        types: ALL_TYPES,
        questionCount: 7,
        seed,
      })
      expect(questions).toHaveLength(7)

      for (const question of questions) {
        const target = getMolecule(question.targetId)

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
      const questions = generateQuizSession(AMINO_ACIDS, {
        types: ["nameToStructure", "letterToStructure"],
        questionCount: 8,
        seed,
      })
      for (const question of questions) {
        const target = getMolecule(question.targetId)
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
      const questions = generateQuizSession(AMINO_ACIDS, {
        types: ["nameToStructure", "letterToStructure"],
        questionCount: 6,
        seed,
        mirrorDecoys: false,
      })
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
      const questions = generateQuizSession(AMINO_ACIDS, {
        types: ["nameToStructure"],
        questionCount: 4,
        seed,
      })
      for (const question of questions) {
        const target = getMolecule(question.targetId)
        for (const option of question.options) {
          if (option.correct || option.mirror === true) {
            continue
          }
          distractorCount++
          if (getMolecule(option.moleculeId).sideChain === target.sideChain) {
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
    const questions = generateQuizSession(AMINO_ACIDS, {
      types: ALL_TYPES,
      questionCount: 21,
      seed: 99,
    })
    expect(questions).toHaveLength(21)
    for (let i = 1; i < questions.length; i++) {
      expect(questions[i].targetId).not.toBe(questions[i - 1].targetId)
    }
  })
})

describe("characteristic questions", () => {
  it("picks a predicate with enough matches and exactly one matching option", () => {
    for (let seed = 0; seed < 100; seed++) {
      const questions = generateQuizSession(AMINO_ACIDS, {
        types: ["characteristic"],
        questionCount: 6,
        seed,
      })
      for (const question of questions) {
        expect(question.prompt.kind).toBe("characteristic")
        const predicate = question.prompt.predicate
        if (predicate === undefined) {
          throw new Error("characteristic question is missing its predicate")
        }

        const matches = AMINO_ACIDS.filter((molecule) =>
          moleculeMatchesPredicate(molecule, predicate),
        )
        const nonMatches = AMINO_ACIDS.filter(
          (molecule) => !moleculeMatchesPredicate(molecule, predicate),
        )
        expect(matches.length).toBeGreaterThanOrEqual(1)
        expect(nonMatches.length).toBeGreaterThanOrEqual(3)

        const matchingOptions = question.options.filter((option) =>
          moleculeMatchesPredicate(getMolecule(option.moleculeId), predicate),
        )
        expect(matchingOptions).toHaveLength(1)
        expect(question.options.filter((option) => option.correct)).toHaveLength(1)

        for (const option of question.options) {
          expect(option.display).toBe("name")
        }
      }
    }
  })
})
