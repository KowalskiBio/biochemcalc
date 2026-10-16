//! Biomolekuly: the teacher-managed molecule library (categories, molecules,
//! traits — migration v47) plus the section's quiz leaderboard.
//!
//! Everything lives in SQLite, following the calculations side where all
//! question data is database-backed. Reads are open to any logged-in account
//! (the frontend caches the whole library per session); every mutation is
//! teacher-only (the HTTP layer gates it) and returns the full fresh dataset
//! so the client's copy stays in sync. The quiz is still graded client-side,
//! so recorded scores are only sanity-checked — and the category must exist.

use crate::db::repos::biomolecule_repo::{BiomoleculeData, CategoryField};
use crate::db::repos::{BiomoleculeLeaderboardRow, BiomoleculeQuizRepo, BiomoleculeRepo};
use crate::db::DbError;
use rusqlite::Connection;
use serde::Deserialize;
use std::collections::HashMap;
use uuid::Uuid;

const MAX_CATEGORY_NAME_CHARS: usize = 80;
const MAX_DESCRIPTION_CHARS: usize = 300;
const MAX_MOLECULE_NAME_CHARS: usize = 80;
const MAX_SMILES_CHARS: usize = 300;
const MAX_ABBREVIATION_CHARS: usize = 12;
const MAX_FACTS_CHARS: usize = 1000;

/// Generous upper bound on one quiz's length — the "all molecules" option of
/// the biggest category is well under this. Stops a hand-crafted request
/// from claiming a thousand correct answers in one go.
const MAX_QUIZ_QUESTIONS: i64 = 100;

/// The validated trait vocabulary (values stored as text in
/// `biomolecule_traits`; adding a kind needs no schema change).
pub mod traits {
    use crate::db::DbError;
    use std::collections::HashMap;

    pub const ABBREVIATION: &str = "abbreviation";
    pub const ONE_LETTER: &str = "oneLetter";
    pub const CHARGE: &str = "charge";
    pub const POLARITY: &str = "polarity";
    pub const SIDE_CHAIN: &str = "sideChain";
    pub const ESSENTIAL: &str = "essential";
    pub const SULFUR: &str = "sulfur";
    pub const RING_SYSTEM: &str = "ringSystem";
    pub const PAIRS_WITH: &str = "pairsWith";
    pub const IN_DNA: &str = "inDna";
    pub const IN_RNA: &str = "inRna";
    pub const FACTS: &str = "facts";

    /// Traits whose value must be unique within a category — letter-based
    /// quiz options would otherwise be ambiguous.
    const UNIQUE_PER_CATEGORY: &[&str] = &[ABBREVIATION, ONE_LETTER];

    const CHARGE_VALUES: &[&str] = &["positive", "neutral", "negative"];
    const POLARITY_VALUES: &[&str] = &["hydrophobic", "hydrophilic"];
    const SIDE_CHAIN_VALUES: &[&str] = &["nonpolar", "polar", "aromatic", "acidic", "basic"];
    const RING_SYSTEM_VALUES: &[&str] = &["purine", "pyrimidine"];
    const FLAG_VALUES: &[&str] = &[ESSENTIAL, SULFUR, IN_DNA, IN_RNA];

    pub fn is_unique_per_category(key: &str) -> bool {
        UNIQUE_PER_CATEGORY.contains(&key)
    }

    fn is_valid_molecule_slug_ref(value: &str) -> bool {
        !value.is_empty()
            && value.len() <= 32
            && value
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    }

