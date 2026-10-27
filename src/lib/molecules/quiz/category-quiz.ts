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
  moleculeAliases,
  NITROGEN_BASES_SLUG,
  SACCHARIDES_SLUG,
  TRAIT,
  type TraitKey,
  traitOf,
} from "@/lib/molecules"
import type { CharacteristicDef, QuizMolecule } from "@/lib/molecules/quiz/question-generator"
import { parseProjection } from "@/lib/molecules/render/projection"

export interface CategoryQuizConfig {
  molecules: QuizMolecule[]
  characteristics?: CharacteristicDef[]
  /**
   * Every characteristic candidate the adapter knows about, before filtering
   * to the ones that qualified on this category alone. Used by the merged
   * (topic-wide) config, where a larger molecule pool can supply the
   * distractors a narrow predicate lacked.
   */
  characteristicCandidates?: CharacteristicDef[]
}

/** The predicate id a generic trait value quizzes on ("charge:positive"). */
export function traitPredicate(trait: string, value: string): string {
  return `${trait}:${value}`
}

/**
 * Combine an abbreviation-derived alias with the molecule's `aliases` trait.
 * The abbreviation stays first, duplicates are dropped case-insensitively,
 * any alias equal to the molecule name is ignored, and an empty result is
 * `undefined` (the engine's "no aliases" shape).
 */
function quizAliases(molecule: Biomolecule, abbreviationAlias?: string): string[] | undefined {
  const name = molecule.name.trim().toLowerCase()
  const seen = new Set<string>()
  const aliases: string[] = []
  for (const alias of [
    ...(abbreviationAlias !== undefined ? [abbreviationAlias] : []),
    ...moleculeAliases(molecule),
  ]) {
    const key = alias.trim().toLowerCase()
    if (key === name || seen.has(key)) continue
    seen.add(key)
    aliases.push(alias)
  }
  return aliases.length > 0 ? aliases : undefined
}

function baseQuizMolecule(
  molecule: Biomolecule,
  letter?: string,
  classKey?: string,
  aliases?: string[],
): QuizMolecule {
  // A declarative projection carries stereochemistry by definition, so the
  // molecule is chiral even when its (skeletal fallback) SMILES has no `@`.
  // When `haworth` is explicitly false the projection is ignored entirely, so
  // there is nothing to parse and achirality falls back to the SMILES.
  const haworth = molecule.haworth !== false
  const projection = haworth ? parseProjection(molecule.projection) : null
  return {
    id: molecule.slug,
    name: molecule.name,
    smiles: molecule.smiles,
    oneLetter: letter,
    aliases,
    classKey,
    achiral: projection !== null ? false : isAchiral(molecule),
    projection: projection ?? undefined,
    haworth,
    fischer: molecule.fischer !== false,
  }
}

