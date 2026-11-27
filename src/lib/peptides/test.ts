// Peptidovka teacher-tests – the client-side generation/grading glue.
//
// Pure: no React, no network, no RDKit. The run page passes in the already
// loaded molecule data plus the attempt seed and gets back exactly the
// one-letter answers and structure parts the game would serve.
//
// Notes for the UI lane:
// - `structures` are the raw `peptideParts` output. Feed `smiles` to
//   `StructureView`; for the canonical N-left reading direction compute
//   `nLeftOrientationDeg(structure.smiles, structure.nIndex)` exactly like the
//   Učeň run page (its `nLeftDeg` wrapper degrades to 0 on a geometry hiccup).
// - The chains ARE the answers: never persist them. Store
//   `chainFingerprints(run.chains)` for resume-time pool-drift detection.
// - When the pool can no longer be resolved/synthesized, generation returns
//   null and the page shows its "material changed" state instead of a run.

import { fnv1a } from "@/lib/fnv1a"
import { TRAIT } from "@/lib/molecules"
import { createSeededRandom } from "@/lib/molecules/quiz/random"
import { expectedChainLetters, isChainCorrect } from "@/lib/peptides/answer"
import { generatePeptide } from "@/lib/peptides/generate"
import { type PeptideParts, peptideParts } from "@/lib/peptides/synthesize"

/** The server's accepted peptide-length bounds (migration v65 / command layer). */
const PEPTIDE_MIN_LENGTH = 2
const PEPTIDE_MAX_LENGTH = 20

/**
 * Structural copy of the server-lane `PeptidovkaTest` contract. Defined here
 * (rather than imported) so this pure module lands before `biomolecules-api.ts`
 * grows the type; the fields mirror the pinned contract exactly, so the server
 * type is assignable both ways once it exists.
 */
export interface PeptidovkaTest {
  id: string
  title: string
  poolSlugs: string[]
  peptideCount: number
  peptideMinLength: number
  peptideMaxLength: number
  questionSet: "fixed" | "random"
  monochrome: boolean
  availableFrom: string
  availableTo: string
  seed: number
  createdAt: string
}

/**
 * The minimal molecule shape this glue needs. The data-store `Biomolecule`
 * satisfies it directly (both carry `slug` and `traits`).
 */
export interface BiomoleculeLike {
  slug: string
  traits: Record<string, string>
}

/** One attempt's generated material: answers and their render parts, parallel. */
export interface PeptidovkaTestRun {
  /** One-letter answers N→C, uppercased – the grader's expected strings. */
  chains: string[]
  /** `peptideParts` output per chain, in the same order as `chains`. */
  structures: PeptideParts[]
}

/**
 * The generator's weighted pool: every test slug at weight 1 (uniform draw),
 * matching the pinned "each slug weight 1" contract. Duplicate slugs collapse.
 */
export function peptidovkaTestPoolWeights(
  test: Pick<PeptidovkaTest, "poolSlugs">,
): Record<string, number> {
  const weights: Record<string, number> = {}
  for (const slug of test.poolSlugs) {
    weights[slug] = 1
  }
  return weights
}

/**
 * Resolve every pool slug to its one-letter code via the loaded molecule data.
 * Mirrors the run page's playability rule: a slug must exist and carry a
 * non-blank `oneLetter` trait. Returns null when any slug cannot be resolved
 * (deleted molecule, stripped code, or a stale slug).
 */
function resolvePoolLetters(
  poolSlugs: readonly string[],
  molecules: readonly BiomoleculeLike[],
): Map<string, string> | null {
  const bySlug = new Map<string, BiomoleculeLike>()
  for (const molecule of molecules) {
    if (!bySlug.has(molecule.slug)) {
      bySlug.set(molecule.slug, molecule)
    }
  }

  const letters = new Map<string, string>()
  for (const slug of poolSlugs) {
    const oneLetter = bySlug.get(slug)?.traits[TRAIT.oneLetter]
    if (oneLetter === undefined || oneLetter.trim().length === 0) {
      return null
    }
    letters.set(slug, oneLetter.trim().toUpperCase())
  }
  return letters
}

/**
 * Generate the test's peptides for one attempt seed.
 *
 * Seed derivation (documented, deterministic). ONE mulberry32 generator is
 * seeded with `attemptSeed`; per peptide, in a fixed order, it draws:
 *   1. the peptide's length: `min + floor(rng() * (max - min + 1))`, and
 *   2. the peptide's own 32-bit seed: `floor(rng() * 2^32)`.
 * That per-peptide seed then drives `generatePeptide`. Deriving every peptide
 * from successive *outputs* of one chain (rather than from `attemptSeed + i`)
 * decorrelates the peptides: consecutive mulberry32 seeds shared a correlated
 * first draw and could produce the same peptide five times over.
 *
 * The pool is drawn in slug-sorted order by `generatePeptide`, so `poolSlugs`
 * order never matters, and the same `attemptSeed` always reproduces the run.
 *
 * Returns null when the test is malformed: a non-positive/non-integer count or
 * length bounds outside `2..=20` with min > max, an empty pool, an unresolvable
 * slug (missing molecule or missing one-letter code), or synthesis failure (a
 * slug with no residue template, e.g. a teacher-added amino acid the
 * synthesizer doesn't know). The run page shows "material changed" rather than
 * a broken run.
 */
