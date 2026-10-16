// Category → quiz configuration builder.
//
// The molecule library lives in the database; each category's molecules are
// adapted here into the family-agnostic `QuizMolecule` shape the engine
// consumes. The two curated categories keep their bespoke setups: amino
// acids quiz letter codes and the eight curated characteristic predicates,
// nitrogen bases stay limited to name↔structure. Any other (teacher-made)
// category is adapted generically from its molecules' traits: the
// `abbreviation` becomes the quiz letter when every molecule has one,
// `charge` / `polarity` values become characteristic predicates, and the
// same trait doubles as the same-class distractor grouping.

import type { Biomolecule } from "@/lib/biomolecules-api"
import {
  AMINO_ACIDS_SLUG,
  hasTraitFlag,
  isAchiral,
  NITROGEN_BASES_SLUG,
  type TraitKey,
  traitOf,
  TRAIT,
} from "@/lib/molecules"
import type { CharacteristicDef, QuizMolecule } from "@/lib/molecules/quiz/question-generator"

export interface CategoryQuizConfig {
  molecules: QuizMolecule[]
  characteristics?: CharacteristicDef[]
}

/** The predicate id a generic trait value quizzes on ("charge:positive"). */
export function traitPredicate(trait: string, value: string): string {
  return `${trait}:${value}`
}

function baseQuizMolecule(molecule: Biomolecule, letter?: string, classKey?: string): QuizMolecule {
  return {
    id: molecule.slug,
    name: molecule.name,
    smiles: molecule.smiles,
    oneLetter: letter,
    classKey,
    achiral: isAchiral(molecule),
  }
}

/** Amino acids: letter quizzes from `oneLetter`, the eight curated predicates. */
function aminoAcidsQuizConfig(molecules: Biomolecule[]): CategoryQuizConfig {
  const quizMolecules = molecules.map((molecule) =>
    baseQuizMolecule(
      molecule,
      traitOf(molecule, TRAIT.oneLetter),
      traitOf(molecule, TRAIT.sideChain),
    ),
  )
  const byId = new Map(molecules.map((molecule) => [molecule.slug, molecule]))
  const classIs =
    (classKey: string) =>
    (quiz: QuizMolecule): boolean => {
      const molecule = byId.get(quiz.id)
      return molecule !== undefined && traitOf(molecule, TRAIT.sideChain) === classKey
    }

  // Order mirrors `CHARACTERISTIC_PREDICATES` so predicate selection stays stable.
  const characteristics: CharacteristicDef[] = [
    { predicate: "nonpolar", matches: classIs("nonpolar") },
    { predicate: "polar", matches: classIs("polar") },
    { predicate: "aromatic", matches: classIs("aromatic") },
    { predicate: "acidic", matches: classIs("acidic") },
    { predicate: "basic", matches: classIs("basic") },
    {
      predicate: "essential",
      matches: (molecule) => {
        const source = byId.get(molecule.id)
        return source !== undefined && hasTraitFlag(source, TRAIT.essential)
      },
    },
    { predicate: "achiral", matches: (molecule) => molecule.achiral === true },
    {
      predicate: "sulfur",
      matches: (molecule) => {
        const source = byId.get(molecule.id)
        return source !== undefined && hasTraitFlag(source, TRAIT.sulfur)
      },
    },
  ]

  return { molecules: quizMolecules, characteristics }
}

/** Nitrogen bases: name↔structure only, ring-system distractor grouping. */
function nitrogenBasesQuizConfig(molecules: Biomolecule[]): CategoryQuizConfig {
  return {
    molecules: molecules.map((molecule) =>
      baseQuizMolecule(molecule, undefined, traitOf(molecule, TRAIT.ringSystem)),
    ),
  }
}

/**
 * A characteristic question needs at least one matching molecule and at
 * least three non-matching ones (they become the distractors).
 */
function qualifies(
  molecules: QuizMolecule[],
  predicate: (molecule: QuizMolecule) => boolean,
): boolean {
  const matches = molecules.filter(predicate).length
  return matches >= 1 && molecules.length - matches >= 3
}

/**
 * Teacher-made categories: the `abbreviation` doubles as the quiz letter
 * (only when every molecule has one, otherwise letter types stay off), and
 * each present `charge` / `polarity` value yields one characteristic
 * predicate. The polarity (or charge) also groups same-class distractors.
 */
function genericQuizConfig(molecules: Biomolecule[]): CategoryQuizConfig {
  const everyHasAbbreviation =
    molecules.length > 0 && molecules.every((molecule) => traitOf(molecule, TRAIT.abbreviation))
  const quizMolecules = molecules.map((molecule) =>
    baseQuizMolecule(
      molecule,
      everyHasAbbreviation ? traitOf(molecule, TRAIT.abbreviation) : undefined,
      traitOf(molecule, TRAIT.polarity) ?? traitOf(molecule, TRAIT.charge),
    ),
  )
  const byId = new Map(molecules.map((molecule) => [molecule.slug, molecule]))
  const traitIs =
    (key: TraitKey, value: string) =>
    (quiz: QuizMolecule): boolean => {
      const molecule = byId.get(quiz.id)
      return molecule !== undefined && traitOf(molecule, key) === value
    }

  const characteristics: CharacteristicDef[] = []
  for (const value of ["hydrophobic", "hydrophilic"]) {
    const matches = traitIs(TRAIT.polarity, value)
    if (qualifies(quizMolecules, matches)) {
      characteristics.push({ predicate: traitPredicate(TRAIT.polarity, value), matches })
    }
  }
  for (const value of ["positive", "neutral", "negative"]) {
    const matches = traitIs(TRAIT.charge, value)
    if (qualifies(quizMolecules, matches)) {
      characteristics.push({ predicate: traitPredicate(TRAIT.charge, value), matches })
    }
  }

  return {
    molecules: quizMolecules,
    characteristics: characteristics.length > 0 ? characteristics : undefined,
  }
}

/**
 * Build the quiz configuration for one category from its database
 * molecules. Returns undefined for a category that can't quiz at all
 * (nothing to ask about).
 */
export function getCategoryQuizConfig(
  categoryId: string,
  molecules: Biomolecule[],
): CategoryQuizConfig | undefined {
  if (molecules.length === 0) {
    return undefined
  }
  if (categoryId === AMINO_ACIDS_SLUG) {
    return aminoAcidsQuizConfig(molecules)
  }
  if (categoryId === NITROGEN_BASES_SLUG) {
    return nitrogenBasesQuizConfig(molecules)
  }
  return genericQuizConfig(molecules)
}
