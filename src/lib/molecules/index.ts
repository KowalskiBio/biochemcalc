// Biomolekuly category registry — pure data, no display strings.
//
// Display names and descriptions live in `cs.biomolekuly.categories`, keyed
// by category id, so this module stays language-agnostic. Each molecule
// family ships its own dataset (./amino-acids, ./nitrogen-bases today;
// vitamins and metabolites later) and registers one entry in
// MOLECULE_CATEGORIES.

import { AMINO_ACIDS } from "./amino-acids"
import { NITROGEN_BASES } from "./nitrogen-bases"

/**
 * The minimal shape a molecule needs to be browsable in the Biomolekuly
 * section. Each family dataset is a structural superset of this shape (its
 * extra fields — amino acids: `sideChain`, `essential`, letter codes;
 * nitrogen bases: `ringSystem`, `pairsWithIds` — are consumed by that
 * family's bespoke category view), so richer families fit without registry
 * changes.
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
  { id: "dusikate-baze", molecules: NITROGEN_BASES },
]

export function getMoleculeCategory(id: string): MoleculeCategory | undefined {
  return MOLECULE_CATEGORIES.find((category) => category.id === id)
}
