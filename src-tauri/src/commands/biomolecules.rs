//! Biomolekuly: the teacher-managed molecule library (categories, molecules,
//! traits — migration v47) plus the section's quiz leaderboard.
//!
//! Everything lives in SQLite, following the calculations side where all
//! question data is database-backed. Reads are open to any logged-in account
//! (the frontend caches the whole library per session); every mutation is
//! teacher-only (the HTTP layer gates it) and returns the full fresh dataset
//! so the client's copy stays in sync. The quiz is still graded client-side,
//! so recorded scores are only sanity-checked — and the recorded scope must
//! reference an existing category or topic (or the all-ungrouped sentinel).

use crate::db::repos::biomolecule_repo::{BiomoleculeData, CategoryField, TopicField};
use crate::db::repos::{
    BiomoleculeLeaderboardRow, BiomoleculeQuizRepo, BiomoleculeRepo,
    BiomoleculeStreakLeaderboardRow, BiomoleculeStreakRepo,
};
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
const MAX_ALIASES_CHARS: usize = 80;
const MAX_FACTS_CHARS: usize = 1000;

/// Generous upper bound on one quiz's length — the "all molecules" option of
/// the biggest category is well under this. Stops a hand-crafted request
/// from claiming a thousand correct answers in one go.
const MAX_QUIZ_QUESTIONS: i64 = 100;

/// Generous upper bound on one streak run's length: a client-graded run is
/// endless, so this only stops a hand-crafted request from reporting an
/// absurd streak.
const MAX_STREAK_CORRECT: i64 = 10_000;

/// Longest wall-clock time a single run may claim (one day), likewise only a
/// sanity bound on a client-reported number.
const MAX_STREAK_SECONDS: f64 = 86_400.0;

