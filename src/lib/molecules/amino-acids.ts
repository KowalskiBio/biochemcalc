// Curated dataset of the 20 canonical (proteinogenic) amino acids.
// Ships with the app — no DB, works fully offline.
//
// SMILES are the PubChem canonical isomeric forms of the natural
// L-isomers, drawn in the neutral (non-zwitterionic) state for a clean
// skeletal depiction. Chiral entries contain `@`/`@@`; glycine is the
// only achiral one (mirroring its depiction is therefore safe).

export type SideChainClass = "nonpolar" | "polar" | "aromatic" | "acidic" | "basic"

export type ChargeAtPh7 = "negative" | "neutral" | "positive"

export interface AminoAcid {
  /** Stable id, three-letter code lowercased ("ala"). */
  id: string
  /** Czech name ("Alanin"). */
  name: string
  /** Three-letter code ("Ala"). */
  threeLetter: string
  /** One-letter code ("A"). */
  oneLetter: string
  /** Isomeric SMILES of the L-form, neutral state. */
  smiles: string
  /** True only for glycine — mirroring the structure flips stereochemistry otherwise. */
  achiral: boolean
  /** Essential for humans (Val, Leu, Ile, Met, Phe, Trp, Lys, Thr). */
  essential: boolean
  /** Aromatic side chain (Phe, Tyr, Trp). His/Gly excluded to match the usual teaching grouping. */
  aromatic: boolean
  sideChain: SideChainClass
  chargeAtPh7: ChargeAtPh7
  /** Czech teaching facts shown in the detail view. */
  facts: string[]
}

