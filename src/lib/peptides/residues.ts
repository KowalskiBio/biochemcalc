// Condensable amino-acid residues for peptide synthesis.
//
// Every fragment here is DELIBERATELY derived from the seed SMILES in
// `src-tauri/src/db/biomolecule_seed.rs` (the 20 neutral free amino acids):
// the alpha-carbon block is the uniform `N[C@@H](side chain)C(=O)` template —
// the free acid is `template + "O"`, which the test suite canonicalizes
// back to the seed SMILES for all twenty, so the template's parity and any
// side-chain stereocenter strings remain anchored to ground truth.
//
// Vocabulary note: this module is English (`peptides`) while HTTP/UI strings
// are Czech (`peptidovka`) — same convention as the rest of src/lib.

/** One mid-chain repeat unit (neutral, condensable at both ends). */
export interface ResidueFragment {
  /** Repeat unit ending in a carbonyl carbon for the NEXT `N...` bond. */
  readonly unit: string
}

/**
 * The twenty canonical residues, keyed by their three-letter seed slugs
 * (`biomolecule_seed.rs`). Glycine is the only achiral row (plain `NCC(=O)`).
 * Proline is deliberately absent — its secondary amine closes a ring, so the
 * generic alpha-N template cannot express it; see `synthesize.ts`.
 */
export const RESIDUES: Readonly<Record<string, ResidueFragment>> = {
  ala: { unit: "N[C@@H](C)C(=O)" },
  arg: { unit: "N[C@@H](CCCN=C(N)N)C(=O)" },
  asn: { unit: "N[C@@H](CC(=O)N)C(=O)" },
  asp: { unit: "N[C@@H](CC(=O)O)C(=O)" },
  cys: { unit: "N[C@@H](CS)C(=O)" },
  gln: { unit: "N[C@@H](CCC(=O)N)C(=O)" },
  glu: { unit: "N[C@@H](CCC(=O)O)C(=O)" },
  gly: { unit: "NCC(=O)" },
  his: { unit: "N[C@@H](Cc1cnc[nH]1)C(=O)" },
  ile: { unit: "N[C@@H]([C@@H](C)CC)C(=O)" },
  leu: { unit: "N[C@@H](CC(C)C)C(=O)" },
  lys: { unit: "N[C@@H](CCCCN)C(=O)" },
  met: { unit: "N[C@@H](CCSC)C(=O)" },
  phe: { unit: "N[C@@H](Cc1ccccc1)C(=O)" },
  ser: { unit: "N[C@@H](CO)C(=O)" },
  thr: { unit: "N[C@@H]([C@@H](C)O)C(=O)" },
  trp: { unit: "N[C@@H](Cc1c[nH]c2ccccc12)C(=O)" },
  tyr: { unit: "N[C@@H](Cc1ccc(O)cc1)C(=O)" },
  val: { unit: "N[C@@H](C(C)C)C(=O)" },
  // Special proteinogenic residues (opt-in pool members from the
  // "specialni-aminokyseliny" category), same alpha template as the twenty.
  sec: { unit: "N[C@@H](C[SeH])C(=O)" },
  pyl: { unit: "N[C@@H](CCCCNC(=O)C1N=CCC(C)1)C(=O)" },
} as const

/** Seed slugs the template cannot express (ring-fused secondary amine). */
export const CYCLIC_RESIDUE_SLUGS = new Set(["pro"])

/** Slug exists among the canonical residue templates. */
export function isKnownResidueSlug(slug: string): boolean {
  return RESIDUES[slug] !== undefined || CYCLIC_RESIDUE_SLUGS.has(slug)
}

// Proline fragments raw out of the seed `C1C[C@H](NC1)C(=O)O`:
// N-terminal and free-acid shapes reuse the seed's own traversal, so their
// alpha parity is trusted by construction; the internal unit opens at the
// amide N instead and closes the pyrrolidine in a branch, keeping the SAME
// alpha neighbour order (prev N, branch ring chain, next C(=O)) — the
// canonical-crosscheck test in the suite proves the parity transfer.

/** Proline when it opens the chain (free-ring NH, condensable carboxyl). */
export const PROLINE_N_TERM_UNIT = "C1C[C@H](NC1)C(=O)"
/** Proline mid-chain or at the C-terminus: append the trailing carbonyl O. */
export const PROLINE_INTERNAL_UNIT = "N1[C@@H](CCC1)C(=O)"