    fn validate(key: &str, value: &str) -> Result<String, DbError> {
        let trimmed = value.trim();
        match key {
            k if k == ABBREVIATION => {
                if trimmed.is_empty() || trimmed.chars().count() > super::MAX_ABBREVIATION_CHARS {
                    return Err(DbError::Validation(format!(
                        "Abbreviation must be 1-{} characters",
                        super::MAX_ABBREVIATION_CHARS
                    )));
                }
                Ok(trimmed.to_string())
            }
            k if k == ONE_LETTER => {
                if trimmed.chars().count() != 1 || !trimmed.chars().all(|c| c.is_alphabetic()) {
                    return Err(DbError::Validation(
                        "One-letter code must be a single letter".into(),
                    ));
                }
                Ok(trimmed.to_string())
            }
            k if k == CHARGE => validate_enum(key, trimmed, CHARGE_VALUES),
            k if k == POLARITY => validate_enum(key, trimmed, POLARITY_VALUES),
            k if k == SIDE_CHAIN => validate_enum(key, trimmed, SIDE_CHAIN_VALUES),
            k if k == RING_SYSTEM => validate_enum(key, trimmed, RING_SYSTEM_VALUES),
            k if FLAG_VALUES.contains(&k) => {
                if trimmed != "true" {
                    return Err(DbError::Validation(format!(
                        "Trait {key} is a flag and only accepts \"true\""
                    )));
                }
                Ok(trimmed.to_string())
            }
            k if k == PAIRS_WITH => {
                let parts: Vec<&str> = trimmed
                    .split(',')
                    .map(str::trim)
                    .filter(|part| !part.is_empty())
                    .collect();
                if parts.is_empty()
                    || parts.len() > 8
                    || !parts.iter().all(|part| is_valid_molecule_slug_ref(part))
                {
                    return Err(DbError::Validation(
                        "Pairs-with must be 1-8 comma-separated molecule slugs".into(),
                    ));
                }
                Ok(parts.join(","))
            }
            k if k == FACTS => {
                if trimmed.is_empty() || trimmed.chars().count() > super::MAX_FACTS_CHARS {
                    return Err(DbError::Validation(format!(
                        "Facts must be 1-{} characters",
                        super::MAX_FACTS_CHARS
                    )));
                }
                Ok(trimmed.to_string())
            }
            _ => Err(DbError::Validation(format!("Unknown trait: {key}"))),
        }
    }

    fn validate_enum(key: &str, value: &str, allowed: &[&str]) -> Result<String, DbError> {
        if allowed.contains(&value) {
            Ok(value.to_string())
        } else {
            Err(DbError::Validation(format!(
                "Invalid {key} value: {value}"
            )))
        }
    }

    /// The form submits the full trait map; blank entries are dropped, the
    /// rest is validated (order stable for storage diffs).
    pub fn normalize(input: &HashMap<String, String>) -> Result<Vec<(String, String)>, DbError> {
        let mut normalized = Vec::new();
        for (key, raw) in input {
            let key = key.trim();
            if key.is_empty() || raw.trim().is_empty() {
                continue;
            }
            normalized.push((key.to_string(), validate(key, raw)?));
        }
        normalized.sort_by(|a, b| a.0.cmp(&b.0));
        normalized.dedup_by(|a, b| a.0 == b.0);
        Ok(normalized)
    }
}

/// Category / molecule slugs are route segments ("dusikate-baze", "ala") —
/// anything else can't be a real slug, so reject it rather than store junk.
fn is_valid_slug(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// ASCII slug from a Czech name ("Dusíkaté báze" → "dusikate-baze").
fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = true; // trims leading separators
    for ch in name.trim().chars().flat_map(char::to_lowercase) {
        let replacement: &str = match ch {
            'á' | 'ä' | 'â' | 'à' => "a",
            'č' => "c",
            'ď' => "d",
            'é' | 'ě' | 'ë' | 'è' => "e",
            'í' | 'ï' | 'ì' => "i",
            'ĺ' | 'ľ' => "l",
            'ň' | 'ń' => "n",
            'ó' | 'ö' | 'ô' | 'ò' => "o",
            'ř' | 'ŕ' => "r",
            'š' | 'ś' => "s",
            'ť' => "t",
            'ú' | 'ů' | 'ü' | 'ù' => "u",
            'ý' | 'ÿ' => "y",
            'ž' | 'ź' => "z",
            c if c.is_ascii_alphanumeric() => {
                slug.push(c);
                last_was_dash = false;
                ""
            }
            _ => "-",
        };
        if !replacement.is_empty() {
            if replacement == "-" {
                if !last_was_dash {
                    slug.push('-');
                    last_was_dash = true;
                }
            } else {
                slug.push_str(replacement);
                last_was_dash = false;
            }
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    slug
}

/// Unique-ify `base` (falling back to `fallback`) against `taken` by
/// appending -2, -3, …
fn unique_slug(
    base: &str,
    fallback: &str,
    taken: impl Fn(&str) -> Result<bool, DbError>,
) -> Result<String, DbError> {
    let base = {
        let slug = slugify(base);
        if slug.is_empty() {
            fallback.to_string()
        } else {
            slug
        }
    };
    if !taken(&base)? {
        return Ok(base);
    }
    for suffix in 2.. {
        let candidate = format!("{base}-{suffix}");
        if !taken(&candidate)? {
            return Ok(candidate);
        }
    }
    unreachable!()
}

fn validate_category_name(name: &str) -> Result<&str, DbError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_CATEGORY_NAME_CHARS {
        return Err(DbError::Validation(format!(
            "Category name must be 1-{MAX_CATEGORY_NAME_CHARS} characters"
        )));
    }
    Ok(trimmed)
}

fn validate_description(description: Option<&str>) -> Result<Option<String>, DbError> {
    match description.map(str::trim) {
        None | Some("") => Ok(None),
        Some(v) if v.chars().count() > MAX_DESCRIPTION_CHARS => Err(DbError::Validation(
            format!("Description must be at most {MAX_DESCRIPTION_CHARS} characters"),
        )),
        Some(v) => Ok(Some(v.to_string())),
    }
}

fn validate_molecule_name(name: &str) -> Result<&str, DbError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_MOLECULE_NAME_CHARS {
        return Err(DbError::Validation(format!(
            "Molecule name must be 1-{MAX_MOLECULE_NAME_CHARS} characters"
        )));
    }
    Ok(trimmed)
}

