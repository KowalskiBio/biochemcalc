//! Built-in Biomolekuly dataset, seeded by migration v47.
//!
//! Until v47 the curated categories lived in the frontend
//! (`src/lib/molecules/*.ts`); they moved into the database so teachers can
//! manage them like everything else. This module is the seed's single source
//! of truth — the trait keys must stay in sync with the validated vocabulary
//! in `commands::biomolecules::traits` and the display strings keyed by trait
//! value in `cs.biomolekuly`.

use rusqlite::{params, Connection};
use uuid::Uuid;

pub const AMINO_ACIDS_SLUG: &str = "aminokyseliny";
pub const NITROGEN_BASES_SLUG: &str = "dusikate-baze";

struct SeedCategory {
    slug: &'static str,
    name: &'static str,
    description: &'static str,
}

struct SeedMolecule {
    slug: &'static str,
    name: &'static str,
    smiles: &'static str,
    traits: &'static [(&'static str, &'static str)],
}

const AMINO_ACIDS_CATEGORY: SeedCategory = SeedCategory {
    slug: AMINO_ACIDS_SLUG,
    name: "Aminokyseliny",
    description: "Dvacet proteinogenních aminokyselin — názvy, zkratky a strukturní vzorce.",
};

const NITROGEN_BASES_CATEGORY: SeedCategory = SeedCategory {
    slug: NITROGEN_BASES_SLUG,
    name: "Dusíkaté báze",
    description: "Pět základních bází DNA a RNA — názvy, zkratky a strukturní vzorce.",
};

