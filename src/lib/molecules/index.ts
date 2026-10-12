// Biomolekuly category registry — pure data, no display strings.
//
// Display names and descriptions live in `cs.biomolekuly.categories`, keyed
// by category id, so this module stays language-agnostic. Each molecule
// family ships its own dataset (./amino-acids today; nucleotides, vitamins
// and metabolites later) and registers one entry in MOLECULE_CATEGORIES.

import { AMINO_ACIDS } from "./amino-acids"

/**
 * The minimal shape a molecule needs to be browsable in the Biomolekuly
 * section. The amino-acid dataset is a structural superset of this shape
 * (its extra fields — `sideChain`, `essential`, top-level letter codes — are
 * consumed by that family's bespoke category view), so richer families fit
 * without registry changes.
 */
export interface MoleculeBase {
  /** Stable id, unique within its category ("ala"). */
  id: string
  /** Czech display name ("Alanin"). */
  name: string
  /** SMILES for the skeletal depiction. */
  smiles: string
  /** Letter codes for families that have them (amino acids: 3- and 1-letter). */
  codes?: {
    threeLetter?: string
    oneLetter?: string
  }
  /** Czech teaching facts shown in the detail view. */
  facts?: string[]
}

export interface MoleculeCategory {
  /** Stable route slug for "/biomolekuly/:categoryId" and cs lookup key. */
  id: string
  molecules: MoleculeBase[]
}

export const MOLECULE_CATEGORIES: MoleculeCategory[] = [
  { id: "aminokyseliny", molecules: AMINO_ACIDS },
]

export function getMoleculeCategory(id: string): MoleculeCategory | undefined {
  return MOLECULE_CATEGORIES.find((category) => category.id === id)
}
