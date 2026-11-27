import { describe, expect, it } from "vitest"
import { TRAIT } from "@/lib/molecules"
import { createSeededRandom } from "@/lib/molecules/quiz/random"
import { expectedChainLetters, isChainCorrect } from "@/lib/peptides/answer"
import { generatePeptide } from "@/lib/peptides/generate"
import { peptideParts } from "@/lib/peptides/synthesize"
import {
  type BiomoleculeLike,
  chainFingerprints,
  generatePeptidovkaTestRun,
  isPeptideAnswerCorrect,
  type PeptidovkaTest,
  type PeptidovkaTestRun,
  peptidovkaTestPoolWeights,
  regradePeptidovkaAttempt,
} from "@/lib/peptides/test"

const MOLECULES: BiomoleculeLike[] = [
  { slug: "ala", traits: { oneLetter: "A" } },
  { slug: "gly", traits: { oneLetter: "G" } },
  { slug: "ser", traits: { oneLetter: "S" } },
  { slug: "pro", traits: { oneLetter: "P" } },
  { slug: "lys", traits: { oneLetter: "K" } },
  { slug: "phe", traits: { oneLetter: "F" } },
]

function makeTest(overrides: Partial<PeptidovkaTest> = {}): PeptidovkaTest {
  return {
    id: "peptidovka-test-1",
    title: "Peptidovka",
    poolSlugs: ["ala", "gly", "ser", "pro"],
    peptideCount: 5,
    peptideMinLength: 4,
    peptideMaxLength: 6,
    questionSet: "fixed",
    monochrome: false,
    availableFrom: "2026-01-01T00:00:00Z",
    availableTo: "2026-12-31T23:59:59Z",
    seed: 1,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function requireRun(
  test: Pick<
    PeptidovkaTest,
    "poolSlugs" | "peptideCount" | "peptideMinLength" | "peptideMaxLength"
  >,
  attemptSeed: number,
  molecules: readonly BiomoleculeLike[] = MOLECULES,
): PeptidovkaTestRun {
  const run = generatePeptidovkaTestRun(test, attemptSeed, molecules)
  if (run === null) {
    throw new Error("expected a generatable test run")
  }
  return run
}

describe("peptidovkaTestPoolWeights", () => {
  it("maps every slug to weight 1 and collapses duplicates", () => {
    expect(peptidovkaTestPoolWeights(makeTest({ poolSlugs: ["ala", "gly", "ala"] }))).toEqual({
      ala: 1,
      gly: 1,
    })
  })

  it("returns an empty record for an empty pool", () => {
    expect(peptidovkaTestPoolWeights(makeTest({ poolSlugs: [] }))).toEqual({})
  })
})

describe("generatePeptidovkaTestRun", () => {
  it("is deterministic for the same test and attempt seed", () => {
    const first = requireRun(makeTest(), 1234)
    const second = requireRun(makeTest(), 1234)
    expect(second).toEqual(first)
  })

  it("yields different peptides for a different attempt seed", () => {
    const first = requireRun(makeTest(), 1)
    const second = requireRun(makeTest(), 2)
    expect(second.chains).not.toEqual(first.chains)
  })

  it("ignores pool-slug order", () => {
    const forward = requireRun(makeTest({ poolSlugs: ["ala", "gly", "ser", "pro"] }), 99)
    const reversed = requireRun(makeTest({ poolSlugs: ["pro", "ser", "gly", "ala"] }), 99)
    expect(reversed).toEqual(forward)
  })

  it("honours peptideCount and the length range", () => {
    const run = requireRun(
      makeTest({ peptideCount: 7, peptideMinLength: 3, peptideMaxLength: 5 }),
      5,
    )
    expect(run.chains).toHaveLength(7)
    expect(run.structures).toHaveLength(7)
    for (const chain of run.chains) {
      expect(chain.length).toBeGreaterThanOrEqual(3)
      expect(chain.length).toBeLessThanOrEqual(5)
      expect(chain).toMatch(/^[A-Z]+$/)
    }

    // A single-value range pins the length exactly.
    const fixed = requireRun(
      makeTest({ peptideCount: 4, peptideMinLength: 3, peptideMaxLength: 3 }),
      5,
    )
    for (const chain of fixed.chains) {
      expect(chain).toHaveLength(3)
    }
  })

  it("matches the documented per-peptide derivation (length, then seed)", () => {
    const test = makeTest({ peptideMinLength: 3, peptideMaxLength: 6 })
    const attemptSeed = 321
    const run = requireRun(test, attemptSeed)
    const weights = peptidovkaTestPoolWeights(test)
    const rng = createSeededRandom(attemptSeed)
    const span = test.peptideMaxLength - test.peptideMinLength + 1

    for (let index = 0; index < test.peptideCount; index++) {
      const length = test.peptideMinLength + Math.floor(rng() * span)
      const peptideSeed = Math.floor(rng() * 0x1_0000_0000)
      const slugs = generatePeptide(weights, length, peptideSeed)
      expect(run.structures[index]).toEqual(peptideParts(slugs))

      const oneLetters = slugs.map((slug) => {
        const molecule = MOLECULES.find((candidate) => candidate.slug === slug)
        if (molecule === undefined) {
          throw new Error(`fixture is missing slug ${slug}`)
        }
        const oneLetter = molecule.traits[TRAIT.oneLetter]
        if (oneLetter === undefined) {
          throw new Error(`fixture is missing oneLetter for ${slug}`)
        }
        return oneLetter
      })
      expect(run.chains[index]).toBe(expectedChainLetters(oneLetters))
    }
  })

  it("decorrelates peptides for a timestamp-like seed (regression)", () => {
    // The old `attemptSeed + i` derivation produced the SAME chain five times
    // for this wrapped timestamp seed. Drawing both the length and the
    // per-peptide seed from one rng chain must yield visibly distinct chains.
    const run = requireRun(
      makeTest({ peptideCount: 5, peptideMinLength: 4, peptideMaxLength: 4 }),
      1_737_000_000_000,
    )
    expect(new Set(run.chains).size).toBeGreaterThanOrEqual(2)
  })

  it("returns null for an empty pool", () => {
    expect(generatePeptidovkaTestRun(makeTest({ poolSlugs: [] }), 1, MOLECULES)).toBeNull()
  })

  it("returns null for an unresolvable slug", () => {
    expect(
      generatePeptidovkaTestRun(makeTest({ poolSlugs: ["ala", "zzz"] }), 1, MOLECULES),
    ).toBeNull()
  })

  it("returns null when a slug loses its one-letter code", () => {
    const molecules: BiomoleculeLike[] = [...MOLECULES, { slug: "orn", traits: {} }]
    expect(
      generatePeptidovkaTestRun(makeTest({ poolSlugs: ["ala", "orn"] }), 1, molecules),
    ).toBeNull()
  })

  it("returns null on synthesis failure (no residue template)", () => {
    // "orn" resolves to a molecule and letter, but the synthesizer has no
    // template for it – the same "teacher-added acid" case the game redraws.
    const molecules: BiomoleculeLike[] = [{ slug: "orn", traits: { oneLetter: "B" } }]
    expect(
      generatePeptidovkaTestRun(
        makeTest({
          poolSlugs: ["orn"],
          peptideCount: 1,
          peptideMinLength: 2,
          peptideMaxLength: 2,
        }),
        7,
        molecules,
      ),
    ).toBeNull()
  })

  it("returns null for a non-positive/invalid count or length range", () => {
    for (const overrides of [
      { peptideCount: 0 },
      { peptideCount: -1 },
      { peptideCount: 1.5 },
      { peptideMinLength: 1, peptideMaxLength: 5 },
      { peptideMinLength: 2, peptideMaxLength: 21 },
      { peptideMinLength: 5, peptideMaxLength: 4 },
      { peptideMinLength: 2.5, peptideMaxLength: 5 },
      { peptideMinLength: 2, peptideMaxLength: 3.5 },
    ]) {
      expect(generatePeptidovkaTestRun(makeTest(overrides), 1, MOLECULES)).toBeNull()
    }
  })
})

describe("isPeptideAnswerCorrect", () => {
  it("matches the game's isChainCorrect semantics", () => {
    const expected =
      requireRun(makeTest({ peptideCount: 1, peptideMinLength: 4, peptideMaxLength: 4 }), 42)
        .chains[0] ?? ""
    const inputs = [
      expected,
      expected.toLowerCase(),
      ` ${expected.split("").join(" ")} `,
      `${expected}A`,
      expected.slice(0, -1),
      "",
    ]
    for (const input of inputs) {
      expect(isPeptideAnswerCorrect(expected, input)).toBe(isChainCorrect(input, expected))
    }
  })

  it("accepts case and whitespace variation, rejects a different chain", () => {
    expect(isPeptideAnswerCorrect("MKY", "m k y")).toBe(true)
    expect(isPeptideAnswerCorrect("MKY", "MKY")).toBe(true)
    expect(isPeptideAnswerCorrect("MKY", "MKA")).toBe(false)
  })
})

describe("chainFingerprints", () => {
  it("is stable across calls and tracks the chain order", () => {
    const chains = ["MKY", "AG", "W"]
    const first = chainFingerprints(chains)
    expect(first).toHaveLength(chains.length)
    expect(chainFingerprints(chains)).toEqual(first)
    expect(chainFingerprints(["W", "AG", "MKY"])).toEqual([first[2], first[1], first[0]])
  })

  it("differs for different chains and is 8-char hex", () => {
    const fingerprints = chainFingerprints(["MKY", "MKA", "AG", "GA"])
    for (const fingerprint of fingerprints) {
      expect(fingerprint).toMatch(/^[0-9a-f]{8}$/)
    }
    expect(new Set(fingerprints).size).toBe(fingerprints.length)
  })

  it("is non-reversible: the chain text never appears in the fingerprint", () => {
    const chain = "MKYPHE"
    expect(chainFingerprints([chain])[0]).not.toContain(chain)
  })
})

describe("regradePeptidovkaAttempt", () => {
  const run = requireRun(makeTest(), 99)
  const detail = (typed: (string | null)[]) =>
    JSON.stringify({
      fingerprints: chainFingerprints(run.chains),
      typed,
      correct: run.chains.map(() => true), // always claimed; must be ignored
    })

  it("grades the typed answers and ignores claimed verdicts", () => {
    const grade = (typed: (string | null)[]) =>
      regradePeptidovkaAttempt(makeTest(), 99, detail(typed), MOLECULES)
    expect(grade(run.chains)).toMatchObject({ correct: 5, total: 5 })
    expect(grade(run.chains.map(() => "XX"))).toMatchObject({ correct: 0, total: 5 })
    expect(grade(run.chains.map(() => null))).toMatchObject({ correct: 0, total: 5 })
  })

  it("refuses a changed run, truncated answers and malformed detail", () => {
    expect(regradePeptidovkaAttempt(makeTest(), 100, detail(run.chains), MOLECULES)).toBeNull()
    const short = detail(run.chains.slice(0, 1))
    expect(regradePeptidovkaAttempt(makeTest(), 99, short, MOLECULES)).toBeNull()
    for (const bad of [null, "null", "{}", "nope"]) {
      expect(regradePeptidovkaAttempt(makeTest(), 99, bad, MOLECULES)).toBeNull()
    }
  })
})
