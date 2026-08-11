use crate::db::repos::{ConstantRepo, OutputFileRepo, ProjektRepo, TemplateRepo};
use crate::db::{AppState, DbError};
use crate::engine::answer_targets::extract_target_symbols;
use crate::engine::export_writer::{write_txt, ExportQuestion};
use crate::engine::extract_fixed_placeholders;
use crate::engine::extract_molar_mass_constants;
use crate::engine::generator::{
    generate_numeric_options, generate_variant_with_targets, generate_variants_with_targets,
    open_interval, GenerationError,
};
use crate::models::{
    ConstraintType, OutputFile, Projekt, ProjektContent, ProjektQuestion, ResultConstraint,
    Template, TemplateMode, Variant,
};
use chrono::Utc;
use rand::rngs::StdRng;
use rand::SeedableRng;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::State;
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
    crate::util::guard_panic("generate_for_templates", move || {
        let conn = crate::util::lock_db(&state.db);
        do_generate_for_templates(&conn, &payload)
    })
}

pub fn do_generate_for_templates(
    conn: &rusqlite::Connection,
    payload: &GenerateForTemplatesPayload,
) -> Result<Vec<GeneratedTemplate>, DbError> {
    let mut output = Vec::with_capacity(payload.template_ids.len());

    for (template_index, template_id) in payload.template_ids.iter().enumerate() {
        let template = TemplateRepo::get_by_id(conn, template_id)?;
        let (variables, constants, constraint, fixed_values) =
            load_template_dependencies(conn, &template)?;
        let targets = extract_target_symbols(&template.question_text);

        // Give each template its own non-overlapping seed block so the correct
        // answer position is independent across templates in the same batch.
        let template_base_seed = payload
            .base_seed
            .wrapping_add((template_index as u64).wrapping_mul(payload.count as u64));

        let variants = generate_variants_with_targets(
            template.id,
            &template.formula,
            &variables,
            &constants,
            &constraint,
            payload.mode,
            payload.count as usize,
            template_base_seed,
            &payload.difficulty,
            payload.option_count,
            &fixed_values,
            &targets,
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
    #[serde(default)]
    pub variable_significant_digits: HashMap<String, u8>,
    pub result_precision: u8,
    #[serde(default)]
    pub result_significant_digits: Option<u8>,
    #[serde(default)]
    pub force_scientific: bool,
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
    state: State<'_, AppState>,
    payload: ExportPayload,
) -> Result<ExportResult, DbError> {
    crate::util::guard_panic("export_to_txt", move || {
        let conn = crate::util::lock_db(&state.db);
        do_export_to_txt(&conn, &state.data_dir, payload)
    })
}

/// Shared by the Tauri command above and the HTTP handler in `src/http` —
/// takes `data_dir` explicitly instead of resolving it from an `AppHandle` so
/// it has no Tauri dependency at all.
pub fn do_export_to_txt(
    conn: &Connection,
    data_dir: &Path,
    payload: ExportPayload,
) -> Result<ExportResult, DbError> {
    let questions: Vec<ExportQuestion<'_>> = payload
        .questions
        .iter()
        .map(|input| ExportQuestion {
            template: &input.template,
            variant: &input.variant,
            variable_precisions: input.variable_precisions.clone(),
            variable_significant_digits: input.variable_significant_digits.clone(),
            result_precision: input.result_precision,
            result_significant_digits: input.result_significant_digits,
            force_scientific: input.force_scientific,
            mode: input.mode,
        })
        .collect();

    let content = write_txt(&questions);

    std::fs::create_dir_all(data_dir)
        .map_err(|e| DbError::Io(format!("Failed to create app data dir: {e}")))?;

    let file_name = if payload.filename.ends_with(".txt") {
        payload.filename
    } else {
        format!("{}.txt", payload.filename)
    };
    let file_path = data_dir.join(file_name);

    crate::util::atomic_write(&file_path, &content)
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
    crate::util::guard_panic("regenerate_variant", move || {
        let conn = crate::util::lock_db(&state.db);
        do_regenerate_variant(&conn, payload)
    })
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub(crate) fn do_regenerate_variant(
    conn: &Connection,
    payload: RegenerateVariantPayload,
) -> Result<Variant, DbError> {
    let template = TemplateRepo::get_by_id(conn, &payload.template_id)?;
    let (variables, constants, constraint, fixed_values) =
        load_template_dependencies(conn, &template)?;
    let targets = extract_target_symbols(&template.question_text);

    let mut variant = generate_variant_with_targets(
        template.id,
        &template.formula,
        &variables,
        &constants,
        &constraint,
        payload.mode,
        payload.seed,
        &payload.difficulty,
        payload.option_count,
        &fixed_values,
        &targets,
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

/// Persist a projekt as a JSON file in `data_dir/projekty/<uuid>.json`
/// and insert metadata into the database via ProjektRepo.
#[tauri::command]
pub fn save_projekt(
    state: State<'_, AppState>,
    payload: SaveProjektPayload,
) -> Result<Projekt, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_save_projekt(&conn, &state.data_dir, payload)
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub fn do_save_projekt(
    conn: &Connection,
    data_dir: &Path,
    payload: SaveProjektPayload,
) -> Result<Projekt, DbError> {
    let projekt_id = Uuid::new_v4();

    let projekty_dir = data_dir.join("projekty");
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
    crate::util::atomic_write(&file_path, &json)
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

    ProjektRepo::insert(conn, &projekt)?;

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

/// Update an existing projekt's content and metadata. Takes no data-dir
/// parameter — it reuses the file path already stored on the existing
/// projekt row rather than resolving one itself, so it needs no Tauri
/// `AppHandle` and works unchanged for both the desktop app and the HTTP
/// server.
#[tauri::command]
pub fn update_projekt(
    state: State<'_, AppState>,
    payload: UpdateProjektPayload,
) -> Result<Projekt, DbError> {
    let conn = crate::util::lock_db(&state.db);
    do_update_projekt(&conn, payload)
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub(crate) fn do_update_projekt(
    conn: &Connection,
    payload: UpdateProjektPayload,
) -> Result<Projekt, DbError> {
    // Get existing projekt to preserve file path
    let existing = ProjektRepo::get_by_id(conn, &payload.projekt_id)?;
    let file_path = existing.file_path.clone();

    let question_count = payload.questions.len() as u32;
    let content = ProjektContent {
        projekt_id: payload.projekt_id,
        questions: payload.questions,
    };

    let json = serde_json::to_string_pretty(&content)?;
    crate::util::atomic_write(&file_path, &json)
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

    ProjektRepo::update(conn, &projekt)?;

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
    let conn = crate::util::lock_db(&state.db);
    let projekt = ProjektRepo::get_by_id(&conn, &payload.projekt_id)?;
    let json = std::fs::read_to_string(&projekt.file_path)
        .map_err(|e| DbError::Io(format!("Failed to read projekt file: {e}")))?;
    let content: ProjektContent = serde_json::from_str(&json)?;
    Ok(content)
}

/// List all projekty (metadata only), newest first.
#[tauri::command]
pub fn list_projekty(state: State<'_, AppState>) -> Result<Vec<Projekt>, DbError> {
    let conn = crate::util::lock_db(&state.db);
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
    let conn = crate::util::lock_db(&state.db);
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
    state: State<'_, AppState>,
    payload: ExportProjektToTxtPayload,
) -> Result<ExportResult, DbError> {
    crate::util::guard_panic("export_projekt_to_txt", move || {
        let conn = crate::util::lock_db(&state.db);
        do_export_projekt_to_txt(&conn, &state.data_dir, payload)
    })
}

/// Shared by the Tauri command above and the HTTP handler in `src/http`.
pub fn do_export_projekt_to_txt(
    conn: &Connection,
    data_dir: &Path,
    payload: ExportProjektToTxtPayload,
) -> Result<ExportResult, DbError> {
    let projekt = ProjektRepo::get_by_id(conn, &payload.projekt_id)?;
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
            significant_digits: pq.significant_digits,
            force_scientific: pq.force_scientific,
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
            variable_significant_digits: pq.variable_significant_digits.clone(),
            result_precision: pq.result_precision,
            result_significant_digits: pq.significant_digits,
            force_scientific: pq.force_scientific,
            mode: pq.mode,
        })
        .collect();

    let content_str = write_txt(&questions);

    std::fs::create_dir_all(data_dir)
        .map_err(|e| DbError::Io(format!("Failed to create app data dir: {e}")))?;

    let file_name = if payload.filename.ends_with(".txt") {
        payload.filename
    } else {
        format!("{}.txt", payload.filename)
    };
    let file_path = data_dir.join(&file_name);

    crate::util::atomic_write(&file_path, &content_str)
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
    let conn = crate::util::lock_db(&state.db);
    OutputFileRepo::list_all(&conn)
}

/// Read the text content of an exported file by its id.
#[tauri::command]
pub fn read_output_file(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<OutputFileContent, DbError> {
    let conn = crate::util::lock_db(&state.db);
    let file = OutputFileRepo::get_by_id(&conn, &id)?;
    let content = std::fs::read_to_string(&file.file_path)
        .map_err(|e| DbError::Io(format!("Failed to read output file: {e}")))?;
    Ok(OutputFileContent { file, content })
}

/// Delete an exported file record and its underlying `.txt` file.
#[tauri::command]
pub fn delete_output_file(state: State<'_, AppState>, id: Uuid) -> Result<(), DbError> {
    let conn = crate::util::lock_db(&state.db);
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

/// Load variables, constants, and a (possibly default) constraint for a
/// template. Shared with `commands::practice` so a question served to a
/// student resolves its constants exactly as one generated for a test does.
pub(crate) fn load_template_dependencies(
    conn: &rusqlite::Connection,
    template: &Template,
) -> Result<
    (
        Vec<crate::models::Variable>,
        HashMap<String, f64>,
        ResultConstraint,
        HashMap<String, f64>,
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

    // Auto-resolve any M_* molar mass references in the formula so templates
    // do not need to manually link every atomic weight as a constant.
    let molar_constants = extract_molar_mass_constants(&template.formula);
    for (symbol, value) in molar_constants {
        constants.entry(symbol).or_insert(value);
    }

    // Auto-resolve any other constant symbols referenced in the formula from
    // the global constants table (e.g. NA, R, π) when they are not explicitly
    // linked to the template. Skip symbols that belong to variables or answer
    // targets so that a variable named N is not overwritten by the nitrogen
    // constant.
    let all_constants = ConstantRepo::list_all(conn)?;
    let formula_without_comment = template
        .formula
        .split('—')
        .next()
        .unwrap_or(&template.formula);
    let excluded_symbols: std::collections::HashSet<String> = variables
        .iter()
        .map(|v| v.symbol.clone())
        .chain(
            extract_target_symbols(&template.question_text)
                .into_iter()
                .map(|t| t.symbol),
        )
        .collect();

    // Token-based matching avoids unsupported Unicode look-around patterns and
    // guarantees whole-symbol matching (e.g. "N" must not match "NA").
    let identifier_regex = regex::Regex::new(r"[A-Za-z0-9_α-ω]+").expect("valid identifier regex");
    let formula_tokens: std::collections::HashSet<String> = identifier_regex
        .find_iter(formula_without_comment)
        .map(|m| m.as_str().to_string())
        .collect();
    for c in &all_constants {
        if constants.contains_key(&c.symbol) || excluded_symbols.contains(&c.symbol) {
            continue;
        }
        if formula_tokens.contains(&c.symbol) {
            constants.insert(c.symbol.clone(), c.value);
        }
    }

    let constant_aliases: &[(&str, &str)] = &[("NA", "N_A"), ("N_A", "NA")];
    for (alias, target) in constant_aliases {
        if constants.contains_key(*alias) || excluded_symbols.contains(*alias) {
            continue;
        }
        if let Some(&value) = constants.get(*target) {
            if formula_tokens.contains(*alias) {
                constants.insert(alias.to_string(), value);
            }
        }
    }

    let fixed_values = extract_fixed_placeholders(&template.question_text);

    let constraint = TemplateRepo::get_constraint(conn, &template.id)?.unwrap_or_else(|| {
        ResultConstraint::new(template.id, None, None, None, ConstraintType::Range)
    });

    Ok((variables, constants, constraint, fixed_values))
}

fn generation_to_db_error(err: GenerationError) -> DbError {
    DbError::Validation(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::{ConstantRepo, TemplateRepo, VariableRepo};
    use crate::db::AppState;
    use crate::models::{Constant, TemplateVariable, Variable};
    use chrono::Utc;

    fn setup() -> AppState {
        AppState::new_in_memory().expect("in-memory state")
    }

    #[test]
    fn load_template_dependencies_auto_resolves_na_and_custom_molar_mass() {
        let state = setup();
        let conn = state.db.lock().expect("lock");

        let na = Constant::new(
            "Avogadro (NA)".into(),
            "NA".into(),
            6.022e23,
            "mol⁻¹".into(),
            false,
        );
        let m_ethanol = Constant::new(
            "Molar mass ethanol".into(),
            "M_ethanol".into(),
            46.07,
            "g/mol".into(),
            false,
        );
        ConstantRepo::insert(&conn, &na).expect("insert NA");
        ConstantRepo::insert(&conn, &m_ethanol).expect("insert M_ethanol");

        let template_id = Uuid::new_v4();
        let template = Template {
            id: template_id,
            question_text: "Vypočítejte počet částic pro objem [[V]] L [N]".into(),
            formula: "N = (V / 22.4) * NA + M_ethanol".into(),
            equation_text: "N = (V / 22,4) × NA + M_ethanol".into(),
            numeric_answer: None,
            result_unit: "".into(),
            point_value: 2,
            significant_digits: None,
            force_scientific: false,
            created_at: Utc::now(),
        };
        TemplateRepo::insert(&conn, &template, &[], &[], None).expect("insert template");

        let (_, constants, _, _) = load_template_dependencies(&conn, &template).expect("load");

        assert!(
            constants.contains_key("NA"),
            "expected NA to be auto-resolved; got {:?}",
            constants
        );
        assert!(
            constants.contains_key("M_ethanol"),
            "expected M_ethanol to be auto-resolved; got {:?}",
            constants
        );
    }

    #[test]
    fn generate_for_templates_uses_independent_seeds_per_template() {
        let state = setup();
        let conn = state.db.lock().expect("lock");

        let mut template_ids = Vec::new();
        for i in 0..5 {
            let var = Variable::new(
                format!("X{i}"),
                format!("X{i}"),
                1.0,
                10.0,
                1.0,
                "g".into(),
                0,
            );
            VariableRepo::insert_raw(&conn, &var).expect("insert variable");

            let template = Template::new(
                format!("Question [[X{i}]] [Y{i}]"),
                format!("Y{i} = X{i} * 2"),
                format!("Y{i} = X{i} × 2"),
                None,
                "g".into(),
                2,
            );
            let constraint = ResultConstraint::new(
                template.id,
                Some(0.0),
                Some(100.0),
                None,
                ConstraintType::Range,
            );
            let tv = TemplateVariable {
                template_id: template.id,
                variable_id: var.id,
                placeholder: format!("X{i}"),
                greater_than_variable_id: None,
                less_than_variable_id: None,
            };
            TemplateRepo::insert(&conn, &template, &[tv], &[], Some(&constraint))
                .expect("insert template");
            template_ids.push(template.id);
        }

        let payload = GenerateForTemplatesPayload {
            template_ids,
            count: 1,
            base_seed: 12345,
            mode: TemplateMode::Closed,
            difficulty: "medium".into(),
            option_count: 5,
        };

        let results = do_generate_for_templates(&conn, &payload).expect("generate");
        assert_eq!(results.len(), 5);

        let seeds: Vec<u64> = results.iter().map(|r| r.variants[0].seed).collect();
        let unique_seeds: std::collections::HashSet<u64> = seeds.iter().cloned().collect();
        assert_eq!(
            unique_seeds.len(),
            seeds.len(),
            "each template should start from a different seed, got {:?}",
            seeds
        );

        let positions: Vec<u8> = results
            .iter()
            .map(|r| {
                r.variants[0]
                    .correct_option
                    .expect("closed variant has position")
            })
            .collect();
        let unique_positions: std::collections::HashSet<u8> = positions.iter().cloned().collect();
        assert!(
            unique_positions.len() > 1,
            "correct answer positions should vary across templates, got {:?}",
            positions
        );
    }
}
