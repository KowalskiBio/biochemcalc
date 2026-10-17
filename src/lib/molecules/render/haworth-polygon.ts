// Canonical Haworth ring polygons (unit bond), shared by the declarative
// projection renderer and the SMILES ring recognizer.
//
// The polygons are NOT regular: they are stretched horizontally by
// `HAWORTH_X_STRETCH` (wider than tall, textbook look) while keeping
// natural bond-length ring edges. Side-aware substituent bond lengths
// (short for "up", normal for "down") are applied at the draw sites.

export const HAWORTH_X_STRETCH = 1.15

/** Pyranose hexagon: ring O top-right, anomeric carbon at the right. */
const PYRANOSE = [
  { x: 1.5, y: 0.86603 }, // anomeric C (right)
  { x: 1, y: 1.73205 },
  { x: 0, y: 1.73205 },
  { x: -0.5, y: 0.86603 },
  { x: 0, y: 0 },
  { x: 1, y: 0 }, // ring O (top right)
]

/** Furanose pentagon: ring O at the top vertex, anomeric carbon upper-right. */
const FURANOSE = [
  { x: 0.80902, y: -0.26287 }, // anomeric C (right)
  { x: 0.5, y: 0.68819 },
  { x: -0.5, y: 0.68819 },
  { x: -0.80902, y: -0.26287 },
  { x: 0, y: -0.85065 }, // ring O (top)
]

function stretched(points: { x: number; y: number }[]): { x: number; y: number }[] {
  return points.map((point) => ({ x: point.x * HAWORTH_X_STRETCH, y: point.y }))
}

/** Canonical Haworth polygon for the PHYSICAL ring size (6 pyranose, 5 furanose). */
export function haworthPolygon(polySize: 5 | 6): { x: number; y: number }[] {
  return polySize === 6 ? stretched(PYRANOSE) : stretched(FURANOSE)
}
