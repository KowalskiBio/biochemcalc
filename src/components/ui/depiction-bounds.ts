/**
 * Adaptive sizing for molecule depictions.
 *
 * Grids and option lists keep the fixed `size` square (uniform tiles). In
 * single-molecule contexts `grow` is on, and the principle is the one the
 * teacher feedback assembled: every depiction is at least as readable as the
 * grid preview, scaled to the shared natural bond length (currently 28 px)
 * up to viewport-safe caps. Concretely, k = min(capK, max(fillScale, 1)):
 * structures smaller than the square get the grid-parity fill scale first,
 * big structures stay at their natural bond length until the viewport-safe
 * cap, and only that cap — never the square — is permitted to shrink them
 * (uniformly, so aspect always survives).
 */

export interface DepictionBoundsInput {
  /** viewBox width of the drawn svg (natural depiction bounds). */
  vbw: number
  /** viewBox height of the drawn svg. */
  vbh: number
  /** Square side length the element would get in fixed mode (px). */
  size: number
  /** Width cap for grow mode (px). */
  capW: number
  /** Height cap for grow mode (px). */
  capH: number
  /** false → today's fixed square; true → the described adaptive rule. */
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
 * svg letterboxes the viewBox into it, preserving aspect itself). Grow mode:
 * scale = min(capK, max(fillScale, 1)) — grid-parity as the floor (so a
 * small molecule never reads tinier than its grid preview), natural
 * 1:1-style elsewhere, and anything exceeding the viewport-safe cap
 * downscales uniformly, aspect intact. A degenerate viewBox (nothing drawn,
 * unparseable dims) falls back to the fixed square so the element never
 * collapses to 0.
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

  const fillScale = size / Math.max(vbw, vbh)
  const boundW = capW > 0 && Number.isFinite(capW) ? capW / vbw : Number.POSITIVE_INFINITY
  const boundH = capH > 0 && Number.isFinite(capH) ? capH / vbh : Number.POSITIVE_INFINITY
  const capK = Math.min(boundW, boundH)
  const k = Math.min(capK, Math.max(fillScale, 1))
  return { width: vbw * k, height: vbh * k }
}
