import { createSeededRandom } from "@/lib/molecules/quiz/random"

interface WeightedEntry {
  readonly slug: string
  readonly weight: number
}

/**
 * Draw `length` residue slugs from `pool`, seeded — the same seed and weights
 * always yield the same peptide, so a game round is stable across rerenders
 * and unit-testable.
 *
 * `pool` maps each slug to a weight in `[0, 1]`: the probability of drawing a
 * slug at any position is `weight / totalWeight`, so a 0.5-weight acid appears
 * half as often as a 1-weight one and a 0-weight acid never appears. Sampling
 * is with replacement (duplicates are allowed).
 *
 * Entries are drawn in slug-sorted order, so two records holding the same
 * slug/weight pairs in different insertion orders produce the same chain.
 */
export function generatePeptide(
  pool: Readonly<Record<string, number>>,
  length: number,
  seed: number,
): string[] {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`generatePeptide requires an integer length >= 1 (got ${length})`)
  }

  const entries: WeightedEntry[] = []
  let totalWeight = 0
  for (const [slug, weight] of Object.entries(pool)) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error(
        `generatePeptide requires each weight to be a finite number in [0, 1] (got ${slug}: ${weight})`,
      )
    }
    if (weight > 0) {
      entries.push({ slug, weight })
      totalWeight += weight
    }
  }

  if (entries.length === 0) {
    throw new Error("generatePeptide requires a pool with at least one positive weight")
  }

  // Sort by slug so Record insertion order cannot leak into the chain.
  entries.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))

  const rng = createSeededRandom(seed)
  const chain = new Array<string>(length)
  for (let i = 0; i < length; i++) {
    const r = rng() * totalWeight
    let cumulative = 0
    let chosen = entries[entries.length - 1].slug
    for (const entry of entries) {
      cumulative += entry.weight
      if (r < cumulative) {
        chosen = entry.slug
        break
      }
    }
    chain[i] = chosen
  }
  return chain
}
