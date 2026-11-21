// Teacher-created biomolecules tests — the client-side generation glue.
//
// A test stores a SNAPSHOT of the material it was built from (category slugs +
// molecule ids) and the question types it wants. This module turns that
// snapshot into a quiz session with the shared engine. It is pure: no React,
// no network — the run page passes in the already-loaded molecule data.
//
// Notes for the UI lane:
// - Monochrome and easy/hard `mode` are NOT generation concerns. v1 tests are
//   easy-mode multiple choice; the run page handles the display (monochrome)
//   and any later difficulty wiring.
// - When the stored material no longer produces a generatable type, the
//   helpers return null / empty so the run page can show "material changed".

import type { Biomolecule } from "@/lib/biomolecules-api"
import { getMergedQuizConfig } from "@/lib/molecules/quiz/category-quiz"
import {
  ALL_QUIZ_TYPES,
  type CharacteristicDef,
  type GenerateQuizConfig,
  generatableQuizTypes,
  generateQuizSession,
  type QuizMolecule,
  type QuizPair,
  type QuizQuestion,
  type QuizQuestionType,
} from "@/lib/molecules/quiz/question-generator"

/**
 * Structural copy of the server-lane `BiomoleculeTest` contract. Defined here
 * (rather than imported) so this pure module lands before `biomolecules-api.ts`
 * grows the type; the fields mirror the pinned contract exactly, so the server
 * type is assignable both ways once it exists.
 */
export interface BiomoleculeTest {
  id: string
  title: string
  categorySlugs: string[]
  moleculeIds: string[]
  questionTypes: string[]
  questionCount: number
  questionSet: "fixed" | "random"
  monochrome: boolean
  availableFrom: string
  availableTo: string
  seed: number
  createdAt: string
}

/** The generatable material a test resolves to, adapted for the quiz engine. */
export interface TestQuestionPool {
  molecules: QuizMolecule[]
  characteristics?: CharacteristicDef[]
}

const ALL_TYPES = new Set<string>(ALL_QUIZ_TYPES)

function isQuizQuestionType(value: string): value is QuizQuestionType {
  return ALL_TYPES.has(value)
}

/**
 * The molecules a test is allowed to quiz, in the test's SNAPSHOT order.
 *
 * `moleculeIds` is authoritative when non-empty: ids are looked up in that
 * order and unknown ids are skipped, then the result is restricted to the
 * test's categories. An empty `moleculeIds` is the legacy/edge case and falls
 * back to filtering the loaded library by category only (preserving its order).
 */
export function resolveTestScope(
  test: Pick<BiomoleculeTest, "categorySlugs" | "moleculeIds">,
  molecules: Biomolecule[],
): Biomolecule[] {
  const categories = new Set(test.categorySlugs)
  const inCategory = (molecule: Biomolecule): boolean => categories.has(molecule.categorySlug)

  if (test.moleculeIds.length === 0) {
    return molecules.filter(inCategory)
  }

  const byId = new Map(molecules.map((molecule) => [molecule.id, molecule]))
  const scope: Biomolecule[] = []
  for (const id of test.moleculeIds) {
    const molecule = byId.get(id)
    if (molecule !== undefined && inCategory(molecule)) {
      scope.push(molecule)
    }
  }
  return scope
}

/**
 * Build the merged quiz pool for a test: the resolved snapshot grouped by the
 * test's category slugs, each group adapted by its own category adapter, then
 * merged and re-qualified exactly like `getMergedQuizConfig` does for the
 * topic-wide quiz. Returns null when the snapshot resolves to nothing (the
 * categories/molecules were deleted or moved away).
 */
