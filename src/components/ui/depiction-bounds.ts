/**
 * Adaptive sizing for molecule depictions.
 *
 * The claimed premise of the grow mode is that every biomolecule shares one
 * canonical scale (natural bond length 24, the same ring and bond sizes
 * everywhere the molecule can show at all): below that scale the context's
 * window simply grows around the structure up to a viewport-safe cap, and
 * only when the structure can't fit the cap does the depiction shrink —
 * uniformly, so aspect always survives. Grids and option lists keep the
 * fixed `size` square (uniform tiles); `grow` is opt-in for single-molecule
 * contexts, where this natural/1:1-until-cap rule is exactly what students
 * mean by "same proportions everywhere".
 */

export interface DepictionBoundsInput {
  /** viewBox width of the drawn svg (natural depiction bounds). */
  vbw: number
  /** viewBox height of the drawn svg. */
  vbh: number
  /** Square side length the depiction element would get today (px). */
  size: number
  /** Width cap for grow mode (px). */
  capW: number
  /** Height cap for grow mode (px). */
  capH: number
  /** false → today's fixed square; true → natural 1:1 up to the caps. */
  grow: boolean
}

export interface DepictionBounds {
  width: number
  height: number
}

/**
 * The depiction element's px dimensions for one drawn molecule.
 *
 * Fixed mode is today's behavior verbatim: a `size` × `size` square (the
 * svg letterboxes the viewBox into it, preserving aspect itself). Grow mode
 * keeps the natural 1:1 bond length up to the caps (`k = 1`), where the
 * window grows to the structure, and only the caps pull the scale below 1
 * (uniformly, preserving aspect). There is deliberately no enlargement past
 * natural bonds here — a degenerate viewBox (nothing drawn, unparseable
 * dims) falls back to the fixed square so the element never collapses to 0.
 */
export function computeDepictionBounds({
  vbw,
  vbh,
  size,
  capW,
  capH,
  grow,
}: DepictionBoundsInput): DepictionBounds {
  if (!grow || !(vbw > 0) || !(vbh > 0)) {
    return { width: size, height: size }
  }

  // A non-positive or non-finite cap reads as "no constraint" here; the
  // component itself always resolves real caps before calling.
  const boundW = capW > 0 && Number.isFinite(capW) ? capW / vbw : Number.POSITIVE_INFINITY
  const boundH = capH > 0 && Number.isFinite(capH) ? capH / vbh : Number.POSITIVE_INFINITY
  // Uniform natural scale: every molecule is drawn at its natural bond
  // length until the caps stop it; there is no special fill-square scale.
  const k = Math.min(1, boundW, boundH)
  return { width: vbw * k, height: vbh * k }
}
