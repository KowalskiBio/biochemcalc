use crate::db::repos::{ConstantRepo, OutputFileRepo, ProjektRepo, TemplateRepo};
use crate::db::{AppState, DbError};
use crate::engine::export_writer::{write_txt, ExportQuestion};
use crate::engine::generator::{
    generate_numeric_options, generate_variant, generate_variants, open_interval, GenerationError,
};
use crate::models::{
    ConstraintType, OutputFile, Projekt, ProjektContent, ProjektQuestion, ResultConstraint,
    Template, TemplateMode, Variant,
};
use chrono::Utc;
use rand::rngs::StdRng;
use rand::SeedableRng;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

/// Input for generating variants for one or more templates.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateForTemplatesPayload {
    pub template_ids: Vec<Uuid>,
    pub count: u32,
    pub base_seed: u64,
    pub mode: TemplateMode,
    pub difficulty: String,
    pub option_count: u8,
}

/// A template together with its generated variants.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedTemplate {
    pub template: Template,
    pub variants: Vec<Variant>,
}

#[tauri::command]
pub fn generate_for_templates(
    state: State<'_, AppState>,
    payload: GenerateForTemplatesPayload,
) -> Result<Vec<GeneratedTemplate>, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    let mut output = Vec::with_capacity(payload.template_ids.len());

    for template_id in &payload.template_ids {
        let template = TemplateRepo::get_by_id(&conn, template_id)?;
        let (variables, constants, constraint) = load_template_dependencies(&conn, &template)?;
        let variants = generate_variants(
            template.id,
            &template.formula,
            &variables,
            &constants,
            &constraint,
            payload.mode,
            payload.count as usize,
            payload.base_seed,
            &payload.difficulty,
            payload.option_count,
        )
        .map_err(generation_to_db_error)?;

        output.push(GeneratedTemplate { template, variants });
    }

    Ok(output)
}

/// Input for exporting already-generated variants.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPayload {
    pub filename: String,
    pub questions: Vec<ExportQuestionInput>,
}

/// A serializable stand-in for `ExportQuestion` that does not borrow data.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportQuestionInput {
    pub template: Template,
    pub variant: Variant,
    pub variable_precisions: HashMap<String, u8>,
    pub result_precision: u8,
    pub mode: TemplateMode,
}

/// Result of an export operation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub content: String,
    pub file_path: String,
}

#[tauri::command]
pub fn export_to_txt(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: ExportPayload,
) -> Result<ExportResult, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    let questions: Vec<ExportQuestion<'_>> = payload
        .questions
        .iter()
        .map(|input| ExportQuestion {
            template: &input.template,
            variant: &input.variant,
            variable_precisions: input.variable_precisions.clone(),
            result_precision: input.result_precision,
            mode: input.mode,
        })
        .collect();

    let content = write_txt(&questions);

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| DbError::Io(format!("Failed to resolve app data dir: {e}")))?;
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| DbError::Io(format!("Failed to create app data dir: {e}")))?;

    let file_name = if payload.filename.ends_with(".txt") {
        payload.filename
    } else {
        format!("{}.txt", payload.filename)
    };
    let file_path = app_data_dir.join(file_name);

    std::fs::write(&file_path, &content)
        .map_err(|e| DbError::Io(format!("Failed to write export file: {e}")))?;

    // Persist output metadata.
    conn.execute(
        "INSERT INTO output_files (id, filename, file_path, category_package_ids, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            Uuid::new_v4(),
            file_path.file_name().and_then(|n| n.to_str()).unwrap_or("export.txt"),
            file_path.to_string_lossy(),
            serde_json::to_string(&Vec::<Uuid>::new())?,
            "exported",
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;

    Ok(ExportResult {
        content,
        file_path: file_path.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// regenerate_variant
// ---------------------------------------------------------------------------

/// Input for regenerating a single variant, with an optional manual answer override.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegenerateVariantPayload {
    pub template_id: Uuid,
    pub mode: TemplateMode,
    pub seed: u64,
    pub manual_answer: Option<f64>,
    pub difficulty: String,
    pub option_count: u8,
}

/// Regenerate a variant for a template using the given seed.
///
/// If `manual_answer` is provided, the correct answer is set to that value and
/// numeric options / correct option / interval are recalculated around it.
#[tauri::command]
pub fn regenerate_variant(
    state: State<'_, AppState>,
    payload: RegenerateVariantPayload,
) -> Result<Variant, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    let template = TemplateRepo::get_by_id(&conn, &payload.template_id)?;
    let (variables, constants, constraint) = load_template_dependencies(&conn, &template)?;

    let mut variant = generate_variant(
        template.id,
        &template.formula,
        &variables,
        &constants,
        &constraint,
        payload.mode,
        payload.seed,
        &payload.difficulty,
        payload.option_count,
    )
    .map_err(|e| DbError::Validation(e.to_string()))?;

    if let Some(manual_answer) = payload.manual_answer {
        variant.correct_answer = manual_answer;

        match payload.mode {
            TemplateMode::Closed => {
                let mut rng = StdRng::seed_from_u64(payload.seed.wrapping_add(1));
                let (options, position) = generate_numeric_options(
                    manual_answer,
                    &constraint,
                    &mut rng,
                    &payload.difficulty,
                    payload.option_count,
                )
                .map_err(|e| DbError::Validation(e.to_string()))?;
                variant.numeric_options = Some(options);
                variant.correct_option = Some(position);
            }
            TemplateMode::Open => {
                let (lo, hi) = open_interval(manual_answer, &constraint, &payload.difficulty);
                variant.interval_lo = Some(lo);
                variant.interval_hi = Some(hi);
            }
        }
    }

    Ok(variant)
}

// ---------------------------------------------------------------------------
// Projekt (project) save / load / list / delete / export
// ---------------------------------------------------------------------------

/// Input for saving a projekt (temporary project).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjektPayload {
    pub name: String,
    pub topic_name: Option<String>,
    pub mode: TemplateMode,
    pub questions: Vec<ProjektQuestion>,
}

