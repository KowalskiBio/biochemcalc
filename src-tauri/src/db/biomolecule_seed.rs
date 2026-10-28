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
pub const SACCHARIDES_SLUG: &str = "sacharidy";
/// Special proteinogenic amino acids beyond the canonical 20 (Sec, Pyl).
/// Opted into games individually — the Peptidovka defaults leave them out.
pub const SPECIAL_AMINO_ACIDS_SLUG: &str = "specialni-aminokyseliny";

pub const AMINO_ACIDS_TOPIC_SLUG: &str = "aminokyseliny";
pub const NUCLEIC_ACIDS_TOPIC_SLUG: &str = "nukleove-kyseliny";
pub const SACCHARIDES_TOPIC_SLUG: &str = "sacharidy";

struct SeedTopic {
    slug: &'static str,
    name: &'static str,
    description: &'static str,
}

struct SeedCategory {
    slug: &'static str,
    name: &'static str,
    description: &'static str,
    topic_slug: &'static str,
}

/// Built-in topic grouping (v51). Kept here so any code path that seeds a
/// fresh library produces the same shape as a migrated database.
const SEED_TOPICS: &[SeedTopic] = &[
    SeedTopic {
        slug: AMINO_ACIDS_TOPIC_SLUG,
        name: "Aminokyseliny",
        description: "Proteinogenní aminokyseliny a jejich vlastnosti.",
    },
    SeedTopic {
        slug: NUCLEIC_ACIDS_TOPIC_SLUG,
        name: "Nukleové kyseliny",
        description: "Dusíkaté báze a nukleotidy — stavební kameny nukleových kyselin.",
    },
    SeedTopic {
        slug: SACCHARIDES_TOPIC_SLUG,
        name: "Sacharidy",
        description: "Monosacharidy a další cukry — struktura a označení.",
    },
];

struct SeedMolecule {
    slug: &'static str,
    name: &'static str,
    smiles: &'static str,
    /// Raw JSON Haworth projection spec, when the molecule has one.
    projection: Option<&'static str>,
    traits: &'static [(&'static str, &'static str)],
}

const AMINO_ACIDS_CATEGORY: SeedCategory = SeedCategory {
    slug: AMINO_ACIDS_SLUG,
    name: "Aminokyseliny",
    description: "Dvacet proteinogenních aminokyselin — názvy, zkratky a strukturní vzorce.",
    topic_slug: AMINO_ACIDS_TOPIC_SLUG,
};

const NITROGEN_BASES_CATEGORY: SeedCategory = SeedCategory {
    slug: NITROGEN_BASES_SLUG,
    name: "Dusíkaté báze",
    description: "Pět základních bází DNA a RNA — názvy, zkratky a strukturní vzorce.",
    topic_slug: NUCLEIC_ACIDS_TOPIC_SLUG,
};

const SACCHARIDES_CATEGORY: SeedCategory = SeedCategory {
    slug: SACCHARIDES_SLUG,
    name: "Sacharidy",
    description: "Vybrané monosacharidy a nukleotidy — Haworthovy projekce a strukturní vzorce.",
    topic_slug: SACCHARIDES_TOPIC_SLUG,
};

const SPECIAL_AMINO_ACIDS_CATEGORY: SeedCategory = SeedCategory {
    slug: SPECIAL_AMINO_ACIDS_SLUG,
    name: "Speciální aminokyseliny",
    description: "21. a 22. proteinogenní aminokyselina — selenocystein a pyrrolysin.",
    topic_slug: AMINO_ACIDS_TOPIC_SLUG,
};

