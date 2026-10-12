/**
 * Deterministic pseudo-random helpers for the quiz engine.
 *
 * Everything here is pure: given the same seed and the same sequence of calls
 * the output is identical, so a generated quiz is stable across reloads and can
 * be unit-tested in node without any DOM or React.
 */

/**
 * Create a mulberry32 pseudo-random number generator.
 *
 * mulberry32 is a tiny, fast, well-distributed 32-bit generator. It is NOT
 * cryptographically secure and must never be used for secrets — it exists only
 * so quiz questions are reproducible from a seed.
 *
 * @param seed Any number; coerced to a 32-bit unsigned integer via `>>> 0`.
 * @returns A function returning a float in `[0, 1)` on each call.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Integer in `[minInclusive, maxExclusive)` drawn from `rng`.
 * Throws for an empty range rather than silently returning a bad value.
 */
export function randomInt(rng: () => number, minInclusive: number, maxExclusive: number): number {
  if (maxExclusive <= minInclusive) {
    throw new Error(
      `randomInt requires maxExclusive > minInclusive (got ${minInclusive}, ${maxExclusive})`,
    )
  }
  return Math.floor(rng() * (maxExclusive - minInclusive)) + minInclusive
}

/** One element of a non-empty array, drawn uniformly. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("pick requires a non-empty array")
  }
  return items[randomInt(rng, 0, items.length)]
}

/** Fisher–Yates shuffle. Returns a new array and leaves the input untouched. */
export function shuffle<T>(rng: () => number, items: readonly T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(rng, 0, i + 1)
    const tmp = result[i]
    result[i] = result[j]
    result[j] = tmp
  }
  return result
}
