/**
 * Adaptive sizing for molecule depictions.
 *
 * smiles-drawer renders into a fixed square: the svg element is `size` ×
 * `size` while the molecule's natural bounds (bond length 24) sit in the
 * viewBox, so anything larger than the square downscales — acetyl-CoA ends
 * up as illegible lint. Grids and previews want that uniform square, so
 * `grow` is opt-in for single-molecule contexts: there the depiction draws
 * at 1:1 natural bonds and the element grows with the molecule until it
 * hits a practical cap; only beyond the cap does it shrink (uniformly,
 * preserving aspect). Small molecules keep today's fill — a 220 px square
 * enlarging water is fine, a 30 px water molecule floating in a 220 px
 * question prompt is not.
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
 * keeps today's fill scale for small molecules (`s0 > 1` — the square
 * enlarges them), otherwise draws 1:1 natural, and only the caps pull the
 * scale below 1. Both dims scale by the same k, so aspect always survives.
 * A degenerate viewBox (nothing drawn, unparseable dims) falls back to the
 * fixed square so the element never collapses to 0.
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

  // Today's fill scale: the square is filled along the viewBox's long side.
  const s0 = size / Math.max(vbw, vbh)
  // A non-positive or non-finite cap reads as "no constraint" here; the
  // component itself always resolves real caps before calling.
  const boundW = capW > 0 && Number.isFinite(capW) ? capW / vbw : Number.POSITIVE_INFINITY
  const boundH = capH > 0 && Number.isFinite(capH) ? capH / vbh : Number.POSITIVE_INFINITY
  const k = s0 > 1 ? s0 : Math.min(1, boundW, boundH)
  return { width: vbw * k, height: vbh * k }
}
