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

use crate::db::repos::biomolecule_repo::{
    BiomoleculeData, CategoryField, MoleculeRelocation, TopicField,
};
use crate::db::repos::{
    BiomoleculeHistoryRepo, BiomoleculeLeaderboardRow, BiomoleculeQuizRepo, BiomoleculeRepo,
    BiomoleculeStreakLeaderboardRow, BiomoleculeStreakRepo, PeptidovkaLeaderboardRow,
    PeptidovkaRepo, PeptidovkaSettingsRecord,
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

/// The two Peptidovka modes. Text-only server-side (the game is graded in the
/// frontend), validated on every settings write and run record.
const PEPTIDOVKA_MODES: [&str; 2] = ["ucen", "mistr"];

/// Settings bounds mirroring the teacher-facing form: a run picks at least
/// two and at most all 20 amino acids, at 3-120 seconds per answer.
const PEPTIDOVKA_MIN_LEN_FLOOR: i64 = 2;
const PEPTIDOVKA_MAX_LEN_CEILING: i64 = 20;
const PEPTIDOVKA_SECONDS_PER_AA_MIN: i64 = 3;
const PEPTIDOVKA_SECONDS_PER_AA_MAX: i64 = 120;

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
/// real parse happens client-side (legacy drawer preview) before submit; the
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

/// Optimistic concurrency: a write that names the version it was based on
/// (`expectedUpdatedAt`) only lands if the row still has that version. Each
/// request runs under the one DB lock, so check and write are atomic.
fn check_version(
    what: &str,
    current: Option<String>,
    expected: Option<&str>,
) -> Result<(), DbError> {
    match (current, expected) {
        (None, _) => Err(DbError::NotFound(format!("{what} not found"))),
        (Some(current), Some(expected)) if current != expected => Err(DbError::Conflict(format!(
            "{what} was changed by someone else in the meantime"
        ))),
        _ => Ok(()),
    }
}

/// A reorder must list exactly the current items; when it also names the
/// order it was based on, that must still be the current one.
fn check_order<T: Ord + Clone + PartialEq>(
    what: &str,
    current: &[T],
    requested: &[T],
    expected: Option<&[T]>,
) -> Result<(), DbError> {
    if expected.is_some_and(|expected| expected != current) {
        return Err(DbError::Conflict(format!(
            "The order of {what} was changed by someone else in the meantime"
        )));
    }
    let mut have = current.to_vec();
    let mut want = requested.to_vec();
    have.sort();
    want.sort();
    if have != want {
        return Err(DbError::Conflict(format!(
            "The {what} changed in the meantime — reload and reorder again"
        )));
    }
    Ok(())
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
    BiomoleculeHistoryRepo::record(conn, teacher_id, "category", "create", name, None)?;
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
    #[serde(default)]
    pub expected_updated_at: Option<String>,
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
    check_version(
        &format!("Category {category_id}"),
        BiomoleculeRepo::category_version(conn, category_id)?,
        payload.expected_updated_at.as_deref(),
    )?;
    let value: Option<String> = match payload.field {
        CategoryField::Name => {
            Some(validate_category_name(payload.value.as_deref().unwrap_or(""))?.to_string())
        }
        CategoryField::Description => validate_description(payload.value.as_deref())?,
        CategoryField::Topic => validate_optional_topic(conn, payload.value.as_deref())?,
    };
    // Diff capture before the write: the history entry shows what changed,
    // in "field: old → new" form, one logical row per save.
    let old_name = BiomoleculeRepo::category_name(conn, category_id)?;
    let old_topic_slug = if payload.field == CategoryField::Topic {
        BiomoleculeRepo::category_topic_slug(conn, category_id)?.flatten()
    } else {
        None
    };
    BiomoleculeRepo::update_category_field(conn, category_id, payload.field, value.as_deref(), teacher_id)?;
    let new_name = BiomoleculeRepo::category_name(conn, category_id)?
        .unwrap_or_else(|| category_id.to_string());
    let detail = match payload.field {
        CategoryField::Name => format!(
            "name: {} → {}",
            old_name.as_deref().unwrap_or("—"),
            new_name.as_str()
        ),
        CategoryField::Description => "description changed".to_string(),
        CategoryField::Topic => format!(
            "topic: {} → {}",
            old_topic_slug.as_deref().unwrap_or("—"),
            value.as_deref().unwrap_or("—")
        ),
    };
    BiomoleculeHistoryRepo::record(
        conn,
        teacher_id,
        "category",
        "update",
        new_name.as_str(),
        Some(detail.as_str()),
    )?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCategoryPayload {
    pub category_id: String,
    #[serde(default)]
    pub expected_updated_at: Option<String>,
    /// The molecules (id → version) the caller expects the category to hold;
    /// anything added, removed or edited since refuses the delete, which
    /// would otherwise take that work down with it.
    #[serde(default)]
    pub expected_molecules: Option<HashMap<Uuid, String>>,
}

/// Deletes the category with its molecules and traits (FK cascade). Past
/// quiz results keep their slug — the leaderboard rows survive the deletion.
pub fn do_delete_category(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: DeleteCategoryPayload,
) -> Result<BiomoleculeData, DbError> {
    let category_id = payload.category_id.trim();
    if !is_valid_slug(category_id) || !BiomoleculeRepo::category_exists(conn, category_id)? {
        return Err(DbError::NotFound(format!("Category {category_id} not found")));
    }
    check_version(
        &format!("Category {category_id}"),
        BiomoleculeRepo::category_version(conn, category_id)?,
        payload.expected_updated_at.as_deref(),
    )?;
    if let Some(expected) = &payload.expected_molecules {
        if &BiomoleculeRepo::molecule_versions_in(conn, category_id)? != expected {
            return Err(DbError::Conflict(format!(
                "The molecules of category {category_id} were changed by someone else in the meantime"
            )));
        }
    }
    let label = BiomoleculeRepo::category_name(conn, category_id)?
        .unwrap_or_else(|| category_id.to_string());
    BiomoleculeRepo::delete_category(conn, category_id)?;
    BiomoleculeHistoryRepo::record(conn, teacher_id, "category", "delete", &label, None)?;
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
    BiomoleculeHistoryRepo::record(conn, teacher_id, "topic", "create", name, None)?;
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
    #[serde(default)]
    pub expected_updated_at: Option<String>,
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
    check_version(
        &format!("Topic {topic_id}"),
        BiomoleculeRepo::topic_version(conn, topic_id)?,
        payload.expected_updated_at.as_deref(),
    )?;
    let value: Option<String> = match payload.field {
        TopicField::Name => {
            Some(validate_topic_name(payload.value.as_deref().unwrap_or(""))?.to_string())
        }
        TopicField::Description => validate_description(payload.value.as_deref())?,
    };
    let old_name = BiomoleculeRepo::topic_name(conn, topic_id)?;
    BiomoleculeRepo::update_topic_field(
        conn,
        topic_id,
        payload.field,
        value.as_deref(),
        teacher_id,
    )?;
    let new_name = BiomoleculeRepo::topic_name(conn, topic_id)?
        .unwrap_or_else(|| topic_id.to_string());
    let detail = match payload.field {
        TopicField::Name => format!(
            "name: {} → {}",
            old_name.as_deref().unwrap_or("—"),
            new_name.as_str()
        ),
        TopicField::Description => "description changed".to_string(),
    };
    BiomoleculeHistoryRepo::record(
        conn,
        teacher_id,
        "topic",
        "update",
        new_name.as_str(),
        Some(detail.as_str()),
    )?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTopicPayload {
    pub topic_id: String,
    #[serde(default)]
    pub expected_updated_at: Option<String>,
}

/// Deletes the grouping only — its categories survive and become topic-less
/// (`ON DELETE SET NULL`).
pub fn do_delete_topic(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: DeleteTopicPayload,
) -> Result<BiomoleculeData, DbError> {
    let topic_id = payload.topic_id.trim();
    if !is_valid_slug(topic_id) || !BiomoleculeRepo::topic_exists(conn, topic_id)? {
        return Err(DbError::NotFound(format!("Topic {topic_id} not found")));
    }
    check_version(
        &format!("Topic {topic_id}"),
        BiomoleculeRepo::topic_version(conn, topic_id)?,
        payload.expected_updated_at.as_deref(),
    )?;
    let label = BiomoleculeRepo::topic_name(conn, topic_id)?.unwrap_or_else(|| topic_id.to_string());
    BiomoleculeRepo::delete_topic(conn, topic_id)?;
    BiomoleculeHistoryRepo::record(conn, teacher_id, "topic", "delete", &label, None)?;
    BiomoleculeRepo::list_data(conn)
}

/// Older clients omit `haworth`; saccharide detection stays on for them.
fn default_true() -> bool {
    true
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
    /// Draw a Haworth projection (true) or a plain skeletal one (false).
    #[serde(default = "default_true")]
    pub haworth: bool,
    /// Draw a Fischer projection for open-chain sugars (true) or a plain
    /// skeletal one (false). Older clients omit it; detection stays on.
    #[serde(default = "default_true")]
    pub fischer: bool,
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
        payload.haworth,
        payload.fischer,
        position,
        &traits,
        teacher_id,
    )?;
    BiomoleculeHistoryRepo::record(conn, teacher_id, "molecule", "create", &name, None)?;
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
    /// Draw a Haworth projection (true) or a plain skeletal one (false).
    #[serde(default = "default_true")]
    pub haworth: bool,
    /// Draw a Fischer projection for open-chain sugars (true) or a plain
    /// skeletal one (false). Older clients omit it; detection stays on.
    #[serde(default = "default_true")]
    pub fischer: bool,
    #[serde(default)]
    pub traits: HashMap<String, String>,
    /// Moves the molecule to this category (to its end); omitted keeps it.
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub expected_updated_at: Option<String>,
}

pub fn do_update_molecule(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: UpdateMoleculePayload,
) -> Result<BiomoleculeData, DbError> {
    let id = payload.molecule_id;
    let current_category = BiomoleculeRepo::molecule_category(conn, &id)?
        .ok_or_else(|| DbError::NotFound(format!("Molecule {id} not found")))?;
    let old_name = BiomoleculeRepo::molecule_name(conn, &id)?;
    check_version(
        &format!("Molecule {id}"),
        BiomoleculeRepo::molecule_version(conn, &id)?,
        payload.expected_updated_at.as_deref(),
    )?;
    let target_category = payload
        .category_id
        .as_deref()
        .map(str::trim)
        .unwrap_or(&current_category)
        .to_string();
    // Validated against the target category: names and letter codes must be
    // unique where the molecule ends up.
    let (name, smiles, projection, traits) = validate_molecule_input(
        conn,
        &target_category,
        &payload.name,
        &payload.smiles,
        payload.projection.as_deref(),
        &payload.traits,
        Some(id),
    )?;
    let relocation = if target_category != current_category {
        let current_slug = BiomoleculeRepo::list_molecules(conn)?
            .into_iter()
            .find(|m| m.id == id)
            .map(|m| m.slug)
            .ok_or_else(|| DbError::NotFound(format!("Molecule {id} not found")))?;
        // Keep the slug (quiz identities, pairsWith) unless the target has it.
        let slug = if BiomoleculeRepo::molecule_slug_taken(
            conn,
            &target_category,
            &current_slug,
            Some(id),
        )? {
            unique_slug(&name, "molekula", |slug| {
                BiomoleculeRepo::molecule_slug_taken(conn, &target_category, slug, Some(id))
            })?
        } else {
            current_slug
        };
        Some(MoleculeRelocation {
            position: BiomoleculeRepo::next_molecule_position(conn, &target_category)?,
            category_slug: target_category,
            slug,
        })
    } else {
        None
    };
    BiomoleculeRepo::update_molecule(
        conn,
        &id,
        &name,
        &smiles,
        projection.as_deref(),
        payload.haworth,
        payload.fischer,
        &traits,
        relocation.as_ref(),
        teacher_id,
    )?;
    let detail = if old_name.as_deref() != Some(name.as_str()) {
        format!(
            "name: {} → {}",
            old_name.as_deref().unwrap_or("—"),
            name.as_str()
        )
    } else if relocation.is_some() {
        "moved to another category".to_string()
    } else {
        "traits/structure updated".to_string()
    };
    BiomoleculeHistoryRepo::record(
        conn,
        teacher_id,
        "molecule",
        "update",
        &name,
        Some(detail.as_str()),
    )?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteMoleculePayload {
    pub molecule_id: Uuid,
    #[serde(default)]
    pub expected_updated_at: Option<String>,
}

pub fn do_delete_molecule(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: DeleteMoleculePayload,
) -> Result<BiomoleculeData, DbError> {
    check_version(
        &format!("Molecule {}", payload.molecule_id),
        BiomoleculeRepo::molecule_version(conn, &payload.molecule_id)?,
        payload.expected_updated_at.as_deref(),
    )?;
    let label = BiomoleculeRepo::molecule_name(conn, &payload.molecule_id)?
        .unwrap_or_else(|| payload.molecule_id.to_string());
    BiomoleculeRepo::delete_molecule(conn, &payload.molecule_id)?;
    BiomoleculeHistoryRepo::record(conn, teacher_id, "molecule", "delete", &label, None)?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderTopicsPayload {
    /// Every topic slug, in the new order.
    pub slugs: Vec<String>,
    /// The order the caller saw; omitted skips that check.
    #[serde(default)]
    pub expected_order: Option<Vec<String>>,
}

pub fn do_reorder_topics(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: ReorderTopicsPayload,
) -> Result<BiomoleculeData, DbError> {
    let current = BiomoleculeRepo::topic_order(conn)?;
    check_order(
        "topics",
        &current,
        &payload.slugs,
        payload.expected_order.as_deref(),
    )?;
    BiomoleculeRepo::set_topic_order(conn, &payload.slugs)?;
    let detail = format!("{}", payload.slugs.len());
    BiomoleculeHistoryRepo::record(
        conn,
        teacher_id,
        "topics",
        "reorder",
        "topics",
        Some(detail.as_str()),
    )?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderCategoriesPayload {
    /// Every category slug, in the new order.
    pub slugs: Vec<String>,
    #[serde(default)]
    pub expected_order: Option<Vec<String>>,
}

pub fn do_reorder_categories(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: ReorderCategoriesPayload,
) -> Result<BiomoleculeData, DbError> {
    let current = BiomoleculeRepo::category_order(conn)?;
    check_order(
        "categories",
        &current,
        &payload.slugs,
        payload.expected_order.as_deref(),
    )?;
    BiomoleculeRepo::set_category_order(conn, &payload.slugs)?;
    let detail = format!("{}", payload.slugs.len());
    BiomoleculeHistoryRepo::record(
        conn,
        teacher_id,
        "categories",
        "reorder",
        "categories",
        Some(detail.as_str()),
    )?;
    BiomoleculeRepo::list_data(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderMoleculesPayload {
    pub category_id: String,
    /// Every molecule id of the category, in the new order.
    pub ids: Vec<Uuid>,
    #[serde(default)]
    pub expected_order: Option<Vec<Uuid>>,
}

pub fn do_reorder_molecules(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: ReorderMoleculesPayload,
) -> Result<BiomoleculeData, DbError> {
    let category_id = payload.category_id.trim();
    if !is_valid_slug(category_id) || !BiomoleculeRepo::category_exists(conn, category_id)? {
        return Err(DbError::NotFound(format!(
            "Category {category_id} not found"
        )));
    }
    let current = BiomoleculeRepo::molecule_order(conn, category_id)?;
    check_order(
        "molecules",
        &current,
        &payload.ids,
        payload.expected_order.as_deref(),
    )?;
    BiomoleculeRepo::set_molecule_order(conn, &payload.ids)?;
    let detail = format!("{}", payload.ids.len());
    BiomoleculeHistoryRepo::record(
        conn,
        teacher_id,
        "molecules",
        "reorder",
        category_id,
        Some(detail.as_str()),
    )?;
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

/// Leaderboard payload for one Peptidovka mode (`"ucen"` / `"mistr"`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeptidovkaLeaderboardPayload {
    pub mode: String,
}

/// History listing payload: optional page window (defaults 50/0 at the route).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeHistoryPayload {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

/// Each user's single best finished Peptidovka run of the mode — same table
/// shape as the streak board, so the page reuses it verbatim.
pub fn do_peptidovka_leaderboard(
    conn: &Connection,
    payload: &PeptidovkaLeaderboardPayload,
) -> Result<Vec<BiomoleculeStreakLeaderboardEntry>, DbError> {
    let mode = validate_peptidovka_mode(&payload.mode)?;
    Ok(PeptidovkaRepo::best_per_user(conn, mode)?
        .into_iter()
        .map(
            |row: PeptidovkaLeaderboardRow| BiomoleculeStreakLeaderboardEntry {
                user_id: row.user_id.to_string(),
                username: row.username,
                best_correct_count: row.best_correct_count,
                total_seconds: row.total_seconds,
                // The run always ends on one failed/expired round: that round
                // counts as answered, exactly like the streak's +1.
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

/// One mode's Peptidovka settings as the API returns them.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeptidovkaSettings {
    pub mode: String,
    pub min_len: i64,
    pub max_len: i64,
    pub seconds_per_aa: i64,
    pub slugs: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePeptidovkaSettingsPayload {
    /// `"ucen"` or `"mistr"`.
    pub mode: String,
    pub min_len: i64,
    pub max_len: i64,
    pub seconds_per_aa: i64,
    pub slugs: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPeptidovkaRunPayload {
    /// `"ucen"` or `"mistr"`.
    pub mode: String,
    /// Peptides solved correctly in the run — the leaderboard's best-series
    /// metric (in-game points are decoration only and are never recorded).
    pub correct_count: i64,
    pub total_seconds: f64,
}

fn validate_peptidovka_mode(mode: &str) -> Result<&str, DbError> {
    let mode = mode.trim();
    if PEPTIDOVKA_MODES.contains(&mode) {
        Ok(mode)
    } else {
        Err(DbError::Validation(format!(
            "Invalid peptidovka mode: {mode}"
        )))
    }
}

/// Both modes' settings, Učeň first.
pub fn do_list_peptidovka_settings(conn: &Connection) -> Result<Vec<PeptidovkaSettings>, DbError> {
    PeptidovkaRepo::list_settings(conn)?
        .into_iter()
        .map(|row: PeptidovkaSettingsRecord| {
            Ok(PeptidovkaSettings {
                mode: row.mode,
                min_len: row.min_len,
                max_len: row.max_len,
                seconds_per_aa: row.seconds_per_aa,
                slugs: serde_json::from_str(&row.slugs_json)?,
            })
        })
        .collect()
}

/// Replace one mode's settings. The teacher form owns the whole row, so this
/// is a wholesale upsert; all bounds are checked here rather than in the
/// schema so the error messages reach the client.
pub fn do_update_peptidovka_settings(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: UpdatePeptidovkaSettingsPayload,
) -> Result<(), DbError> {
    let mode = validate_peptidovka_mode(&payload.mode)?;
    if payload.min_len < PEPTIDOVKA_MIN_LEN_FLOOR {
        return Err(DbError::Validation(format!(
            "Minimum length must be at least {PEPTIDOVKA_MIN_LEN_FLOOR}"
        )));
    }
    if payload.max_len < payload.min_len {
        return Err(DbError::Validation(
            "Maximum length must not be shorter than the minimum".into(),
        ));
    }
    if payload.max_len > PEPTIDOVKA_MAX_LEN_CEILING {
        return Err(DbError::Validation(format!(
            "Maximum length must be at most {PEPTIDOVKA_MAX_LEN_CEILING}"
        )));
    }
    if !(PEPTIDOVKA_SECONDS_PER_AA_MIN..=PEPTIDOVKA_SECONDS_PER_AA_MAX)
        .contains(&payload.seconds_per_aa)
    {
        return Err(DbError::Validation(format!(
            "Seconds per amino acid must be {PEPTIDOVKA_SECONDS_PER_AA_MIN}-{PEPTIDOVKA_SECONDS_PER_AA_MAX}"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let slugs: Vec<String> = payload
        .slugs
        .iter()
        .map(|slug| slug.trim().to_string())
        .filter(|slug| !slug.is_empty())
        .filter(|slug| seen.insert(slug.clone()))
        .collect();
    if slugs.is_empty() || slugs.iter().any(|slug| !is_valid_slug(slug)) {
        return Err(DbError::Validation(
            "Slugs must be a non-empty list of amino-acid slugs".into(),
        ));
    }
    // Format alone lets a typo'd slug silently break the game pool later;
    // demand every slug names a real molecule (any category — a teacher's
    // custom amino-acid entry is just as valid as a seeded one).
    for slug in &slugs {
        if !BiomoleculeRepo::molecule_slug_exists(conn, slug)? {
            return Err(DbError::Validation(format!(
                "Unknown molecule slug: {slug}"
            )));
        }
    }
    let slugs_json = serde_json::to_string(&slugs)?;
    PeptidovkaRepo::upsert_settings(
        conn,
        mode,
        payload.min_len,
        payload.max_len,
        payload.seconds_per_aa,
        &slugs_json,
    )?;
    let detail = format!(
        "{}–{} · {} s/aa · {} slugs",
        payload.min_len,
        payload.max_len,
        payload.seconds_per_aa,
        slugs.len()
    );
    BiomoleculeHistoryRepo::record(
        conn,
        teacher_id,
        "peptidovka",
        "settings",
        mode,
        Some(detail.as_str()),
    )
}

/// Store the aggregate of one finished Peptidovka run for the acting user.
/// Graded client-side, so this only sanity-checks the numbers, exactly like
/// `do_record_streak_result`.
pub fn do_record_peptidovka_run(
    conn: &Connection,
    user_id: &Uuid,
    payload: RecordPeptidovkaRunPayload,
) -> Result<(), DbError> {
    let mode = validate_peptidovka_mode(&payload.mode)?;
    if !(0..=MAX_STREAK_CORRECT).contains(&payload.correct_count) {
        return Err(DbError::Validation("Invalid peptidovka run score".into()));
    }
    if !(payload.total_seconds > 0.0 && payload.total_seconds <= MAX_STREAK_SECONDS) {
        return Err(DbError::Validation("Invalid peptidovka run time".into()));
    }
    PeptidovkaRepo::insert_run(
        conn,
        user_id,
        mode,
        payload.correct_count,
        payload.total_seconds,
    )
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
            haworth: true,
            fischer: true,
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
            assert!(
                molecule.haworth,
                "{} must keep Haworth detection on by default",
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
                expected_updated_at: None,
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
                expected_updated_at: None,
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
                    expected_updated_at: None,
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
            &teacher,
            DeleteTopicPayload {
                topic_id: "vitaminy".into(),
                expected_updated_at: None,
            },
        )
        .expect("delete topic");
        assert!(!data.topics.iter().any(|t| t.slug == "vitaminy"));
        assert!(matches!(
            do_delete_topic(
                &conn,
                &teacher,
                DeleteTopicPayload {
                    topic_id: "vitaminy".into(),
                    expected_updated_at: None,
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
                expected_updated_at: None,
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
                expected_updated_at: None,
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
                    expected_updated_at: None,
                },
            ),
            Err(DbError::NotFound(_))
        ));
    }

    #[test]
    fn deleting_a_topic_keeps_its_categories_and_ungroups_them() {
        let conn = setup_conn();
        let teacher = insert_student(&conn, "ucitel");
        let data = do_delete_topic(
            &conn,
            &teacher,
            DeleteTopicPayload {
                topic_id: "nukleove-kyseliny".into(),
                expected_updated_at: None,
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
                expected_updated_at: None,
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
                    expected_updated_at: None,
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
                expected_updated_at: None,
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
                    expected_updated_at: None,
                },
            ),
            Err(DbError::NotFound(_))
        ));

        // Deleting a category cascades to its molecules and traits.
        let data = do_delete_category(
            &conn,
            &teacher,
            DeleteCategoryPayload {
                category_id: "dusikate-baze".into(),
                expected_updated_at: None,
                expected_molecules: None,
            },
        )
        .expect("delete");
        assert!(!data.categories.iter().any(|c| c.slug == "dusikate-baze"));
        assert!(!data.molecules.iter().any(|m| m.category_slug == "dusikate-baze"));
        assert!(matches!(
            do_delete_category(
                &conn,
                &teacher,
                DeleteCategoryPayload {
                    category_id: "dusikate-baze".into(),
                    expected_updated_at: None,
                    expected_molecules: None,
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
                haworth: true,
                fischer: true,
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
        assert!(created.haworth, "an omitted haworth field defaults to true");
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
                    haworth: true,
                    fischer: true,
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
                haworth: false,
                fischer: true,
                traits: new_traits,
                category_id: None,
                expected_updated_at: None,
            },
        )
        .expect("update");
        let updated = data.molecules.iter().find(|m| m.id == created.id).unwrap();
        assert_eq!(updated.name, "Watsonin II");
        assert_eq!(updated.slug, "watsonin", "slug stays stable across renames");
        assert!(!updated.haworth, "an explicit false round-trips through update");
        assert_eq!(updated.traits.len(), 1);
        assert_eq!(updated.traits.get("polarity").map(String::as_str), Some("hydrophobic"));

        let data = do_delete_molecule(
            &conn,
            &teacher,
            DeleteMoleculePayload {
                molecule_id: created.id,
                expected_updated_at: None,
            },
        )
        .expect("delete");
        assert!(!data.molecules.iter().any(|m| m.id == created.id));
    }

    #[test]
    fn molecule_projection_flags_round_trip() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);

        // Explicit false disables each projection detection for this molecule.
        let data = do_create_molecule(
            &conn,
            &teacher,
            CreateMoleculePayload {
                category_id: "sacharidy".into(),
                name: "Testoza".into(),
                smiles: "OCC1OC(O)C(O)C(O)C1O".into(),
                projection: None,
                haworth: false,
                fischer: false,
                traits: HashMap::new(),
            },
        )
        .expect("create");
        let created = data
            .molecules
            .iter()
            .find(|m| m.name == "Testoza")
            .expect("created");
        assert!(!created.haworth, "explicit false survives create");
        assert!(!created.fischer, "explicit false survives create");

        let data = do_update_molecule(
            &conn,
            &teacher,
            UpdateMoleculePayload {
                molecule_id: created.id,
                name: "Testoza".into(),
                smiles: "OCC1OC(O)C(O)C(O)C1O".into(),
                projection: None,
                haworth: true,
                fischer: true,
                traits: HashMap::new(),
                category_id: None,
                expected_updated_at: None,
            },
        )
        .expect("update");
        let updated = data.molecules.iter().find(|m| m.id == created.id).unwrap();
        assert!(updated.haworth, "explicit true survives update");
        assert!(updated.fischer, "explicit true survives update");
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
                    haworth: true,
                    fischer: true,
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

    fn update_payload(
        m: &crate::db::repos::biomolecule_repo::BiomoleculeInfo,
    ) -> UpdateMoleculePayload {
        UpdateMoleculePayload {
            molecule_id: m.id,
            name: m.name.clone(),
            smiles: m.smiles.clone(),
            projection: m.projection.clone(),
            haworth: m.haworth,
            fischer: m.fischer,
            traits: m.traits.clone(),
            category_id: None,
            expected_updated_at: None,
        }
    }

    fn molecule<'a>(
        data: &'a BiomoleculeData,
        name: &str,
    ) -> &'a crate::db::repos::biomolecule_repo::BiomoleculeInfo {
        data.molecules
            .iter()
            .find(|m| m.name == name)
            .expect("molecule")
    }

    #[test]
    fn a_molecule_moves_to_another_category_keeping_its_id_and_slug() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        let data = do_list_data(&conn).expect("list");
        let alanine = molecule(&data, "Alanin").clone();

        let data = do_update_molecule(
            &conn,
            &teacher,
            UpdateMoleculePayload {
                category_id: Some("sacharidy".into()),
                ..update_payload(&alanine)
            },
        )
        .expect("move");
        let moved = molecule(&data, "Alanin");
        assert_eq!(moved.id, alanine.id);
        assert_eq!(moved.category_slug, "sacharidy");
        assert_eq!(moved.slug, alanine.slug);
        let last = data
            .molecules
            .iter()
            .filter(|m| m.category_slug == "sacharidy")
            .map(|m| m.position)
            .max();
        assert_eq!(
            Some(moved.position),
            last,
            "a moved molecule goes to the end"
        );

        // The target's name rule applies: no second "Glycin" in one category.
        let glycine = molecule(&data, "Glycin").clone();
        do_create_molecule(
            &conn,
            &teacher,
            molecule_payload("sacharidy", "Glycin", "CCO"),
        )
        .expect("create a namesake");
        let result = do_update_molecule(
            &conn,
            &teacher,
            UpdateMoleculePayload {
                category_id: Some("sacharidy".into()),
                ..update_payload(&glycine)
            },
        );
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[test]
    fn a_moved_molecule_gets_a_new_slug_only_when_the_target_has_its_own() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        let data = do_list_data(&conn).expect("list");
        let alanine = molecule(&data, "Alanin").clone();
        let data = do_create_molecule(
            &conn,
            &teacher,
            molecule_payload("sacharidy", &alanine.slug, "CCO"),
        )
        .expect("take the slug in the target");
        assert!(data
            .molecules
            .iter()
            .any(|m| m.category_slug == "sacharidy" && m.slug == alanine.slug));

        let data = do_update_molecule(
            &conn,
            &teacher,
            UpdateMoleculePayload {
                category_id: Some("sacharidy".into()),
                ..update_payload(&alanine)
            },
        )
        .expect("move");
        let moved = molecule(&data, "Alanin");
        assert_eq!(moved.category_slug, "sacharidy");
        assert_ne!(moved.slug, alanine.slug);
    }

    #[test]
    fn writes_based_on_a_stale_version_are_refused() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        let data = do_list_data(&conn).expect("list");
        let alanine = molecule(&data, "Alanin").clone();

        let data = do_update_molecule(
            &conn,
            &teacher,
            UpdateMoleculePayload {
                smiles: "CC(N)C(=O)O".into(),
                expected_updated_at: Some(alanine.updated_at.clone()),
                ..update_payload(&alanine)
            },
        )
        .expect("current version is accepted");
        assert_ne!(molecule(&data, "Alanin").updated_at, alanine.updated_at);

        let stale = do_update_molecule(
            &conn,
            &teacher,
            UpdateMoleculePayload {
                name: "Ala".into(),
                expected_updated_at: Some(alanine.updated_at.clone()),
                ..update_payload(&alanine)
            },
        );
        assert!(matches!(stale, Err(DbError::Conflict(_))));
        let stale_delete = do_delete_molecule(
            &conn,
            &teacher,
            DeleteMoleculePayload {
                molecule_id: alanine.id,
                expected_updated_at: Some(alanine.updated_at.clone()),
            },
        );
        assert!(matches!(stale_delete, Err(DbError::Conflict(_))));
        assert_eq!(
            molecule(&do_list_data(&conn).expect("list"), "Alanin").smiles,
            "CC(N)C(=O)O",
            "refused writes change nothing"
        );

        let topic = data.topics[0].clone();
        do_update_topic_meta(
            &conn,
            &teacher,
            UpdateTopicMetaPayload {
                topic_id: topic.slug.clone(),
                field: TopicField::Name,
                value: Some("Nový název".into()),
                expected_updated_at: Some(topic.updated_at.clone()),
            },
        )
        .expect("topic rename");
        let stale_topic = do_delete_topic(
            &conn,
            &teacher,
            DeleteTopicPayload {
                topic_id: topic.slug.clone(),
                expected_updated_at: Some(topic.updated_at.clone()),
            },
        );
        assert!(matches!(stale_topic, Err(DbError::Conflict(_))));

        let category = data.categories[0].clone();
        do_update_category_meta(
            &conn,
            &teacher,
            UpdateCategoryMetaPayload {
                category_id: category.slug.clone(),
                field: CategoryField::Description,
                value: Some("Jinak".into()),
                expected_updated_at: Some(category.updated_at.clone()),
            },
        )
        .expect("category edit");
        let stale_category = do_update_category_meta(
            &conn,
            &teacher,
            UpdateCategoryMetaPayload {
                category_id: category.slug.clone(),
                field: CategoryField::Name,
                value: Some("Jiné".into()),
                expected_updated_at: Some(category.updated_at.clone()),
            },
        );
        assert!(matches!(stale_category, Err(DbError::Conflict(_))));
    }

    #[test]
    fn deleting_a_category_is_refused_when_its_molecules_changed() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        let data = do_list_data(&conn).expect("list");
        let seen: HashMap<Uuid, String> = data
            .molecules
            .iter()
            .filter(|m| m.category_slug == "dusikate-baze")
            .map(|m| (m.id, m.updated_at.clone()))
            .collect();
        do_create_molecule(
            &conn,
            &teacher,
            molecule_payload("dusikate-baze", "Xanthin", "CCO"),
        )
        .expect("someone adds a molecule");

        let delete = |expected_molecules| {
            do_delete_category(
                &conn,
                &teacher,
                DeleteCategoryPayload {
                    category_id: "dusikate-baze".into(),
                    expected_updated_at: None,
                    expected_molecules: Some(expected_molecules),
                },
            )
        };
        assert!(matches!(delete(seen), Err(DbError::Conflict(_))));
        let now = BiomoleculeRepo::molecule_versions_in(&conn, "dusikate-baze").expect("versions");
        delete(now).expect("delete with the current contents");
        assert!(!BiomoleculeRepo::category_exists(&conn, "dusikate-baze").expect("exists"));
    }

    #[test]
    fn reorder_takes_every_item_and_checks_the_order_it_was_based_on() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        let current = BiomoleculeRepo::topic_order(&conn).expect("order");
        let mut reversed = current.clone();
        reversed.reverse();

        let data = do_reorder_topics(
            &conn,
            &teacher,
            ReorderTopicsPayload {
                slugs: reversed.clone(),
                expected_order: Some(current.clone()),
            },
        )
        .expect("reorder");
        let order: Vec<String> = data.topics.iter().map(|t| t.slug.clone()).collect();
        assert_eq!(order, reversed);

        let stale = do_reorder_topics(
            &conn,
            &teacher,
            ReorderTopicsPayload {
                slugs: current.clone(),
                expected_order: Some(current.clone()),
            },
        );
        assert!(matches!(stale, Err(DbError::Conflict(_))));
        let partial = do_reorder_topics(
            &conn,
            &teacher,
            ReorderTopicsPayload {
                slugs: current[..1].to_vec(),
                expected_order: None,
            },
        );
        assert!(matches!(partial, Err(DbError::Conflict(_))));

        let ids = BiomoleculeRepo::molecule_order(&conn, "dusikate-baze").expect("ids");
        let mut rotated = ids.clone();
        rotated.rotate_left(1);
        let data = do_reorder_molecules(
            &conn,
            &teacher,
            ReorderMoleculesPayload {
                category_id: "dusikate-baze".into(),
                ids: rotated.clone(),
                expected_order: Some(ids),
            },
        )
        .expect("reorder molecules");
        let order: Vec<Uuid> = data
            .molecules
            .iter()
            .filter(|m| m.category_slug == "dusikate-baze")
            .map(|m| m.id)
            .collect();
        assert_eq!(order, rotated);

        let categories = BiomoleculeRepo::category_order(&conn).expect("categories");
        let mut swapped = categories.clone();
        swapped.swap(0, 1);
        let data = do_reorder_categories(
            &conn,
            &teacher,
            ReorderCategoriesPayload {
                slugs: swapped.clone(),
                expected_order: Some(categories),
            },
        )
        .expect("reorder categories");
        let order: Vec<String> = data.categories.iter().map(|c| c.slug.clone()).collect();
        assert_eq!(order, swapped);
    }

    #[test]
    fn peptidovka_defaults_are_seeded_for_both_modes() {
        let conn = setup_conn();
        let settings = do_list_peptidovka_settings(&conn).expect("settings");

        assert_eq!(settings.len(), 2);
        assert_eq!(settings[0].mode, "ucen");
        assert_eq!(
            (
                settings[0].min_len,
                settings[0].max_len,
                settings[0].seconds_per_aa
            ),
            (3, 6, 15)
        );
        assert_eq!(settings[1].mode, "mistr");
        assert_eq!(
            (
                settings[1].min_len,
                settings[1].max_len,
                settings[1].seconds_per_aa
            ),
            (3, 10, 15)
        );

        // Both modes default to the canonical 20 amino-acid slugs.
        assert_eq!(settings[0].slugs.len(), 20);
        assert!(settings[0].slugs.iter().any(|slug| slug == "ala"));
        assert_eq!(settings[0].slugs, settings[1].slugs);
    }

    #[test]
    fn peptidovka_settings_update_round_trips_each_mode() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        for (mode, max_len) in [("ucen", 5_i64), ("mistr", 9_i64)] {
            do_update_peptidovka_settings(
                &conn,
                &teacher,
                UpdatePeptidovkaSettingsPayload {
                    mode: mode.into(),
                    min_len: 4,
                    max_len,
                    seconds_per_aa: 30,
                    slugs: vec!["ala".into(), "gly".into()],
                },
            )
            .expect("update");
        }

        let settings = do_list_peptidovka_settings(&conn).expect("settings");
        let ucen = settings
            .iter()
            .find(|s| s.mode == "ucen")
            .expect("ucen settings");
        assert_eq!((ucen.min_len, ucen.max_len), (4, 5));
        assert_eq!(ucen.seconds_per_aa, 30);
        assert_eq!(ucen.slugs, vec!["ala".to_string(), "gly".to_string()]);

        let mistr = settings
            .iter()
            .find(|s| s.mode == "mistr")
            .expect("mistr settings");
        assert_eq!((mistr.min_len, mistr.max_len), (4, 9));
        assert_eq!(mistr.seconds_per_aa, 30);
        assert_eq!(mistr.slugs, vec!["ala".to_string(), "gly".to_string()]);
    }

    #[test]
    fn peptidovka_settings_validation_rejects_bad_input() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);
        let update =
            |mode: &str, min_len: i64, max_len: i64, seconds_per_aa: i64, slugs: Vec<String>| {
                do_update_peptidovka_settings(
                    &conn,
                    &teacher,
                    UpdatePeptidovkaSettingsPayload {
                        mode: mode.into(),
                        min_len,
                        max_len,
                        seconds_per_aa,
                        slugs,
                    },
                )
            };
        let aa = || vec!["ala".to_string()];

        assert!(matches!(
            update("beginner", 3, 6, 15, aa()),
            Err(DbError::Validation(_))
        ));
        assert!(
            matches!(update("ucen", 1, 6, 15, aa()), Err(DbError::Validation(_))),
            "minimum length below 2 must be rejected"
        );
        assert!(
            matches!(update("ucen", 8, 4, 15, aa()), Err(DbError::Validation(_))),
            "inverted lengths must be rejected"
        );
        assert!(
            matches!(update("ucen", 3, 21, 15, aa()), Err(DbError::Validation(_))),
            "maximum length above 20 must be rejected"
        );
        assert!(
            matches!(update("ucen", 3, 6, 2, aa()), Err(DbError::Validation(_))),
            "seconds per amino acid below 3 must be rejected"
        );
        assert!(
            matches!(update("ucen", 3, 6, 121, aa()), Err(DbError::Validation(_))),
            "seconds per amino acid above 120 must be rejected"
        );
        assert!(
            matches!(
                update("ucen", 3, 6, 15, vec![]),
                Err(DbError::Validation(_))
            ),
            "an empty slug set must be rejected"
        );
    }

    #[test]
    fn peptidovka_run_is_recorded() {
        let conn = setup_conn();
        let student = insert_student(&conn, "peptak");

        do_record_peptidovka_run(
            &conn,
            &student,
            RecordPeptidovkaRunPayload {
                mode: "ucen".into(),
                correct_count: 7,
                total_seconds: 12.5,
            },
        )
        .expect("record run");

        let (mode, correct_count, total_seconds): (String, i64, f64) = conn
            .query_row(
                "SELECT mode, correct_count, total_seconds FROM peptidovka_runs",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("stored run");
        assert_eq!(mode, "ucen");
        assert_eq!(correct_count, 7);
        assert_eq!(total_seconds, 12.5);
    }

    #[test]
    fn peptidovka_rejects_stale_mode_strings() {
        let conn = setup_conn();
        let student = insert_student(&conn, "peptak");

        for stale in ["apprentice", "master", ""] {
            assert!(
                matches!(
                    do_record_peptidovka_run(
                        &conn,
                        &student,
                        RecordPeptidovkaRunPayload {
                            mode: stale.into(),
                            correct_count: 3,
                            total_seconds: 10.0,
                        },
                    ),
                    Err(DbError::Validation(_))
                ),
                "run mode {stale:?} must be rejected"
            );
            assert!(
                matches!(
                    do_update_peptidovka_settings(
                        &conn,
                        &student,
                        UpdatePeptidovkaSettingsPayload {
                            mode: stale.into(),
                            min_len: 3,
                            max_len: 6,
                            seconds_per_aa: 15,
                            slugs: vec!["ala".into()],
                        },
                    ),
                    Err(DbError::Validation(_))
                ),
                "settings mode {stale:?} must be rejected"
            );
        }
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM peptidovka_runs", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count"),
            0,
            "rejected runs write nothing"
        );
    }

    #[test]
    fn peptidovka_record_run_validates_bounds() {
        let conn = setup_conn();
        let student = insert_student(&conn, "peptak");
        let record = |mode: &str, correct: i64, seconds: f64| {
            do_record_peptidovka_run(
                &conn,
                &student,
                RecordPeptidovkaRunPayload {
                    mode: mode.into(),
                    correct_count: correct,
                    total_seconds: seconds,
                },
            )
        };

        assert!(matches!(
            record("ucen", -1, 30.0),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            record("ucen", MAX_STREAK_CORRECT + 1, 30.0),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(record("ucen", 5, 0.0), Err(DbError::Validation(_))));
        assert!(matches!(
            record("ucen", 5, -4.0),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            record("ucen", 5, MAX_STREAK_SECONDS + 1.0),
            Err(DbError::Validation(_))
        ));
        record("mistr", 5, 30.0).expect("valid mistr run");
        record("ucen", 0, 4.0).expect("zero-answer run is valid");
    }

    #[test]
    fn peptidovka_leaderboard_reports_each_users_best_run_per_mode() {
        let conn = setup_conn();
        let petri = insert_student(&conn, "petri");
        let other = insert_student(&conn, "jinek");

        for (count, seconds) in [(2_i64, 30.0_f64), (5, 40.0), (3, 10.0)] {
            do_record_peptidovka_run(
                &conn,
                &petri,
                RecordPeptidovkaRunPayload {
                    mode: "ucen".into(),
                    correct_count: count,
                    total_seconds: seconds,
                },
            )
            .expect("petri run");
        }
        do_record_peptidovka_run(
            &conn,
            &other,
            RecordPeptidovkaRunPayload {
                mode: "ucen".into(),
                correct_count: 4,
                total_seconds: 20.0,
            },
        )
        .expect("other run");
        do_record_peptidovka_run(
            &conn,
            &petri,
            RecordPeptidovkaRunPayload {
                mode: "mistr".into(),
                correct_count: 1,
                total_seconds: 8.0,
            },
        )
        .expect("mistr run separate");

        let board = do_peptidovka_leaderboard(
            &conn,
            &PeptidovkaLeaderboardPayload {
                mode: "ucen".into(),
            },
        )
        .expect("leaderboard");
        assert_eq!(board.len(), 2);
        // Petri's best is 5 correct from the second run; the slower 3-correct
        // run and the worse 2-correct run are folded away, and the other
        // student sits behind despite more correct than petri's worst runs.
        assert_eq!(board[0].best_correct_count, 5);
        assert_eq!(board[0].username, "petri");
        assert_eq!(board[0].seconds_per_answer, 40.0 / 6.0);
        assert_eq!(board[1].best_correct_count, 4);

        let mistr = do_peptidovka_leaderboard(
            &conn,
            &PeptidovkaLeaderboardPayload {
                mode: "mistr".into(),
            },
        )
        .expect("mistr leaderboard");
        assert_eq!(mistr.len(), 1, "modes stay isolated on the board");

        assert!(matches!(
            do_peptidovka_leaderboard(
                &conn,
                &PeptidovkaLeaderboardPayload {
                    mode: "apprentice".into(),
                },
            ),
            Err(DbError::Validation(_))
        ));
    }

    #[test]
    fn peptidovka_update_rejects_unknown_slugs_and_dedupes() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);

        // Well-formed but nonexistent slug — format checks alone used to let
        // this through, silently breaking the game's pool. Distinct numerics,
        // so the "stored untouched" assertion below actually discriminates
        // (seed defaults are 3/6/15).
        assert!(matches!(
            do_update_peptidovka_settings(
                &conn,
                &teacher,
                UpdatePeptidovkaSettingsPayload {
                    mode: "ucen".into(),
                    min_len: 4,
                    max_len: 8,
                    seconds_per_aa: 20,
                    slugs: vec!["ala".into(), "gly".into(), "nesmysl-123".into()],
                },
            ),
            Err(DbError::Validation(_))
        ));
        let stored_seconds: i64 = conn
            .query_row(
                "SELECT seconds_per_aa FROM peptidovka_settings WHERE mode = 'ucen'",
                [],
                |row| row.get(0),
            )
            .expect("untouched settings");
        assert_eq!(stored_seconds, 15, "a rejected update writes nothing");

        // Duplicates collapse once, in first-seen order.
        do_update_peptidovka_settings(
            &conn,
            &teacher,
            UpdatePeptidovkaSettingsPayload {
                mode: "ucen".into(),
                min_len: 3,
                max_len: 6,
                seconds_per_aa: 15,
                slugs: vec!["ala".into(), "ala".into(), "gly".into()],
            },
        )
        .expect("deduped update");
        let slugs_json: String = conn
            .query_row(
                "SELECT slugs FROM peptidovka_settings WHERE mode = 'ucen'",
                [],
                |row| row.get(0),
            )
            .expect("slugs");
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&slugs_json).expect("slugs json"),
            vec!["ala".to_string(), "gly".to_string()]
        );
    }

    #[test]
    fn teacher_mutations_leave_a_history_trail() {
        let conn = setup_conn();
        let teacher = teacher_id(&conn);

        let data = do_create_molecule(
            &conn,
            &teacher,
            molecule_payload("aminokyseliny", "Histidinium", "C1=C(N)C=NC=1"),
        )
        .expect("create molecule");
        let mapro_name = data
            .molecules
            .iter()
            .find(|m| m.name == "Histidinium")
            .expect("molecule")
            .id;
        do_delete_molecule(
            &conn,
            &teacher,
            DeleteMoleculePayload {
                molecule_id: mapro_name,
                expected_updated_at: None,
            },
        )
        .expect("delete molecule");
        do_reorder_categories(
            &conn,
            &teacher,
            ReorderCategoriesPayload {
                slugs: BiomoleculeRepo::category_order(&conn).expect("categories"),
                expected_order: None,
            },
        )
        .expect("reorder");
        do_update_peptidovka_settings(
            &conn,
            &teacher,
            UpdatePeptidovkaSettingsPayload {
                mode: "ucen".into(),
                min_len: 3,
                max_len: 6,
                seconds_per_aa: 15,
                slugs: vec!["ala".into(), "gly".into()],
            },
        )
        .expect("settings");

        let entries = BiomoleculeHistoryRepo::list_all(&conn, 50, 0).expect("history");
        let actions: Vec<(&str, &str, &str)> = entries
            .iter()
            .map(|e| (e.kind.as_str(), e.action.as_str(), e.label.as_str()))
            .collect();
        assert_eq!(entries.len(), 4);
        assert!(actions.contains(&("molecule", "create", "Histidinium")));
        assert!(actions.contains(&("molecule", "delete", "Histidinium")));
        assert!(actions.contains(&("categories", "reorder", "categories")));
        assert!(actions.contains(&("peptidovka", "settings", "ucen")));
        assert!(
            entries.iter().all(|e| !e.username.is_empty()),
            "every entry carries its actor"
        );
        // Newest first.
        assert_eq!(entries[0].action, "settings");
        assert_eq!(entries[1].action, "reorder");

        BiomoleculeHistoryRepo::clear_all(&conn).expect("clear");
        assert!(
            BiomoleculeHistoryRepo::list_all(&conn, 50, 0)
                .expect("after clear")
                .is_empty()
        );
    }
}
