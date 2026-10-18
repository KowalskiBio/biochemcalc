// TEST FIXTURE — a copy of the built-in dataset seeded by
// `src-tauri/src/db/biomolecule_seed.rs` (migration v47), reshaped into the
// frontend's `Biomolecule` rows so the quiz-config tests don't reach into
// the database. The Rust seed is the source of truth — regenerate/update
// this file when it changes.

import type { Biomolecule } from "@/lib/biomolecules-api"
import { AMINO_ACIDS_SLUG, NITROGEN_BASES_SLUG, SACCHARIDES_SLUG } from "@/lib/molecules"

interface SeedMolecule {
  slug: string
  name: string
  smiles: string
  traits: Record<string, string>
}

function toBiomolecules(categorySlug: string, molecules: SeedMolecule[]): Biomolecule[] {
  return molecules.map((molecule, position) => ({
    id: `${categorySlug}-${molecule.slug}`,
    categorySlug,
    slug: molecule.slug,
    name: molecule.name,
    smiles: molecule.smiles,
    position,
    traits: molecule.traits,
  }))
}

const AMINO_ACID_SEED: SeedMolecule[] = [
  {
    slug: "ala",
    name: "Alanin",
    smiles: "C[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "A",
      abbreviation: "Ala",
      sideChain: "nonpolar",
      charge: "neutral",
      facts: "Nejmenší chirální aminokyselina.",
    },
  },
  {
    slug: "arg",
    name: "Arginin",
    smiles: "C(C[C@@H](C(=O)O)N)CN=C(N)N",
    traits: {
      oneLetter: "R",
      abbreviation: "Arg",
      sideChain: "basic",
      charge: "positive",
      facts:
        "Guanidiniová skupina je v těle prakticky stále kladně nabitá.\nNejvyšší pKa postranního řetězce (≈ 12,5).",
    },
  },
  {
    slug: "asn",
    name: "Asparagin",
    smiles: "C([C@@H](C(=O)O)N)C(=O)N",
    traits: {
      oneLetter: "N",
      abbreviation: "Asn",
      sideChain: "polar",
      charge: "neutral",
      facts: "Amid kyseliny asparagové.",
    },
  },
  {
    slug: "asp",
    name: "Kyselina asparagová",
    smiles: "C([C@@H](C(=O)O)N)C(=O)O",
    traits: {
      oneLetter: "D",
      abbreviation: "Asp",
      sideChain: "acidic",
      charge: "negative",
      facts: "Při fyziologickém pH nese záporný náboj (aspartát).",
    },
  },
  {
    slug: "cys",
    name: "Cystein",
    smiles: "C([C@@H](C(=O)O)N)S",
    traits: {
      oneLetter: "C",
      abbreviation: "Cys",
      sideChain: "polar",
      charge: "neutral",
      sulfur: "true",
      facts:
        "Sulfhydrylové skupiny (–SH) dvou cysteinů tvoří disulfidový můstek (–S–S–).\nJako jediná chirální AMK má konfiguraci R — kvůli prioritě síry.",
    },
  },
  {
    slug: "gln",
    name: "Glutamin",
    smiles: "C(CC(=O)N)[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "Q",
      abbreviation: "Gln",
      sideChain: "polar",
      charge: "neutral",
      facts: "Amid kyseliny glutamové; hlavní transportní forma dusíku v krvi.",
    },
  },
  {
    slug: "glu",
    name: "Kyselina glutamová",
    smiles: "C(CC(=O)O)[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "E",
      abbreviation: "Glu",
      sideChain: "acidic",
      charge: "negative",
      facts:
        "Při fyziologickém pH nese záporný náboj (glutamát).\nDůležitý excitační neurotransmiter.",
    },
  },
  {
    slug: "gly",
    name: "Glycin",
    smiles: "NCC(=O)O",
    traits: {
      oneLetter: "G",
      abbreviation: "Gly",
      sideChain: "nonpolar",
      charge: "neutral",
      facts: "Jediná achirální proteinogenní aminokyselina — postranní řetězec je pouze H.",
    },
  },
  {
    slug: "his",
    name: "Histidin",
    smiles: "C1=C(NC=N1)C[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "H",
      abbreviation: "His",
      sideChain: "basic",
      charge: "neutral",
      facts:
        "Imidazol má pKa ≈ 6,0 — při fyziologickém pH je částečně nabitý.\nProto je častý v aktivních centrech enzymů.",
    },
  },
  {
    slug: "ile",
    name: "Isoleucin",
    smiles: "CC[C@H](C)[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "I",
      abbreviation: "Ile",
      sideChain: "nonpolar",
      charge: "neutral",
      essential: "true",
      facts: "Rozvětvený řetězec (BCAA); má dvě chirální centra.",
    },
  },
  {
    slug: "leu",
    name: "Leucin",
    smiles: "CC(C)C[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "L",
      abbreviation: "Leu",
      sideChain: "nonpolar",
      charge: "neutral",
      essential: "true",
      facts: "Rozvětvený řetězec (BCAA); častý v leucinových ziprech.",
    },
  },
  {
    slug: "lys",
    name: "Lysin",
    smiles: "C(CCN)C[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "K",
      abbreviation: "Lys",
      sideChain: "basic",
      charge: "positive",
      essential: "true",
      facts: "Dlouhý řetězec zakončený primárním aminem — při fyziologickém pH kladně nabitý.",
    },
  },
  {
    slug: "met",
    name: "Methionin",
    smiles: "CSCC[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "M",
      abbreviation: "Met",
      sideChain: "nonpolar",
      charge: "neutral",
      essential: "true",
      sulfur: "true",
      facts: "Startovací aminokyselina translace (kodon AUG).\nObsahuje síru (thioether).",
    },
  },
  {
    slug: "phe",
    name: "Fenylalanin",
    smiles: "C1=CC=C(C=C1)C[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "F",
      abbreviation: "Phe",
      sideChain: "aromatic",
      charge: "neutral",
      essential: "true",
      facts: "Benzolový kruh; vysoce hydrofobní.",
    },
  },
  {
    slug: "pro",
    name: "Prolin",
    smiles: "C1C[C@H](NC1)C(=O)O",
    traits: {
      oneLetter: "P",
      abbreviation: "Pro",
      sideChain: "nonpolar",
      charge: "neutral",
      facts:
        "Iminokyselina — dusík je součástí pyrrolidinového kruhu.\nZalamuje α-helixy (helix-breaker).",
    },
  },
  {
    slug: "ser",
    name: "Serin",
    smiles: "C([C@@H](C(=O)O)N)O",
    traits: {
      oneLetter: "S",
      abbreviation: "Ser",
      sideChain: "polar",
      charge: "neutral",
      facts: "Hydroxyskupina je častým místem fosforylace.",
    },
  },
  {
    slug: "thr",
    name: "Threonin",
    smiles: "C[C@H]([C@@H](C(=O)O)N)O",
    traits: {
      oneLetter: "T",
      abbreviation: "Thr",
      sideChain: "polar",
      charge: "neutral",
      essential: "true",
      facts: "Hydroxyskupina je častým místem fosforylace; má dvě chirální centra.",
    },
  },
  {
    slug: "trp",
    name: "Tryptofan",
    smiles: "C1=CC=C2C(=C1)C(=CN2)C[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "W",
      abbreviation: "Trp",
      sideChain: "aromatic",
      charge: "neutral",
      essential: "true",
      facts:
        "Největší standardní aminokyselina; indolový kruh.\nPředstupeň serotoninu a melatoninu.",
    },
  },
  {
    slug: "tyr",
    name: "Tyrosin",
    smiles: "C1=CC(=CC=C1C[C@@H](C(=O)O)N)O",
    traits: {
      oneLetter: "Y",
      abbreviation: "Tyr",
      sideChain: "aromatic",
      charge: "neutral",
      facts: "Fenolová –OH; místo fosforylace.\nPředstupeň dopaminu a adrenalínu.",
    },
  },
  {
    slug: "val",
    name: "Valin",
    smiles: "CC(C)[C@@H](C(=O)O)N",
    traits: {
      oneLetter: "V",
      abbreviation: "Val",
      sideChain: "nonpolar",
      charge: "neutral",
      essential: "true",
      facts: "Rozvětvený řetězec (BCAA).",
    },
  },
]