/// The streak-run variants (`models::StreakRunKind` on the calculations side);
/// kept as text here since the Biomolekuly streak lives entirely in the
/// frontend and is only validated on record.
const STREAK_KINDS: [&str; 2] = ["apprentice", "master"];

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
    pub const ANOMER: &str = "anomer";
    pub const RING_FORM: &str = "ringForm";
    pub const DEOXY: &str = "deoxy";
    pub const PAIRS_WITH: &str = "pairsWith";
    pub const IN_DNA: &str = "inDna";
    pub const IN_RNA: &str = "inRna";
    pub const FACTS: &str = "facts";
    pub const ALIASES: &str = "aliases";

    /// Traits whose value must be unique within a category — letter-based
    /// quiz options would otherwise be ambiguous.
    const UNIQUE_PER_CATEGORY: &[&str] = &[ABBREVIATION, ONE_LETTER];

    const CHARGE_VALUES: &[&str] = &["positive", "neutral", "negative"];
    const POLARITY_VALUES: &[&str] = &["hydrophobic", "hydrophilic"];
    const SIDE_CHAIN_VALUES: &[&str] = &["nonpolar", "polar", "aromatic", "acidic", "basic"];
    const RING_SYSTEM_VALUES: &[&str] = &["purine", "pyrimidine"];
    const ANOMER_VALUES: &[&str] = &["alpha", "beta"];
    const RING_FORM_VALUES: &[&str] = &["pyranose", "furanose"];
    const FLAG_VALUES: &[&str] = &[ESSENTIAL, SULFUR, DEOXY, IN_DNA, IN_RNA];

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

    pub(super) fn validate(key: &str, value: &str) -> Result<String, DbError> {
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
            k if k == ANOMER => validate_enum(key, trimmed, ANOMER_VALUES),
            k if k == RING_FORM => validate_enum(key, trimmed, RING_FORM_VALUES),
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
            k if k == ALIASES => {
                let aliases: Vec<&str> = trimmed
                    .split('\n')
                    .map(str::trim)
                    .filter(|alias| !alias.is_empty())
                    .collect();
                if aliases.is_empty()
                    || aliases.len() > 8
                    || !aliases
                        .iter()
                        .all(|alias| alias.chars().count() <= super::MAX_ALIASES_CHARS)
                {
                    return Err(DbError::Validation(format!(
                        "Aliases must be 1-8 newline-separated names, each 1-{} characters",
                        super::MAX_ALIASES_CHARS
                    )));
                }
                Ok(aliases.join("\n"))
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

/// Topics are navigation labels with the same bounds as category names.
fn validate_topic_name(name: &str) -> Result<&str, DbError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_CATEGORY_NAME_CHARS {
        return Err(DbError::Validation(format!(
            "Topic name must be 1-{MAX_CATEGORY_NAME_CHARS} characters"
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

/// Optional topic reference: blank/absent means "no topic". A non-blank value
/// must be an existing topic slug.
fn validate_optional_topic(
    conn: &Connection,
    topic_id: Option<&str>,
) -> Result<Option<String>, DbError> {
    let Some(topic_id) = topic_id.map(str::trim).filter(|id| !id.is_empty()) else {
        return Ok(None);
    };
    if !is_valid_slug(topic_id) || !BiomoleculeRepo::topic_exists(conn, topic_id)? {
        return Err(DbError::NotFound(format!("Topic {topic_id} not found")));
    }
    Ok(Some(topic_id.to_string()))
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

/// The optional Haworth projection is a raw JSON spec stored as text; the
/// frontend owns the full drawing vocabulary, so the server only checks that
/// it is a JSON object of the expected shape. `None` (or blank) clears it.
fn validate_projection(projection: Option<&str>) -> Result<Option<String>, DbError> {
    let Some(raw) = projection.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(None);
    };
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|_| DbError::Validation("Projection must be valid JSON".into()))?;
    let object = value
        .as_object()
        .ok_or_else(|| DbError::Validation("Projection must be a JSON object".into()))?;
    if object.get("type").and_then(|v| v.as_str()) != Some("haworth") {
        return Err(DbError::Validation(
            "Projection type must be \"haworth\"".into(),
        ));
    }
    if !matches!(
        object.get("ringSize").and_then(|v| v.as_i64()),
        Some(5 | 6)
    ) {
        return Err(DbError::Validation(
            "Projection ringSize must be 5 or 6".into(),
        ));
    }
    if !object.get("substituents").is_some_and(|v| v.is_array()) {
        return Err(DbError::Validation(
            "Projection substituents must be an array".into(),
        ));
    }
    Ok(Some(raw.to_string()))
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
    /// Optional topic to place the new category under.
    #[serde(default)]
    pub topic_id: Option<String>,
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
    let topic_slug = validate_optional_topic(conn, payload.topic_id.as_deref())?;
    let slug = unique_slug(name, "kategorie", |slug| {
        BiomoleculeRepo::category_exists(conn, slug)
    })?;
    let position = BiomoleculeRepo::next_category_position(conn)?;
    BiomoleculeRepo::insert_category(
        conn,
        &slug,
        name,
        description.as_deref(),
        topic_slug.as_deref(),
        position,
        teacher_id,
    )?;
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
        CategoryField::Topic => validate_optional_topic(conn, payload.value.as_deref())?,
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
pub struct CreateTopicPayload {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// Teacher-only. Slugs are derived server-side, exactly like categories.
pub fn do_create_topic(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: CreateTopicPayload,
) -> Result<BiomoleculeData, DbError> {
    let name = validate_topic_name(&payload.name)?;
    let description = validate_description(payload.description.as_deref())?;
    let slug = unique_slug(name, "tema", |slug| BiomoleculeRepo::topic_exists(conn, slug))?;
    let position = BiomoleculeRepo::next_topic_position(conn)?;
    BiomoleculeRepo::insert_topic(
        conn,
        &slug,
        name,
        description.as_deref(),
        position,
        teacher_id,
    )?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTopicMetaPayload {
    pub topic_id: String,
    pub field: TopicField,
    /// `None`/blank clears a description; a name must stay non-empty.
    #[serde(default)]
    pub value: Option<String>,
}

pub fn do_update_topic_meta(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: UpdateTopicMetaPayload,
) -> Result<BiomoleculeData, DbError> {
    let topic_id = payload.topic_id.trim();
    if !is_valid_slug(topic_id) || !BiomoleculeRepo::topic_exists(conn, topic_id)? {
        return Err(DbError::NotFound(format!("Topic {topic_id} not found")));
    }
    let value: Option<String> = match payload.field {
        TopicField::Name => {
            Some(validate_topic_name(payload.value.as_deref().unwrap_or(""))?.to_string())
        }
        TopicField::Description => validate_description(payload.value.as_deref())?,
    };
    BiomoleculeRepo::update_topic_field(
        conn,
        topic_id,
        payload.field,
        value.as_deref(),
        teacher_id,
    )?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTopicPayload {
    pub topic_id: String,
}

/// Deletes the grouping only — its categories survive and become topic-less
/// (`ON DELETE SET NULL`).
pub fn do_delete_topic(
    conn: &Connection,
    payload: DeleteTopicPayload,
) -> Result<BiomoleculeData, DbError> {
    let topic_id = payload.topic_id.trim();
    if !is_valid_slug(topic_id) || !BiomoleculeRepo::topic_exists(conn, topic_id)? {
        return Err(DbError::NotFound(format!("Topic {topic_id} not found")));
    }
    BiomoleculeRepo::delete_topic(conn, topic_id)?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMoleculePayload {
    pub category_id: String,
    pub name: String,
    pub smiles: String,
    /// Optional raw JSON Haworth spec (see `validate_projection`).
    #[serde(default)]
    pub projection: Option<String>,
    #[serde(default)]
    pub traits: HashMap<String, String>,
}

fn validate_molecule_input(
    conn: &Connection,
    category_id: &str,
    name: &str,
    smiles: &str,
    projection: Option<&str>,
    raw_traits: &HashMap<String, String>,
    exclude_id: Option<Uuid>,
) -> Result<(String, String, Option<String>, Vec<(String, String)>), DbError> {
    if !is_valid_slug(category_id) || !BiomoleculeRepo::category_exists(conn, category_id)? {
        return Err(DbError::NotFound(format!("Category {category_id} not found")));
    }
    let name = validate_molecule_name(name)?;
    let smiles = validate_smiles(smiles)?;
    let projection = validate_projection(projection)?;
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
    Ok((name.to_string(), smiles.to_string(), projection, traits))
}

pub fn do_create_molecule(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: CreateMoleculePayload,
) -> Result<BiomoleculeData, DbError> {
    let category_id = payload.category_id.trim().to_string();
    let (name, smiles, projection, traits) = validate_molecule_input(
        conn,
        &category_id,
        &payload.name,
        &payload.smiles,
        payload.projection.as_deref(),
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
        projection.as_deref(),
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
    /// Optional raw JSON Haworth spec; `None` clears it.
    #[serde(default)]
    pub projection: Option<String>,
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
    let (name, smiles, projection, traits) = validate_molecule_input(
        conn,
        &category_slug,
        &payload.name,
        &payload.smiles,
        payload.projection.as_deref(),
        &payload.traits,
        Some(payload.molecule_id),
    )?;
    BiomoleculeRepo::update_molecule(
        conn,
        &payload.molecule_id,
        &name,
        &smiles,
        projection.as_deref(),
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

/// Scope sentinel for a run over "all ungrouped/no-topic categories". Topic
/// runs and this sentinel share the overall leaderboard total with category
/// runs; the per-category board only matches the exact slug.
const ALL_UNGROUPED_SCOPE: &str = "*";

/// Store the score of one finished quiz for the acting user. The quiz is
/// graded client-side, so this can only sanity-check the numbers — and the
/// scope must be an existing category slug, an existing topic slug, or the
/// all-ungrouped sentinel, or junk slugs would pollute the leaderboard.
pub fn do_record_quiz_result(
    conn: &Connection,
    user_id: &Uuid,
    payload: RecordQuizResultPayload,
) -> Result<(), DbError> {
    let category_id = payload.category_id.trim();
    let scope_valid = if category_id == ALL_UNGROUPED_SCOPE {
        true
    } else {
        is_valid_slug(category_id)
            && (BiomoleculeRepo::category_exists(conn, category_id)?
                || BiomoleculeRepo::topic_exists(conn, category_id)?)
    };
    if !scope_valid {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStreakResultPayload {
    /// Run variant: `"apprentice"` or `"master"`.
    pub kind: String,
    pub correct_count: i64,
    pub total_seconds: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakLeaderboardPayload {
    /// The run variant to rank: `"apprentice"` or `"master"`.
    pub kind: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeStreakLeaderboardEntry {
    pub user_id: String,
    pub username: String,
    pub best_correct_count: i64,
    pub total_seconds: f64,
    /// `total_seconds / (best_correct_count + 1)` — the run ended on a wrong
    /// answer, which counts as an answered question.
    pub seconds_per_answer: f64,
}

/// Store the aggregate of one finished Biomolekuly streak run for the acting
/// user. The run is graded client-side, so this can only sanity-check the
/// numbers (`kind` must be a known variant, counts/times within their bounds).
pub fn do_record_streak_result(
    conn: &Connection,
    user_id: &Uuid,
    payload: RecordStreakResultPayload,
) -> Result<(), DbError> {
    let kind = validate_streak_kind(&payload.kind)?;
    if !(0..=MAX_STREAK_CORRECT).contains(&payload.correct_count) {
        return Err(DbError::Validation("Invalid streak score".into()));
    }
    if !(payload.total_seconds > 0.0 && payload.total_seconds <= MAX_STREAK_SECONDS) {
        return Err(DbError::Validation("Invalid streak time".into()));
    }
    BiomoleculeStreakRepo::insert(
        conn,
        user_id,
        kind,
        payload.correct_count,
        payload.total_seconds,
    )
}

pub fn do_streak_leaderboard(
    conn: &Connection,
    payload: &StreakLeaderboardPayload,
) -> Result<Vec<BiomoleculeStreakLeaderboardEntry>, DbError> {
    let kind = validate_streak_kind(&payload.kind)?;
    Ok(BiomoleculeStreakRepo::best_per_user(conn, kind)?
        .into_iter()
        .map(
            |row: BiomoleculeStreakLeaderboardRow| BiomoleculeStreakLeaderboardEntry {
                user_id: row.user_id.to_string(),
                username: row.username,
                best_correct_count: row.best_correct_count,
                total_seconds: row.total_seconds,
                // The failed answer counts as answered, mirroring the
                // calculations streak summary.
                seconds_per_answer: row.total_seconds / (row.best_correct_count + 1) as f64,
            },
        )
        .collect())
}

/// Trim and validate a streak-run variant, returning the canonical `&str`.
fn validate_streak_kind(kind: &str) -> Result<&str, DbError> {
    let kind = kind.trim();
    if STREAK_KINDS.contains(&kind) {
        Ok(kind)
    } else {
        Err(DbError::Validation(format!("Invalid streak kind: {kind}")))
    }
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
            projection: None,
            traits: HashMap::new(),
        }
    }

    #[test]
    fn seeded_categories_are_listed() {
        let conn = setup_conn();
        let data = do_list_data(&conn).expect("list");
        assert_eq!(data.categories.len(), 3);
        assert_eq!(data.categories[0].slug, "aminokyseliny");
        assert!(data.categories[0].built_in);
        assert_eq!(data.categories[0].molecule_count, 20);
        assert_eq!(data.categories[1].slug, "dusikate-baze");
        assert_eq!(data.categories[1].molecule_count, 5);
        assert_eq!(data.categories[2].slug, "sacharidy");
        assert!(data.categories[2].built_in);
        assert_eq!(data.categories[2].molecule_count, 9);
        let ala = data
            .molecules
            .iter()
            .find(|m| m.slug == "ala")
            .expect("alanine seeded");
        assert_eq!(ala.traits.get("oneLetter").map(String::as_str), Some("A"));
        assert_eq!(ala.traits.get("sideChain").map(String::as_str), Some("nonpolar"));
    }

    #[test]
    fn seeded_saccharides_are_fully_smiles_driven() {
        let conn = setup_conn();
        let data = do_list_data(&conn).expect("list");
        let saccharides: Vec<_> = data
            .molecules
            .iter()
            .filter(|m| m.category_slug == "sacharidy")
            .collect();
        assert_eq!(saccharides.len(), 9);

        // Every molecule in the category is drawn from its isomeric SMILES
        // alone by the client-side ring recognizer — no declarative
        // projection specs are stored anywhere.
        assert!(
            saccharides.iter().all(|m| m.projection.is_none()),
            "no sacharidy molecule should carry a projection spec"
        );
        for molecule in &saccharides {
            assert!(
                molecule.smiles.contains('@'),
                "{} must carry an isomeric SMILES so the recognizer can derive Haworth sides",
                molecule.slug
            );
        }

        let deoxy = saccharides
            .iter()
            .find(|m| m.slug == "deoxyriboza-b")
            .expect("deoxyribose seeded");
        assert_eq!(deoxy.traits.get("ringForm").map(String::as_str), Some("furanose"));
        assert_eq!(deoxy.traits.get("anomer").map(String::as_str), Some("beta"));
        assert_eq!(deoxy.traits.get("deoxy").map(String::as_str), Some("true"));
    }

    #[test]
    fn saccharide_traits_validate() {
        let normalize = |key: &str, value: &str| {
            let mut traits = HashMap::new();
            traits.insert(key.to_string(), value.to_string());
            traits::normalize(&traits)
        };
        for (key, value) in [
            ("anomer", "alpha"),
            ("anomer", "beta"),
            ("ringForm", "pyranose"),
            ("ringForm", "furanose"),
            ("deoxy", "true"),
        ] {
            normalize(key, value).unwrap_or_else(|e| panic!("{key}={value}: {e:?}"));
        }
        for (key, value) in [
            ("anomer", "gamma"),
            ("ringForm", "hexose"),
            ("deoxy", "false"),
            ("deoxy", "1"),
        ] {
            assert!(
                matches!(normalize(key, value), Err(DbError::Validation(_))),
                "{key}={value} must be rejected"
            );
        }
    }

    #[test]
    fn aliases_trait_normalizes_and_validates() {
        use traits::{validate, ALIASES};

        // Valid multi-line value: each line is trimmed and blank lines dropped.
        let mut input = HashMap::new();
        input.insert(ALIASES.to_string(), "  alfa  \n\n beta \n".to_string());
        assert_eq!(
            traits::normalize(&input).expect("valid aliases"),
            vec![(ALIASES.to_string(), "alfa\nbeta".to_string())]
        );

        // An empty value (after trimming) is rejected.
        assert!(matches!(
            validate(ALIASES, "  \n \n"),
            Err(DbError::Validation(_))
        ));

        // More than eight names is rejected.
        let too_many = (1..=9)
            .map(|n| format!("alias{n}"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(matches!(
            validate(ALIASES, &too_many),
            Err(DbError::Validation(_))
        ));

        // A single name longer than MAX_ALIASES_CHARS is rejected.
        let overlong = "a".repeat(MAX_ALIASES_CHARS + 1);
        assert!(matches!(
            validate(ALIASES, &overlong),
            Err(DbError::Validation(_))
        ));
    }

    #[test]
    fn molecule_projection_must_be_a_valid_haworth_spec() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        let create = |name: &str, projection: &str| {
            let mut payload = molecule_payload("sacharidy", name, "CCO");
            payload.projection = Some(projection.into());
            do_create_molecule(&conn, &teacher, payload)
        };

        for bad in [
            "not json",
            "{}",
            r#"{"type":"chair","ringSize":6,"substituents":[]}"#,
            r#"{"type":"haworth","ringSize":7,"substituents":[]}"#,
            r#"{"type":"haworth","ringSize":6,"substituents":{}}"#,
        ] {
            assert!(
                matches!(create("Testin", bad), Err(DbError::Validation(_))),
                "garbage projection must be rejected: {bad}"
            );
        }

        let good = r#"{"type":"haworth","ringSize":6,"anomericCarbon":1,"substituents":[],"showHydrogens":false}"#;
        let data = create("Testin", good).expect("valid projection");
        let created = data
            .molecules
            .iter()
            .find(|m| m.name == "Testin")
            .expect("created");
        assert_eq!(created.projection.as_deref(), Some(good));
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
                topic_id: None,
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
                topic_id: None,
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
                topic_id: None,
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
                        topic_id: None,
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
                    topic_id: None,
                },
            ),
            Err(DbError::Validation(_))
        ));
    }

    #[test]
    fn seeded_topics_group_the_builtin_categories() {
        let conn = setup_conn();
        let data = do_list_data(&conn).expect("list");

        assert_eq!(data.topics.len(), 3);
        assert_eq!(data.topics[0].slug, "aminokyseliny");
        assert_eq!(data.topics[0].name, "Aminokyseliny");
        assert!(data.topics[0].built_in);
        assert_eq!(data.topics[1].slug, "nukleove-kyseliny");
        assert_eq!(data.topics[2].slug, "sacharidy");

        let topic_of = |slug: &str| {
            data.categories
                .iter()
                .find(|c| c.slug == slug)
                .unwrap_or_else(|| panic!("category {slug} seeded"))
                .topic_slug
                .as_deref()
        };
        assert_eq!(topic_of("aminokyseliny"), Some("aminokyseliny"));
        assert_eq!(topic_of("dusikate-baze"), Some("nukleove-kyseliny"));
        assert_eq!(topic_of("sacharidy"), Some("sacharidy"));
    }

    #[test]
    fn create_update_and_delete_topic() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);

        let data = do_create_topic(
            &conn,
            &teacher,
            CreateTopicPayload {
                name: "  Vitamíny  ".into(),
                description: Some("  Mastné vitamíny  ".into()),
            },
        )
        .expect("create topic");
        let topic = data
            .topics
            .iter()
            .find(|t| t.slug == "vitaminy")
            .expect("created topic");
        assert_eq!(topic.name, "Vitamíny");
        assert_eq!(topic.description.as_deref(), Some("Mastné vitamíny"));
        assert!(!topic.built_in);

        // Duplicate names get a uniquified slug, mirroring categories.
        let data = do_create_topic(
            &conn,
            &teacher,
            CreateTopicPayload {
                name: "Vitaminy".into(),
                description: None,
            },
        )
        .expect("create duplicate");
        assert!(data.topics.iter().any(|t| t.slug == "vitaminy-2"));

        let data = do_update_topic_meta(
            &conn,
            &teacher,
            UpdateTopicMetaPayload {
                topic_id: "vitaminy".into(),
                field: TopicField::Name,
                value: Some("  Vitaminy II  ".into()),
            },
        )
        .expect("rename topic");
        assert_eq!(
            data.topics.iter().find(|t| t.slug == "vitaminy").unwrap().name,
            "Vitaminy II"
        );

        let data = do_update_topic_meta(
            &conn,
            &teacher,
            UpdateTopicMetaPayload {
                topic_id: "vitaminy".into(),
                field: TopicField::Description,
                value: Some("   ".into()),
            },
        )
        .expect("clear description");
        assert_eq!(
            data.topics.iter().find(|t| t.slug == "vitaminy").unwrap().description,
            None
        );

        // Blank names stay rejected.
        assert!(matches!(
            do_update_topic_meta(
                &conn,
                &teacher,
                UpdateTopicMetaPayload {
                    topic_id: "vitaminy".into(),
                    field: TopicField::Name,
                    value: Some("   ".into()),
                },
            ),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            do_create_topic(
                &conn,
                &teacher,
                CreateTopicPayload {
                    name: "".into(),
                    description: None,
                },
            ),
            Err(DbError::Validation(_))
        ));

        let data = do_delete_topic(
            &conn,
            DeleteTopicPayload {
                topic_id: "vitaminy".into(),
            },
        )
        .expect("delete topic");
        assert!(!data.topics.iter().any(|t| t.slug == "vitaminy"));
        assert!(matches!(
            do_delete_topic(
                &conn,
                DeleteTopicPayload {
                    topic_id: "vitaminy".into(),
                },
            ),
            Err(DbError::NotFound(_))
        ));
    }

    #[test]
    fn category_can_be_created_under_a_topic_and_moved_or_ungrouped() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);

        let data = do_create_category(
            &conn,
            &teacher,
            CreateCategoryPayload {
                name: "Nukleotidy".into(),
                description: None,
                topic_id: Some("nukleove-kyseliny".into()),
            },
        )
        .expect("create with topic");
        let category = data.categories.iter().find(|c| c.slug == "nukleotidy").unwrap();
        assert_eq!(category.topic_slug.as_deref(), Some("nukleove-kyseliny"));

        // An unknown topic reference is refused.
        assert!(matches!(
            do_create_category(
                &conn,
                &teacher,
                CreateCategoryPayload {
                    name: "Nukleotidy 2".into(),
                    description: None,
                    topic_id: Some("neexistuje".into()),
                },
            ),
            Err(DbError::NotFound(_))
        ));

        // Move it under another topic.
        let data = do_update_category_meta(
            &conn,
            &teacher,
            UpdateCategoryMetaPayload {
                category_id: "nukleotidy".into(),
                field: CategoryField::Topic,
                value: Some("sacharidy".into()),
            },
        )
        .expect("move topic");
        assert_eq!(
            data.categories.iter().find(|c| c.slug == "nukleotidy").unwrap().topic_slug.as_deref(),
            Some("sacharidy")
        );

        // Missing/null value ungroups it.
        let data = do_update_category_meta(
            &conn,
            &teacher,
            UpdateCategoryMetaPayload {
                category_id: "nukleotidy".into(),
                field: CategoryField::Topic,
                value: None,
            },
        )
        .expect("ungroup");
        assert_eq!(
            data.categories.iter().find(|c| c.slug == "nukleotidy").unwrap().topic_slug,
            None
        );

        // And an unknown topic is refused there too.
        assert!(matches!(
            do_update_category_meta(
                &conn,
                &teacher,
                UpdateCategoryMetaPayload {
                    category_id: "nukleotidy".into(),
                    field: CategoryField::Topic,
                    value: Some("neexistuje".into()),
                },
            ),
            Err(DbError::NotFound(_))
        ));
    }

    #[test]
    fn deleting_a_topic_keeps_its_categories_and_ungroups_them() {
        let conn = setup_conn();
        let data = do_delete_topic(
            &conn,
            DeleteTopicPayload {
                topic_id: "nukleove-kyseliny".into(),
            },
        )
        .expect("delete topic");
        assert!(!data.topics.iter().any(|t| t.slug == "nukleove-kyseliny"));

        let bases = data
            .categories
            .iter()
            .find(|c| c.slug == "dusikate-baze")
            .expect("category survives");
        assert_eq!(bases.topic_slug, None);
        assert_eq!(bases.molecule_count, 5);
        assert!(data.molecules.iter().any(|m| m.category_slug == "dusikate-baze"));
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
                projection: None,
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
                    projection: None,
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
                projection: None,
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
                    projection: None,
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
    fn record_quiz_result_accepts_category_topic_and_all_scopes() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");
        let record = |category: &str| {
            do_record_quiz_result(
                &conn,
                &student,
                RecordQuizResultPayload {
                    category_id: category.into(),
                    correct_count: 5,
                    total_count: 5,
                    mode: "easy".into(),
                },
            )
        };

        record("aminokyseliny").expect("existing category scope");
        record("nukleove-kyseliny").expect("existing topic scope");
        record("*").expect("all-ungrouped sentinel");

        for bogus in ["neexistuje", "../etc", ""] {
            assert!(
                matches!(record(bogus), Err(DbError::Validation(_))),
                "{bogus:?} must be rejected"
            );
        }
    }

    #[test]
    fn leaderboard_sums_all_scopes_and_category_filter_excludes_them() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");
        let record = |category: &str, correct, total, mode: &str| {
            do_record_quiz_result(
                &conn,
                &student,
                RecordQuizResultPayload {
                    category_id: category.into(),
                    correct_count: correct,
                    total_count: total,
                    mode: mode.into(),
                },
            )
            .expect("record quiz");
        };

        record("aminokyseliny", 7, 10, "easy");
        record("nukleove-kyseliny", 5, 5, "hard");
        record("*", 3, 4, "easy");

        // No filter: category, topic and "*" runs all count into one total.
        let board =
            do_quiz_leaderboard(&conn, &QuizLeaderboardPayload::default()).expect("leaderboard");
        assert_eq!(board.len(), 1);
        assert_eq!(board[0].correct_count, 15);
        assert_eq!(board[0].answered_count, 19);
        assert_eq!(board[0].quiz_count, 3);
        // 7 (easy) + 5*2 (hard) + 3 (easy).
        assert_eq!(board[0].points, 20);

        // A per-category filter matches the exact slug, so topic and "*"
        // rows are excluded.
        let aminokyseliny = do_quiz_leaderboard(
            &conn,
            &QuizLeaderboardPayload {
                category_id: Some("aminokyseliny".into()),
            },
        )
        .expect("filtered leaderboard");
        assert_eq!(aminokyseliny.len(), 1);
        assert_eq!(aminokyseliny[0].correct_count, 7);
        assert_eq!(aminokyseliny[0].answered_count, 10);
        assert_eq!(aminokyseliny[0].quiz_count, 1);
        assert_eq!(aminokyseliny[0].points, 7);
    }

    #[test]
    fn record_streak_result_validates_kind_and_score() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");
        let record = |kind: &str, correct, seconds| {
            do_record_streak_result(
                &conn,
                &student,
                RecordStreakResultPayload {
                    kind: kind.into(),
                    correct_count: correct,
                    total_seconds: seconds,
                },
            )
        };

        assert!(matches!(
            record("vysoky", 5, 30.0),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            record("apprentice", -1, 30.0),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            record("apprentice", MAX_STREAK_CORRECT + 1, 30.0),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            record("apprentice", 5, 0.0),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            record("apprentice", 5, MAX_STREAK_SECONDS + 1.0),
            Err(DbError::Validation(_))
        ));
        record("apprentice", 5, 30.0).expect("valid streak");
        // A wrong answer is always answered, so a zero-length streak is valid.
        record("master", 0, 4.0).expect("valid empty streak");

        let board = do_streak_leaderboard(
            &conn,
            &StreakLeaderboardPayload {
                kind: "apprentice".into(),
            },
        )
        .expect("leaderboard");
        assert_eq!(board.len(), 1);
        assert_eq!(board[0].best_correct_count, 5);
        assert_eq!(board[0].total_seconds, 30.0);
        // 30 / (5 + 1) — the failed answer counts as answered.
        assert_eq!(board[0].seconds_per_answer, 5.0);

        // The two variants are ranked independently.
        let master = do_streak_leaderboard(
            &conn,
            &StreakLeaderboardPayload {
                kind: "master".into(),
            },
        )
        .expect("leaderboard");
        assert_eq!(master.len(), 1);
        assert_eq!(master[0].best_correct_count, 0);
        assert_eq!(master[0].seconds_per_answer, 4.0);
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
