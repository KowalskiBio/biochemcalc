// Biomolekuly molecule traits — pure data, no display strings.
//
// Molecules and categories live in the database (see `biomolecules-api.ts`
// and `stores/biomolecule-data-store.ts`); this module holds the shared
// trait vocabulary the browse page and the quiz engine read. Display labels
// for trait values live in `cs.biomolekuly` (`sideChainLabels`,
// `chargeLabels`, `polarityLabels`, `ringSystemLabels`).

import type { Biomolecule, BiomoleculeTraits } from "@/lib/biomolecules-api"

/** Route slug of the seeded amino-acid category. */
export const AMINO_ACIDS_SLUG = "aminokyseliny"
/** Route slug of the seeded nitrogenous-bases category. */
export const NITROGEN_BASES_SLUG = "dusikate-baze"
/** Route slug of the seeded saccharides category (Haworth projections). */
export const SACCHARIDES_SLUG = "sacharidy"

/** The trait keys validated server-side (mirrors `commands::biomolecules::traits`). */
export const TRAIT = {
  /** Short code shown on cards (amino acids: three-letter, bases: one letter). */
  abbreviation: "abbreviation",
  /** Single letter used by letter-based quiz questions (amino acids). */
  oneLetter: "oneLetter",
  /** Charge at pH 7: positive | neutral | negative. */
  charge: "charge",
  /** hydrophobic | hydrophilic. */
  polarity: "polarity",
  /** Amino-acid side-chain class: nonpolar | polar | aromatic | acidic | basic. */
  sideChain: "sideChain",
  /** Flag traits (value "true" when present). */
  essential: "essential",
  sulfur: "sulfur",
  inDna: "inDna",
  inRna: "inRna",
  /** purine | pyrimidine. */
  ringSystem: "ringSystem",
  /** Comma-separated slugs of Watson-Crick partners within the category. */
  pairsWith: "pairsWith",
  /** Czech teaching facts, one per line. */
  facts: "facts",
  /** Saccharides: alpha | beta — cross-checked against the Haworth spec. */
  anomer: "anomer",
  /** Saccharide ring form: pyranose | furanose. */
  ringForm: "ringForm",
  /** Flag: the sugar is a deoxy sugar (value "true" when present). */
  deoxy: "deoxy",
} as const

export type TraitKey = (typeof TRAIT)[keyof typeof TRAIT]

/** A molecule's trait value, or undefined when it doesn't carry the trait. */
export function traitOf(molecule: Biomolecule, key: TraitKey): string | undefined {
  const value = molecule.traits[key]
  return value && value.trim().length > 0 ? value : undefined
}

/** True when the molecule carries a flag trait (essential, sulfur, inDna, …). */
export function hasTraitFlag(molecule: Biomolecule, key: TraitKey): boolean {
  return traitOf(molecule, key) === "true"
}

/** A molecule's teaching facts (the `facts` trait, one per line). */
export function moleculeFacts(molecule: Biomolecule): string[] {
  return (traitOf(molecule, TRAIT.facts) ?? "")
    .split("\n")
    .map((fact) => fact.trim())
    .filter((fact) => fact.length > 0)
}

/**
 * True when a molecule has no stereocenter. SMILES marks chirality with
 * `@`/`@@`, so its absence is the achirality signal — for the curated sets
 * this matches the old hand-maintained flags exactly (only glycine).
 * Molecules with a declarative projection spec (saccharides) carry
 * stereochemistry by definition and are treated as chiral upstream
 * (`baseQuizMolecule`), regardless of what their skeletal SMILES contains.
 */
export function isAchiral(molecule: Pick<Biomolecule, "smiles">): boolean {
  return !molecule.smiles.includes("@")
}

/**
 * The minimal shape the shared molecule browser needs. Biomolecules from
 * the database satisfy it directly.
 */
export type MoleculeBase = Pick<Biomolecule, "slug" | "name" | "smiles" | "traits">

export type { Biomolecule, BiomoleculeTraits }