export function testQuestionPool(
  test: Pick<BiomoleculeTest, "categorySlugs" | "moleculeIds">,
  molecules: Biomolecule[],
): TestQuestionPool | null {
  const scope = resolveTestScope(test, molecules)
  if (scope.length === 0) {
    return null
  }

  // Keep the test's category order (and dedupe) so per-category quiz letters and
  // distractor classes survive the merge. Only categories that still hold
  // scoped molecules contribute an entry.
  const entries: { categoryId: string; molecules: Biomolecule[] }[] = []
  const seen = new Set<string>()
  for (const categoryId of test.categorySlugs) {
    if (seen.has(categoryId)) continue
    seen.add(categoryId)
    const categoryMolecules = scope.filter((molecule) => molecule.categorySlug === categoryId)
    if (categoryMolecules.length > 0) {
      entries.push({ categoryId, molecules: categoryMolecules })
    }
  }

  const config = getMergedQuizConfig(entries)
  if (config === undefined) {
    return null
  }
  return { molecules: config.molecules, characteristics: config.characteristics }
}

/**
 * The test's requested types that this material can still generate, in the
 * test's stored order. A teacher test may lose types when its material changes
 * (e.g. the last molecule with a quiz letter is removed).
 */
export function generatableTestTypes(
  molecules: QuizMolecule[],
  characteristics: CharacteristicDef[] | undefined,
  types: readonly string[],
): QuizQuestionType[] {
  const generatable = new Set<QuizQuestionType>(generatableQuizTypes(molecules, characteristics))
  const result: QuizQuestionType[] = []
  const seen = new Set<string>()
  for (const type of types) {
    if (seen.has(type) || !isQuizQuestionType(type) || !generatable.has(type)) {
      continue
    }
    seen.add(type)
    result.push(type)
  }
  return result
}

/**
 * Every generatable (molecule × type) pair for the test, in pool order. This is
 * the exhaustive "all questions" enumeration, consumed by the engine's
 * `pairs` mode.
 */
export function enumerateTestPairs(
  molecules: QuizMolecule[],
  characteristics: CharacteristicDef[] | undefined,
  types: readonly string[],
): QuizPair[] {
  const generatable = generatableTestTypes(molecules, characteristics, types)
  const pairs: QuizPair[] = []
  for (const molecule of molecules) {
    for (const type of generatable) {
      pairs.push({ molecule, type })
    }
  }
  return pairs
}

/** The number of generatable (molecule × type) pairs — the UI's "all" display. */
export function testPairCount(
  molecules: QuizMolecule[],
  characteristics: CharacteristicDef[] | undefined,
  types: readonly string[],
): number {
  return enumerateTestPairs(molecules, characteristics, types).length
}

/**
 * Generate one attempt's session end-to-end:
 * resolve the snapshot → intersect the stored types with what is generatable →
 * build the engine config with `attemptSeed`.
 *
 * When the requested count covers the whole pair set (`questionCount >=
 * pairCount`) the explicit pairs are passed, so the engine treats it as an
 * exhaustive "all questions" draw instead of independently sampling type and
 * target. Otherwise the plain type+count queues are used.
 *
 * Returns null when the material can no longer generate any stored type (the
 * run page shows "material changed"). Display concerns (monochrome, difficulty)
 * are intentionally out of scope.
 */
export function generateTestSession(
  test: Pick<BiomoleculeTest, "categorySlugs" | "moleculeIds" | "questionTypes" | "questionCount">,
  attemptSeed: number,
  molecules: Biomolecule[],
): QuizQuestion[] | null {
  const pool = testQuestionPool(test, molecules)
  if (pool === null) {
    return null
  }

  const types = generatableTestTypes(pool.molecules, pool.characteristics, test.questionTypes)
  if (types.length === 0) {
    return null
  }

  const pairs = enumerateTestPairs(pool.molecules, pool.characteristics, types)
  const config: GenerateQuizConfig = {
    types,
    questionCount: test.questionCount,
    seed: attemptSeed,
    characteristics: pool.characteristics,
  }
  if (pairs.length > 0 && test.questionCount >= pairs.length) {
    config.pairs = pairs
  }

  return generateQuizSession(pool.molecules, config)
}