export const AMINO_ACIDS: AminoAcid[] = [
  {
    id: "ala",
    name: "Alanin",
    threeLetter: "Ala",
    oneLetter: "A",
    smiles: "C[C@@H](C(=O)O)N",
    achiral: false,
    essential: false,
    aromatic: false,
    sideChain: "nonpolar",
    chargeAtPh7: "neutral",
    facts: ["Nejmenší chirální aminokyselina."],
  },
  {
    id: "arg",
    name: "Arginin",
    threeLetter: "Arg",
    oneLetter: "R",
    smiles: "C(C[C@@H](C(=O)O)N)CN=C(N)N",
    achiral: false,
    essential: false,
    aromatic: false,
    sideChain: "basic",
    chargeAtPh7: "positive",
    facts: [
      "Guanidiniová skupina je v těle prakticky stále kladně nabitá.",
      "Nejvyšší pKa postranního řetězce (≈ 12,5).",
    ],
  },
  {
    id: "asn",
    name: "Asparagin",
    threeLetter: "Asn",
    oneLetter: "N",
    smiles: "C([C@@H](C(=O)O)N)C(=O)N",
    achiral: false,
    essential: false,
    aromatic: false,
    sideChain: "polar",
    chargeAtPh7: "neutral",
    facts: ["Amid kyseliny asparagové."],
  },
  {
    id: "asp",
    name: "Kyselina asparagová",
    threeLetter: "Asp",
    oneLetter: "D",
    smiles: "C([C@@H](C(=O)O)N)C(=O)O",
    achiral: false,
    essential: false,
    aromatic: false,
    sideChain: "acidic",
    chargeAtPh7: "negative",
    facts: ["Při fyziologickém pH nese záporný náboj (aspartát)."],
  },
  {
    id: "cys",
    name: "Cystein",
    threeLetter: "Cys",
    oneLetter: "C",
    smiles: "C([C@@H](C(=O)O)N)S",
    achiral: false,
    essential: false,
    aromatic: false,
    sideChain: "polar",
    chargeAtPh7: "neutral",
    facts: [
      "Sulfhydrylové skupiny (–SH) dvou cysteinů tvoří disulfidový můstek (–S–S–).",
      "Jako jediná chirální AMK má konfiguraci R — kvůli prioritě síry.",
    ],
  },
  {
    id: "gln",
    name: "Glutamin",
    threeLetter: "Gln",
    oneLetter: "Q",
    smiles: "C(CC(=O)N)[C@@H](C(=O)O)N",
    achiral: false,
    essential: false,
    aromatic: false,
    sideChain: "polar",
    chargeAtPh7: "neutral",
    facts: ["Amid kyseliny glutamové; hlavní transportní forma dusíku v krvi."],
  },
  {
    id: "glu",
    name: "Kyselina glutamová",
    threeLetter: "Glu",
    oneLetter: "E",
    smiles: "C(CC(=O)O)[C@@H](C(=O)O)N",
    achiral: false,
    essential: false,
    aromatic: false,
    sideChain: "acidic",
    chargeAtPh7: "negative",
    facts: [
      "Při fyziologickém pH nese záporný náboj (glutamát).",
      "Důležitý excitační neurotransmiter.",
    ],
  },
  {
    id: "gly",
    name: "Glycin",
    threeLetter: "Gly",
    oneLetter: "G",
    smiles: "NCC(=O)O",
    achiral: true,
    essential: false,
    aromatic: false,
    sideChain: "nonpolar",
    chargeAtPh7: "neutral",
    facts: ["Jediná achirální proteinogenní aminokyselina — postranní řetězec je pouze H."],
  },
  {
    id: "his",
    name: "Histidin",
    threeLetter: "His",
    oneLetter: "H",
    smiles: "C1=C(NC=N1)C[C@@H](C(=O)O)N",
    achiral: false,
    essential: false,
    aromatic: false,
    sideChain: "basic",
    chargeAtPh7: "neutral",
    facts: [
      "Imidazol má pKa ≈ 6,0 — při fyziologickém pH je částečně nabitý.",
      "Proto je častý v aktivních centrech enzymů.",
    ],
  },
  {
    id: "ile",
    name: "Isoleucin",
    threeLetter: "Ile",
    oneLetter: "I",
    smiles: "CC[C@H](C)[C@@H](C(=O)O)N",
    achiral: false,
    essential: true,
    aromatic: false,
    sideChain: "nonpolar",
    chargeAtPh7: "neutral",
    facts: ["Rozvětvený řetězec (BCAA); má dvě chirální centra."],
  },
  {
    id: "leu",
    name: "Leucin",
    threeLetter: "Leu",
    oneLetter: "L",
    smiles: "CC(C)C[C@@H](C(=O)O)N",
    achiral: false,
    essential: true,
    aromatic: false,
    sideChain: "nonpolar",
    chargeAtPh7: "neutral",
    facts: ["Rozvětvený řetězec (BCAA); častý v leucinových ziprech."],
  },
  {
    id: "lys",
    name: "Lysin",
    threeLetter: "Lys",
    oneLetter: "K",
    smiles: "C(CCN)C[C@@H](C(=O)O)N",
    achiral: false,
    essential: true,
    aromatic: false,
    sideChain: "basic",
    chargeAtPh7: "positive",
    facts: ["Dlouhý řetězec zakončený primárním aminem — při fyziologickém pH kladně nabitý."],
  },
  {
    id: "met",
    name: "Methionin",
    threeLetter: "Met",
    oneLetter: "M",
    smiles: "CSCC[C@@H](C(=O)O)N",
    achiral: false,
    essential: true,
    aromatic: false,
    sideChain: "nonpolar",
    chargeAtPh7: "neutral",
    facts: ["Startovací aminokyselina translace (kodon AUG).", "Obsahuje síru (thioether)."],
  },
  {
    id: "phe",
    name: "Fenylalanin",
    threeLetter: "Phe",
    oneLetter: "F",
    smiles: "C1=CC=C(C=C1)C[C@@H](C(=O)O)N",
    achiral: false,
    essential: true,
    aromatic: true,
    sideChain: "aromatic",
    chargeAtPh7: "neutral",
    facts: ["Benzolový kruh; vysoce hydrofobní."],
  },
  {
    id: "pro",
    name: "Prolin",
    threeLetter: "Pro",
    oneLetter: "P",
    smiles: "C1C[C@H](NC1)C(=O)O",
    achiral: false,
    essential: false,
    aromatic: false,
    sideChain: "nonpolar",
    chargeAtPh7: "neutral",
    facts: [
      "Iminokyselina — dusík je součástí pyrrolidinového kruhu.",
      "Zalamuje α-helixy (helix-breaker).",
    ],
  },
  {
    id: "ser",
    name: "Serin",
    threeLetter: "Ser",
    oneLetter: "S",
    smiles: "C([C@@H](C(=O)O)N)O",
    achiral: false,
    essential: false,
    aromatic: false,
    sideChain: "polar",
    chargeAtPh7: "neutral",
    facts: ["Hydroxyskupina je častým místem fosforylace."],
  },
  {
    id: "thr",
    name: "Threonin",
    threeLetter: "Thr",
    oneLetter: "T",
    smiles: "C[C@H]([C@@H](C(=O)O)N)O",
    achiral: false,
    essential: true,
    aromatic: false,
    sideChain: "polar",
    chargeAtPh7: "neutral",
    facts: ["Hydroxyskupina je častým místem fosforylace; má dvě chirální centra."],
  },
  {
    id: "trp",
    name: "Tryptofan",
    threeLetter: "Trp",
    oneLetter: "W",
    smiles: "C1=CC=C2C(=C1)C(=CN2)C[C@@H](C(=O)O)N",
    achiral: false,
    essential: true,
    aromatic: true,
    sideChain: "aromatic",
    chargeAtPh7: "neutral",
    facts: [
      "Největší standardní aminokyselina; indolový kruh.",
      "Předstupeň serotoninu a melatoninu.",
    ],
  },
  {
    id: "tyr",
    name: "Tyrosin",
    threeLetter: "Tyr",
    oneLetter: "Y",
    smiles: "C1=CC(=CC=C1C[C@@H](C(=O)O)N)O",
    achiral: false,
    essential: false,
    aromatic: true,
    sideChain: "aromatic",
    chargeAtPh7: "neutral",
    facts: ["Fenolová –OH; místo fosforylace.", "Předstupeň dopaminu a adrenalínu."],
  },
  {
    id: "val",
    name: "Valin",
    threeLetter: "Val",
    oneLetter: "V",
    smiles: "CC(C)[C@@H](C(=O)O)N",
    achiral: false,
    essential: true,
    aromatic: false,
    sideChain: "nonpolar",
    chargeAtPh7: "neutral",
    facts: ["Rozvětvený řetězec (BCAA)."],
  },
]

export function getAminoAcidByOneLetter(letter: string): AminoAcid | undefined {
  return AMINO_ACIDS.find((aa) => aa.oneLetter === letter.toUpperCase())
}

/** Mirroring a structure drawing flips stereochemistry — allowed only for achiral molecules. */
export function canMirrorStructure(molecule: Pick<AminoAcid, "achiral">): boolean {
  return molecule.achiral
}