const NITROGEN_BASE_SEED: SeedMolecule[] = [
  {
    slug: "ade",
    name: "Adenin",
    smiles: "C1=NC2=NC=NC(=C2N1)N",
    traits: {
      abbreviation: "A",
      ringSystem: "purine",
      pairsWith: "thy,ura",
      inDna: "true",
      inRna: "true",
      facts:
        "Páruje se s thyminem (v DNA) nebo uracilem (v RNA) — dvě vodíkové vazby.\nSoučást ATP — hlavního energetického intermediátu buňky.",
    },
  },
  {
    slug: "cyt",
    name: "Cytosin",
    smiles: "C1=C(NC(=O)N=C1)N",
    traits: {
      abbreviation: "C",
      ringSystem: "pyrimidine",
      pairsWith: "gua",
      inDna: "true",
      inRna: "true",
      facts:
        "Páruje se s guaninem — tři vodíkové vazby.\nDeaminací vzniká uracil — častý zdroj bodových mutací.",
    },
  },
  {
    slug: "gua",
    name: "Guanin",
    smiles: "C1=NC2=C(N1)C(=O)N=C(N2)N",
    traits: {
      abbreviation: "G",
      ringSystem: "purine",
      pairsWith: "cyt",
      inDna: "true",
      inRna: "true",
      facts:
        "Páruje se s cytosinem — tři vodíkové vazby (vazba G–C je pevnější než A–T).\nNejnáchylnější báze k oxidaci — vzniká 8-oxoguanin.",
    },
  },
  {
    slug: "thy",
    name: "Thymin",
    smiles: "CC1=CNC(=O)NC1=O",
    traits: {
      abbreviation: "T",
      ringSystem: "pyrimidine",
      pairsWith: "ade",
      inDna: "true",
      facts:
        "Vyskytuje se pouze v DNA — v RNA jej nahrazuje uracil.\nUV záření vytváří thyminové dimery (poškození DNA).",
    },
  },
  {
    slug: "ura",
    name: "Uracil",
    smiles: "C1=CNC(=O)NC1=O",
    traits: {
      abbreviation: "U",
      ringSystem: "pyrimidine",
      pairsWith: "ade",
      inRna: "true",
      facts: "Vyskytuje se pouze v RNA.\nVzniká deaminací cytosinu.",
    },
  },
]