/// Persist a projekt as a JSON file in `app_data_dir/projekty/<uuid>.json`
/// and insert metadata into the database via ProjektRepo.
#[tauri::command]
pub fn save_projekt(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SaveProjektPayload,
) -> Result<Projekt, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    let projekt_id = Uuid::new_v4();

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| DbError::Io(format!("Failed to resolve app data dir: {e}")))?;
    let projekty_dir = app_data_dir.join("projekty");
    std::fs::create_dir_all(&projekty_dir)
        .map_err(|e| DbError::Io(format!("Failed to create projekty dir: {e}")))?;

    let file_path = projekty_dir.join(format!("{projekt_id}.json"));
    let file_path_str = file_path.to_string_lossy().to_string();

    let question_count = payload.questions.len() as u32;
    let content = ProjektContent {
        projekt_id,
        questions: payload.questions,
    };

    let json = serde_json::to_string_pretty(&content)?;
    std::fs::write(&file_path, &json)
        .map_err(|e| DbError::Io(format!("Failed to write projekt file: {e}")))?;

    let now = Utc::now();
    let projekt = Projekt {
        id: projekt_id,
        name: payload.name,
        file_path: file_path_str,
        question_count,
        mode: payload.mode,
        topic_name: payload.topic_name,
        created_at: now,
        updated_at: now,
    };

    ProjektRepo::insert(&conn, &projekt)?;

    Ok(projekt)
}

/// Input for updating a projekt - uses the same structure as SaveProjektPayload
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjektPayload {
    pub projekt_id: Uuid,
    pub name: String,
    pub topic_name: Option<String>,
    pub mode: TemplateMode,
    pub questions: Vec<ProjektQuestion>,
}

/// Update an existing projekt's content and metadata.
#[tauri::command]
pub fn update_projekt(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: UpdateProjektPayload,
) -> Result<Projekt, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;

    // Get existing projekt to preserve file path
    let existing = ProjektRepo::get_by_id(&conn, &payload.projekt_id)?;
    let file_path = existing.file_path.clone();

    let question_count = payload.questions.len() as u32;
    let content = ProjektContent {
        projekt_id: payload.projekt_id,
        questions: payload.questions,
    };

    let json = serde_json::to_string_pretty(&content)?;
    std::fs::write(&file_path, &json)
        .map_err(|e| DbError::Io(format!("Failed to write projekt file: {e}")))?;

    let now = Utc::now();
    let updated_at = now;
    let created_at = existing.created_at; // Preserve original creation time

    let projekt = Projekt {
        id: payload.projekt_id,
        name: payload.name,
        file_path: file_path.clone(),
        question_count,
        mode: payload.mode,
        topic_name: payload.topic_name,
        created_at,
        updated_at,
    };

    ProjektRepo::update(&conn, &projekt)?;

    Ok(projekt)
}

