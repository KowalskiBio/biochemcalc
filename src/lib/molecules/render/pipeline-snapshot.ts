// Adapter: extract the recognizer's structural snapshot from smiles-drawer's
// live preprocessor graph. Structurally typed over the library's internals
// (no package imports) so it works in the browser hook and in vitest alike.

import type { GraphSnapshot } from "@/lib/molecules/render/recognize"

export interface PreprocessorLike {
  graph: {
    vertices: {
      id: number
      value: {
        element: string
        chirality?: string
        isPartOfAromaticRing?: boolean
      }
      neighbours: number[]
    }[]
    edges?: { sourceId: number; targetId: number; weight?: number }[]
  }
  rings: { id: number; members: number[] }[]
}

export function snapshotFromPreprocessor(preprocessor: PreprocessorLike): GraphSnapshot {
  const atoms = new Map<
    number,
    { vertexId: number; element: string; chirality: string; isAromatic: boolean }
  >()
  const adjacency = new Map<number, number[]>()
  for (const vertex of preprocessor.graph.vertices) {
    atoms.set(vertex.id, {
      vertexId: vertex.id,
      element: vertex.value.element,
      chirality: vertex.value.chirality ?? "",
      isAromatic: vertex.value.isPartOfAromaticRing ?? false,
    })
    adjacency.set(vertex.id, [...vertex.neighbours])
  }
  const weights = new Map<string, number>()
  for (const edge of preprocessor.graph.edges ?? []) {
    const key =
      edge.sourceId < edge.targetId
        ? `${edge.sourceId}_${edge.targetId}`
        : `${edge.targetId}_${edge.sourceId}`
    weights.set(key, edge.weight ?? 1)
  }
  return {
    atoms,
    adjacency,
    bondWeightOf: (a, b) => weights.get(a < b ? `${a}_${b}` : `${b}_${a}`) ?? 1,
    rings: preprocessor.rings.map((ring) => ({ id: ring.id, members: [...ring.members] })),
  }
}