/** The 20 seeded amino acids as frontend Biomolecule rows. */
export const TEST_AMINO_ACIDS: Biomolecule[] = toBiomolecules(AMINO_ACIDS_SLUG, AMINO_ACID_SEED)

/** The 5 seeded nitrogenous bases as frontend Biomolecule rows. */
export const TEST_NITROGEN_BASES: Biomolecule[] = toBiomolecules(
  NITROGEN_BASES_SLUG,
  NITROGEN_BASE_SEED,
)

const SACCHARIDE_SEED: SeedMolecule[] = [
  {
    slug: "glukoza-a",
    name: "α-D-glukóza",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O)O)O)O)O",
    traits: { ringForm: "pyranose", anomer: "alpha" },
  },
  {
    slug: "glukoza-b",
    name: "β-D-glukóza",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O",
    traits: { ringForm: "pyranose", anomer: "beta" },
  },
  {
    slug: "galaktoza-b",
    name: "β-D-galaktóza",
    smiles: "C([C@@H]1[C@@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O",
    traits: { ringForm: "pyranose", anomer: "beta" },
  },
  {
    slug: "manoza-a",
    name: "α-D-manóza",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@@H]([C@H](O1)O)O)O)O)O",
    traits: { ringForm: "pyranose", anomer: "alpha" },
  },
  {
    slug: "fruktoza-b",
    name: "β-D-fruktóza",
    smiles: "OC[C@]1(O)[C@@H](O)[C@@H](O)[C@@H](CO)O1",
    traits: { ringForm: "furanose", anomer: "beta" },
  },
  {
    slug: "riboza-b",
    name: "β-D-ribóza",
    smiles: "OC[C@H]1O[C@@H](O)[C@H](O)[C@@H]1O",
    traits: { ringForm: "furanose", anomer: "beta" },
  },
  {
    slug: "deoxyriboza-b",
    name: "2-deoxy-β-D-ribóza",
    smiles: "OC[C@H]1O[C@@H](O)C[C@@H]1O",
    traits: { ringForm: "furanose", anomer: "beta", deoxy: "true" },
  },
  {
    slug: "adenosin",
    name: "Adenosin",
    smiles: "NC1=NC=NC2=C1N=CN2[C@@H]3O[C@H](CO)[C@@H](O)[C@H]3O",
    traits: { ringForm: "furanose", anomer: "beta" },
  },
  {
    slug: "amp",
    name: "Adenosinmonofosfát (AMP)",
    smiles: "NC1=NC=NC2=C1N=CN2[C@@H]3O[C@H](COP(=O)(O)O)[C@@H](O)[C@H]3O",
    traits: { ringForm: "furanose", anomer: "beta" },
  },
]

/** The 9 seeded saccharides/nucleotides as frontend Biomolecule rows. */
export const TEST_SACCHARIDES: Biomolecule[] = toBiomolecules(SACCHARIDES_SLUG, SACCHARIDE_SEED)
