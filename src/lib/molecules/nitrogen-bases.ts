// Curated dataset of the five basic nitrogenous bases (dusíkaté báze).
// Ships with the app — no DB, works fully offline.
//
// SMILES are PubChem canonical (keto tautomeric forms): adenine CID 190,
// cytosine CID 597, guanine CID 764, thymine CID 1135, uracil CID 1174.
// All five bases are achiral planar ring systems.

export type RingSystem = "purine" | "pyrimidine"

export interface NitrogenBase {
  /** Stable id, three letters lowercase ("ade"). */
  id: string
  /** Czech name ("Adenin"). */
  name: string
  /** One-letter abbreviation ("A"). */
  abbreviation: string
  /** Canonical SMILES (keto form). */
  smiles: string
  /** Purine (A, G) — fused double ring; pyrimidine (C, T, U) — single ring. */
  ringSystem: RingSystem
  /** Ids of the Watson-Crick pairing partners (A: thy+ura; C/G: each other). */
  pairsWithIds: string[]
  inDna: boolean
  inRna: boolean
  /** Czech teaching facts shown in the detail view. */
  facts: string[]
}

export const NITROGEN_BASES: NitrogenBase[] = [
  {
    id: "ade",
    name: "Adenin",
    abbreviation: "A",
    smiles: "C1=NC2=NC=NC(=C2N1)N",
    ringSystem: "purine",
    pairsWithIds: ["thy", "ura"],
    inDna: true,
    inRna: true,
    facts: [
      "Páruje se s thyminem (v DNA) nebo uracilem (v RNA) — dvě vodíkové vazby.",
      "Součást ATP — hlavního energetického intermediátu buňky.",
    ],
  },
  {
    id: "cyt",
    name: "Cytosin",
    abbreviation: "C",
    smiles: "C1=C(NC(=O)N=C1)N",
    ringSystem: "pyrimidine",
    pairsWithIds: ["gua"],
    inDna: true,
    inRna: true,
    facts: [
      "Páruje se s guaninem — tři vodíkové vazby.",
      "Deaminací vzniká uracil — častý zdroj bodových mutací.",
    ],
  },
  {
    id: "gua",
    name: "Guanin",
    abbreviation: "G",
    smiles: "C1=NC2=C(N1)C(=O)N=C(N2)N",
    ringSystem: "purine",
    pairsWithIds: ["cyt"],
    inDna: true,
    inRna: true,
    facts: [
      "Páruje se s cytosinem — tři vodíkové vazby (vazba G–C je pevnější než A–T).",
      "Nejnáchylnější báze k oxidaci — vzniká 8-oxoguanin.",
    ],
  },
  {
    id: "thy",
    name: "Thymin",
    abbreviation: "T",
    smiles: "CC1=CNC(=O)NC1=O",
    ringSystem: "pyrimidine",
    pairsWithIds: ["ade"],
    inDna: true,
    inRna: false,
    facts: [
      "Vyskytuje se pouze v DNA — v RNA jej nahrazuje uracil.",
      "UV záření vytváří thyminové dimery (poškození DNA).",
    ],
  },
  {
    id: "ura",
    name: "Uracil",
    abbreviation: "U",
    smiles: "C1=CNC(=O)NC1=O",
    ringSystem: "pyrimidine",
    pairsWithIds: ["ade"],
    inDna: false,
    inRna: true,
    facts: ["Vyskytuje se pouze v RNA.", "Vzniká deaminací cytosinu."],
  },
]

export function getNitrogenBaseById(id: string): NitrogenBase | undefined {
  return NITROGEN_BASES.find((base) => base.id === id)
}