/// SMILES is the molecule's whole depiction — non-empty printable ASCII. A
/// real parse happens client-side (smiles-drawer preview) before submit; the
/// server has no chemistry parser, so it only keeps the charset sane.
fn validate_smiles(smiles: &str) -> Result<&str, DbError> {
    let trimmed = smiles.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > MAX_SMILES_CHARS
        || !trimmed.chars().all(|c| ('!'..='~').contains(&c))
    {
        return Err(DbError::Validation(format!(
            "SMILES must be 1-{MAX_SMILES_CHARS} printable ASCII characters"
        )));
    }
    Ok(trimmed)
}

pub fn do_list_data(conn: &Connection) -> Result<BiomoleculeData, DbError> {
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCategoryPayload {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// Teacher-only (the HTTP layer gates it). The slug is derived from the
/// name server-side; all mutations return the full dataset so the client
/// can replace its copy in one go.
pub fn do_create_category(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: CreateCategoryPayload,
) -> Result<BiomoleculeData, DbError> {
    let name = validate_category_name(&payload.name)?;
    let description = validate_description(payload.description.as_deref())?;
    let slug = unique_slug(name, "kategorie", |slug| {
        BiomoleculeRepo::category_exists(conn, slug)
    })?;
    let position = BiomoleculeRepo::next_category_position(conn)?;
    BiomoleculeRepo::insert_category(conn, &slug, name, description.as_deref(), position, teacher_id)?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCategoryMetaPayload {
    pub category_id: String,
    pub field: CategoryField,
    /// `None`/blank clears a description; a name must stay non-empty.
    #[serde(default)]
    pub value: Option<String>,
}

pub fn do_update_category_meta(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: UpdateCategoryMetaPayload,
) -> Result<BiomoleculeData, DbError> {
    let category_id = payload.category_id.trim();
    if !is_valid_slug(category_id) || !BiomoleculeRepo::category_exists(conn, category_id)? {
        return Err(DbError::NotFound(format!("Category {category_id} not found")));
    }
    let value: Option<String> = match payload.field {
        CategoryField::Name => {
            Some(validate_category_name(payload.value.as_deref().unwrap_or(""))?.to_string())
        }
        CategoryField::Description => validate_description(payload.value.as_deref())?,
    };
    BiomoleculeRepo::update_category_field(conn, category_id, payload.field, value.as_deref(), teacher_id)?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCategoryPayload {
    pub category_id: String,
}

/// Deletes the category with its molecules and traits (FK cascade). Past
/// quiz results keep their slug — the leaderboard rows survive the deletion.
pub fn do_delete_category(
    conn: &Connection,
    payload: DeleteCategoryPayload,
) -> Result<BiomoleculeData, DbError> {
    let category_id = payload.category_id.trim();
    if !is_valid_slug(category_id) || !BiomoleculeRepo::category_exists(conn, category_id)? {
        return Err(DbError::NotFound(format!("Category {category_id} not found")));
    }
    BiomoleculeRepo::delete_category(conn, category_id)?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMoleculePayload {
    pub category_id: String,
    pub name: String,
    pub smiles: String,
    #[serde(default)]
    pub traits: HashMap<String, String>,
}

fn validate_molecule_input(
    conn: &Connection,
    category_id: &str,
    name: &str,
    smiles: &str,
    raw_traits: &HashMap<String, String>,
    exclude_id: Option<Uuid>,
) -> Result<(String, String, Vec<(String, String)>), DbError> {
    if !is_valid_slug(category_id) || !BiomoleculeRepo::category_exists(conn, category_id)? {
        return Err(DbError::NotFound(format!("Category {category_id} not found")));
    }
    let name = validate_molecule_name(name)?;
    let smiles = validate_smiles(smiles)?;
    let traits = traits::normalize(raw_traits)?;
    if BiomoleculeRepo::molecule_name_taken(conn, category_id, name, exclude_id)? {
        return Err(DbError::Validation(format!(
            "A molecule named {name} already exists in this category"
        )));
    }
    for (key, value) in &traits {
        if traits::is_unique_per_category(key)
            && BiomoleculeRepo::trait_value_taken(conn, category_id, key, value, exclude_id)?
        {
            return Err(DbError::Validation(format!(
                "Another molecule in this category already uses {key} {value}"
            )));
        }
    }
    Ok((name.to_string(), smiles.to_string(), traits))
}

pub fn do_create_molecule(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: CreateMoleculePayload,
) -> Result<BiomoleculeData, DbError> {
    let category_id = payload.category_id.trim().to_string();
    let (name, smiles, traits) = validate_molecule_input(
        conn,
        &category_id,
        &payload.name,
        &payload.smiles,
        &payload.traits,
        None,
    )?;
    let slug = unique_slug(&name, "molekula", |slug| {
        BiomoleculeRepo::molecule_slug_taken(conn, &category_id, slug, None)
    })?;
    let position = BiomoleculeRepo::next_molecule_position(conn, &category_id)?;
    BiomoleculeRepo::insert_molecule(
        conn,
        &category_id,
        &slug,
        &name,
        &smiles,
        position,
        &traits,
        teacher_id,
    )?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMoleculePayload {
    pub molecule_id: Uuid,
    pub name: String,
    pub smiles: String,
    #[serde(default)]
    pub traits: HashMap<String, String>,
}

pub fn do_update_molecule(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: UpdateMoleculePayload,
) -> Result<BiomoleculeData, DbError> {
    let category_slug = BiomoleculeRepo::molecule_category(conn, &payload.molecule_id)?
        .ok_or_else(|| DbError::NotFound(format!("Molecule {} not found", payload.molecule_id)))?;
    let (name, smiles, traits) = validate_molecule_input(
        conn,
        &category_slug,
        &payload.name,
        &payload.smiles,
        &payload.traits,
        Some(payload.molecule_id),
    )?;
    BiomoleculeRepo::update_molecule(
        conn,
        &payload.molecule_id,
        &name,
        &smiles,
        &traits,
        teacher_id,
    )?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteMoleculePayload {
    pub molecule_id: Uuid,
}

pub fn do_delete_molecule(
    conn: &Connection,
    payload: DeleteMoleculePayload,
) -> Result<BiomoleculeData, DbError> {
    BiomoleculeRepo::delete_molecule(conn, &payload.molecule_id)?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordQuizResultPayload {
    pub category_id: String,
    pub correct_count: i64,
    pub total_count: i64,
    /// Quiz difficulty: `"easy"` or `"hard"`.
    pub mode: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuizLeaderboardPayload {
    /// Narrow the board to one category; omitted sums every category.
    pub category_id: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeLeaderboardEntry {
    pub user_id: String,
    pub username: String,
    pub correct_count: i64,
    pub answered_count: i64,
    pub quiz_count: i64,
    /// Weighted score: hard-mode correct answers count double.
    pub points: i64,
}

/// Store the score of one finished quiz for the acting user. The quiz is
/// graded client-side, so this can only sanity-check the numbers — and the
/// category must exist, or junk slugs would pollute the leaderboard.
pub fn do_record_quiz_result(
    conn: &Connection,
    user_id: &Uuid,
    payload: RecordQuizResultPayload,
) -> Result<(), DbError> {
    let category_id = payload.category_id.trim();
    if !is_valid_slug(category_id) || !BiomoleculeRepo::category_exists(conn, category_id)? {
        return Err(DbError::Validation(format!(
            "Invalid category: {category_id}"
        )));
    }
    if !(1..=MAX_QUIZ_QUESTIONS).contains(&payload.total_count)
        || !(0..=payload.total_count).contains(&payload.correct_count)
    {
        return Err(DbError::Validation("Invalid quiz score".into()));
    }
    let mode = payload.mode.trim();
    if mode != "easy" && mode != "hard" {
        return Err(DbError::Validation(format!("Invalid mode: {mode}")));
    }
    BiomoleculeQuizRepo::insert(
        conn,
        user_id,
        category_id,
        payload.correct_count,
        payload.total_count,
        mode,
    )
}

pub fn do_quiz_leaderboard(
    conn: &Connection,
    payload: &QuizLeaderboardPayload,
) -> Result<Vec<BiomoleculeLeaderboardEntry>, DbError> {
    let category_id = payload
        .category_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    Ok(BiomoleculeQuizRepo::leaderboard(conn, category_id)?
        .into_iter()
        .map(
            |row: BiomoleculeLeaderboardRow| BiomoleculeLeaderboardEntry {
                user_id: row.user_id.to_string(),
                username: row.username,
                correct_count: row.correct_count,
                answered_count: row.answered_count,
                quiz_count: row.quiz_count,
                points: row.points,
            },
        )
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::BiomoleculeRepo;
    use crate::models::{Role, SectionAccess};

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk on");
        conn
    }

    fn teacher_id(conn: &Connection) -> Uuid {
        crate::commands::auth::do_bootstrap_admin_if_empty(conn, "teacher", "teacherpassword1")
            .expect("bootstrap")
            .map(|u| u.id)
            .unwrap_or_else(|| {
                crate::db::repos::UserRepo::find_by_username(conn, "teacher")
                    .expect("find")
                    .expect("present")
                    .id
            })
    }

    fn insert_student(conn: &Connection, username: &str) -> Uuid {
        let user = crate::db::repos::UserRecord {
            id: Uuid::new_v4(),
            username: username.into(),
            password_hash: "h".into(),
            role: Role::Student,
            created_at: chrono::Utc::now(),
            protected: false,
            email: None,
            sections: SectionAccess::Both,
            preferred_section: None,
        };
        crate::db::repos::UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    fn molecule_payload(category: &str, name: &str, smiles: &str) -> CreateMoleculePayload {
        CreateMoleculePayload {
            category_id: category.into(),
            name: name.into(),
            smiles: smiles.into(),
            traits: HashMap::new(),
        }
    }

    #[test]
    fn seeded_categories_are_listed() {
        let conn = setup_conn();
        let data = do_list_data(&conn).expect("list");
        assert_eq!(data.categories.len(), 2);
        assert_eq!(data.categories[0].slug, "aminokyseliny");
        assert!(data.categories[0].built_in);
        assert_eq!(data.categories[0].molecule_count, 20);
        assert_eq!(data.categories[1].slug, "dusikate-baze");
        assert_eq!(data.categories[1].molecule_count, 5);
        let ala = data
            .molecules
            .iter()
            .find(|m| m.slug == "ala")
            .expect("alanine seeded");
        assert_eq!(ala.traits.get("oneLetter").map(String::as_str), Some("A"));
        assert_eq!(ala.traits.get("sideChain").map(String::as_str), Some("nonpolar"));
    }

    #[test]
    fn create_category_derives_a_unique_slug() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        let data = do_create_category(
            &conn,
            &teacher,
            CreateCategoryPayload {
                name: "  Vitamíny  ".into(),
                description: Some("  Mastné vitamíny  ".into()),
            },
        )
        .expect("create");
        let vitaminy = data
            .categories
            .iter()
            .find(|c| c.slug == "vitaminy")
            .expect("created");
        assert_eq!(vitaminy.name, "Vitamíny");
        assert_eq!(vitaminy.description.as_deref(), Some("Mastné vitamíny"));
        assert!(!vitaminy.built_in);

        // Same name again gets a suffixed slug instead of an error.
        let data = do_create_category(
            &conn,
            &teacher,
            CreateCategoryPayload {
                name: "Vitaminy".into(),
                description: None,
            },
        )
        .expect("create second");
        assert!(data.categories.iter().any(|c| c.slug == "vitaminy-2"));

        // And the slug never collides with the built-ins.
        let data = do_create_category(
            &conn,
            &teacher,
            CreateCategoryPayload {
                name: "Aminokyseliny".into(),
                description: None,
            },
        )
        .expect("create third");
        assert!(data.categories.iter().any(|c| c.slug == "aminokyseliny-2"));
    }

    #[test]
    fn create_category_rejects_bad_names() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        for bad in ["", "   ", &"a".repeat(MAX_CATEGORY_NAME_CHARS + 1)] {
            assert!(matches!(
                do_create_category(
                    &conn,
                    &teacher,
                    CreateCategoryPayload {
                        name: bad.into(),
                        description: None,
                    },
                ),
                Err(DbError::Validation(_))
            ));
        }
        assert!(matches!(
            do_create_category(
                &conn,
                &teacher,
                CreateCategoryPayload {
                    name: "Ok".into(),
                    description: Some("a".repeat(MAX_DESCRIPTION_CHARS + 1)),
                },
            ),
            Err(DbError::Validation(_))
        ));
    }

    #[test]
    fn update_and_delete_category() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);

        let data = do_update_category_meta(
            &conn,
            &teacher,
            UpdateCategoryMetaPayload {
                category_id: "dusikate-baze".into(),
                field: CategoryField::Name,
                value: Some("  Báze  ".into()),
            },
        )
        .expect("rename");
        assert_eq!(data.categories.iter().find(|c| c.slug == "dusikate-baze").unwrap().name, "Báze");

        // Blank name is not allowed anywhere.
        assert!(matches!(
            do_update_category_meta(
                &conn,
                &teacher,
                UpdateCategoryMetaPayload {
                    category_id: "dusikate-baze".into(),
                    field: CategoryField::Name,
                    value: Some("   ".into()),
                },
            ),
            Err(DbError::Validation(_))
        ));

        let data = do_update_category_meta(
            &conn,
            &teacher,
            UpdateCategoryMetaPayload {
                category_id: "dusikate-baze".into(),
                field: CategoryField::Description,
                value: Some("   ".into()),
            },
        )
        .expect("clear description");
        assert_eq!(
            data.categories
                .iter()
                .find(|c| c.slug == "dusikate-baze")
                .unwrap()
                .description,
            None
        );

        assert!(matches!(
            do_update_category_meta(
                &conn,
                &teacher,
                UpdateCategoryMetaPayload {
                    category_id: "../etc".into(),
                    field: CategoryField::Name,
                    value: Some("x".into()),
                },
            ),
            Err(DbError::NotFound(_))
        ));

        // Deleting a category cascades to its molecules and traits.
        let data = do_delete_category(
            &conn,
            DeleteCategoryPayload {
                category_id: "dusikate-baze".into(),
            },
        )
        .expect("delete");
        assert!(!data.categories.iter().any(|c| c.slug == "dusikate-baze"));
        assert!(!data.molecules.iter().any(|m| m.category_slug == "dusikate-baze"));
        assert!(matches!(
            do_delete_category(
                &conn,
                DeleteCategoryPayload {
                    category_id: "dusikate-baze".into(),
                },
            ),
            Err(DbError::NotFound(_))
        ));
    }

    #[test]
    fn molecule_crud_with_traits() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);

        let mut traits = HashMap::new();
        traits.insert("abbreviation".to_string(), "Wat".to_string());
        traits.insert("charge".to_string(), "neutral".to_string());
        traits.insert("facts".to_string(), "První..\nDruhá..".to_string());
        let data = do_create_molecule(
            &conn,
            &teacher,
            CreateMoleculePayload {
                category_id: "aminokyseliny".into(),
                name: "Watsonin".into(),
                smiles: "C[C@@H](C(=O)O)N".into(),
                traits,
            },
        )
        .expect("create");
        let created = data
            .molecules
            .iter()
            .find(|m| m.slug == "watsonin")
            .expect("created");
        assert_eq!(created.category_slug, "aminokyseliny");
        assert_eq!(
            created.traits.get("abbreviation").map(String::as_str),
            Some("Wat")
        );

        // Duplicate name and duplicate one-letter are both refused.
        assert!(matches!(
            do_create_molecule(&conn, &teacher, molecule_payload("aminokyseliny", "Watsonin", "CCO")),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            do_create_molecule(&conn, &teacher, molecule_payload("aminokyseliny", "alanin", "CCO")),
            Err(DbError::Validation(_))
        ));
        let mut letter = HashMap::new();
        letter.insert("oneLetter".to_string(), "A".to_string());
        assert!(matches!(
            do_create_molecule(
                &conn,
                &teacher,
                CreateMoleculePayload {
                    category_id: "aminokyseliny".into(),
                    name: "Testin".into(),
                    smiles: "CCO".into(),
                    traits: letter,
                },
            ),
            Err(DbError::Validation(_))
        ));

        // Update replaces the trait set wholesale.
        let mut new_traits = HashMap::new();
        new_traits.insert("polarity".to_string(), "hydrophobic".to_string());
        let data = do_update_molecule(
            &conn,
            &teacher,
            UpdateMoleculePayload {
                molecule_id: created.id,
                name: "Watsonin II".into(),
                smiles: "CCO".into(),
                traits: new_traits,
            },
        )
        .expect("update");
        let updated = data.molecules.iter().find(|m| m.id == created.id).unwrap();
        assert_eq!(updated.name, "Watsonin II");
        assert_eq!(updated.slug, "watsonin", "slug stays stable across renames");
        assert_eq!(updated.traits.len(), 1);
        assert_eq!(updated.traits.get("polarity").map(String::as_str), Some("hydrophobic"));

        let data = do_delete_molecule(
            &conn,
            DeleteMoleculePayload {
                molecule_id: created.id,
            },
        )
        .expect("delete");
        assert!(!data.molecules.iter().any(|m| m.id == created.id));
    }

    #[test]
    fn invalid_traits_and_smiles_are_rejected() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        let create = |trait_key: &str, value: &str| {
            let mut traits = HashMap::new();
            traits.insert(trait_key.to_string(), value.to_string());
            do_create_molecule(
                &conn,
                &teacher,
                CreateMoleculePayload {
                    category_id: "aminokyseliny".into(),
                    name: "Testin".into(),
                    smiles: "CCO".into(),
                    traits,
                },
            )
        };
        assert!(matches!(create("charge", "spicy"), Err(DbError::Validation(_))));
        assert!(matches!(create("essential", "1"), Err(DbError::Validation(_))));
        assert!(matches!(create("oneLetter", "AB"), Err(DbError::Validation(_))));
        assert!(matches!(create("pairsWith", "Not A Slug"), Err(DbError::Validation(_))));
        assert!(matches!(create("unknownTrait", "x"), Err(DbError::Validation(_))));
        // Seed data uses these — they must keep validating.
        assert!(create("pairsWith", "thy, ura").is_ok());

        // Blank or non-printable SMILES cannot pass the server-side check.
        assert!(matches!(
            do_create_molecule(&conn, &teacher, molecule_payload("aminokyseliny", "Testin2", "  ")),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            do_create_molecule(&conn, &teacher, molecule_payload("aminokyseliny", "Testin3", "C C")),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            do_create_molecule(
                &conn,
                &teacher,
                molecule_payload("neexistuje", "Testin4", "CCO"),
            ),
            Err(DbError::NotFound(_))
        ));
    }

    #[test]
    fn record_quiz_result_validates_category_and_score() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");
        let record = |category: &str, correct, total| {
            do_record_quiz_result(
                &conn,
                &student,
                RecordQuizResultPayload {
                    category_id: category.into(),
                    correct_count: correct,
                    total_count: total,
                    mode: "easy".into(),
                },
            )
        };
        for (correct, total) in [(0, 0), (6, 5), (-1, 5), (1, MAX_QUIZ_QUESTIONS + 1)] {
            assert!(matches!(
                record("aminokyseliny", correct, total),
                Err(DbError::Validation(_))
            ));
        }
        assert!(matches!(
            record("neexistuje", 5, 5),
            Err(DbError::Validation(_))
        ));
        record("aminokyseliny", 7, 10).expect("valid score");

        let board = do_quiz_leaderboard(&conn, &QuizLeaderboardPayload::default())
            .expect("leaderboard");
        assert_eq!(board.len(), 1);
        assert_eq!(board[0].correct_count, 7);
        assert_eq!(board[0].answered_count, 10);
    }

    #[test]
    fn seed_is_not_reapplied_after_a_teacher_deletes_built_ins() {
        let conn = setup_conn();
        crate::db::repos::BiomoleculeRepo::delete_category(&conn, "aminokyseliny")
            .expect("delete");
        crate::db::biomolecule_seed::seed_builtins_if_empty(&conn).expect("re-seed is a no-op");
        assert!(!BiomoleculeRepo::category_exists(&conn, "aminokyseliny").expect("exists"));
    }
}