/// Input for loading a projekt by ID.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadProjektPayload {
    pub projekt_id: Uuid,
}

/// Load a projekt's full content from its JSON file.
#[tauri::command]
pub fn load_projekt(
    state: State<'_, AppState>,
    payload: LoadProjektPayload,
) -> Result<ProjektContent, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    let projekt = ProjektRepo::get_by_id(&conn, &payload.projekt_id)?;
    let json = std::fs::read_to_string(&projekt.file_path)
        .map_err(|e| DbError::Io(format!("Failed to read projekt file: {e}")))?;
    let content: ProjektContent = serde_json::from_str(&json)?;
    Ok(content)
}

/// List all projekty (metadata only), newest first.
#[tauri::command]
pub fn list_projekty(state: State<'_, AppState>) -> Result<Vec<Projekt>, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    ProjektRepo::list_all(&conn)
}

/// Input for deleting a projekt.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjektPayload {
    pub projekt_id: Uuid,
}

/// Delete a projekt's DB metadata and its JSON file on disk.
#[tauri::command]
pub fn delete_projekt(
    state: State<'_, AppState>,
    payload: DeleteProjektPayload,
) -> Result<(), DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    let projekt = ProjektRepo::get_by_id(&conn, &payload.projekt_id)?;

    // Best-effort file deletion; DB entry must be removed regardless.
    let _ = std::fs::remove_file(&projekt.file_path);

    ProjektRepo::delete(&conn, &payload.projekt_id)?;

    Ok(())
}

/// Input for exporting a saved projekt to a `.txt` file.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProjektToTxtPayload {
    pub projekt_id: Uuid,
    pub filename: String,
}

/// Export a saved projekt as a `.txt` file using the same format as `export_to_txt`.
#[tauri::command]
pub fn export_projekt_to_txt(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ExportProjektToTxtPayload,
) -> Result<ExportResult, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    let projekt = ProjektRepo::get_by_id(&conn, &payload.projekt_id)?;
    let json = std::fs::read_to_string(&projekt.file_path)
        .map_err(|e| DbError::Io(format!("Failed to read projekt file: {e}")))?;
    let content: ProjektContent = serde_json::from_str(&json)?;

    // Build owned Template/Variant pairs so ExportQuestion can borrow safely.
    let mut templates: Vec<Template> = Vec::with_capacity(content.questions.len());
    let mut variants: Vec<Variant> = Vec::with_capacity(content.questions.len());

    for pq in &content.questions {
        templates.push(Template {
            id: pq.template_id,
            question_text: pq.question_text.clone(),
            formula: String::new(),
            equation_text: String::new(),
            numeric_answer: None,
            result_unit: pq.result_unit.clone(),
            point_value: pq.point_value,
            created_at: Utc::now(),
        });

        let assigned_numeric: HashMap<String, f64> = pq
            .assigned_values
            .iter()
            .filter_map(|(k, v)| v.as_f64().map(|f| (k.clone(), f)))
            .collect();

        variants.push(Variant::new(
            pq.template_id,
            assigned_numeric,
            pq.assigned_strings.clone(),
            pq.correct_answer.unwrap_or(0.0),
            pq.numeric_options.clone(),
            pq.correct_option,
            pq.interval_lo,
            pq.interval_hi,
            pq.seed,
        ));
    }

    let questions: Vec<ExportQuestion<'_>> = content
        .questions
        .iter()
        .enumerate()
        .map(|(i, pq)| ExportQuestion {
            template: &templates[i],
            variant: &variants[i],
            variable_precisions: pq.variable_precisions.clone(),
            result_precision: pq.result_precision,
            mode: pq.mode,
        })
        .collect();

    let content_str = write_txt(&questions);

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| DbError::Io(format!("Failed to resolve app data dir: {e}")))?;
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| DbError::Io(format!("Failed to create app data dir: {e}")))?;

    let file_name = if payload.filename.ends_with(".txt") {
        payload.filename
    } else {
        format!("{}.txt", payload.filename)
    };
    let file_path = app_data_dir.join(&file_name);

    std::fs::write(&file_path, &content_str)
        .map_err(|e| DbError::Io(format!("Failed to write export file: {e}")))?;

    Ok(ExportResult {
        content: content_str,
        file_path: file_path.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// Output files (testy)
// ---------------------------------------------------------------------------

/// List all exported `.txt` files ordered by creation time (newest first).
#[tauri::command]
pub fn list_output_files(state: State<'_, AppState>) -> Result<Vec<OutputFile>, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    OutputFileRepo::list_all(&conn)
}

/// Read the text content of an exported file by its id.
#[tauri::command]
pub fn read_output_file(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<OutputFileContent, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    let file = OutputFileRepo::get_by_id(&conn, &id)?;
    let content = std::fs::read_to_string(&file.file_path)
        .map_err(|e| DbError::Io(format!("Failed to read output file: {e}")))?;
    Ok(OutputFileContent { file, content })
}

/// Delete an exported file record and its underlying `.txt` file.
#[tauri::command]
pub fn delete_output_file(state: State<'_, AppState>, id: Uuid) -> Result<(), DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    let file = OutputFileRepo::get_by_id(&conn, &id)?;
    if std::path::Path::new(&file.file_path).exists() {
        std::fs::remove_file(&file.file_path)
            .map_err(|e| DbError::Io(format!("Failed to remove output file: {e}")))?;
    }
    OutputFileRepo::delete(&conn, &id)
}

/// Result of reading an output file, including its text content.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputFileContent {
    pub file: OutputFile,
    pub content: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract numeric placeholder values written inline in question text, e.g.
/// `[[rho_r=1.3384]]`, and return them as a symbol -> value map.
/// Non-numeric placeholders (e.g. `[[molekula=glukóza]]`) are ignored.
fn extract_inline_constants(question_text: &str) -> HashMap<String, f64> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\[\[([^\]=\s]+)(?:=([^\]]*))?\]\]").unwrap());

    let mut constants = HashMap::new();
    for cap in re.captures_iter(question_text) {
        let symbol = cap[1].trim();
        let value_str = cap.get(2).map(|m| m.as_str().trim()).unwrap_or("");
        if value_str.is_empty() {
            continue;
        }
        let value = value_str.replace(',', ".").parse::<f64>();
        if let Ok(value) = value {
            constants.insert(symbol.to_string(), value);
        }
    }
    constants
}

