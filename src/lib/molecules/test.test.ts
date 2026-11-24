import { describe, expect, it } from "vitest"
import type { Biomolecule } from "@/lib/biomolecules-api"
import {
  type BiomoleculeTest,
  enumerateTestPairs,
  generatableTestTypes,
  generateTestSession,
  questionFingerprints,
  regradeTestAttempt,
  resolveTestScope,
  tagTestQuestions,
  testPairCount,
  testQuestionPool,
} from "@/lib/molecules/test"
import { TEST_AMINO_ACIDS, TEST_NITROGEN_BASES } from "./quiz/__tests__/fixtures"

const AA_SLUG = TEST_AMINO_ACIDS[0]?.categorySlug ?? "aminokyseliny"
const BASE_SLUG = TEST_NITROGEN_BASES[0]?.categorySlug ?? "dusikate-baze"

function moleculeAt(molecules: Biomolecule[], index: number): Biomolecule {
  const molecule = molecules[index]
  if (molecule === undefined) {
    throw new Error(`fixture is missing molecule at index ${index}`)
  }
  return molecule
}

function makeTest(overrides: Partial<BiomoleculeTest> = {}): BiomoleculeTest {
  return {
    id: "test-1",
    title: "Test",
    categorySlugs: [AA_SLUG],
    moleculeIds: [],
    questionTypes: ["nameToStructure", "structureToName"],
    questionCount: 10,
    questionSet: "fixed",
    monochrome: false,
    availableFrom: "2026-01-01T00:00:00Z",
    availableTo: "2026-12-31T23:59:59Z",
    seed: 1,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function requirePool(
  test: Pick<BiomoleculeTest, "categorySlugs" | "moleculeIds">,
  molecules: Biomolecule[],
) {
  const pool = testQuestionPool(test, molecules)
  if (pool === null) {
    throw new Error("expected a non-empty test pool")
  }
  return pool
}

function pairIdentity(question: { type: string; targetId: string }): string {
  return `${question.type}:${question.targetId}`
}

describe("resolveTestScope", () => {
  it("preserves the snapshot's molecule order", () => {
    const chosen = [
      moleculeAt(TEST_AMINO_ACIDS, 3),
      moleculeAt(TEST_AMINO_ACIDS, 0),
      moleculeAt(TEST_AMINO_ACIDS, 7),
    ]
    const scope = resolveTestScope(
      makeTest({ moleculeIds: chosen.map((molecule) => molecule.id) }),
      [...TEST_NITROGEN_BASES, ...TEST_AMINO_ACIDS],
    )
    expect(scope.map((molecule) => molecule.id)).toEqual(chosen.map((molecule) => molecule.id))
  })

  it("skips unknown ids and molecules outside the test's categories", () => {
    const first = moleculeAt(TEST_AMINO_ACIDS, 1)
    const second = moleculeAt(TEST_AMINO_ACIDS, 2)
    const foreign = moleculeAt(TEST_NITROGEN_BASES, 0)
    const scope = resolveTestScope(
      makeTest({
        categorySlugs: [AA_SLUG],
        moleculeIds: [first.id, "deleted-molecule", foreign.id, second.id],
      }),
      [...TEST_AMINO_ACIDS, ...TEST_NITROGEN_BASES],
    )
    expect(scope.map((molecule) => molecule.id)).toEqual([first.id, second.id])
  })

  it("falls back to category filtering when moleculeIds is empty", () => {
    const scope = resolveTestScope(makeTest({ categorySlugs: [BASE_SLUG], moleculeIds: [] }), [
      ...TEST_AMINO_ACIDS,
      ...TEST_NITROGEN_BASES,
    ])
    expect(scope.map((molecule) => molecule.id)).toEqual(
      TEST_NITROGEN_BASES.map((molecule) => molecule.id),
    )
  })
})

describe("testQuestionPool", () => {
  it("adapts the snapshot into a merged quiz pool", () => {
    const pool = requirePool(makeTest(), TEST_AMINO_ACIDS)
    expect(pool.molecules).toHaveLength(TEST_AMINO_ACIDS.length)
    expect(pool.molecules[0]?.oneLetter).toBeDefined()
  })

  it("returns null when the snapshot resolves to nothing", () => {
    expect(testQuestionPool(makeTest({ moleculeIds: ["gone"] }), TEST_AMINO_ACIDS)).toBeNull()
  })

  it("returns null for an empty category list", () => {
    expect(testQuestionPool(makeTest({ categorySlugs: [] }), TEST_AMINO_ACIDS)).toBeNull()
  })
})

describe("generatableTestTypes", () => {
  it("intersects the stored types with what the material can generate", () => {
    const pool = requirePool(makeTest({ categorySlugs: [BASE_SLUG] }), TEST_NITROGEN_BASES)
    const types = generatableTestTypes(pool.molecules, pool.characteristics, [
      "nameToLetter",
      "nameToStructure",
      "structureToName",
    ])
    // Nitrogen bases have no quiz letters, so the letter type drops out.
    expect(types).toEqual(["nameToStructure", "structureToName"])
  })

  it("keeps the stored type order and drops duplicates", () => {
    const pool = requirePool(makeTest(), TEST_AMINO_ACIDS)
    const types = generatableTestTypes(pool.molecules, pool.characteristics, [
      "structureToName",
      "nameToStructure",
      "structureToName",
    ])
    expect(types).toEqual(["structureToName", "nameToStructure"])
  })
})

describe("testPairCount / enumerateTestPairs", () => {
  it("enumerates every molecule × generatable type pair", () => {
    const types = ["nameToStructure", "structureToName"]
    const pool = requirePool(makeTest({ categorySlugs: [BASE_SLUG] }), TEST_NITROGEN_BASES)
    const pairs = enumerateTestPairs(pool.molecules, pool.characteristics, types)

    expect(pairs).toHaveLength(pool.molecules.length * types.length)
    expect(testPairCount(pool.molecules, pool.characteristics, types)).toBe(pairs.length)

    const identities = new Set(pairs.map((pair) => `${pair.type}:${pair.molecule.id}`))
    expect(identities.size).toBe(pairs.length)
  })
})

describe("generateTestSession", () => {
  it("is deterministic for the same attempt seed", () => {
    const test = makeTest({ questionCount: 12 })
    const first = generateTestSession(test, 555, TEST_AMINO_ACIDS)
    const second = generateTestSession(test, 555, TEST_AMINO_ACIDS)

    expect(first).not.toBeNull()
    expect(first).toHaveLength(12)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it("changes with a different attempt seed", () => {
    const test = makeTest({ questionCount: 12 })
    const first = generateTestSession(test, 1, TEST_AMINO_ACIDS)
    const second = generateTestSession(test, 2, TEST_AMINO_ACIDS)
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second))
  })

  it("returns null when the scope is empty", () => {
    const test = makeTest({ moleculeIds: ["gone"] })
    expect(generateTestSession(test, 1, TEST_AMINO_ACIDS)).toBeNull()
  })

  it("returns null when no stored type is generatable any more", () => {
    const test = makeTest({
      categorySlugs: [BASE_SLUG],
      questionTypes: ["nameToLetter"],
      questionCount: 5,
    })
    expect(generateTestSession(test, 1, TEST_NITROGEN_BASES)).toBeNull()
  })

  it("uses exhaustive pairs when count equals the pair count", () => {
    const snapshot = TEST_AMINO_ACIDS.slice(0, 3)
    const types = ["nameToStructure", "structureToName"]
    const test = makeTest({
      moleculeIds: snapshot.map((molecule) => molecule.id),
      questionTypes: types,
      questionCount: snapshot.length * types.length,
    })

    const questions = generateTestSession(test, 42, TEST_AMINO_ACIDS)
    expect(questions).not.toBeNull()
    if (questions === null) return

    expect(questions).toHaveLength(test.questionCount)
    // Quiz molecules identify by their per-category slug, not the API id.
    const expected = new Set(snapshot.map((molecule) => molecule.slug))
    const produced = questions.map(pairIdentity)
    expect(new Set(produced).size).toBe(produced.length)
    for (const identity of produced) {
      const [type, id] = identity.split(":")
      expect(types).toContain(type)
      expect(expected.has(id ?? "")).toBe(true)
    }
    // Every pair appears exactly once.
    expect(new Set(produced).size).toBe(test.questionCount)
  })

  it("cycles the pairs when count exceeds the pair count", () => {
    const snapshot = TEST_AMINO_ACIDS.slice(0, 3)
    const types = ["nameToStructure", "structureToName"]
    const pairCount = snapshot.length * types.length
    const test = makeTest({
      moleculeIds: snapshot.map((molecule) => molecule.id),
      questionTypes: types,
      questionCount: pairCount + 3,
    })

    const questions = generateTestSession(test, 7, TEST_AMINO_ACIDS)
    expect(questions).not.toBeNull()
    if (questions === null) return

    expect(questions).toHaveLength(pairCount + 3)
    const allowed = new Set(
      snapshot.flatMap((molecule) => types.map((type) => `${type}:${molecule.slug}`)),
    )
    for (const question of questions) {
      expect(allowed.has(pairIdentity(question))).toBe(true)
    }
  })
})

describe("regradeTestAttempt", () => {
  const test = makeTest({ questionTypes: ["structureToName"] })
  const seed = 99
  const molecules = TEST_AMINO_ACIDS

  function detail(pick: "right" | "wrong" | "none") {
    const questions = tagTestQuestions(generateTestSession(test, seed, molecules) ?? [], seed)
    return {
      fingerprints: questionFingerprints(questions, requirePool(test, molecules).molecules),
      answers: questions.map((question) => ({
        uid: question.uid,
        correct: true, // always claimed; must be ignored
        selectedKey:
          pick === "none"
            ? null
            : (question.options.find((option) => option.correct === (pick === "right"))?.key ??
              null),
      })),
    }
  }

  it("grades the stored picks and ignores claimed verdicts", () => {
    const grade = (pick: "right" | "wrong" | "none") =>
      regradeTestAttempt(test, seed, JSON.stringify(detail(pick)), molecules)
    expect(grade("right")).toMatchObject({ correct: 10, total: 10 })
    expect(grade("wrong")).toMatchObject({ correct: 0, total: 10 })
    expect(grade("none")).toMatchObject({ correct: 0, total: 10 })
  })

  it("refuses edited material, truncated answers and malformed detail", () => {
    const full = detail("right")
    const renamed = molecules.map((molecule) => ({ ...molecule, name: `${molecule.name} X` }))
    expect(regradeTestAttempt(test, seed, JSON.stringify(full), renamed)).toBeNull()
    const short = { ...full, answers: full.answers.slice(0, 1) }
    expect(regradeTestAttempt(test, seed, JSON.stringify(short), molecules)).toBeNull()
    for (const bad of [null, "null", "{}", "nope"]) {
      expect(regradeTestAttempt(test, seed, bad, molecules)).toBeNull()
    }
  })
})
