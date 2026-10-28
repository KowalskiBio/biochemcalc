import {
  CYCLIC_RESIDUE_SLUGS,
  PROLINE_INTERNAL_UNIT,
  PROLINE_N_TERM_UNIT,
  RESIDUES,
} from "@/lib/peptides/residues"

/**
 * One assembled peptide plus the atom anchors the layout code needs.
 *
 * Neutral free NH2/COOH termini — the settled product decision (no
 * zwitterions). The chain is pure string assembly of per-residue templates
 * whose parity the test suite pins against the seed SMILES; ring digits
 * never cross a fragment boundary, so splicing is safe.
 */
export interface PeptideParts {
  /** Full peptide SMILES, N-terminus first, C-terminal carboxyl last. */
  smiles: string
  /**
   * Atom index of the N-terminus nitrogen under SMILES parse order (which
   * RDKit preserves in its JSON atom list): `0` for the uniform template,
   * `3` when the chain opens with proline's ring-first fragment.
   */
  nIndex: number
}

/**
 * Build a peptide from residue slugs left→right N→C. Returns null on any
 * unknown slug (the caller's pool is settings/db-derived, never typed —
 * this stays a hard structural guarantee, not a validation UX).
 */
export function peptideParts(slugs: string[]): PeptideParts | null {
  if (slugs.length === 0) {
    return null
  }
  const parts: string[] = []
  const first = slugs[0]
  let nIndex = 0
  if (CYCLIC_RESIDUE_SLUGS.has(first)) {
    parts.push(PROLINE_N_TERM_UNIT)
    nIndex = 3
  } else {
    const fragment = RESIDUES[first]
    if (fragment === undefined) {
      return null
    }
    parts.push(fragment.unit)
  }
  for (const slug of slugs.slice(1)) {
    if (CYCLIC_RESIDUE_SLUGS.has(slug)) {
      parts.push(PROLINE_INTERNAL_UNIT)
      continue
    }
    const fragment = RESIDUES[slug]
    if (fragment === undefined) {
      return null
    }
    parts.push(fragment.unit)
  }
  // One terminal hydroxyl closes the last carbonyl into COOH; standard and
  // cyclic templates share the same trailing `C(=O)` so this never branches.
  return { smiles: `${parts.join("")}O`, nIndex }
}

/** Thin convenience: just the SMILES, null on unknown slugs. */
export function peptideSmiles(slugs: string[]): string | null {
  return peptideParts(slugs)?.smiles ?? null
}
