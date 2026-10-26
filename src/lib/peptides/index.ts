// Peptide game core: residue fragments, SMILES synthesis, seeded generation,
// canonical N-left orientation and one-letter answer semantics.

export { expectedChainLetters, isChainCorrect } from "@/lib/peptides/answer"
export { generatePeptide } from "@/lib/peptides/generate"
export { nLeftOrientationDeg } from "@/lib/peptides/geometry"
export {
  CYCLIC_RESIDUE_SLUGS,
  isKnownResidueSlug,
  PROLINE_INTERNAL_UNIT,
  PROLINE_N_TERM_UNIT,
  RESIDUES,
  type ResidueFragment,
} from "@/lib/peptides/residues"
export { type PeptideParts, peptideParts, peptideSmiles } from "@/lib/peptides/synthesize"