/** Amino acids: letter quizzes from `oneLetter`, the eight curated predicates. */
function aminoAcidsQuizConfig(molecules: Biomolecule[]): CategoryQuizConfig {
  const quizMolecules = molecules.map((molecule) => {
    // The three-letter code spells the answer a student may type in hard mode.
    const abbreviation = traitOf(molecule, TRAIT.abbreviation)
    const abbreviationAlias =
      abbreviation !== undefined && abbreviation.length > 1 ? abbreviation : undefined
    return baseQuizMolecule(
      molecule,
      traitOf(molecule, TRAIT.oneLetter),
      traitOf(molecule, TRAIT.sideChain),
      quizAliases(molecule, abbreviationAlias),
    )
  })
  const byId = new Map(molecules.map((molecule) => [molecule.slug, molecule]))
  const classIs =
    (classKey: string) =>
    (quiz: QuizMolecule): boolean => {
      const molecule = byId.get(quiz.id)
      return molecule !== undefined && traitOf(molecule, TRAIT.sideChain) === classKey
    }
  // Polarity questions ask the hydrophobic/hydrophilic axis on purpose, not
  // the display family: phenylalanine is aromatic BY FAMILY yet hydrophobic
  // BY BEHAVIOUR, and students deserve both answers, one per axis.
  const polarityIs =
    (value: string) =>
    (quiz: QuizMolecule): boolean => {
      const molecule = byId.get(quiz.id)
      return molecule !== undefined && traitOf(molecule, TRAIT.polarity) === value
    }

  // Order mirrors `CHARACTERISTIC_PREDICATES` so predicate selection stays stable.
  const characteristics: CharacteristicDef[] = [
    { predicate: "nonpolar", matches: polarityIs("hydrophobic") },
    { predicate: "polar", matches: polarityIs("hydrophilic") },
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

  return { molecules: quizMolecules, characteristics, characteristicCandidates: characteristics }
}

/** Nitrogen bases: name↔structure only, ring-system distractor grouping. */
function nitrogenBasesQuizConfig(molecules: Biomolecule[]): CategoryQuizConfig {
  return {
    molecules: molecules.map((molecule) =>
      baseQuizMolecule(
        molecule,
        undefined,
        traitOf(molecule, TRAIT.ringSystem),
        quizAliases(molecule),
      ),
    ),
  }
}

/**
 * Saccharides (Haworth projections): name↔structure plus trait predicates
 * (anomer, ring form, deoxy); the ring form groups same-class distractors.
 * Predicates that can't fill three distractors are dropped, exactly like the
 * generic adapter does.
 */
function saccharidesQuizConfig(molecules: Biomolecule[]): CategoryQuizConfig {
  const quizMolecules = molecules.map((molecule) =>
    baseQuizMolecule(molecule, undefined, traitOf(molecule, TRAIT.ringForm), quizAliases(molecule)),
  )
  const byId = new Map(molecules.map((molecule) => [molecule.slug, molecule]))
  const traitIs =
    (key: TraitKey, value: string) =>
    (quiz: QuizMolecule): boolean => {
      const molecule = byId.get(quiz.id)
      return molecule !== undefined && traitOf(molecule, key) === value
    }

  const candidates: CharacteristicDef[] = [
    { predicate: traitPredicate(TRAIT.anomer, "alpha"), matches: traitIs(TRAIT.anomer, "alpha") },
    { predicate: traitPredicate(TRAIT.anomer, "beta"), matches: traitIs(TRAIT.anomer, "beta") },
    {
      predicate: traitPredicate(TRAIT.ringForm, "pyranose"),
      matches: traitIs(TRAIT.ringForm, "pyranose"),
    },
    {
      predicate: traitPredicate(TRAIT.ringForm, "furanose"),
      matches: traitIs(TRAIT.ringForm, "furanose"),
    },
    {
      predicate: traitPredicate(TRAIT.deoxy, "true"),
      matches: (quiz) => {
        const source = byId.get(quiz.id)
        return source !== undefined && hasTraitFlag(source, TRAIT.deoxy)
      },
    },
  ]

  return {
    molecules: quizMolecules,
    characteristics: candidates.filter((def) => qualifies(quizMolecules, def.matches)),
    characteristicCandidates: candidates,
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
  const quizMolecules = molecules.map((molecule) => {
    const abbreviation = traitOf(molecule, TRAIT.abbreviation)
    const oneLetter = everyHasAbbreviation ? abbreviation : undefined
    // A multi-character abbreviation that isn't already the quiz letter is an
    // accepted alternative spelling.
    const abbreviationAlias =
      abbreviation !== undefined && abbreviation.length > 1 && abbreviation !== oneLetter
        ? abbreviation
        : undefined
    return baseQuizMolecule(
      molecule,
      oneLetter,
      traitOf(molecule, TRAIT.polarity) ?? traitOf(molecule, TRAIT.charge),
      quizAliases(molecule, abbreviationAlias),
    )
  })
  const byId = new Map(molecules.map((molecule) => [molecule.slug, molecule]))
  const traitIs =
    (key: TraitKey, value: string) =>
    (quiz: QuizMolecule): boolean => {
      const molecule = byId.get(quiz.id)
      return molecule !== undefined && traitOf(molecule, key) === value
    }

  const candidates: CharacteristicDef[] = []
  for (const value of ["hydrophobic", "hydrophilic"]) {
    const matches = traitIs(TRAIT.polarity, value)
    candidates.push({ predicate: traitPredicate(TRAIT.polarity, value), matches })
  }
  for (const value of ["positive", "neutral", "negative"]) {
    const matches = traitIs(TRAIT.charge, value)
    candidates.push({ predicate: traitPredicate(TRAIT.charge, value), matches })
  }
  const characteristics = candidates.filter((def) => qualifies(quizMolecules, def.matches))

  return {
    molecules: quizMolecules,
    characteristics: characteristics.length > 0 ? characteristics : undefined,
    characteristicCandidates: candidates,
  }
}

/**
 * Build one quiz configuration out of several categories, for the
 * topic-wide picker entry ("all categories in the topic"). Each entry is
 * adapted by its own category adapter first, so per-category quiz letters and
 * distractor classes survive the merge; the characteristics are then
 * re-qualified against the merged molecule pool, where the extra molecules
 * often supply the distractors a narrowly-scoped predicate lacked.
 */
export function getMergedQuizConfig(
  entries: { categoryId: string; molecules: Biomolecule[] }[],
): CategoryQuizConfig | undefined {
  const configs: CategoryQuizConfig[] = []
  for (const entry of entries) {
    const config = getCategoryQuizConfig(entry.categoryId, entry.molecules)
    if (config !== undefined) configs.push(config)
  }
  if (configs.length === 0) {
    return undefined
  }

  // Molecule ids are the quiz identity; a defensive dedupe keeps the first
  // occurrence if two entries ever point at the same molecule.
  const molecules: QuizMolecule[] = []
  const seen = new Set<string>()
  for (const config of configs) {
    for (const molecule of config.molecules) {
      if (seen.has(molecule.id)) continue
      seen.add(molecule.id)
      molecules.push(molecule)
    }
  }

  const characteristics = configs
    .flatMap((config) => config.characteristicCandidates ?? config.characteristics ?? [])
    .filter((definition) => qualifies(molecules, definition.matches))

  return {
    molecules,
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
  if (categoryId === SACCHARIDES_SLUG) {
    return saccharidesQuizConfig(molecules)
  }
  return genericQuizConfig(molecules)
}
