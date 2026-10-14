// Category → quiz configuration registry.
//
// Adapts each molecule family into the family-agnostic `QuizMolecule` shape the
// engine consumes and, for amino acids, supplies the eight characteristic
// predicates. All configs are static and built once at module scope.

import { AMINO_ACIDS } from "@/lib/molecules/amino-acids"
import { NITROGEN_BASES } from "@/lib/molecules/nitrogen-bases"
import type { CharacteristicDef, QuizMolecule } from "@/lib/molecules/quiz/question-generator"

export interface CategoryQuizConfig {
  molecules: QuizMolecule[]
  characteristics?: CharacteristicDef[]
}

const AMINO_ACID_MOLECULES: QuizMolecule[] = AMINO_ACIDS.map((aminoAcid) => ({
  id: aminoAcid.id,
  name: aminoAcid.name,
  smiles: aminoAcid.smiles,
  oneLetter: aminoAcid.oneLetter,
  classKey: aminoAcid.sideChain,
  achiral: aminoAcid.achiral,
}))

const aminoAcidById = new Map(AMINO_ACIDS.map((aminoAcid) => [aminoAcid.id, aminoAcid]))

// Order mirrors `CHARACTERISTIC_PREDICATES` so predicate selection stays stable.
const AMINO_ACID_CHARACTERISTICS: CharacteristicDef[] = [
  { predicate: "nonpolar", matches: (molecule) => molecule.classKey === "nonpolar" },
  { predicate: "polar", matches: (molecule) => molecule.classKey === "polar" },
  {
    predicate: "aromatic",
    matches: (molecule) => aminoAcidById.get(molecule.id)?.aromatic ?? false,
  },
  { predicate: "acidic", matches: (molecule) => molecule.classKey === "acidic" },
  { predicate: "basic", matches: (molecule) => molecule.classKey === "basic" },
  {
    predicate: "essential",
    matches: (molecule) => aminoAcidById.get(molecule.id)?.essential ?? false,
  },
  {
    predicate: "achiral",
    matches: (molecule) => aminoAcidById.get(molecule.id)?.achiral ?? false,
  },
  {
    predicate: "sulfur",
    matches: (molecule) => molecule.id === "cys" || molecule.id === "met",
  },
]

const NITROGEN_BASE_MOLECULES: QuizMolecule[] = NITROGEN_BASES.map((base) => ({
  id: base.id,
  name: base.name,
  smiles: base.smiles,
  classKey: base.ringSystem,
  achiral: true,
}))

const AMINO_ACIDS_QUIZ_CONFIG: CategoryQuizConfig = {
  molecules: AMINO_ACID_MOLECULES,
  characteristics: AMINO_ACID_CHARACTERISTICS,
}

const NITROGEN_BASES_QUIZ_CONFIG: CategoryQuizConfig = {
  molecules: NITROGEN_BASE_MOLECULES,
}

const CATEGORY_QUIZ_CONFIGS: Record<string, CategoryQuizConfig> = {
  aminokyseliny: AMINO_ACIDS_QUIZ_CONFIG,
  "dusikate-baze": NITROGEN_BASES_QUIZ_CONFIG,
}

/** The quiz configuration for `categoryId`, or `undefined` when unknown. */
export function getCategoryQuizConfig(categoryId: string): CategoryQuizConfig | undefined {
  return CATEGORY_QUIZ_CONFIGS[categoryId]
}
