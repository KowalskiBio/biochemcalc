use crate::db::repos::{CategoryRepo, SetRepo, TemplateRepo, TopicRepo, VariableRepo};
use crate::db::{AppState, DbError};
use crate::models::{Template, TemplateVariable, Topic, Variable};
use serde::Deserialize;
use tauri::State;

// ---------------------------------------------------------------------------
// Bulk template import from structured text (Word-style) payload.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkImportVariablePayload {
    pub symbol: String,
    pub name: String,
    #[serde(rename = "varType")]
    pub var_type: BulkImportVarType,
    pub min_value: f64,
    pub max_value: f64,
    pub step: f64,
    pub unit: String,
    pub precision: u8,
    #[serde(default)]
    pub string_values: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BulkImportVarType {
    Numeric,
    String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkImportQuestionPayload {
    pub question_text: String,
    #[serde(default)]
    pub formula: String,
    #[serde(default)]
    pub equation_text: String,
    #[serde(default)]
    pub targets: Vec<String>,
    pub variables: Vec<BulkImportVariablePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkImportSetPayload {
    pub set_index: u8,
    pub questions: Vec<BulkImportQuestionPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkImportCategoryPayload {
    pub point_value: u8,
    pub sets: Vec<BulkImportSetPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkImportTemplatesPayload {
    pub topic_name: String,
    pub categories: Vec<BulkImportCategoryPayload>,
}

#[tauri::command]
pub fn import_bulk_templates(
    state: State<'_, AppState>,
    payload: BulkImportTemplatesPayload,
) -> Result<Topic, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_import_bulk_templates(&conn, payload)
}

pub fn do_import_bulk_templates(
    conn: &rusqlite::Connection,
    payload: BulkImportTemplatesPayload,
) -> Result<Topic, DbError> {
    let topic = Topic::new(crate::util::normalize_name_dashes(&payload.topic_name));
    TopicRepo::insert(conn, &topic)?;

    for category_payload in payload.categories {
        let (category, sets) = CategoryRepo::create(conn, topic.id, category_payload.point_value)?;

        for set_payload in category_payload.sets {
            let set = sets
                .get(set_payload.set_index.saturating_sub(1) as usize)
                .ok_or_else(|| {
                    DbError::Validation(format!(
                        "Set index {} does not exist for category point_value {}",
                        set_payload.set_index, category.point_value
                    ))
                })?;

            for question_payload in set_payload.questions {
                import_bulk_question(conn, &category, set, &question_payload)?;
            }
        }
    }

    Ok(topic)
}

fn import_bulk_question(
    conn: &rusqlite::Connection,
    category: &crate::models::Category,
    set: &crate::models::Set,
    question: &BulkImportQuestionPayload,
) -> Result<(), DbError> {
    if let Some(existing) = TemplateRepo::find_by_question_and_equation(
        conn,
        &question.question_text,
        &question.equation_text,
    )? {
        let in_set = SetRepo::list_templates(conn, &set.id)?
            .iter()
            .any(|st| st.template_id == existing.id);
        if !in_set {
            SetRepo::add_template(conn, &set.id, &existing.id)?;
        }
        return Ok(());
    }

    let mut var_placeholders: Vec<(Variable, String)> = Vec::new();

    for var_payload in &question.variables {
        let variable = match var_payload.var_type {
            BulkImportVarType::String => Variable::new_string(
                var_payload.name.clone(),
                var_payload.symbol.clone(),
                var_payload.string_values.clone().unwrap_or_default(),
            ),
            BulkImportVarType::Numeric => Variable::new(
                var_payload.name.clone(),
                var_payload.symbol.clone(),
                var_payload.min_value,
                var_payload.max_value,
                var_payload.step,
                var_payload.unit.clone(),
                var_payload.precision,
            ),
        };
        VariableRepo::insert_raw(conn, &variable)?;
        var_placeholders.push((variable, var_payload.symbol.clone()));
    }

    let result_unit = question.targets.first().cloned().unwrap_or_default();
    let template = Template::new(
        question.question_text.clone(),
        question.formula.clone(),
        question.equation_text.clone(),
        None,
        result_unit,
        category.point_value,
    );

    let tvs = var_placeholders
        .iter()
        .map(|(v, placeholder)| TemplateVariable {
            template_id: template.id,
            variable_id: v.id,
            placeholder: placeholder.clone(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
        })
        .collect::<Vec<_>>();

    // No result constraint: an imported question has no per-question tolerance
    // of its own, so the answer interval is driven by the difficulty chosen at
    // generation time (easy ±50 %, medium ±30 %, hard ±10 %). A blanket
    // absolute SD here would override that for every imported question and
    // scale terribly — ±0.1 is ±0.03 % of a 351 g answer but ±20 % of a 0.5
    // one. Set an SD deliberately per template when a question needs one.
    TemplateRepo::insert(conn, &template, &tvs, &[], None, &[])?;
    SetRepo::add_template(conn, &set.id, &template.id)?;

    Ok(())
}

#[tauri::command]
pub fn import_test1(state: State<'_, AppState>) -> Result<Topic, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_import_test1(&conn)
}

fn do_import_test1(conn: &rusqlite::Connection) -> Result<Topic, DbError> {
    let json_path =
        std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../test1_bulk.json"));
    let raw = std::fs::read_to_string(json_path)
        .map_err(|e| DbError::Io(format!("Failed to read test1_bulk.json: {e}")))?;
    let payload: BulkImportTemplatesPayload =
        serde_json::from_str(&raw).map_err(|e| DbError::Serde(e))?;
    do_import_bulk_templates(conn, payload)
}

#[tauri::command]
pub fn import_reparse_test1(state: State<'_, AppState>) -> Result<Topic, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_import_reparse_test1(&conn)
}

fn do_import_reparse_test1(conn: &rusqlite::Connection) -> Result<Topic, DbError> {
    do_import_test1(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::AppState;

    #[test]
    fn import_test1_creates_topic_categories_sets_and_templates() {
        let state = AppState::new_in_memory().expect("in-memory state");
        {
            let conn = state.db.lock().expect("lock");
            crate::db::repos::ConstantRepo::seed_builtins_if_empty(&conn).expect("seed builtins");
        }

        let conn = state.db.lock().expect("lock");
        let topic = do_import_test1(&conn).expect("import");

        assert_eq!(topic.name, "Hmotnostní a objemové procento, ředění");

        let categories = CategoryRepo::list_by_topic(&conn, &topic.id).expect("list cats");
        assert_eq!(categories.len(), 3);
        assert_eq!(categories[0].point_value, 2);
        assert_eq!(categories[1].point_value, 3);
        assert_eq!(categories[2].point_value, 4);

        for cat in &categories {
            let (_, sets) = CategoryRepo::get_with_sets(&conn, &cat.id).expect("get sets");
            assert_eq!(sets.len(), 4);
        }

        let templates = TemplateRepo::list_all(&conn).expect("list templates");
        assert_eq!(
            templates.len(),
            29,
            "expected 29 templates, got {}",
            templates.len()
        );
    }

    #[test]
    fn import_test1_stores_formula_and_equation_text() {
        let state = AppState::new_in_memory().expect("in-memory state");
        {
            let conn = state.db.lock().expect("lock");
            crate::db::repos::ConstantRepo::seed_builtins_if_empty(&conn).expect("seed builtins");
        }

        let conn = state.db.lock().expect("lock");
        let topic = do_import_test1(&conn).expect("import");
        let categories = CategoryRepo::list_by_topic(&conn, &topic.id).expect("list cats");
        assert!(!categories.is_empty());

        let templates = TemplateRepo::list_all(&conn).expect("list templates");
        assert!(!templates.is_empty());

        let filled = templates
            .iter()
            .find(|t| !t.formula.is_empty())
            .expect("at least one template has a formula");
        assert!(
            !filled.equation_text.is_empty(),
            "equation_text should be filled when formula is paired"
        );
        assert!(
            filled.numeric_answer.is_none(),
            "numeric_answer is not generated during import"
        );

        let vars = TemplateRepo::get_variables(&conn, &filled.id).expect("vars");
        assert!(
            !vars
                .iter()
                .any(|tv| tv.placeholder.starts_with("V") && tv.placeholder.len() == 3),
            "variables should use meaningful placeholder names, not V00/V01"
        );
    }
}