/// The 20 proteinogenic L-amino acids. SMILES are the PubChem canonical
/// isomeric forms in the neutral (non-zwitterionic) state; glycine is the
/// only achiral one (no `@`). Traits: `oneLetter` (quiz letter),
/// `abbreviation` (three-letter code), `sideChain`, `charge` at pH 7,
/// `essential` / `sulfur` (present = true), `facts` (one per line).
#[rustfmt::skip]
const AMINO_ACIDS: &[SeedMolecule] = &[
    SeedMolecule {
        slug: "ala", name: "Alanin", smiles: "C[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "A"), ("abbreviation", "Ala"), ("sideChain", "nonpolar"), ("charge", "neutral"),
                  ("facts", "Nejmenší chirální aminokyselina.")],
    },
    SeedMolecule {
        slug: "arg", name: "Arginin", smiles: "C(C[C@@H](C(=O)O)N)CN=C(N)N",
        traits: &[("oneLetter", "R"), ("abbreviation", "Arg"), ("sideChain", "basic"), ("charge", "positive"),
                  ("facts", "Guanidiniová skupina je v těle prakticky stále kladně nabitá.\nNejvyšší pKa postranního řetězce (≈ 12,5).")],
    },
    SeedMolecule {
        slug: "asn", name: "Asparagin", smiles: "C([C@@H](C(=O)O)N)C(=O)N",
        traits: &[("oneLetter", "N"), ("abbreviation", "Asn"), ("sideChain", "polar"), ("charge", "neutral"),
                  ("facts", "Amid kyseliny asparagové.")],
    },
    SeedMolecule {
        slug: "asp", name: "Kyselina asparagová", smiles: "C([C@@H](C(=O)O)N)C(=O)O",
        traits: &[("oneLetter", "D"), ("abbreviation", "Asp"), ("sideChain", "acidic"), ("charge", "negative"),
                  ("facts", "Při fyziologickém pH nese záporný náboj (aspartát).")],
    },
    SeedMolecule {
        slug: "cys", name: "Cystein", smiles: "C([C@@H](C(=O)O)N)S",
        traits: &[("oneLetter", "C"), ("abbreviation", "Cys"), ("sideChain", "polar"), ("charge", "neutral"), ("sulfur", "true"),
                  ("facts", "Sulfhydrylové skupiny (–SH) dvou cysteinů tvoří disulfidový můstek (–S–S–).\nJako jediná chirální AMK má konfiguraci R — kvůli prioritě síry.")],
    },
    SeedMolecule {
        slug: "gln", name: "Glutamin", smiles: "C(CC(=O)N)[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "Q"), ("abbreviation", "Gln"), ("sideChain", "polar"), ("charge", "neutral"),
                  ("facts", "Amid kyseliny glutamové; hlavní transportní forma dusíku v krvi.")],
    },
    SeedMolecule {
        slug: "glu", name: "Kyselina glutamová", smiles: "C(CC(=O)O)[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "E"), ("abbreviation", "Glu"), ("sideChain", "acidic"), ("charge", "negative"),
                  ("facts", "Při fyziologickém pH nese záporný náboj (glutamát).\nDůležitý excitační neurotransmiter.")],
    },
    SeedMolecule {
        slug: "gly", name: "Glycin", smiles: "NCC(=O)O",
        traits: &[("oneLetter", "G"), ("abbreviation", "Gly"), ("sideChain", "nonpolar"), ("charge", "neutral"),
                  ("facts", "Jediná achirální proteinogenní aminokyselina — postranní řetězec je pouze H.")],
    },
    SeedMolecule {
        slug: "his", name: "Histidin", smiles: "C1=C(NC=N1)C[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "H"), ("abbreviation", "His"), ("sideChain", "basic"), ("charge", "neutral"),
                  ("facts", "Imidazol má pKa ≈ 6,0 — při fyziologickém pH je částečně nabitý.\nProto je častý v aktivních centrech enzymů.")],
    },
    SeedMolecule {
        slug: "ile", name: "Isoleucin", smiles: "CC[C@H](C)[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "I"), ("abbreviation", "Ile"), ("sideChain", "nonpolar"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Rozvětvený řetězec (BCAA); má dvě chirální centra.")],
    },
    SeedMolecule {
        slug: "leu", name: "Leucin", smiles: "CC(C)C[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "L"), ("abbreviation", "Leu"), ("sideChain", "nonpolar"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Rozvětvený řetězec (BCAA); častý v leucinových ziprech.")],
    },
    SeedMolecule {
        slug: "lys", name: "Lysin", smiles: "C(CCN)C[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "K"), ("abbreviation", "Lys"), ("sideChain", "basic"), ("charge", "positive"), ("essential", "true"),
                  ("facts", "Dlouhý řetězec zakončený primárním aminem — při fyziologickém pH kladně nabitý.")],
    },
    SeedMolecule {
        slug: "met", name: "Methionin", smiles: "CSCC[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "M"), ("abbreviation", "Met"), ("sideChain", "nonpolar"), ("charge", "neutral"), ("essential", "true"), ("sulfur", "true"),
                  ("facts", "Startovací aminokyselina translace (kodon AUG).\nObsahuje síru (thioether).")],
    },
    SeedMolecule {
        slug: "phe", name: "Fenylalanin", smiles: "C1=CC=C(C=C1)C[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "F"), ("abbreviation", "Phe"), ("sideChain", "aromatic"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Benzolový kruh; vysoce hydrofobní.")],
    },
    SeedMolecule {
        slug: "pro", name: "Prolin", smiles: "C1C[C@H](NC1)C(=O)O",
        traits: &[("oneLetter", "P"), ("abbreviation", "Pro"), ("sideChain", "nonpolar"), ("charge", "neutral"),
                  ("facts", "Iminokyselina — dusík je součástí pyrrolidinového kruhu.\nZalamuje α-helixy (helix-breaker).")],
    },
    SeedMolecule {
        slug: "ser", name: "Serin", smiles: "C([C@@H](C(=O)O)N)O",
        traits: &[("oneLetter", "S"), ("abbreviation", "Ser"), ("sideChain", "polar"), ("charge", "neutral"),
                  ("facts", "Hydroxyskupina je častým místem fosforylace.")],
    },
    SeedMolecule {
        slug: "thr", name: "Threonin", smiles: "C[C@H]([C@@H](C(=O)O)N)O",
        traits: &[("oneLetter", "T"), ("abbreviation", "Thr"), ("sideChain", "polar"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Hydroxyskupina je častým místem fosforylace; má dvě chirální centra.")],
    },
    SeedMolecule {
        slug: "trp", name: "Tryptofan", smiles: "C1=CC=C2C(=C1)C(=CN2)C[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "W"), ("abbreviation", "Trp"), ("sideChain", "aromatic"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Největší standardní aminokyselina; indolový kruh.\nPředstupeň serotoninu a melatoninu.")],
    },
    SeedMolecule {
        slug: "tyr", name: "Tyrosin", smiles: "C1=CC(=CC=C1C[C@@H](C(=O)O)N)O",
        traits: &[("oneLetter", "Y"), ("abbreviation", "Tyr"), ("sideChain", "aromatic"), ("charge", "neutral"),
                  ("facts", "Fenolová –OH; místo fosforylace.\nPředstupeň dopaminu a adrenalínu.")],
    },
    SeedMolecule {
        slug: "val", name: "Valin", smiles: "CC(C)[C@@H](C(=O)O)N",
        traits: &[("oneLetter", "V"), ("abbreviation", "Val"), ("sideChain", "nonpolar"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Rozvětvený řetězec (BCAA).")],
    },
];

/// The five basic nitrogenous bases (keto tautomeric forms, all achiral
/// planar ring systems). Traits: `abbreviation`, `ringSystem`, `pairsWith`
/// (comma-separated molecule slugs), `inDna` / `inRna`, `facts`.
#[rustfmt::skip]
const NITROGEN_BASES: &[SeedMolecule] = &[
    SeedMolecule {
        slug: "ade", name: "Adenin", smiles: "C1=NC2=NC=NC(=C2N1)N",
        traits: &[("abbreviation", "A"), ("ringSystem", "purine"), ("pairsWith", "thy,ura"), ("inDna", "true"), ("inRna", "true"),
                  ("facts", "Páruje se s thyminem (v DNA) nebo uracilem (v RNA) — dvě vodíkové vazby.\nSoučást ATP — hlavního energetického intermediátu buňky.")],
    },
    SeedMolecule {
        slug: "cyt", name: "Cytosin", smiles: "C1=C(NC(=O)N=C1)N",
        traits: &[("abbreviation", "C"), ("ringSystem", "pyrimidine"), ("pairsWith", "gua"), ("inDna", "true"), ("inRna", "true"),
                  ("facts", "Páruje se s guaninem — tři vodíkové vazby.\nDeaminací vzniká uracil — častý zdroj bodových mutací.")],
    },
    SeedMolecule {
        slug: "gua", name: "Guanin", smiles: "C1=NC2=C(N1)C(=O)N=C(N2)N",
        traits: &[("abbreviation", "G"), ("ringSystem", "purine"), ("pairsWith", "cyt"), ("inDna", "true"), ("inRna", "true"),
                  ("facts", "Páruje se s cytosinem — tři vodíkové vazby (vazba G–C je pevnější než A–T).\nNejnáchylnější báze k oxidaci — vzniká 8-oxoguanin.")],
    },
    SeedMolecule {
        slug: "thy", name: "Thymin", smiles: "CC1=CNC(=O)NC1=O",
        traits: &[("abbreviation", "T"), ("ringSystem", "pyrimidine"), ("pairsWith", "ade"), ("inDna", "true"),
                  ("facts", "Vyskytuje se pouze v DNA — v RNA jej nahrazuje uracil.\nUV záření vytváří thyminové dimery (poškození DNA).")],
    },
    SeedMolecule {
        slug: "ura", name: "Uracil", smiles: "C1=CNC(=O)NC1=O",
        traits: &[("abbreviation", "U"), ("ringSystem", "pyrimidine"), ("pairsWith", "ade"), ("inRna", "true"),
                  ("facts", "Vyskytuje se pouze v RNA.\nVzniká deaminací cytosinu.")],
    },
];

/// Insert the built-in categories and molecules. No-op when any category row
/// already exists — migration v47 runs once per database and callers must not
/// resurrect data a teacher deleted, so emptiness is the only safe gate.
pub fn seed_builtins_if_empty(conn: &Connection) -> Result<(), rusqlite::Error> {
    let already_seeded: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM biomolecule_categories LIMIT 1)",
        [],
        |row| row.get(0),
    )?;
    if already_seeded {
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;
    let now = chrono::Utc::now().to_rfc3339();
    for (position, (category, molecules)) in [
        (&AMINO_ACIDS_CATEGORY, AMINO_ACIDS),
        (&NITROGEN_BASES_CATEGORY, NITROGEN_BASES),
    ]
    .into_iter()
    .enumerate()
    {
        tx.execute(
            "INSERT INTO biomolecule_categories
                 (slug, name, description, position, built_in, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
            params![category.slug, category.name, category.description, position as i64, now],
        )?;
        for (molecule_position, molecule) in molecules.iter().enumerate() {
            let molecule_id = Uuid::new_v4();
            tx.execute(
                "INSERT INTO biomolecules
                     (id, category_slug, slug, name, smiles, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![
                    molecule_id,
                    category.slug,
                    molecule.slug,
                    molecule.name,
                    molecule.smiles,
                    molecule_position as i64,
                    now
                ],
            )?;
            for (trait_key, value) in molecule.traits {
                tx.execute(
                    "INSERT INTO biomolecule_traits (molecule_id, trait, value)
                     VALUES (?1, ?2, ?3)",
                    params![molecule_id, trait_key, value],
                )?;
            }
        }
    }
    tx.commit()?;
    Ok(())
}