export function generatePeptidovkaTestRun(
  test: Pick<
    PeptidovkaTest,
    "poolSlugs" | "peptideCount" | "peptideMinLength" | "peptideMaxLength"
  >,
  attemptSeed: number,
  molecules: readonly BiomoleculeLike[],
): PeptidovkaTestRun | null {
  if (!Number.isInteger(test.peptideCount) || test.peptideCount < 1) {
    return null
  }
  if (
    !Number.isInteger(test.peptideMinLength) ||
    !Number.isInteger(test.peptideMaxLength) ||
    test.peptideMinLength < PEPTIDE_MIN_LENGTH ||
    test.peptideMaxLength > PEPTIDE_MAX_LENGTH ||
    test.peptideMinLength > test.peptideMaxLength
  ) {
    return null
  }
  if (test.poolSlugs.length === 0) {
    return null
  }

  const letters = resolvePoolLetters(test.poolSlugs, molecules)
  if (letters === null) {
    return null
  }

  const poolWeights = peptidovkaTestPoolWeights(test)
  const rng = createSeededRandom(attemptSeed)
  const lengthSpan = test.peptideMaxLength - test.peptideMinLength + 1
  const chains: string[] = []
  const structures: PeptideParts[] = []

  for (let index = 0; index < test.peptideCount; index++) {
    // Fixed per-peptide draw order: length first, then the peptide seed.
    const length = test.peptideMinLength + Math.floor(rng() * lengthSpan)
    const peptideSeed = Math.floor(rng() * 0x1_0000_0000)
    const slugs = generatePeptide(poolWeights, length, peptideSeed)
    const parts = peptideParts(slugs)
    if (parts === null) {
      return null
    }

    const oneLetters: string[] = []
    for (const slug of slugs) {
      const oneLetter = letters.get(slug)
      if (oneLetter === undefined) {
        return null
      }
      oneLetters.push(oneLetter)
    }

    chains.push(expectedChainLetters(oneLetters))
    structures.push(parts)
  }

  return { chains, structures }
}

/**
 * Grade a typed one-letter chain against the test's expected chain.
 *
 * Argument order matches the generation output: `chain` is the expected
 * N→C string (`run.chains[i]`), `input` is what the student typed. Wraps the
 * game's own `isChainCorrect` (case- and whitespace-insensitive exact match),
 * so test grading is byte-identical to a Peptidovka round.
 */
export function isPeptideAnswerCorrect(chain: string, input: string): boolean {
  return isChainCorrect(input, chain)
}

/**
 * Non-reversible fingerprints of the answer chains, for resume-time pool-drift
 * detection. Persist these INSTEAD of the chains (the chains are the answers):
 * on resume, regenerate and compare fingerprints; a mismatch means the pool
 * changed and the attempt should restart.
 */
export function chainFingerprints(chains: readonly string[]): string[] {
  return chains.map((chain) => fnv1a(chain))
}

export interface RegradedPeptidovkaTest {
  run: PeptidovkaTestRun
  rows: { typed: string | null; correct: boolean }[]
  correct: number
  total: number
}

/**
 * Re-grade a submitted attempt from its server-issued seed and typed answers,
 * ignoring the score the student's browser claimed. Null when it cannot be
 * verified: malformed detail, or a pool edited since submission.
 */
export function regradePeptidovkaAttempt(
  test: Parameters<typeof generatePeptidovkaTestRun>[0],
  attemptSeed: number,
  detailJson: string | null,
  molecules: readonly BiomoleculeLike[],
): RegradedPeptidovkaTest | null {
  if (detailJson === null) return null
  let typed: unknown
  let stored: unknown
  try {
    const parsed = JSON.parse(detailJson) as { typed?: unknown; fingerprints?: unknown } | null
    typed = parsed?.typed
    stored = parsed?.fingerprints
  } catch {
    return null
  }
  if (!Array.isArray(typed) || !Array.isArray(stored)) return null
  const run = generatePeptidovkaTestRun(test, attemptSeed, molecules)
  if (run === null || typed.length !== run.chains.length) return null
  const fingerprints = chainFingerprints(run.chains)
  if (stored.length !== fingerprints.length) return null
  if (fingerprints.some((fingerprint, index) => fingerprint !== stored[index])) return null

  const rows = run.chains.map((chain, index) => {
    const value: unknown = typed[index]
    const answer = typeof value === "string" ? value : null
    return { typed: answer, correct: answer !== null && isPeptideAnswerCorrect(chain, answer) }
  })
  return { run, rows, correct: rows.filter((row) => row.correct).length, total: rows.length }
}
