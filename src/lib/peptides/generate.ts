import { createSeededRandom, pick } from "@/lib/molecules/quiz/random"

/**
 * Draw `length` residue slugs uniformly from `slugPool`, seeded — the same
 * seed and pool always yield the same peptide, so a game round is stable
 * across rerenders and unit-testable.
 */
export function generatePeptide(
  slugPool: readonly string[],
  length: number,
  seed: number,
): string[] {
  if (slugPool.length === 0) {
    throw new Error("generatePeptide requires a non-empty slug pool")
  }
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`generatePeptide requires an integer length >= 1 (got ${length})`)
  }
  const rng = createSeededRandom(seed)
  return Array.from({ length }, () => pick(rng, slugPool))
}