/// Load variables, constants, and a (possibly default) constraint for a template.
/// Inline numeric placeholder values from the question text are also included
/// as constants so they can be referenced in the formula.
fn load_template_dependencies(
    conn: &rusqlite::Connection,
    template: &Template,
) -> Result<
    (
        Vec<crate::models::Variable>,
        HashMap<String, f64>,
        ResultConstraint,
    ),
    DbError,
> {
    let variables = TemplateRepo::get_variables_with_comparisons(conn, &template.id)?;

    let linked_consts = TemplateRepo::get_constants(conn, &template.id)?;
    let mut constants = HashMap::new();
    for tc in &linked_consts {
        let c = ConstantRepo::get_by_id(conn, &tc.constant_id)?;
        constants.insert(c.symbol.clone(), c.value);
    }

    for (symbol, value) in extract_inline_constants(&template.question_text) {
        constants.entry(symbol).or_insert(value);
    }

    let constraint = TemplateRepo::get_constraint(conn, &template.id)?.unwrap_or_else(|| {
        ResultConstraint::new(template.id, None, None, None, ConstraintType::Range)
    });

    Ok((variables, constants, constraint))
}

fn generation_to_db_error(err: GenerationError) -> DbError {
    DbError::Validation(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_inline_constants_parses_numeric_placeholders() {
        let text = "hustota [[rho_r=1,3384]] g/cm3 a objem [[V]] cm3";
        let constants = extract_inline_constants(text);
        assert!((constants.get("rho_r").unwrap() - 1.3384).abs() < 1e-10);
        assert_eq!(constants.get("V"), None);
    }

    #[test]
    fn extract_inline_constants_ignores_non_numeric_placeholders() {
        let text = "[[molekula=glukóza]] a [[rho_r=1.5]]";
        let constants = extract_inline_constants(text);
        assert_eq!(constants.len(), 1);
        assert!((constants.get("rho_r").unwrap() - 1.5).abs() < 1e-10);
    }
}
