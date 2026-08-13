use crate::db::repos::{
    CategoryRepo, ConstantRepo, SetRepo, TemplateDecoyRepo, TemplateHistoryRepo, TemplateRepo,
    TopicGroupRepo, TopicRepo, VariableHistoryRepo, VariableRepo,
};
use crate::db::{AppState, DbError};
use crate::models::{
    Category, Constant, ConstraintType, ResultConstraint, Set, Template, TemplateConstant,
    TemplateDecoy, TemplateDecoyInput, TemplateMode, TemplateVariable, Topic, TopicGroup,
    Variable, VariableType,
};
use chrono::Utc;
use serde::Deserialize;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tauri::State;
use uuid::Uuid;

fn record_variable_history(
    conn: &rusqlite::Connection,
    template_id: Uuid,
    old: Option<&Variable>,
    new: &Variable,
) -> Result<(), DbError> {
    if let Some(old) = old {
        if old.name != new.name {
            VariableHistoryRepo::record_change(
                conn,
                &new.id,
                &template_id,
                "name",
                Some(&old.name),
                Some(&new.name),
            )?;
        }
        if old.symbol != new.symbol {
            VariableHistoryRepo::record_change(
                conn,
                &new.id,
                &template_id,
                "symbol",
                Some(&old.symbol),
                Some(&new.symbol),
            )?;
        }
        if old.var_type != new.var_type {
            VariableHistoryRepo::record_change(
                conn,
                &new.id,
                &template_id,
                "var_type",
                Some(&format!("{:?}", old.var_type)),
                Some(&format!("{:?}", new.var_type)),
            )?;
        }
        if old.min_value != new.min_value || old.max_value != new.max_value || old.step != new.step
        {
            VariableHistoryRepo::record_change(
                conn,
                &new.id,
                &template_id,
                "range",
                Some(&format!(
                    "{}..{} step {}",
                    old.min_value, old.max_value, old.step
                )),
                Some(&format!(
                    "{}..{} step {}",
                    new.min_value, new.max_value, new.step
                )),
            )?;
        }
        if old.unit != new.unit {
            VariableHistoryRepo::record_change(
                conn,
                &new.id,
                &template_id,
                "unit",
                if old.unit.is_empty() {
                    None
                } else {
                    Some(&old.unit)
                },
                if new.unit.is_empty() {
                    None
                } else {
                    Some(&new.unit)
                },
            )?;
        }
        if old.precision != new.precision {
            VariableHistoryRepo::record_change(
                conn,
                &new.id,
                &template_id,
                "precision",
                Some(&old.precision.to_string()),
                Some(&new.precision.to_string()),
            )?;
        }
        if old.string_values != new.string_values {
            VariableHistoryRepo::record_change(
                conn,
                &new.id,
                &template_id,
                "string_values",
                Some(&serde_json::to_string(&old.string_values).unwrap_or_default()),
                Some(&serde_json::to_string(&new.string_values).unwrap_or_default()),
            )?;
        }
    } else {
        VariableHistoryRepo::record_change(
            conn,
            &new.id,
            &template_id,
            "created",
            None,
            Some(&new.name),
        )?;
    }
    Ok(())
}

