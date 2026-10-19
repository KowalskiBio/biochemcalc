/**
 * Coordinate transforms for pre-render molecular orientations.
 *
 * Rotating the finished SVG (e.g. a CSS `transform`) would also rotate the
 * atom labels. Rotating the *coordinates* before the draw keeps every label
 * upright, which is what this module enables: `render-structure.ts` feeds the
 * RDKit atom positions through {@link transformPoints} before the final draw.
 */

export interface Point {
  x: number
  y: number
}

const DEG_TO_RAD = Math.PI / 180

/**
 * Center of the axis-aligned bounding box of `points`. Returns the origin for
 * an empty input, which keeps the transform well defined for degenerate
 * molecules.
 */
export function pointsBoundingCenter(points: readonly Point[]): Point {
  if (points.length === 0) {
    return { x: 0, y: 0 }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }

  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

/**
 * Return NEW points transformed about the bounding-box center: first mirror
 * across the vertical axis through that center (`x' = 2 * cx - x`, y kept),
 * then rotate by `orientationDeg`.
 *
 * Rotation convention: the standard mathematical matrix
 *   x' = cx + dx*cos - dy*sin
 *   y' = cy + dx*sin + dy*cos
 * with `dx = x - cx`, `dy = y - cy`. In the y-up sense a positive angle is
 * counter-clockwise, so `(1, 0)` maps to `(0, 1)` at 90°. Because SVG screen
 * space has y pointing down, the same numbers read as clockwise on screen —
 * the convention is documented here so callers can negate if they prefer.
 *
 * Mirroring and rotation are applied around the *same* center, and the
 * bounding-box center is invariant under both (for the 90/180/270° angles the
 * caller's UI produces, and exactly under mirroring), so repeated calls agree.
 * The identity input (`0`, `false`) short-circuits and returns plain copies.
 */
export function transformPoints<T extends Point>(
  points: readonly T[],
  orientationDeg: number,
  mirror: boolean,
): T[] {
  if (orientationDeg === 0 && !mirror) {
    return points.map((point) => ({ ...point }))
  }

  const center = pointsBoundingCenter(points)
  const radians = orientationDeg * DEG_TO_RAD
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  return points.map((point) => {
    const sourceX = mirror ? 2 * center.x - point.x : point.x
    const dx = sourceX - center.x
    const dy = point.y - center.y
    return {
      ...point,
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    }
  })
}
