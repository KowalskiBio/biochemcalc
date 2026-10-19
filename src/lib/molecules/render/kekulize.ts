// Kekulization of aromatic rings for textbook-style depictions.
//
// legacy drawer's default draws aromatic systems as a polygon with an inner
// circle; textbooks (and the molecules' own chemistry cards here) show
// alternating double bonds instead. This pass assigns alternating
// single/double weights to the bonds of each fully aromatic ring (a maximum
// matching over the aromatic bond graph, so fused ring systems like purines
// get one consistent assignment) and then drops the aromatic flag on the
// affected atoms/edges so the circle is not drawn on top.

import type { HaworthPreprocessor } from "@/lib/molecules/render/haworth-layout"

interface AromaticEdge {
  index: number
  a: number
  b: number
}

/** Maximum matching over aromatic edges via small DFS backtracking. */
function maximumMatching(edges: AromaticEdge[]): Set<number> {
  // matched.with[vertexId] = edge index matched at that vertex
  const matched = new Map<number, number>()
  const ordered = [...edges].sort((p, q) => p.index - q.index)
  const better = (at: number, over: Map<number, number>): Map<number, number> | null => {
    let best: Map<number, number> | null = null
    for (let index = at; index < ordered.length; index += 1) {
      const edge = ordered[index]
      if (over.has(edge.a) || over.has(edge.b)) {
        continue
      }
      const next = new Map(over)
      next.set(edge.a, index)
      next.set(edge.b, index)
      const attempted = better(index + 1, next) ?? next
      if (best === null || attempted.size > best.size) {
        best = attempted
        if (best.size === ordered.length * 2) {
          break
        }
      }
    }
    // There is always the option of skipping this edge entirely.
    if (best === null) {
      best = new Map(over)
    }
    return best
  }
  const result = better(0, matched) ?? matched
  const indices = new Set<number>()
  for (const edgeIndex of result.values()) {
    indices.add(ordered[edgeIndex].index)
  }
  return indices
}

/**
 * Assign alternating bond orders to fully aromatic rings + drop the aromatic
 * flags driving the inner-circle depiction. Returns the number of rings
 * changed (0 = nothing was aromatic → also nothing to render differently).
 */
export function kekulizeAromaticRings(preprocessor: HaworthPreprocessor): number {
  const rings = preprocessor.rings.filter((ring) =>
    ring.members.every(
      (memberId) =>
        preprocessor.graph.vertices.find((candidate) => candidate.id === memberId)?.value
          .isPartOfAromaticRing === true,
    ),
  )
  if (rings.length === 0) {
    return 0
  }
  const memberSet = new Set<number>(rings.flatMap((ring) => ring.members))
  const aromaticEdges: AromaticEdge[] = (preprocessor.graph.edges ?? [])
    .map((edge, index) => ({ edge, index }))
    .filter(
      ({ edge }) =>
        memberSet.has(edge.sourceId) &&
        memberSet.has(edge.targetId) &&
        edge.isPartOfAromaticRing === true,
    )
    .map(({ edge, index }) => ({ index, a: edge.sourceId, b: edge.targetId }))
  if (aromaticEdges.length === 0) {
    return 0
  }
  const doubleIndices = maximumMatching(aromaticEdges)
  const edgesList = preprocessor.graph.edges ?? []
  for (const aromaticEdge of aromaticEdges) {
    const edge = edgesList[aromaticEdge.index]
    edge.weight = doubleIndices.has(aromaticEdge.index) ? 2 : 1
    edge.isPartOfAromaticRing = false
  }
  for (const memberId of memberSet) {
    const vertex = preprocessor.graph.vertices.find((candidate) => candidate.id === memberId)
    if (vertex !== undefined) {
      vertex.value.isPartOfAromaticRing = false
    }
  }
  return rings.length
}