fn record_template_field_history(
    conn: &rusqlite::Connection,
    template_id: Uuid,
    old: &Template,
    new: &Template,
) -> Result<(), DbError> {
    if old.question_text != new.question_text {
        TemplateHistoryRepo::record_change(
            conn,
            &template_id,
            "questionText",
            Some(&old.question_text),
            Some(&new.question_text),
        )?;
    }
    if old.formula != new.formula {
        TemplateHistoryRepo::record_change(
            conn,
            &template_id,
            "formula",
            Some(&old.formula),
            Some(&new.formula),
        )?;
    }
    if old.equation_text != new.equation_text {
        TemplateHistoryRepo::record_change(
            conn,
            &template_id,
            "equationText",
            Some(&old.equation_text),
            Some(&new.equation_text),
        )?;
    }
    if old.numeric_answer != new.numeric_answer {
        TemplateHistoryRepo::record_change(
            conn,
            &template_id,
            "numericAnswer",
            old.numeric_answer.map(|v| v.to_string()).as_deref(),
            new.numeric_answer.map(|v| v.to_string()).as_deref(),
        )?;
    }
    if old.result_unit != new.result_unit {
        TemplateHistoryRepo::record_change(
            conn,
            &template_id,
            "resultUnit",
            Some(&old.result_unit),
            Some(&new.result_unit),
        )?;
    }
    if old.point_value != new.point_value {
        TemplateHistoryRepo::record_change(
            conn,
            &template_id,
            "pointValue",
            Some(&old.point_value.to_string()),
            Some(&new.point_value.to_string()),
        )?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTopicPayload {
    pub name: String,
    #[serde(default)]
    pub for_students: bool,
}

#[tauri::command]
pub fn create_topic(
    state: State<'_, AppState>,
    payload: CreateTopicPayload,
) -> Result<Topic, DbError> {
    let conn = crate::util::lock_db(&state.db);
    let mut topic = Topic::new(payload.name);
    topic.for_students = payload.for_students;
    TopicRepo::insert(&conn, &topic)?;
    Ok(topic)
}

#[tauri::command]
pub fn list_topics(state: State<'_, AppState>) -> Result<Vec<Topic>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    TopicRepo::list_all(&conn)
}

#[tauri::command]
pub fn get_topic(state: State<'_, AppState>, id: Uuid) -> Result<Topic, DbError> {
    let conn = crate::util::lock_db(&state.db);
    TopicRepo::get_by_id(&conn, &id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTopicPayload {
    pub id: Uuid,
    pub name: String,
    pub for_students: bool,
}

#[tauri::command]
pub fn update_topic(
    state: State<'_, AppState>,
    payload: UpdateTopicPayload,
) -> Result<Topic, DbError> {
    let conn = crate::util::lock_db(&state.db);
    // group_id/position are preserved from the existing row — TopicRepo::update
    // never touches them, so the response must reflect their actual persisted
    // values rather than defaulting to "unsorted".
    let existing = TopicRepo::get_by_id(&conn, &payload.id)?;
    let topic = Topic {
        id: payload.id,
        name: payload.name,
        created_at: Utc::now(),
        for_students: payload.for_students,
        group_id: existing.group_id,
        position: existing.position,
    };
    TopicRepo::update(&conn, &topic)?;
    Ok(topic)
}

#[tauri::command]
pub fn delete_topic(state: State<'_, AppState>, id: Uuid) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    TopicRepo::delete(&conn, &id)
}

/// Deep-copy an entire topic — every category, set, template, and each
/// template's own variables, constants links, constraint, and decoys —
/// into a brand new topic. The copy is fully independent: editing it (e.g.
/// narrowing a variable's range) can never change the source topic's
/// behavior, because every variable the source used gets its own new row
/// (never shared with the original — see `clone_variable_if_needed`).
///
/// `templates.topic_id` is NOT used to find the source topic's templates —
/// `TemplateRepo::insert` always writes `Uuid::nil()` there (a pre-existing,
/// unrelated quirk), so the only reliable way to enumerate "which templates
/// belong to this topic" is the same traversal the rest of the app uses:
/// categories (topic_id) -> sets (category_id) -> set_templates -> templates.
#[tauri::command]
pub fn duplicate_topic(state: State<'_, AppState>, id: Uuid) -> Result<Topic, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_duplicate_topic(&conn, &id)
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub(crate) fn do_duplicate_topic(
    conn: &rusqlite::Connection,
    source_topic_id: &Uuid,
) -> Result<Topic, DbError> {
    let tx = conn.unchecked_transaction()?;

    let source_topic = TopicRepo::get_by_id(&tx, source_topic_id)?;
    let mut new_topic = Topic::new(format!("{} (kopie)", source_topic.name));
    new_topic.for_students = source_topic.for_students;
    new_topic.group_id = source_topic.group_id;
    new_topic.position = tx
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM topics WHERE group_id IS ?1",
            rusqlite::params![new_topic.group_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    TopicRepo::insert(&tx, &new_topic)?;

    // Categories + sets: raw structural copy, preserving the source's exact
    // set list (which may exceed the default 4 sets per category).
    let mut set_id_map: HashMap<Uuid, Uuid> = HashMap::new();
    for src_cat in CategoryRepo::list_by_topic(&tx, source_topic_id)? {
        let new_cat = Category::new(new_topic.id, src_cat.point_value);
        CategoryRepo::insert(&tx, &new_cat)?;
        for src_set in CategoryRepo::get_sets_for_category(&tx, &src_cat.id)? {
            let mut new_set = Set::new(new_cat.id, src_set.set_index, src_set.mode);
            new_set.name = src_set.name.clone();
            SetRepo::insert(&tx, &new_set)?;
            set_id_map.insert(src_set.id, new_set.id);
        }
    }

    // Templates: traverse via set_templates (the only reliable way to
    // enumerate this topic's templates, see doc comment above). Memoize per
    // template/variable so anything referenced from multiple sets/templates
    // within this topic is only cloned once.
    let mut template_id_map: HashMap<Uuid, Uuid> = HashMap::new();
    let mut variable_id_map: HashMap<Uuid, Uuid> = HashMap::new();

    for (&old_set_id, &new_set_id) in &set_id_map {
        for link in SetRepo::list_templates(&tx, &old_set_id)? {
            let new_template_id = match template_id_map.get(&link.template_id) {
                Some(id) => *id,
                None => {
                    let new_id = clone_template(&tx, &link.template_id, &mut variable_id_map)?;
                    template_id_map.insert(link.template_id, new_id);
                    new_id
                }
            };
            SetRepo::insert_link(&tx, &new_set_id, &new_template_id, link.sort_order)?;
        }
    }

    tx.commit()?;
    Ok(new_topic)
}

/// Deep-clones one template: its own row, an independent copy of every
/// variable it uses (memoized in `variable_id_map` across the whole
/// duplicate-topic operation — variables shared between templates in the
/// source topic stay shared in the copy, just never shared with the
/// originals), the SAME constant links (constants are global reference
/// data, not per-topic), its result constraint, and its decoys. Returns the
/// new template's id.
fn clone_template(
    tx: &rusqlite::Transaction,
    old_template_id: &Uuid,
    variable_id_map: &mut HashMap<Uuid, Uuid>,
) -> Result<Uuid, DbError> {
    let src = TemplateRepo::get_by_id(tx, old_template_id)?;
    let mut new_template = Template::new(
        unique_question_text(tx, &src.question_text)?,
        src.formula.clone(),
        src.equation_text.clone(),
        src.numeric_answer,
        src.result_unit.clone(),
        src.point_value,
    );
    new_template.significant_digits = src.significant_digits;
    new_template.force_scientific = src.force_scientific;
    new_template.decoy_formula = src.decoy_formula.clone();

    let old_links = TemplateRepo::get_variables(tx, old_template_id)?;
    for link in &old_links {
        clone_variable_if_needed(tx, &link.variable_id, variable_id_map)?;
        if let Some(gid) = link.greater_than_variable_id {
            clone_variable_if_needed(tx, &gid, variable_id_map)?;
        }
        if let Some(lid) = link.less_than_variable_id {
            clone_variable_if_needed(tx, &lid, variable_id_map)?;
        }
    }
    let new_links: Vec<TemplateVariable> = old_links
        .iter()
        .map(|l| TemplateVariable {
            template_id: new_template.id,
            variable_id: variable_id_map[&l.variable_id],
            placeholder: l.placeholder.clone(),
            greater_than_variable_id: l.greater_than_variable_id.map(|g| variable_id_map[&g]),
            less_than_variable_id: l.less_than_variable_id.map(|le| variable_id_map[&le]),
        })
        .collect();

    let new_constants: Vec<TemplateConstant> = TemplateRepo::get_constants(tx, old_template_id)?
        .into_iter()
        .map(|c| TemplateConstant {
            template_id: new_template.id,
            constant_id: c.constant_id,
        })
        .collect();

    let new_constraint = TemplateRepo::get_constraint(tx, old_template_id)?.map(|c| {
        ResultConstraint::new(
            new_template.id,
            c.min_result,
            c.max_result,
            c.sd_allowed,
            c.constraint_type,
        )
    });

    let decoy_inputs: Vec<TemplateDecoyInput> =
        TemplateDecoyRepo::list_by_template(tx, old_template_id)?
            .into_iter()
            .map(|d| TemplateDecoyInput {
                formula: d.formula,
                option_count: d.option_count,
            })
            .collect();

    TemplateRepo::insert_in_tx(
        tx,
        &new_template,
        &new_links,
        &new_constants,
        new_constraint.as_ref(),
        &decoy_inputs,
    )?;
    Ok(new_template.id)
}

/// `templates.question_text` is globally unique (trimmed) across the whole
/// app (`idx_templates_unique_question_text`) — cloning a template verbatim
/// would collide with its own source row. Appends " (kopie)", then
/// " (kopie 2)", " (kopie 3)", ... until a free question text is found.
fn unique_question_text(tx: &rusqlite::Transaction, base: &str) -> Result<String, DbError> {
    let trimmed = base.trim();
    let mut candidate = format!("{trimmed} (kopie)");
    let mut suffix = 2;
    loop {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM templates WHERE TRIM(question_text) = ?1)",
            rusqlite::params![candidate.trim()],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(candidate);
        }
        candidate = format!("{trimmed} (kopie {suffix})");
        suffix += 1;
    }
}

/// Clones a variable the first time it's seen in a duplicate-topic
/// operation; a repeat request for the same `old_id` is a no-op (the
/// mapping is already there), so templates that shared one variable in the
/// source topic still share one (new) variable in the copy.
fn clone_variable_if_needed(
    tx: &rusqlite::Transaction,
    old_id: &Uuid,
    variable_id_map: &mut HashMap<Uuid, Uuid>,
) -> Result<(), DbError> {
    if variable_id_map.contains_key(old_id) {
        return Ok(());
    }
    let mut new_var = VariableRepo::get_by_id(tx, old_id)?;
    new_var.id = Uuid::new_v4();
    new_var.created_at = Utc::now();
    VariableRepo::insert_raw(tx, &new_var)?;
    variable_id_map.insert(*old_id, new_var.id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Topic groups ("Skupiny") — organize topics on the topics list page.
// Deliberately unrelated to Category ("Kategorie"), the fixed 2/3/4-point
// bucket nested under a topic.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTopicGroupPayload {
    pub name: String,
}

#[tauri::command]
pub fn create_topic_group(
    state: State<'_, AppState>,
    payload: CreateTopicGroupPayload,
) -> Result<TopicGroup, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_create_topic_group(&conn, payload)
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub(crate) fn do_create_topic_group(
    conn: &rusqlite::Connection,
    payload: CreateTopicGroupPayload,
) -> Result<TopicGroup, DbError> {
    let next_position: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM topic_groups",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let mut group = TopicGroup::new(payload.name);
    group.position = next_position;
    TopicGroupRepo::insert(conn, &group)?;
    Ok(group)
}

#[tauri::command]
pub fn list_topic_groups(state: State<'_, AppState>) -> Result<Vec<TopicGroup>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    TopicGroupRepo::list_all(&conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTopicGroupPayload {
    pub id: Uuid,
    pub name: String,
}

#[tauri::command]
pub fn rename_topic_group(
    state: State<'_, AppState>,
    payload: RenameTopicGroupPayload,
) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    TopicGroupRepo::rename(&conn, &payload.id, &payload.name)
}

#[tauri::command]
pub fn delete_topic_group(state: State<'_, AppState>, id: Uuid) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    TopicGroupRepo::delete(&conn, &id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderTopicGroupsPayload {
    pub group_ids: Vec<Uuid>,
}

#[tauri::command]
pub fn reorder_topic_groups(
    state: State<'_, AppState>,
    payload: ReorderTopicGroupsPayload,
) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    TopicGroupRepo::reorder(&conn, &payload.group_ids)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveTopicToGroupPayload {
    pub topic_id: Uuid,
    pub group_id: Option<Uuid>,
}

#[tauri::command]
pub fn move_topic_to_group(
    state: State<'_, AppState>,
    payload: MoveTopicToGroupPayload,
) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    TopicRepo::move_to_group(&conn, &payload.topic_id, payload.group_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderTopicsInGroupPayload {
    pub topic_ids: Vec<Uuid>,
}

#[tauri::command]
pub fn reorder_topics_in_group(
    state: State<'_, AppState>,
    payload: ReorderTopicsInGroupPayload,
) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    TopicRepo::reorder_within_group(&conn, &payload.topic_ids)
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVariablePayload {
    pub name: String,
    pub symbol: String,
    pub var_type: VariableType,
    pub min_value: f64,
    pub max_value: f64,
    pub step: f64,
    pub unit: String,
    pub precision: u8,
    pub string_values: Option<Vec<String>>,
    pub paired_constants: Option<Vec<std::collections::HashMap<String, f64>>>,
    #[serde(default)]
    pub significant_digits: Option<u8>,
}

#[tauri::command]
pub fn create_variable(
    state: State<'_, AppState>,
    payload: CreateVariablePayload,
) -> Result<Variable, DbError> {
    let conn = crate::util::lock_db(&state.db);
    let variable = match payload.var_type {
        VariableType::String => {
            let mut v = Variable::new_string(
                payload.name,
                payload.symbol,
                payload.string_values.unwrap_or_default(),
            );
            v.paired_constants = payload.paired_constants;
            v.significant_digits = payload.significant_digits;
            v
        }
        VariableType::Numeric => {
            let mut v = Variable::new(
                payload.name,
                payload.symbol,
                payload.min_value,
                payload.max_value,
                payload.step,
                payload.unit,
                payload.precision,
            );
            v.significant_digits = payload.significant_digits;
            v
        }
    };
    VariableRepo::insert(&conn, &variable)?;
    Ok(variable)
}

#[tauri::command]
pub fn list_variables(state: State<'_, AppState>) -> Result<Vec<Variable>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    VariableRepo::list_all(&conn)
}

#[tauri::command]
pub fn get_variable(state: State<'_, AppState>, id: Uuid) -> Result<Variable, DbError> {
    let conn = crate::util::lock_db(&state.db);
    VariableRepo::get_by_id(&conn, &id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVariablePayload {
    pub id: Uuid,
    pub name: String,
    pub symbol: String,
    pub var_type: VariableType,
    pub min_value: f64,
    pub max_value: f64,
    pub step: f64,
    pub unit: String,
    pub precision: u8,
    pub string_values: Option<Vec<String>>,
    pub paired_constants: Option<Vec<std::collections::HashMap<String, f64>>>,
    #[serde(default)]
    pub significant_digits: Option<u8>,
}

#[tauri::command]
pub fn update_variable(
    state: State<'_, AppState>,
    payload: UpdateVariablePayload,
) -> Result<Variable, DbError> {
    let conn = crate::util::lock_db(&state.db);
    let variable = Variable {
        id: payload.id,
        name: payload.name,
        symbol: payload.symbol,
        var_type: payload.var_type,
        min_value: payload.min_value,
        max_value: payload.max_value,
        step: payload.step,
        unit: payload.unit,
        precision: payload.precision,
        string_values: payload.string_values,
        paired_constants: payload.paired_constants,
        greater_than: None,
        less_than: None,
        significant_digits: payload.significant_digits,
        created_at: Utc::now(),
    };
    VariableRepo::update(&conn, &variable)?;
    Ok(variable)
}

#[tauri::command]
pub fn delete_variable(state: State<'_, AppState>, id: Uuid) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    VariableRepo::delete(&conn, &id)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConstantPayload {
    pub name: String,
    pub symbol: String,
    pub value: f64,
    pub unit: String,
    pub is_builtin: bool,
    pub formula: Option<String>,
}

#[tauri::command]
pub fn create_constant(
    state: State<'_, AppState>,
    payload: CreateConstantPayload,
) -> Result<Constant, DbError> {
    let conn = crate::util::lock_db(&state.db);
    let mut constant = Constant::new(
        payload.name,
        payload.symbol,
        payload.value,
        payload.unit,
        payload.is_builtin,
    );
    constant.formula = payload.formula;
    ConstantRepo::insert(&conn, &constant)?;
    Ok(constant)
}

#[tauri::command]
pub fn list_constants(state: State<'_, AppState>) -> Result<Vec<Constant>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    ConstantRepo::list_all(&conn)
}

#[tauri::command]
pub fn get_constant(state: State<'_, AppState>, id: Uuid) -> Result<Constant, DbError> {
    let conn = crate::util::lock_db(&state.db);
    ConstantRepo::get_by_id(&conn, &id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConstantPayload {
    pub id: Uuid,
    pub name: String,
    pub symbol: String,
    pub value: f64,
    pub unit: String,
    pub formula: Option<String>,
}

#[tauri::command]
pub fn update_constant(
    state: State<'_, AppState>,
    payload: UpdateConstantPayload,
) -> Result<Constant, DbError> {
    let conn = crate::util::lock_db(&state.db);
    // Preserve the existing built-in flag so the frontend cannot change it.
    let existing = ConstantRepo::get_by_id(&conn, &payload.id)?;
    let constant = Constant {
        id: payload.id,
        name: payload.name,
        symbol: payload.symbol,
        value: payload.value,
        unit: payload.unit,
        is_builtin: existing.is_builtin,
        formula: payload.formula,
        created_at: Utc::now(),
    };
    ConstantRepo::update(&conn, &constant)?;
    Ok(constant)
}

#[tauri::command]
pub fn delete_constant(state: State<'_, AppState>, id: Uuid) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    ConstantRepo::delete(&conn, &id)
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVariableInput {
    pub variable_id: Uuid,
    pub placeholder: String,
    pub greater_than_variable_id: Option<Uuid>,
    pub less_than_variable_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateConstantInput {
    pub constant_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintInput {
    pub min_result: Option<f64>,
    pub max_result: Option<f64>,
    pub sd_allowed: Option<f64>,
    pub constraint_type: ConstraintType,
}

// `rename_all = "camelCase"` at the container level does not reliably reach
// multi-word field names inside variants of an internally-tagged enum
// (`tag = "action"`) — serde re-derives each variant from a buffered
// `Content` after reading the tag, and that path silently drops fields whose
// camelCase name came only from `rename_all` rather than an explicit
// per-field `#[serde(rename = ...)]`. Verified: with only `rename_all`,
// `greaterThanVariableId`/`lessThanVariableId` deserialized to `None` even
// when present in the JSON — explicit renames on every field fix it.
#[derive(Debug, Deserialize)]
#[serde(tag = "action")]
pub enum VariableMutation {
    #[serde(rename = "keep")]
    Keep {
        #[serde(rename = "variableId")]
        variable_id: Uuid,
        placeholder: String,
        #[serde(rename = "greaterThanVariableId")]
        greater_than_variable_id: Option<Uuid>,
        #[serde(rename = "lessThanVariableId")]
        less_than_variable_id: Option<Uuid>,
    },
    #[serde(rename = "create")]
    Create {
        placeholder: String,
        #[serde(rename = "greaterThanVariableId")]
        greater_than_variable_id: Option<Uuid>,
        #[serde(rename = "lessThanVariableId")]
        less_than_variable_id: Option<Uuid>,
        variable: CreateVariablePayload,
    },
    #[serde(rename = "update")]
    Update {
        #[serde(rename = "variableId")]
        variable_id: Uuid,
        placeholder: String,
        #[serde(rename = "greaterThanVariableId")]
        greater_than_variable_id: Option<Uuid>,
        #[serde(rename = "lessThanVariableId")]
        less_than_variable_id: Option<Uuid>,
        variable: CreateVariablePayload,
    },
    #[serde(rename = "clone")]
    Clone {
        #[serde(rename = "oldVariableId")]
        old_variable_id: Uuid,
        placeholder: String,
        #[serde(rename = "greaterThanVariableId")]
        greater_than_variable_id: Option<Uuid>,
        #[serde(rename = "lessThanVariableId")]
        less_than_variable_id: Option<Uuid>,
        variable: CreateVariablePayload,
    },
    #[serde(rename = "remove")]
    Remove {
        #[serde(rename = "variableId")]
        variable_id: Uuid,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTemplateWithVariablesPayload {
    pub id: Uuid,
    pub question_text: String,
    pub formula: String,
    pub equation_text: String,
    pub numeric_answer: Option<f64>,
    pub result_unit: String,
    pub point_value: u8,
    pub significant_digits: Option<u8>,
    #[serde(default)]
    pub force_scientific: bool,
    #[serde(default)]
    pub decoys: Vec<TemplateDecoyInput>,
    pub variable_mutations: Vec<VariableMutation>,
    pub constants: Vec<TemplateConstantInput>,
    pub constraint: Option<ConstraintInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTemplatePayload {
    pub question_text: String,
    pub formula: String,
    pub equation_text: String,
    pub numeric_answer: Option<f64>,
    pub result_unit: String,
    pub point_value: u8,
    pub significant_digits: Option<u8>,
    #[serde(default)]
    pub force_scientific: bool,
    #[serde(default)]
    pub decoys: Vec<TemplateDecoyInput>,
    pub variables: Vec<TemplateVariableInput>,
    pub constants: Vec<TemplateConstantInput>,
    pub constraint: Option<ConstraintInput>,
}

fn build_template_variables(
    template_id: Uuid,
    inputs: &[TemplateVariableInput],
) -> Vec<TemplateVariable> {
    inputs
        .iter()
        .map(|input| TemplateVariable {
            template_id,
            variable_id: input.variable_id,
            placeholder: input.placeholder.clone(),
            greater_than_variable_id: input.greater_than_variable_id,
            less_than_variable_id: input.less_than_variable_id,
        })
        .collect()
}

fn build_template_constants(
    template_id: Uuid,
    inputs: &[TemplateConstantInput],
) -> Vec<TemplateConstant> {
    inputs
        .iter()
        .map(|input| TemplateConstant {
            template_id,
            constant_id: input.constant_id,
        })
        .collect()
}

pub(crate) fn build_variable_from_payload(payload: CreateVariablePayload) -> Variable {
    match payload.var_type {
        VariableType::String => {
            let mut v = Variable::new_string(
                payload.name,
                payload.symbol,
                payload.string_values.unwrap_or_default(),
            );
            v.paired_constants = payload.paired_constants;
            v
        }
        VariableType::Numeric => Variable::new(
            payload.name,
            payload.symbol,
            payload.min_value,
            payload.max_value,
            payload.step,
            payload.unit,
            payload.precision,
        ),
    }
}

fn build_constraint(template_id: Uuid, input: Option<ConstraintInput>) -> Option<ResultConstraint> {
    input.map(|c| {
        ResultConstraint::new(
            template_id,
            c.min_result,
            c.max_result,
            c.sd_allowed,
            c.constraint_type,
        )
    })
}

#[tauri::command]
pub fn create_template(
    state: State<'_, AppState>,
    payload: CreateTemplatePayload,
) -> Result<Template, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_create_template(&conn, payload)
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub(crate) fn do_create_template(
    conn: &rusqlite::Connection,
    payload: CreateTemplatePayload,
) -> Result<Template, DbError> {
    if TemplateRepo::find_by_question_and_equation(
        conn,
        payload.question_text.trim(),
        payload.equation_text.trim(),
    )?
    .is_some()
    {
        return Err(DbError::Validation(
            "Otázka se stejným zněním a vzorcem již existuje.".into(),
        ));
    }
    let mut template = Template::new(
        payload.question_text,
        payload.formula,
        payload.equation_text,
        payload.numeric_answer,
        payload.result_unit,
        payload.point_value,
    );
    template.significant_digits = payload.significant_digits;
    template.force_scientific = payload.force_scientific;
    let variables = build_template_variables(template.id, &payload.variables);
    let constants = build_template_constants(template.id, &payload.constants);
    let constraint = build_constraint(template.id, payload.constraint);
    TemplateRepo::insert(
        conn,
        &template,
        &variables,
        &constants,
        constraint.as_ref(),
        &payload.decoys,
    )?;
    Ok(template)
}

#[tauri::command]
pub fn list_templates(state: State<'_, AppState>) -> Result<Vec<Template>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    TemplateRepo::list_all(&conn)
}

#[tauri::command]
pub fn get_template(state: State<'_, AppState>, id: Uuid) -> Result<Template, DbError> {
    let conn = crate::util::lock_db(&state.db);
    TemplateRepo::get_by_id(&conn, &id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateWithDetails {
    pub template: Template,
    pub variables: Vec<VariableWithPlaceholder>,
    pub constants: Vec<Constant>,
    pub constraint: Option<ResultConstraint>,
    pub decoys: Vec<TemplateDecoy>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableWithPlaceholder {
    pub variable: Variable,
    pub placeholder: String,
    pub is_shared: bool,
    pub greater_than_variable_id: Option<Uuid>,
    pub less_than_variable_id: Option<Uuid>,
}

/// `pub(crate)` (not private) so the HTTP layer (`src/http`) can reuse it
/// without going through Tauri's `State<'_, AppState>`.
pub(crate) fn load_template_with_details(
    conn: &rusqlite::Connection,
    id: &Uuid,
) -> Result<TemplateWithDetails, DbError> {
    let template = TemplateRepo::get_by_id(conn, id)?;
    let template_variables = TemplateRepo::get_variables(conn, id)?;
    let template_constants = TemplateRepo::get_constants(conn, id)?;
    let constraint = TemplateRepo::get_constraint(conn, id)?;
    let decoys = TemplateDecoyRepo::list_by_template(conn, id)?;

    let variables = template_variables
        .into_iter()
        .map(|tv| {
            let variable = VariableRepo::get_by_id(conn, &tv.variable_id)?;
            let usage_count = VariableRepo::count_usage(conn, &variable.id)?;
            Ok(VariableWithPlaceholder {
                variable,
                placeholder: tv.placeholder,
                is_shared: usage_count > 1,
                greater_than_variable_id: tv.greater_than_variable_id,
                less_than_variable_id: tv.less_than_variable_id,
            })
        })
        .collect::<Result<Vec<_>, DbError>>()?;

    let constants = template_constants
        .into_iter()
        .map(|tc| ConstantRepo::get_by_id(conn, &tc.constant_id))
        .collect::<Result<Vec<_>, DbError>>()?;

    Ok(TemplateWithDetails {
        template,
        variables,
        constants,
        constraint,
        decoys,
    })
}

#[tauri::command]
pub fn get_template_with_details(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<TemplateWithDetails, DbError> {
    let conn = crate::util::lock_db(&state.db);
    load_template_with_details(&conn, &id)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateLocation {
    pub set_id: Uuid,
    pub category_id: Uuid,
    pub topic_id: Uuid,
}

#[tauri::command]
pub fn get_template_location(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<Option<TemplateLocation>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_get_template_location(&conn, &id)
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub(crate) fn do_get_template_location(
    conn: &rusqlite::Connection,
    id: &Uuid,
) -> Result<Option<TemplateLocation>, DbError> {
    if let Some((set_id, category_id)) = SetRepo::find_by_template_id(conn, id)? {
        let category = CategoryRepo::get_by_id(conn, &category_id)?;
        Ok(Some(TemplateLocation {
            set_id,
            category_id,
            topic_id: category.topic_id,
        }))
    } else {
        Ok(None)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTemplatePayload {
    pub id: Uuid,
    pub question_text: String,
    pub formula: String,
    pub equation_text: String,
    pub numeric_answer: Option<f64>,
    pub result_unit: String,
    pub point_value: u8,
    pub significant_digits: Option<u8>,
    #[serde(default)]
    pub force_scientific: bool,
    #[serde(default)]
    pub decoys: Vec<TemplateDecoyInput>,
    pub variables: Vec<TemplateVariableInput>,
    pub constants: Vec<TemplateConstantInput>,
    pub constraint: Option<ConstraintInput>,
}

#[tauri::command]
pub fn update_template(
    state: State<'_, AppState>,
    payload: UpdateTemplatePayload,
) -> Result<Template, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_update_template(&conn, payload)
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub(crate) fn do_update_template(
    conn: &rusqlite::Connection,
    payload: UpdateTemplatePayload,
) -> Result<Template, DbError> {
    if let Some(existing) = TemplateRepo::find_by_question_and_equation(
        conn,
        payload.question_text.trim(),
        payload.equation_text.trim(),
    )? {
        if existing.id != payload.id {
            return Err(DbError::Validation(
                "Otázka se stejným zněním a vzorcem již existuje.".into(),
            ));
        }
    }
    let template = Template {
        id: payload.id,
        question_text: payload.question_text,
        formula: payload.formula,
        equation_text: payload.equation_text,
        numeric_answer: payload.numeric_answer,
        result_unit: payload.result_unit,
        point_value: payload.point_value,
        significant_digits: payload.significant_digits,
        force_scientific: payload.force_scientific,
        decoy_formula: None,
        created_at: Utc::now(),
    };

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE templates SET question_text=?2, formula=?3, equation_text=?4, numeric_answer=?5, result_unit=?6, point_value=?7, significant_digits=?8, force_scientific=?9, created_at=?10 WHERE id=?1",
        rusqlite::params![
            template.id,
            template.question_text,
            template.formula,
            template.equation_text,
            template.numeric_answer,
            template.result_unit,
            template.point_value,
            template.significant_digits,
            template.force_scientific,
            template.created_at.to_rfc3339(),
        ],
    )?;

    TemplateDecoyRepo::replace_for_template(&tx, &template.id, &payload.decoys)?;

    tx.execute(
        "DELETE FROM template_variables WHERE template_id = ?1",
        rusqlite::params![template.id],
    )?;
    tx.execute(
        "DELETE FROM template_constants WHERE template_id = ?1",
        rusqlite::params![template.id],
    )?;
    tx.execute(
        "DELETE FROM result_constraints WHERE template_id = ?1",
        rusqlite::params![template.id],
    )?;

    let variables = build_template_variables(template.id, &payload.variables);
    let constants = build_template_constants(template.id, &payload.constants);
    let constraint = build_constraint(template.id, payload.constraint);

    for tv in &variables {
        tx.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![tv.template_id, tv.variable_id, tv.placeholder],
        )?;
    }
    for tc in &constants {
        tx.execute(
            "INSERT INTO template_constants (template_id, constant_id) VALUES (?1, ?2)",
            rusqlite::params![tc.template_id, tc.constant_id],
        )?;
    }
    if let Some(rc) = &constraint {
        tx.execute(
            "INSERT INTO result_constraints (id, template_id, min_result, max_result, sd_allowed, constraint_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![rc.id, rc.template_id, rc.min_result, rc.max_result, rc.sd_allowed, serde_constraint_type(rc.constraint_type)],
        )?;
    }

    tx.commit()?;
    Ok(template)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTemplatesByEquationPayload {
    pub old_equation_text: String,
    pub new_formula: String,
    pub new_equation_text: String,
    pub new_result_unit: String,
}

#[tauri::command]
pub fn update_templates_by_equation(
    state: State<'_, AppState>,
    payload: UpdateTemplatesByEquationPayload,
) -> Result<usize, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_update_templates_by_equation(&conn, payload)
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub(crate) fn do_update_templates_by_equation(
    conn: &rusqlite::Connection,
    payload: UpdateTemplatesByEquationPayload,
) -> Result<usize, DbError> {
    let old_templates = TemplateRepo::find_by_equation_text(conn, &payload.old_equation_text)?;
    let affected_ids = TemplateRepo::update_by_equation_text(
        conn,
        &payload.old_equation_text,
        &payload.new_formula,
        &payload.new_equation_text,
        &payload.new_result_unit,
    )?;

    for old_template in &old_templates {
        if old_template.formula != payload.new_formula {
            TemplateHistoryRepo::record_change(
                conn,
                &old_template.id,
                "formula",
                Some(&old_template.formula),
                Some(&payload.new_formula),
            )?;
        }
        if old_template.equation_text != payload.new_equation_text {
            TemplateHistoryRepo::record_change(
                conn,
                &old_template.id,
                "equationText",
                Some(&old_template.equation_text),
                Some(&payload.new_equation_text),
            )?;
        }
        if old_template.result_unit != payload.new_result_unit {
            TemplateHistoryRepo::record_change(
                conn,
                &old_template.id,
                "resultUnit",
                Some(&old_template.result_unit),
                Some(&payload.new_result_unit),
            )?;
        }
    }

    Ok(affected_ids.len())
}

fn extract_placeholders(text: &str) -> Vec<String> {
    let mut placeholders = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' && chars.peek() == Some(&'[') {
            chars.next();
            let mut name = String::new();
            while let Some(&ch) = chars.peek() {
                if ch == ']' {
                    break;
                }
                name.push(ch);
                chars.next();
            }
            if chars.peek() == Some(&']') {
                chars.next();
                if chars.peek() == Some(&']') {
                    chars.next();
                    if !name.is_empty()
                        && name.chars().all(|ch| ch.is_alphanumeric() || ch == '_')
                        && !placeholders.contains(&name)
                    {
                        placeholders.push(name);
                    }
                }
            }
        }
    }
    placeholders
}

pub fn apply_template_variable_mutations(
    conn: &rusqlite::Connection,
    payload: UpdateTemplateWithVariablesPayload,
) -> Result<Template, DbError> {
    let tx = conn.unchecked_transaction()?;

    let old_template = TemplateRepo::get_by_id(&tx, &payload.id)?;

    let mut template = Template {
        id: payload.id,
        question_text: payload.question_text.clone(),
        formula: payload.formula.clone(),
        equation_text: payload.equation_text.clone(),
        numeric_answer: payload.numeric_answer,
        result_unit: payload.result_unit.clone(),
        point_value: payload.point_value,
        significant_digits: payload.significant_digits,
        force_scientific: payload.force_scientific,
        decoy_formula: None,
        created_at: Utc::now(),
    };

    tx.execute(
        "UPDATE templates SET question_text=?2, formula=?3, equation_text=?4, numeric_answer=?5, result_unit=?6, point_value=?7, significant_digits=?8, force_scientific=?9, created_at=?10 WHERE id=?1",
        rusqlite::params![
            template.id,
            template.question_text,
            template.formula,
            template.equation_text,
            template.numeric_answer,
            template.result_unit,
            template.point_value,
            template.significant_digits,
            template.force_scientific,
            template.created_at.to_rfc3339(),
        ],
    )?;

    TemplateDecoyRepo::replace_for_template(&tx, &payload.id, &payload.decoys)?;

    let old_links = TemplateRepo::get_variables(&tx, &payload.id)?;
    let mut new_links: Vec<TemplateVariable> = Vec::new();
    let mut final_question_text = payload.question_text.clone();

    for mutation in payload.variable_mutations {
        match mutation {
            VariableMutation::Keep {
                variable_id,
                placeholder,
                greater_than_variable_id,
                less_than_variable_id,
            } => {
                new_links.push(TemplateVariable {
                    template_id: payload.id,
                    variable_id,
                    placeholder,
                    greater_than_variable_id,
                    less_than_variable_id,
                });
            }
            VariableMutation::Create {
                placeholder,
                greater_than_variable_id,
                less_than_variable_id,
                variable,
            } => {
                let new_var = build_variable_from_payload(variable);
                VariableRepo::insert(&tx, &new_var)?;
                record_variable_history(&tx, payload.id, None, &new_var)?;
                new_links.push(TemplateVariable {
                    template_id: payload.id,
                    variable_id: new_var.id,
                    placeholder,
                    greater_than_variable_id,
                    less_than_variable_id,
                });
            }
            VariableMutation::Update {
                variable_id,
                placeholder,
                greater_than_variable_id,
                less_than_variable_id,
                variable,
            } => {
                let old_placeholder = old_links
                    .iter()
                    .find(|l| l.variable_id == variable_id)
                    .map(|l| l.placeholder.clone())
                    .unwrap_or_else(|| placeholder.clone());
                if old_placeholder != placeholder {
                    final_question_text = final_question_text.replace(
                        &format!("[[{}]]", old_placeholder),
                        &format!("[[{}]]", placeholder),
                    );
                }

                let old_var = VariableRepo::get_by_id(&tx, &variable_id)?;
                let updated = Variable {
                    id: variable_id,
                    name: variable.name,
                    symbol: variable.symbol,
                    var_type: variable.var_type.clone(),
                    min_value: variable.min_value,
                    max_value: variable.max_value,
                    step: variable.step,
                    unit: variable.unit,
                    precision: variable.precision,
                    string_values: variable.string_values.clone(),
                    paired_constants: variable.paired_constants.clone(),
                    greater_than: None,
                    less_than: None,
                    significant_digits: variable.significant_digits,
                    created_at: Utc::now(),
                };
                VariableRepo::update(&tx, &updated)?;
                record_variable_history(&tx, payload.id, Some(&old_var), &updated)?;
                new_links.push(TemplateVariable {
                    template_id: payload.id,
                    variable_id,
                    placeholder,
                    greater_than_variable_id,
                    less_than_variable_id,
                });
            }
            VariableMutation::Clone {
                old_variable_id,
                placeholder,
                greater_than_variable_id,
                less_than_variable_id,
                variable,
            } => {
                let old_placeholder = old_links
                    .iter()
                    .find(|l| l.variable_id == old_variable_id)
                    .map(|l| l.placeholder.clone())
                    .unwrap_or_else(|| placeholder.clone());
                if old_placeholder != placeholder {
                    final_question_text = final_question_text.replace(
                        &format!("[[{}]]", old_placeholder),
                        &format!("[[{}]]", placeholder),
                    );
                }

                let new_var = build_variable_from_payload(variable);
                VariableRepo::insert(&tx, &new_var)?;
                record_variable_history(&tx, payload.id, None, &new_var)?;
                new_links.push(TemplateVariable {
                    template_id: payload.id,
                    variable_id: new_var.id,
                    placeholder,
                    greater_than_variable_id,
                    less_than_variable_id,
                });
            }
            VariableMutation::Remove { variable_id } => {
                let _ = variable_id;
            }
        }
    }

    if final_question_text != payload.question_text {
        tx.execute(
            "UPDATE templates SET question_text=?2 WHERE id=?1",
            rusqlite::params![template.id, final_question_text],
        )?;
        template.question_text = final_question_text;
    }

    tx.execute(
        "DELETE FROM template_variables WHERE template_id = ?1",
        rusqlite::params![template.id],
    )?;
    tx.execute(
        "DELETE FROM template_constants WHERE template_id = ?1",
        rusqlite::params![template.id],
    )?;
    tx.execute(
        "DELETE FROM result_constraints WHERE template_id = ?1",
        rusqlite::params![template.id],
    )?;

    for tv in &new_links {
        tx.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![tv.template_id, tv.variable_id, tv.placeholder, tv.greater_than_variable_id, tv.less_than_variable_id],
        )?;
    }

    // Reconcile placeholders in the final question text with linked variables:
    // create default variables for newly typed placeholders and drop links for
    // placeholders that are no longer present.
    let placeholders_in_text: HashSet<String> = extract_placeholders(&template.question_text)
        .into_iter()
        .collect();
    let linked_placeholders: HashSet<String> =
        new_links.iter().map(|tv| tv.placeholder.clone()).collect();
    for placeholder in &placeholders_in_text {
        if linked_placeholders.contains(placeholder) {
            continue;
        }
        let new_var = Variable::new(
            format!("Proměnná {}", placeholder),
            placeholder.clone(),
            0.0,
            100.0,
            1.0,
            "g".to_string(),
            1,
        );
        VariableRepo::insert(&tx, &new_var)?;
        record_variable_history(&tx, payload.id, None, &new_var)?;
        tx.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![payload.id, new_var.id, placeholder, Option::<Uuid>::None, Option::<Uuid>::None],
        )?;
    }
    for placeholder in linked_placeholders.difference(&placeholders_in_text) {
        tx.execute(
            "DELETE FROM template_variables WHERE template_id = ?1 AND placeholder = ?2",
            rusqlite::params![payload.id, placeholder],
        )?;
    }

    let constants = build_template_constants(template.id, &payload.constants);
    for tc in &constants {
        tx.execute(
            "INSERT INTO template_constants (template_id, constant_id) VALUES (?1, ?2)",
            rusqlite::params![tc.template_id, tc.constant_id],
        )?;
    }

    let constraint = build_constraint(template.id, payload.constraint);
    if let Some(rc) = &constraint {
        tx.execute(
            "INSERT INTO result_constraints (id, template_id, min_result, max_result, sd_allowed, constraint_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![rc.id, rc.template_id, rc.min_result, rc.max_result, rc.sd_allowed, serde_constraint_type(rc.constraint_type)],
        )?;
    }

    for old_link in old_links {
        let still_used = new_links
            .iter()
            .any(|l| l.variable_id == old_link.variable_id);
        if !still_used {
            VariableRepo::delete_if_unused(&tx, &old_link.variable_id)?;
        }
    }

    record_template_field_history(&tx, payload.id, &old_template, &template)?;

    tx.commit()?;
    Ok(template)
}

#[tauri::command]
pub fn update_template_with_variables(
    state: State<'_, AppState>,
    payload: UpdateTemplateWithVariablesPayload,
) -> Result<TemplateWithDetails, DbError> {
    let id = payload.id;
    let conn = crate::util::lock_db(&state.db);
    apply_template_variable_mutations(&conn, payload)?;
    drop(conn);

    get_template_with_details(state, id)
}

#[tauri::command]
pub fn delete_template(state: State<'_, AppState>, id: Uuid) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    TemplateRepo::delete(&conn, &id)
}

#[tauri::command]
pub fn list_variable_history_by_template(
    state: State<'_, AppState>,
    template_id: Uuid,
    limit: u32,
    offset: u32,
) -> Result<Vec<crate::models::VariableHistoryEntry>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    VariableHistoryRepo::list_by_template(&conn, &template_id, limit, offset)
}

#[tauri::command]
pub fn list_all_variable_history(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
) -> Result<Vec<crate::models::VariableHistoryEntry>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    VariableHistoryRepo::list_all(&conn, limit, offset)
}

#[tauri::command]
pub fn list_template_history_by_template(
    state: State<'_, AppState>,
    template_id: Uuid,
    limit: u32,
    offset: u32,
) -> Result<Vec<crate::models::TemplateHistoryEntry>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    TemplateHistoryRepo::list_by_template(&conn, &template_id, limit, offset)
}

#[tauri::command]
pub fn list_all_template_history(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
) -> Result<Vec<crate::models::TemplateHistoryEntry>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    TemplateHistoryRepo::list_all(&conn, limit, offset)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearTemplateHistoryPayload {
    pub template_id: Uuid,
}

#[tauri::command]
pub fn clear_template_history(
    state: State<'_, AppState>,
    payload: ClearTemplateHistoryPayload,
) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    VariableHistoryRepo::delete_for_template(&conn, &payload.template_id)?;
    TemplateHistoryRepo::delete_for_template(&conn, &payload.template_id)?;
    Ok(())
}

#[tauri::command]
pub fn clear_all_history(state: State<'_, AppState>) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    conn.execute("DELETE FROM variable_history", [])?;
    conn.execute("DELETE FROM template_history", [])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Categories and sets
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCategoryPayload {
    pub topic_id: Uuid,
    pub point_value: u8,
}

#[tauri::command]
pub fn create_category(
    state: State<'_, AppState>,
    payload: CreateCategoryPayload,
) -> Result<crate::models::Category, DbError> {
    let conn = crate::util::lock_db(&state.db);
    let (category, _) = CategoryRepo::create(&conn, payload.topic_id, payload.point_value)?;
    Ok(category)
}

#[tauri::command]
pub fn list_categories(
    state: State<'_, AppState>,
) -> Result<Vec<crate::models::Category>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    CategoryRepo::list_all(&conn)
}

#[tauri::command]
pub fn list_categories_by_topic(
    state: State<'_, AppState>,
    topic_id: Uuid,
) -> Result<Vec<crate::models::Category>, DbError> {
    let conn = crate::util::lock_db(&state.db);
    CategoryRepo::list_by_topic(&conn, &topic_id)
}

#[tauri::command]
pub fn get_category(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<crate::models::Category, DbError> {
    let conn = crate::util::lock_db(&state.db);
    CategoryRepo::get_by_id(&conn, &id)
}

#[tauri::command]
pub fn get_category_with_sets(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<(crate::models::Category, Vec<crate::models::Set>), DbError> {
    let conn = crate::util::lock_db(&state.db);
    CategoryRepo::get_with_sets(&conn, &id)
}

#[tauri::command]
pub fn delete_category(state: State<'_, AppState>, id: Uuid) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    CategoryRepo::delete(&conn, &id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSetPayload {
    pub category_id: Uuid,
    pub mode: TemplateMode,
}

#[tauri::command]
pub fn create_set(
    state: State<'_, AppState>,
    payload: CreateSetPayload,
) -> Result<crate::models::Set, DbError> {
    let conn = crate::util::lock_db(&state.db);
    SetRepo::create(&conn, payload.category_id, payload.mode)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSetNamePayload {
    pub set_id: Uuid,
    pub name: Option<String>,
}

#[tauri::command]
pub fn update_set_name(
    state: State<'_, AppState>,
    payload: UpdateSetNamePayload,
) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    SetRepo::update_name(&conn, &payload.set_id, payload.name.as_deref())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveSetPayload {
    pub set_id: Uuid,
    pub target_category_id: Uuid,
}

#[tauri::command]
pub fn move_set(
    state: State<'_, AppState>,
    payload: MoveSetPayload,
) -> Result<u8, DbError> {
    let conn = crate::util::lock_db(&state.db);
    SetRepo::move_to_category(&conn, &payload.set_id, &payload.target_category_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSetModePayload {
    pub set_id: Uuid,
    pub mode: TemplateMode,
}

#[tauri::command]
pub fn update_set_mode(
    state: State<'_, AppState>,
    payload: UpdateSetModePayload,
) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    SetRepo::update_mode(&conn, &payload.set_id, payload.mode)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTemplatePayload {
    pub set_id: Uuid,
    pub template_id: Uuid,
}

#[tauri::command]
pub fn add_template_to_set(
    state: State<'_, AppState>,
    payload: SetTemplatePayload,
) -> Result<crate::models::SetTemplate, DbError> {
    let conn = crate::util::lock_db(&state.db);
    SetRepo::add_template(&conn, &payload.set_id, &payload.template_id)
}

#[tauri::command]
pub fn remove_template_from_set(
    state: State<'_, AppState>,
    payload: SetTemplatePayload,
) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    SetRepo::remove_template(&conn, &payload.set_id, &payload.template_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderTemplatesPayload {
    pub set_id: Uuid,
    pub template_ids: Vec<Uuid>,
}

#[tauri::command]
pub fn reorder_templates_in_set(
    state: State<'_, AppState>,
    payload: ReorderTemplatesPayload,
) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
    SetRepo::reorder(&conn, &payload.set_id, &payload.template_ids)
}

#[tauri::command]
pub fn get_set_with_templates(
    state: State<'_, AppState>,
    set_id: Uuid,
) -> Result<(crate::models::Set, Vec<TemplateWithDetails>), DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_get_set_with_templates(&conn, &set_id)
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub(crate) fn do_get_set_with_templates(
    conn: &rusqlite::Connection,
    set_id: &Uuid,
) -> Result<(crate::models::Set, Vec<TemplateWithDetails>), DbError> {
    let set = conn.query_row(
        "SELECT id, category_id, set_index, mode, name FROM sets WHERE id = ?1",
        rusqlite::params![set_id],
        |row| {
            let mode_str: String = row.get(3)?;
            let mode = match mode_str.as_str() {
                "open" => TemplateMode::Open,
                _ => TemplateMode::Closed,
            };
            Ok(crate::models::Set {
                id: row.get(0)?,
                category_id: row.get(1)?,
                set_index: row.get(2)?,
                mode,
                name: row.get(4)?,
            })
        },
    )?;
    let set_templates = SetRepo::list_templates(conn, set_id)?;
    let mut templates = Vec::with_capacity(set_templates.len());
    for st in &set_templates {
        templates.push(load_template_with_details(conn, &st.template_id)?);
    }
    Ok((set, templates))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn serde_constraint_type(ct: ConstraintType) -> &'static str {
    match ct {
        ConstraintType::Range => "range",
        ConstraintType::Sd => "sd",
        ConstraintType::Both => "both",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::{TemplateHistoryRepo, TemplateRepo, VariableHistoryRepo, VariableRepo};
    use crate::db::AppState;
    use crate::engine::formula::evaluate;
    use std::collections::HashMap;
    use uuid::Uuid;

    fn setup() -> AppState {
        AppState::new_in_memory().expect("in-memory state")
    }

    fn create_topic_category_set_template(conn: &rusqlite::Connection) -> (Uuid, Uuid, Uuid, Uuid) {
        let topic_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO topics (id, name, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![topic_id, "Test topic", Utc::now().to_rfc3339()],
        )
        .expect("insert topic");

        let category_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO categories (id, topic_id, point_value, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![category_id, topic_id, 2, Utc::now().to_rfc3339()],
        )
        .expect("insert category");

        let set_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO sets (id, category_id, set_index, mode) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![set_id, category_id, 1, "closed"],
        )
        .expect("insert set");

        let template_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO templates (id, question_text, formula, equation_text, numeric_answer, result_unit, point_value, topic_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                template_id,
                "Roztok obsahuje [[V00]] g látky.",
                "V00",
                "m = [[V00]] g",
                None::<f64>,
                "g",
                2,
                topic_id,
                Utc::now().to_rfc3339(),
            ],
        )
        .expect("insert template");

        conn.execute(
            "INSERT INTO set_templates (set_id, template_id, sort_order) VALUES (?1, ?2, ?3)",
            rusqlite::params![set_id, template_id, 0],
        )
        .expect("insert set template");

        (topic_id, category_id, set_id, template_id)
    }

    fn create_variable(conn: &rusqlite::Connection, symbol: &str) -> Variable {
        let variable = Variable::new(
            format!("Variable {symbol}"),
            symbol.into(),
            1.0,
            100.0,
            1.0,
            "g".into(),
            1,
        );
        VariableRepo::insert(conn, &variable).expect("insert variable");
        variable
    }

    fn build_payload(template_id: Uuid) -> UpdateTemplateWithVariablesPayload {
        UpdateTemplateWithVariablesPayload {
            id: template_id,
            question_text: "Roztok obsahuje [[V00]] g látky.".into(),
            formula: "V00".into(),
            equation_text: "m = [[V00]] g".into(),
            numeric_answer: None,
            result_unit: "g".into(),
            point_value: 2,
            significant_digits: None,
            force_scientific: false,
            decoys: Vec::new(),
            variable_mutations: Vec::new(),
            constants: Vec::new(),
            constraint: None,
        }
    }

    fn build_variable_payload(
        name: &str,
        symbol: &str,
        min_value: f64,
        max_value: f64,
        step: f64,
        unit: &str,
        precision: u8,
    ) -> CreateVariablePayload {
        CreateVariablePayload {
            name: name.into(),
            symbol: symbol.into(),
            var_type: VariableType::Numeric,
            min_value,
            max_value,
            step,
            unit: unit.into(),
            precision,
            string_values: None,
            paired_constants: None,
            significant_digits: None,
        }
    }

    #[test]
    fn deserialize_keep_mutation_from_camelcase_json() {
        let json = r#"{"action":"keep","variableId":"550e8400-e29b-41d4-a716-446655440000","placeholder":"V00","greaterThanVariableId":null,"lessThanVariableId":null}"#;
        let mutation: VariableMutation = serde_json::from_str(json).expect("deserialize");
        match mutation {
            VariableMutation::Keep {
                variable_id,
                placeholder,
                greater_than_variable_id,
                less_than_variable_id,
            } => {
                let _ = greater_than_variable_id;
                let _ = less_than_variable_id;
                assert_eq!(
                    variable_id.to_string(),
                    "550e8400-e29b-41d4-a716-446655440000"
                );
                assert_eq!(placeholder, "V00");
            }
            _ => panic!("expected Keep variant"),
        }
    }

    // Regression test for a real bug: `rename_all = "camelCase"` on this
    // internally-tagged enum silently failed to rename multi-word fields
    // inside variants, so `greaterThanVariableId`/`lessThanVariableId`
    // deserialized to `None` even when present in the JSON — every save
    // of a comparison constraint was a no-op. Fixed with explicit per-field
    // `#[serde(rename = ...)]` on every variant; this pins that down.
    #[test]
    fn deserialize_update_mutation_preserves_greater_than_variable_id() {
        let json = r#"{"action":"update","variableId":"f6af41e1-e014-4028-95d8-c7be98b53a22","placeholder":"ms","greaterThanVariableId":"a6d3bd7c-56fc-408b-98c7-ba870c7ac421","variable":{"name":"ms","symbol":"ms","varType":"numeric","minValue":1,"maxValue":1000,"step":1,"unit":"g","precision":0,"stringValues":null,"pairedConstants":null}}"#;
        let mutation: VariableMutation = serde_json::from_str(json).expect("deserialize");
        match mutation {
            VariableMutation::Update {
                greater_than_variable_id,
                less_than_variable_id,
                ..
            } => {
                assert_eq!(
                    greater_than_variable_id,
                    Some("a6d3bd7c-56fc-408b-98c7-ba870c7ac421".parse().unwrap())
                );
                assert_eq!(less_than_variable_id, None);
            }
            _ => panic!("expected Update variant"),
        }
    }

    #[test]
    fn update_template_with_variables_keeps_existing_link() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);
        let variable = create_variable(&conn, "V00");

        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![template_id, variable.id, "V00"],
        )
        .expect("insert link");

        let mut payload = build_payload(template_id);
        payload.variable_mutations.push(VariableMutation::Keep {
            variable_id: variable.id,
            placeholder: "V00".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
        });

        apply_template_variable_mutations(&conn, payload).expect("apply mutations");

        let links = TemplateRepo::get_variables(&conn, &template_id).expect("get variables");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].variable_id, variable.id);
        assert_eq!(links[0].placeholder, "V00");
    }

    #[test]
    fn update_template_with_variables_persists_greater_than_constraint() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);
        let x = create_variable(&conn, "X");
        let y = create_variable(&conn, "Y");

        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![template_id, x.id, "X"],
        )
        .expect("insert link x");
        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![template_id, y.id, "Y"],
        )
        .expect("insert link y");

        // Deserialize from JSON (not a struct literal) so this exercises the
        // same tagged-enum path the HTTP layer uses.
        let json = format!(
            r#"[{{"action":"update","variableId":"{x_id}","placeholder":"X","greaterThanVariableId":"{y_id}","variable":{{"name":"X","symbol":"X","varType":"numeric","minValue":1,"maxValue":100,"step":1,"unit":"g","precision":1,"stringValues":null,"pairedConstants":null}}}},{{"action":"keep","variableId":"{y_id}","placeholder":"Y"}}]"#,
            x_id = x.id,
            y_id = y.id,
        );
        let mutations: Vec<VariableMutation> = serde_json::from_str(&json).expect("deserialize");

        let mut payload = build_payload(template_id);
        payload.question_text = "Roztok obsahuje [[X]] g látky a [[Y]] g vody.".into();
        payload.variable_mutations = mutations;

        apply_template_variable_mutations(&conn, payload).expect("apply mutations");

        let links = TemplateRepo::get_variables(&conn, &template_id).expect("get variables");
        let x_link = links.iter().find(|l| l.variable_id == x.id).expect("x link");
        assert_eq!(x_link.greater_than_variable_id, Some(y.id));
    }

    #[test]
    fn update_template_with_variables_creates_new_variable() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);

        let mut payload = build_payload(template_id);
        payload.question_text = "Roztok obsahuje [[V00]] g látky a [[V01]] g vody.".into();
        payload.variable_mutations.push(VariableMutation::Create {
            placeholder: "V00".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
            variable: build_variable_payload("Hmotnost látky", "V00", 10.0, 50.0, 1.0, "g", 1),
        });

        apply_template_variable_mutations(&conn, payload).expect("apply mutations");

        let template = TemplateRepo::get_by_id(&conn, &template_id).expect("get template");
        assert!(template.question_text.contains("[[V00]]"));
        let links = TemplateRepo::get_variables(&conn, &template_id).expect("get variables");
        assert_eq!(links.len(), 2);
        let v00_link = links
            .iter()
            .find(|l| l.placeholder == "V00")
            .expect("V00 link");

        let variable = VariableRepo::get_by_id(&conn, &v00_link.variable_id).expect("get variable");
        assert_eq!(variable.symbol, "V00");
        assert_eq!(variable.min_value, 10.0);
    }

    #[test]
    fn update_template_with_variables_updates_unshared_variable_in_place() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);
        let variable = create_variable(&conn, "V00");

        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![template_id, variable.id, "V00"],
        )
        .expect("insert link");

        let mut payload = build_payload(template_id);
        payload.variable_mutations.push(VariableMutation::Update {
            variable_id: variable.id,
            placeholder: "V00".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
            variable: build_variable_payload(&variable.name, "V00", 5.0, 10.0, 0.5, "g", 1),
        });

        apply_template_variable_mutations(&conn, payload).expect("apply mutations");

        let updated = VariableRepo::get_by_id(&conn, &variable.id).expect("get variable");
        assert_eq!(updated.min_value, 5.0);
        assert_eq!(updated.max_value, 10.0);
    }

    #[test]
    fn update_template_with_variables_clones_shared_variable() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);
        let variable = create_variable(&conn, "V00");
        let topic_id = TemplateRepo::get_by_id(&conn, &template_id)
            .ok()
            .and_then(|_| {
                conn.query_row(
                    "SELECT topic_id FROM templates WHERE id = ?1",
                    rusqlite::params![template_id],
                    |row| row.get::<_, Uuid>(0),
                )
                .ok()
            })
            .expect("topic id");

        let other_template_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO templates (id, question_text, formula, result_unit, point_value, topic_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                other_template_id,
                "Other [[V00]]",
                "ANS",
                "g",
                2,
                topic_id,
                Utc::now().to_rfc3339(),
            ],
        )
        .expect("insert other template");

        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![template_id, variable.id, "V00"],
        )
        .expect("insert link 1");
        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![other_template_id, variable.id, "V00"],
        )
        .expect("insert link 2");

        let mut payload = build_payload(template_id);
        payload.variable_mutations.push(VariableMutation::Clone {
            old_variable_id: variable.id,
            placeholder: "V00".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
            variable: build_variable_payload(&variable.name, "V00", 5.0, 10.0, 0.5, "g", 1),
        });

        apply_template_variable_mutations(&conn, payload).expect("apply mutations");

        let original = VariableRepo::get_by_id(&conn, &variable.id).expect("original still exists");
        assert_eq!(original.min_value, 1.0);

        let links = TemplateRepo::get_variables(&conn, &template_id).expect("get variables");
        assert_eq!(links.len(), 1);
        assert_ne!(links[0].variable_id, variable.id);

        let clone = VariableRepo::get_by_id(&conn, &links[0].variable_id).expect("get clone");
        assert_eq!(clone.min_value, 5.0);
    }

    #[test]
    fn update_template_with_variables_removes_unused_variable() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);
        let variable = create_variable(&conn, "V00");

        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![template_id, variable.id, "V00"],
        )
        .expect("insert link");

        let mut payload = build_payload(template_id);
        payload.question_text = "Roztok neobsahuje žádné proměnné.".into();
        payload.variable_mutations.push(VariableMutation::Remove {
            variable_id: variable.id,
        });

        apply_template_variable_mutations(&conn, payload).expect("apply mutations");

        let links = TemplateRepo::get_variables(&conn, &template_id).expect("get variables");
        assert!(links.is_empty());
        assert!(VariableRepo::get_by_id(&conn, &variable.id).is_err());
    }

    #[test]
    fn update_template_with_variables_removes_link_but_keeps_shared_variable() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);
        let variable = create_variable(&conn, "V00");
        let topic_id = TemplateRepo::get_by_id(&conn, &template_id)
            .ok()
            .and_then(|_| {
                conn.query_row(
                    "SELECT topic_id FROM templates WHERE id = ?1",
                    rusqlite::params![template_id],
                    |row| row.get::<_, Uuid>(0),
                )
                .ok()
            })
            .expect("topic id");

        let other_template_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO templates (id, question_text, formula, result_unit, point_value, topic_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                other_template_id,
                "Other [[V00]]",
                "ANS",
                "g",
                2,
                topic_id,
                Utc::now().to_rfc3339(),
            ],
        )
        .expect("insert other template");

        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![template_id, variable.id, "V00"],
        )
        .expect("insert link 1");
        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![other_template_id, variable.id, "V00"],
        )
        .expect("insert link 2");

        let mut payload = build_payload(template_id);
        payload.question_text = "Roztok neobsahuje žádné proměnné.".into();
        payload.variable_mutations.push(VariableMutation::Remove {
            variable_id: variable.id,
        });

        apply_template_variable_mutations(&conn, payload).expect("apply mutations");

        let links = TemplateRepo::get_variables(&conn, &template_id).expect("get variables");
        assert!(links.is_empty());
        assert!(VariableRepo::get_by_id(&conn, &variable.id).is_ok());
    }

    #[test]
    fn update_template_with_variables_renames_placeholder_in_question_text() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);
        let variable = create_variable(&conn, "V00");

        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![template_id, variable.id, "V00"],
        )
        .expect("insert link");

        let mut payload = build_payload(template_id);
        payload.variable_mutations.push(VariableMutation::Update {
            variable_id: variable.id,
            placeholder: "X".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
            variable: build_variable_payload(
                &variable.name,
                "X",
                variable.min_value,
                variable.max_value,
                variable.step,
                &variable.unit,
                variable.precision,
            ),
        });

        apply_template_variable_mutations(&conn, payload).expect("apply mutations");

        let template = TemplateRepo::get_by_id(&conn, &template_id).expect("get template");
        assert!(template.question_text.contains("[[X]]"));
        assert!(!template.question_text.contains("[[V00]]"));

        let links = TemplateRepo::get_variables(&conn, &template_id).expect("get variables");
        assert_eq!(links[0].placeholder, "X");
    }

    #[test]
    fn update_template_with_variables_persists_equation_text_and_computes_answer() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);
        let variable = create_variable(&conn, "V00");

        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![template_id, variable.id, "V00"],
        )
        .expect("insert link");

        let mut payload = build_payload(template_id);
        payload.formula = "V00 / (V00 + 100) * 100".into();
        payload.equation_text = "w = m / (m + 100) × 100 %".into();
        payload.variable_mutations.push(VariableMutation::Keep {
            variable_id: variable.id,
            placeholder: "V00".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
        });

        apply_template_variable_mutations(&conn, payload).expect("apply mutations");

        let template = TemplateRepo::get_by_id(&conn, &template_id).expect("get template");
        assert_eq!(template.formula, "V00 / (V00 + 100) * 100");
        assert_eq!(template.equation_text, "w = m / (m + 100) × 100 %");

        let mut vars = HashMap::new();
        vars.insert("V00".into(), 50.0);
        let answer = evaluate(&template.formula, &vars, &HashMap::new()).expect("evaluate");
        assert!((answer - 33.33333333333333).abs() < 1e-10);
    }

    #[test]
    fn update_template_with_variables_records_template_field_history() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);

        let mut payload = build_payload(template_id);
        payload.question_text = "Nové zadání".into();
        payload.formula = "ANS + 1".into();
        payload.equation_text = "x + 1".into();
        payload.result_unit = "kg".into();
        payload.point_value = 3;

        apply_template_variable_mutations(&conn, payload).expect("apply mutations");

        let entries = TemplateHistoryRepo::list_by_template(&conn, &template_id, 10, 0)
            .expect("list template history");
        let fields: Vec<_> = entries.iter().map(|e| e.field_name.as_str()).collect();
        assert!(fields.contains(&"questionText"));
        assert!(fields.contains(&"formula"));
        assert!(fields.contains(&"equationText"));
        assert!(fields.contains(&"resultUnit"));
        assert!(fields.contains(&"pointValue"));
    }

    #[test]
    fn delete_history_for_template_removes_all_entries() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let (_, _, _, template_id) = create_topic_category_set_template(&conn);
        let variable = create_variable(&conn, "V00");

        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![template_id, variable.id, "V00"],
        )
        .expect("insert link");

        VariableHistoryRepo::record_change(
            &conn,
            &variable.id,
            &template_id,
            "range",
            Some("0..100 step 1"),
            Some("0..200 step 2"),
        )
        .expect("record variable history");
        TemplateHistoryRepo::record_change(
            &conn,
            &template_id,
            "questionText",
            Some("old"),
            Some("new"),
        )
        .expect("record template history");

        VariableHistoryRepo::delete_for_template(&conn, &template_id)
            .expect("delete variable history");
        TemplateHistoryRepo::delete_for_template(&conn, &template_id)
            .expect("delete template history");

        let variable_entries = VariableHistoryRepo::list_by_template(&conn, &template_id, 10, 0)
            .expect("list variable history");
        let template_entries = TemplateHistoryRepo::list_by_template(&conn, &template_id, 10, 0)
            .expect("list template history");
        assert!(variable_entries.is_empty());
        assert!(template_entries.is_empty());
    }

    /// End-to-end deep copy: a topic with one category (4 auto-created
    /// sets), two templates in two different sets sharing one variable, a
    /// constant, a constraint, and a decoy — everything must be duplicated
    /// as independent rows, except the constant (global reference data,
    /// stays shared) and the internal variable-sharing topology (preserved
    /// within the copy, never shared with the original).
    #[test]
    fn duplicate_topic_deep_copies_categories_sets_templates_and_variables() {
        let state = setup();
        let conn = state.db.lock().expect("lock");

        let mut topic = Topic::new("Roztoky".into());
        topic.for_students = true;
        TopicRepo::insert(&conn, &topic).expect("insert topic");

        let (category, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create category");
        assert_eq!(sets.len(), 4);

        let shared_var = create_variable(&conn, "X");
        let constant = crate::models::Constant::new(
            "Molar mass".into(),
            "M".into(),
            18.02,
            "g/mol".into(),
            false,
        );
        crate::db::repos::ConstantRepo::insert(&conn, &constant).expect("insert constant");

        let template1 = Template::new(
            "Kolik je [[X]] * 2?".into(),
            "X * 2".into(),
            "X × 2".into(),
            None,
            "g".into(),
            2,
        );
        let tv1 = TemplateVariable {
            template_id: template1.id,
            variable_id: shared_var.id,
            placeholder: "X".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
        };
        let tc1 = TemplateConstant {
            template_id: template1.id,
            constant_id: constant.id,
        };
        let constraint1 =
            ResultConstraint::new(template1.id, Some(0.0), Some(100.0), None, ConstraintType::Range);
        let decoys1 = vec![TemplateDecoyInput {
            formula: "X * 3".into(),
            option_count: 2,
        }];
        TemplateRepo::insert(&conn, &template1, &[tv1], &[tc1], Some(&constraint1), &decoys1)
            .expect("insert template1");
        SetRepo::add_template(&conn, &sets[0].id, &template1.id).expect("add template1 to set");

        let template2 = Template::new(
            "Kolik je [[X]] * 3?".into(),
            "X * 3".into(),
            "X × 3".into(),
            None,
            "g".into(),
            2,
        );
        let tv2 = TemplateVariable {
            template_id: template2.id,
            variable_id: shared_var.id,
            placeholder: "X".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
        };
        TemplateRepo::insert(&conn, &template2, &[tv2], &[], None, &[]).expect("insert template2");
        SetRepo::add_template(&conn, &sets[1].id, &template2.id).expect("add template2 to set");

        let new_topic = do_duplicate_topic(&conn, &topic.id).expect("duplicate topic");

        assert_ne!(new_topic.id, topic.id);
        assert_eq!(new_topic.name, "Roztoky (kopie)");
        assert!(new_topic.for_students);

        let new_categories = CategoryRepo::list_by_topic(&conn, &new_topic.id).expect("list cats");
        assert_eq!(new_categories.len(), 1);
        assert_ne!(new_categories[0].id, category.id);
        assert_eq!(new_categories[0].point_value, 2);

        let new_sets =
            CategoryRepo::get_sets_for_category(&conn, &new_categories[0].id).expect("list sets");
        assert_eq!(new_sets.len(), 4, "duplicate must preserve the exact set count");

        let new_links1 = SetRepo::list_templates(&conn, &new_sets[0].id).expect("list links 1");
        let new_links2 = SetRepo::list_templates(&conn, &new_sets[1].id).expect("list links 2");
        assert_eq!(new_links1.len(), 1);
        assert_eq!(new_links2.len(), 1);
        let new_template1_id = new_links1[0].template_id;
        let new_template2_id = new_links2[0].template_id;
        assert_ne!(new_template1_id, template1.id);
        assert_ne!(new_template2_id, template2.id);

        // The two duplicated templates must share ONE new variable (the
        // source topology preserved) that is NOT the original shared_var.
        let new_var1 = &TemplateRepo::get_variables(&conn, &new_template1_id).expect("vars1")[0];
        let new_var2 = &TemplateRepo::get_variables(&conn, &new_template2_id).expect("vars2")[0];
        assert_eq!(
            new_var1.variable_id, new_var2.variable_id,
            "templates sharing a variable in the source must still share one (new) variable in the copy"
        );
        assert_ne!(
            new_var1.variable_id, shared_var.id,
            "the copy must never share a variable row with the original"
        );

        // Editing the duplicated variable must not affect the original.
        let mut duplicated_var =
            crate::db::repos::VariableRepo::get_by_id(&conn, &new_var1.variable_id).expect("get dup var");
        duplicated_var.max_value = 5.0;
        crate::db::repos::VariableRepo::update(&conn, &duplicated_var).expect("update dup var");
        let original_var_after =
            crate::db::repos::VariableRepo::get_by_id(&conn, &shared_var.id).expect("get original var");
        assert_eq!(
            original_var_after.max_value, shared_var.max_value,
            "editing the duplicate's variable must not change the original's"
        );

        // Constant stays linked to the SAME row (global reference data).
        let new_constants1 = TemplateRepo::get_constants(&conn, &new_template1_id).expect("consts1");
        assert_eq!(new_constants1.len(), 1);
        assert_eq!(new_constants1[0].constant_id, constant.id);

        // Constraint and decoy are deep-copied onto the new template.
        let new_constraint1 = TemplateRepo::get_constraint(&conn, &new_template1_id)
            .expect("constraint1")
            .expect("constraint1 present");
        assert_eq!(new_constraint1.min_result, Some(0.0));
        assert_eq!(new_constraint1.max_result, Some(100.0));

        let new_decoys1 =
            TemplateDecoyRepo::list_by_template(&conn, &new_template1_id).expect("decoys1");
        assert_eq!(new_decoys1.len(), 1);
        assert_eq!(new_decoys1[0].formula, "X * 3");
        assert_eq!(new_decoys1[0].option_count, 2);

        // The source topic must be completely untouched.
        let original_categories = CategoryRepo::list_by_topic(&conn, &topic.id).expect("orig cats");
        assert_eq!(original_categories.len(), 1);
        assert_eq!(original_categories[0].id, category.id);
    }

    #[test]
    fn duplicate_topic_lands_in_the_same_group_as_the_source() {
        let state = setup();
        let conn = state.db.lock().expect("lock");

        let group = TopicGroup::new("2026/2027".into());
        TopicGroupRepo::insert(&conn, &group).expect("insert group");

        let topic = Topic::new("Topic".into());
        TopicRepo::insert(&conn, &topic).expect("insert topic");
        TopicRepo::move_to_group(&conn, &topic.id, Some(group.id)).expect("move to group");

        let new_topic = do_duplicate_topic(&conn, &topic.id).expect("duplicate");
        assert_eq!(new_topic.group_id, Some(group.id));
    }
}