/// Selenocysteine and pyrrolysine with the same trait vocabulary as the
/// canonical twenty: single letters (U / O), codes, family, charge, polarity
/// axis, and facts. SMILES are the neutral isomeric L forms (PubChem).
#[rustfmt::skip]
const SPECIAL_AMINO_ACIDS: &[SeedMolecule] = &[
    SeedMolecule {
        slug: "sec", name: "Selenocystein", smiles: "N[C@@H](C[SeH])C(=O)O",
        projection: None,
        traits: &[("oneLetter", "U"), ("abbreviation", "Sec"), ("sideChain", "polar"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"),
                  ("facts", "21. aminokyselina; vkládá se recodingem UGA kodonu pomocí sekundární SECIS struktury.\nSelen stojí v active centrech (glutathion peroxidáza, thioredoxin reduktáza).")],
    },
    SeedMolecule {
        slug: "pyl", name: "Pyrrolysin", smiles: "N[C@@H](CCCCNC(=O)C1N=CCC(C)1)C(=O)O",
        projection: None,
        traits: &[("oneLetter", "O"), ("abbreviation", "Pyl"), ("sideChain", "basic"),
                  ("polarity", "hydrophilic"), ("charge", "neutral"),
                  ("facts", "22. aminokyselina; vkládá se recodingem UAG kodonu u metanogenů.\nPostranní řetězec nese metylpyrrolinkarbonylamid na ε-dusíku lysinu.")],
    },
];

/// Canonical slugs of the 20 proteinogenic amino acids, in seed order. Used
/// as the default Peptidovka slug set (migration v56).
pub const AMINO_ACID_SLUGS: &[&str] = &[
    "ala", "arg", "asn", "asp", "cys", "gln", "glu", "gly", "his", "ile", "leu", "lys", "met",
    "phe", "pro", "ser", "thr", "trp", "tyr", "val",
];

/// The 20 proteinogenic L-amino acids. SMILES are the PubChem canonical
/// isomeric forms in the neutral (non-zwitterionic) state; glycine is the
/// only achiral one (no `@`). Traits: `oneLetter` (quiz letter),
/// `abbreviation` (three-letter code), `sideChain`, `charge` at pH 7,
/// `essential` / `sulfur` (present = true), `facts` (one per line).
#[rustfmt::skip]
const AMINO_ACIDS: &[SeedMolecule] = &[
    SeedMolecule {
        slug: "ala", name: "Alanin", smiles: "C[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "A"), ("abbreviation", "Ala"), ("sideChain", "nonpolar"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"),
                  ("facts", "Nejmenší chirální aminokyselina.")],
    },
    SeedMolecule {
        slug: "arg", name: "Arginin", smiles: "C(C[C@@H](C(=O)O)N)CN=C(N)N",
        projection: None,
        traits: &[("oneLetter", "R"), ("abbreviation", "Arg"), ("sideChain", "basic"),
                  ("polarity", "hydrophilic"), ("charge", "positive"),
                  ("facts", "Guanidiniová skupina je v těle prakticky stále kladně nabitá.\nNejvyšší pKa postranního řetězce (≈ 12,5).")],
    },
    SeedMolecule {
        slug: "asn", name: "Asparagin", smiles: "C([C@@H](C(=O)O)N)C(=O)N",
        projection: None,
        traits: &[("oneLetter", "N"), ("abbreviation", "Asn"), ("sideChain", "polar"),
                  ("polarity", "hydrophilic"), ("charge", "neutral"),
                  ("facts", "Amid kyseliny asparagové.")],
    },
    SeedMolecule {
        slug: "asp", name: "Kyselina asparagová", smiles: "C([C@@H](C(=O)O)N)C(=O)O",
        projection: None,
        traits: &[("oneLetter", "D"), ("abbreviation", "Asp"), ("sideChain", "acidic"),
                  ("polarity", "hydrophilic"), ("charge", "negative"),
                  ("facts", "Při fyziologickém pH nese záporný náboj (aspartát).")],
    },
    SeedMolecule {
        slug: "cys", name: "Cystein", smiles: "C([C@@H](C(=O)O)N)S",
        projection: None,
        traits: &[("oneLetter", "C"), ("abbreviation", "Cys"), ("sideChain", "polar"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"), ("sulfur", "true"),
                  ("facts", "Sulfhydrylové skupiny (–SH) dvou cysteinů tvoří disulfidový můstek (–S–S–).\nJako jediná chirální AMK má konfiguraci R — kvůli prioritě síry.")],
    },
    SeedMolecule {
        slug: "gln", name: "Glutamin", smiles: "C(CC(=O)N)[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "Q"), ("abbreviation", "Gln"), ("sideChain", "polar"),
                  ("polarity", "hydrophilic"), ("charge", "neutral"),
                  ("facts", "Amid kyseliny glutamové; hlavní transportní forma dusíku v krvi.")],
    },
    SeedMolecule {
        slug: "glu", name: "Kyselina glutamová", smiles: "C(CC(=O)O)[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "E"), ("abbreviation", "Glu"), ("sideChain", "acidic"),
                  ("polarity", "hydrophilic"), ("charge", "negative"),
                  ("facts", "Při fyziologickém pH nese záporný náboj (glutamát).\nDůležitý excitační neurotransmiter.")],
    },
    SeedMolecule {
        slug: "gly", name: "Glycin", smiles: "NCC(=O)O",
        projection: None,
        traits: &[("oneLetter", "G"), ("abbreviation", "Gly"), ("sideChain", "nonpolar"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"),
                  ("facts", "Jediná achirální proteinogenní aminokyselina — postranní řetězec je pouze H.")],
    },
    SeedMolecule {
        slug: "his", name: "Histidin", smiles: "C1=C(NC=N1)C[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "H"), ("abbreviation", "His"), ("sideChain", "basic"),
                  ("polarity", "hydrophilic"), ("charge", "neutral"),
                  ("facts", "Imidazol má pKa ≈ 6,0 — při fyziologickém pH je částečně nabitý.\nProto je častý v aktivních centrech enzymů.")],
    },
    SeedMolecule {
        slug: "ile", name: "Isoleucin", smiles: "CC[C@H](C)[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "I"), ("abbreviation", "Ile"), ("sideChain", "nonpolar"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Rozvětvený řetězec (BCAA); má dvě chirální centra.")],
    },
    SeedMolecule {
        slug: "leu", name: "Leucin", smiles: "CC(C)C[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "L"), ("abbreviation", "Leu"), ("sideChain", "nonpolar"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Rozvětvený řetězec (BCAA); častý v leucinových ziprech.")],
    },
    SeedMolecule {
        slug: "lys", name: "Lysin", smiles: "C(CCN)C[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "K"), ("abbreviation", "Lys"), ("sideChain", "basic"),
                  ("polarity", "hydrophilic"), ("charge", "positive"), ("essential", "true"),
                  ("facts", "Dlouhý řetězec zakončený primárním aminem — při fyziologickém pH kladně nabitý.")],
    },
    SeedMolecule {
        slug: "met", name: "Methionin", smiles: "CSCC[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "M"), ("abbreviation", "Met"), ("sideChain", "nonpolar"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"), ("essential", "true"), ("sulfur", "true"),
                  ("facts", "Startovací aminokyselina translace (kodon AUG).\nObsahuje síru (thioether).")],
    },
    SeedMolecule {
        slug: "phe", name: "Fenylalanin", smiles: "C1=CC=C(C=C1)C[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "F"), ("abbreviation", "Phe"), ("sideChain", "aromatic"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Benzolový kruh; vysoce hydrofobní.")],
    },
    SeedMolecule {
        slug: "pro", name: "Prolin", smiles: "C1C[C@H](NC1)C(=O)O",
        projection: None,
        traits: &[("oneLetter", "P"), ("abbreviation", "Pro"), ("sideChain", "nonpolar"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"),
                  ("facts", "Iminokyselina — dusík je součástí pyrrolidinového kruhu.\nZalamuje α-helixy (helix-breaker).")],
    },
    SeedMolecule {
        slug: "ser", name: "Serin", smiles: "C([C@@H](C(=O)O)N)O",
        projection: None,
        traits: &[("oneLetter", "S"), ("abbreviation", "Ser"), ("sideChain", "polar"),
                  ("polarity", "hydrophilic"), ("charge", "neutral"),
                  ("facts", "Hydroxyskupina je častým místem fosforylace.")],
    },
    SeedMolecule {
        slug: "thr", name: "Threonin", smiles: "C[C@H]([C@@H](C(=O)O)N)O",
        projection: None,
        traits: &[("oneLetter", "T"), ("abbreviation", "Thr"), ("sideChain", "polar"),
                  ("polarity", "hydrophilic"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Hydroxyskupina je častým místem fosforylace; má dvě chirální centra.")],
    },
    SeedMolecule {
        slug: "trp", name: "Tryptofan", smiles: "C1=CC=C2C(=C1)C(=CN2)C[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "W"), ("abbreviation", "Trp"), ("sideChain", "aromatic"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"), ("essential", "true"),
                  ("facts", "Největší standardní aminokyselina; indolový kruh.\nPředstupeň serotoninu a melatoninu.")],
    },
    SeedMolecule {
        slug: "tyr", name: "Tyrosin", smiles: "C1=CC(=CC=C1C[C@@H](C(=O)O)N)O",
        projection: None,
        traits: &[("oneLetter", "Y"), ("abbreviation", "Tyr"), ("sideChain", "aromatic"),
                  ("polarity", "hydrophilic"), ("charge", "neutral"),
                  ("facts", "Fenolová –OH; místo fosforylace.\nPředstupeň dopaminu a adrenalínu.")],
    },
    SeedMolecule {
        slug: "val", name: "Valin", smiles: "CC(C)[C@@H](C(=O)O)N",
        projection: None,
        traits: &[("oneLetter", "V"), ("abbreviation", "Val"), ("sideChain", "nonpolar"),
                  ("polarity", "hydrophobic"), ("charge", "neutral"), ("essential", "true"),
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
        projection: None,
        traits: &[("abbreviation", "A"), ("ringSystem", "purine"), ("pairsWith", "thy,ura"), ("inDna", "true"), ("inRna", "true"),
                  ("facts", "Páruje se s thyminem (v DNA) nebo uracilem (v RNA) — dvě vodíkové vazby.\nSoučást ATP — hlavního energetického intermediátu buňky.")],
    },
    SeedMolecule {
        slug: "cyt", name: "Cytosin", smiles: "C1=C(NC(=O)N=C1)N",
        projection: None,
        traits: &[("abbreviation", "C"), ("ringSystem", "pyrimidine"), ("pairsWith", "gua"), ("inDna", "true"), ("inRna", "true"),
                  ("facts", "Páruje se s guaninem — tři vodíkové vazby.\nDeaminací vzniká uracil — častý zdroj bodových mutací.")],
    },
    SeedMolecule {
        slug: "gua", name: "Guanin", smiles: "C1=NC2=C(N1)C(=O)N=C(N2)N",
        projection: None,
        traits: &[("abbreviation", "G"), ("ringSystem", "purine"), ("pairsWith", "cyt"), ("inDna", "true"), ("inRna", "true"),
                  ("facts", "Páruje se s cytosinem — tři vodíkové vazby (vazba G–C je pevnější než A–T).\nNejnáchylnější báze k oxidaci — vzniká 8-oxoguanin.")],
    },
    SeedMolecule {
        slug: "thy", name: "Thymin", smiles: "CC1=CNC(=O)NC1=O",
        projection: None,
        traits: &[("abbreviation", "T"), ("ringSystem", "pyrimidine"), ("pairsWith", "ade"), ("inDna", "true"),
                  ("facts", "Vyskytuje se pouze v DNA — v RNA jej nahrazuje uracil.\nUV záření vytváří thyminové dimery (poškození DNA).")],
    },
    SeedMolecule {
        slug: "ura", name: "Uracil", smiles: "C1=CNC(=O)NC1=O",
        projection: None,
        traits: &[("abbreviation", "U"), ("ringSystem", "pyrimidine"), ("pairsWith", "ade"), ("inRna", "true"),
                  ("facts", "Vyskytuje se pouze v RNA.\nVzniká deaminací cytosinu.")],
    },
];

/// Nine saccharides and nucleotides. SMILES are connectivity-correct
/// non-isomeric skeletons — the Haworth projection spec carries the
/// stereochemistry (ring form, anomer, substituent sides); keep it that way.
/// Traits: `ringForm`, `anomer`, `deoxy` (present = true).
#[rustfmt::skip]
const SACCHARIDES: &[SeedMolecule] = &[
    SeedMolecule {
        slug: "glukoza-a", name: "α-D-glukóza", smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O)O)O)O)O",
        projection: None,
        traits: &[("ringForm", "pyranose"), ("anomer", "alpha")],
    },
    SeedMolecule {
        slug: "glukoza-b", name: "β-D-glukóza", smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O",
        projection: None,
        traits: &[("ringForm", "pyranose"), ("anomer", "beta")],
    },
    SeedMolecule {
        slug: "galaktoza-b", name: "β-D-galaktóza", smiles: "C([C@@H]1[C@@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O",
        projection: None,
        traits: &[("ringForm", "pyranose"), ("anomer", "beta")],
    },
    SeedMolecule {
        slug: "manoza-a", name: "α-D-manóza", smiles: "C([C@@H]1[C@H]([C@@H]([C@@H]([C@H](O1)O)O)O)O)O",
        projection: None,
        traits: &[("ringForm", "pyranose"), ("anomer", "alpha")],
    },
    SeedMolecule {
        slug: "fruktoza-b", name: "β-D-fruktóza", smiles: "OC[C@]1(O)[C@@H](O)[C@@H](O)[C@@H](CO)O1",
        projection: None,
        traits: &[("ringForm", "furanose"), ("anomer", "beta")],
    },
    SeedMolecule {
        slug: "riboza-b", name: "β-D-ribóza", smiles: "OC[C@H]1O[C@@H](O)[C@H](O)[C@@H]1O",
        projection: None,
        traits: &[("ringForm", "furanose"), ("anomer", "beta")],
    },
    SeedMolecule {
        slug: "deoxyriboza-b", name: "2-deoxy-β-D-ribóza", smiles: "OC[C@H]1O[C@@H](O)C[C@@H]1O",
        projection: None,
        traits: &[("ringForm", "furanose"), ("anomer", "beta"), ("deoxy", "true")],
    },
    // Nucleotides carry a full isomeric SMILES (Kekulé base so the drawing
    // shows alternating double bonds) and NO projection spec — the
    // client-side sugar-ring recognizer finds the ribofuranose ring inside
    // the complete structure and lays it out as Haworth, the library renders
    // the base and phosphate. See `src/lib/molecules/render/recognize.ts`.
    SeedMolecule {
        slug: "adenosin", name: "adenosin", smiles: "NC1=NC=NC2=C1N=CN2[C@@H]3O[C@H](CO)[C@@H](O)[C@H]3O",
        projection: None,
        traits: &[("ringForm", "furanose"), ("anomer", "beta")],
    },
    SeedMolecule {
        slug: "amp", name: "adenosinmonofosfát (AMP)", smiles: "NC1=NC=NC2=C1N=CN2[C@@H]3O[C@H](COP(=O)(O)O)[C@@H](O)[C@H]3O",
        projection: None,
        traits: &[("ringForm", "furanose"), ("anomer", "beta")],
    },
];

/// Insert the built-in topics, categories, and molecules. No-op when any
/// category row already exists — migration v47 runs once per database and
/// callers must not resurrect data a teacher deleted, so emptiness is the only
/// safe gate.
pub fn seed_builtins_if_empty(conn: &Connection) -> Result<(), rusqlite::Error> {
    let already_seeded: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM biomolecule_categories LIMIT 1)",
        [],
        |row| row.get(0),
    )?;
    if already_seeded {
        return Ok(());
    }

    // v47 calls this before the topics table and `topic_slug` column exist;
    // v51 adds both right afterwards. Detect the shape so the same function
    // stays correct on fresh and already-migrated databases alike.
    let has_topics: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master
                        WHERE type = 'table' AND name = 'biomolecule_topics')",
        [],
        |row| row.get(0),
    )?;
    let has_topic_slug: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM pragma_table_info('biomolecule_categories')
                        WHERE name = 'topic_slug')",
        [],
        |row| row.get(0),
    )?;

    let tx = conn.unchecked_transaction()?;
    let now = chrono::Utc::now().to_rfc3339();

    if has_topics {
        for (position, topic) in SEED_TOPICS.iter().enumerate() {
            tx.execute(
                "INSERT OR IGNORE INTO biomolecule_topics
                     (slug, name, description, position, built_in, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
                params![topic.slug, topic.name, topic.description, position as i64, now],
            )?;
        }
    }

    for (position, (category, molecules)) in [
        (&AMINO_ACIDS_CATEGORY, AMINO_ACIDS),
        (&NITROGEN_BASES_CATEGORY, NITROGEN_BASES),
        (&SACCHARIDES_CATEGORY, SACCHARIDES),
        (&SPECIAL_AMINO_ACIDS_CATEGORY, SPECIAL_AMINO_ACIDS),
    ]
    .into_iter()
    .enumerate()
    {
        if has_topic_slug {
            tx.execute(
                "INSERT INTO biomolecule_categories
                     (slug, name, description, topic_slug, position, built_in, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
                params![
                    category.slug,
                    category.name,
                    category.description,
                    category.topic_slug,
                    position as i64,
                    now
                ],
            )?;
        } else {
            tx.execute(
                "INSERT INTO biomolecule_categories
                     (slug, name, description, position, built_in, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
                params![category.slug, category.name, category.description, position as i64, now],
            )?;
        }
        for (molecule_position, molecule) in molecules.iter().enumerate() {
            let molecule_id = Uuid::new_v4();
            tx.execute(
                "INSERT INTO biomolecules
                     (id, category_slug, slug, name, smiles, projection, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                params![
                    molecule_id,
                    category.slug,
                    molecule.slug,
                    molecule.name,
                    molecule.smiles,
                    molecule.projection,
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
