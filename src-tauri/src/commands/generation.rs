use crate::db::repos::{ConstantRepo, OutputFileRepo, ProjektRepo, TemplateDecoyRepo, TemplateRepo};
use crate::db::{AppState, DbError};
use crate::engine::answer_targets::{apply_result_units, extract_target_symbols};
use crate::engine::export_writer::{write_txt, ExportQuestion};
use crate::engine::extract_fixed_placeholders;
use crate::engine::extract_molar_mass_constants;
use crate::engine::generator::{
    generate_numeric_options, generate_variant_with_targets, generate_variants_with_targets,
    open_interval, GenerationError,
};
use crate::models::{
    ConstraintType, Notation, OutputFile, Projekt, ProjektContent, ProjektQuestion,
    ResultConstraint, Template, TemplateMode, Variant,
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
    /// Optional per-call custom deviation, as a raw percent (e.g. `42.0` for
    /// ±42%). Applies to every template_id in this call, same as
    /// `difficulty`/`option_count` do today — the export dialog always calls
    /// this with a single-element `template_ids`, so that's equivalent to a
    /// true per-question override. Absent/non-finite/`<= 0` falls back to
    /// the `difficulty` preset.
    #[serde(default)]
    pub custom_spread_percent: Option<f64>,
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

    // Sanitized once here: a stray non-finite/non-positive percent from a
    // malformed caller is treated as "no override" rather than erroring,
    // and an absurdly large one is capped, matching this codebase's
    // philosophy of falling back silently on bad teacher-supplied input
    // (see decoy formula handling in generator.rs).
    let spread_override = payload
        .custom_spread_percent
        .filter(|p| p.is_finite() && *p > 0.0)
        .map(|p| (p / 100.0).min(10.0));

    for (template_index, template_id) in payload.template_ids.iter().enumerate() {
        let template = TemplateRepo::get_by_id(conn, template_id)?;
        let (variables, constants, constraint, fixed_values) =
            load_template_dependencies(conn, &template)?;
        let mut targets = extract_target_symbols(&template.question_text);
        apply_result_units(&mut targets, &template.result_unit);
        let decoys = TemplateDecoyRepo::list_by_template(conn, &template.id)?;

        // Give each template its own non-overlapping seed block so the correct
        // answer position is independent across templates in the same batch.
        let template_base_seed = payload
            .base_seed
            .wrapping_add((template_index as u64).wrapping_mul(payload.count as u64));

        // Teacher-facing generation (this preview/export path) always places
        // the correct answer at position 1 (R1/A) so the teacher doesn't have
        // to hunt for it; only interactive student practice keeps it random.
        let difficulty = payload.difficulty.as_str();
        let variants = generate_variants_with_targets(
            template.id,
            &template.formula,
            &variables,
            &constants,
            &constraint,
            payload.mode,
            payload.count as usize,
            template_base_seed,
            difficulty,
            payload.option_count,
            &fixed_values,
            &targets,
            &decoys,
            template.alternative_formula.as_deref(),
            true,
            spread_override,
            template.significant_digits,
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
    #[serde(default)]
    pub variable_notations: HashMap<String, Notation>,
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
            variable_notations: input.variable_notations.clone(),
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
    // Apply the batch difficulty preset consistently to initial generation
    // AND both manual-answer recalcs so a regenerated variant's spread never
    // disagrees across a single call.
    let difficulty = payload.difficulty.as_str();
    let (variables, constants, constraint, fixed_values) =
        load_template_dependencies(conn, &template)?;
    let mut targets = extract_target_symbols(&template.question_text);
    apply_result_units(&mut targets, &template.result_unit);
    let decoys = TemplateDecoyRepo::list_by_template(conn, &template.id)?;

    // Teacher-facing regeneration always places the correct answer at
    // position 1 (R1/A) — see do_generate_for_templates for the same policy.
    let mut variant = generate_variant_with_targets(
        template.id,
        &template.formula,
        &variables,
        &constants,
        &constraint,
        payload.mode,
        payload.seed,
        difficulty,
        payload.option_count,
        &fixed_values,
        &targets,
        &decoys,
        template.alternative_formula.as_deref(),
        true,
        None,
        template.significant_digits,
    )
    .map_err(|e| DbError::Validation(e.to_string()))?;

    if let Some(manual_answer) = payload.manual_answer {
        variant.correct_answer = manual_answer;

        match payload.mode {
            TemplateMode::Closed => {
                let mut rng = StdRng::seed_from_u64(payload.seed.wrapping_add(1));
                // A manual answer override is the teacher directly picking the
                // correct value; the decoy and alternace are left out of scope
                // here rather than evaluated against a correct answer the
                // teacher chose.
                let (options, position, _alt_position) = generate_numeric_options(
                    manual_answer,
                    &[],
                    None,
                    &constraint,
                    &mut rng,
                    difficulty,
                    payload.option_count,
                    true,
                    None,
                    template.significant_digits,
                )
                .map_err(|e| DbError::Validation(e.to_string()))?;
                variant.numeric_options = Some(options);
                variant.correct_option = Some(position);
                variant.alternate_option = None;
            }
            TemplateMode::Open => {
                let (lo, hi) = open_interval(manual_answer, &constraint, difficulty, None);
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
            decoy_formula: None,
            alternative_formula: None,
            created_at: Utc::now(),
        });

        let assigned_numeric: HashMap<String, f64> = pq
            .assigned_values
            .iter()
            .filter_map(|(k, v)| v.as_f64().map(|f| (k.clone(), f)))
            .collect();

        let mut variant = Variant::new(
            pq.template_id,
            assigned_numeric,
            pq.assigned_strings.clone(),
            pq.correct_answer.unwrap_or(0.0),
            pq.numeric_options.clone(),
            pq.correct_option,
            pq.interval_lo,
            pq.interval_hi,
            pq.seed,
        );
        // `Variant::new` nulls both of these, so a projekt export used to
        // lose every answer target past the first and the alternace's second
        // `ok` row, exporting differently from the same questions exported
        // straight from the set.
        variant.alternate_option = pq.alternate_option;
        variant.answers_data = pq.answers_data.clone();
        variants.push(variant);
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
            variable_notations: pq.variable_notations.clone().unwrap_or_default(),
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
    use crate::models::{Constant, TemplateDecoyInput, TemplateVariable, Variable};
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
            decoy_formula: None,
            alternative_formula: None,
            created_at: Utc::now(),
        };
        TemplateRepo::insert(&conn, &template, &[], &[], None, &[]).expect("insert template");

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
            TemplateRepo::insert(&conn, &template, &[tv], &[], Some(&constraint), &[])
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
            custom_spread_percent: None,
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

        // Teacher-facing generation always forces the correct answer to
        // position 1 (R1/A) — independent-seed generation still varies the
        // distractor values, but never the correct answer's position here.
        let positions: Vec<u8> = results
            .iter()
            .map(|r| {
                r.variants[0]
                    .correct_option
                    .expect("closed variant has position")
            })
            .collect();
        assert!(
            positions.iter().all(|&p| p == 1),
            "teacher-mode generation must always place the correct answer at position 1, got {:?}",
            positions
        );
    }

    fn insert_template_with_decoy(
        conn: &rusqlite::Connection,
        decoy_formula: Option<&str>,
    ) -> Uuid {
        insert_template_with_decoys(
            conn,
            decoy_formula
                .map(|f| vec![(f, 2)])
                .unwrap_or_default()
                .as_slice(),
        )
    }

    fn insert_template_with_decoys(conn: &rusqlite::Connection, decoys: &[(&str, u8)]) -> Uuid {
        let var = Variable::new("X".into(), "X".into(), 1.0, 10.0, 1.0, "g".into(), 0);
        VariableRepo::insert_raw(conn, &var).expect("insert variable");

        let template = Template::new(
            "Question [[X]]".into(),
            "X * 2".into(),
            "X × 2".into(),
            None,
            "g".into(),
            2,
        );
        let constraint = ResultConstraint::new(
            template.id,
            Some(0.0),
            Some(1000.0),
            None,
            ConstraintType::Range,
        );
        let tv = TemplateVariable {
            template_id: template.id,
            variable_id: var.id,
            placeholder: "X".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
        };
        let decoy_inputs: Vec<TemplateDecoyInput> = decoys
            .iter()
            .map(|(formula, option_count)| TemplateDecoyInput {
                formula: formula.to_string(),
                option_count: *option_count,
            })
            .collect();
        TemplateRepo::insert(conn, &template, &[tv], &[], Some(&constraint), &decoy_inputs)
            .expect("insert template");
        template.id
    }

    #[test]
    fn generate_for_templates_injects_decoy_value_into_closed_options() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let template_id = insert_template_with_decoy(&conn, Some("X * 3"));

        let payload = GenerateForTemplatesPayload {
            template_ids: vec![template_id],
            count: 1,
            base_seed: 12345,
            mode: TemplateMode::Closed,
            difficulty: "medium".into(),
            option_count: 5,
            custom_spread_percent: None,
        };

        let results = do_generate_for_templates(&conn, &payload).expect("generate");
        assert_eq!(results.len(), 1);
        let variant = &results[0].variants[0];
        let x = variant.assigned_values["X"];
        let decoy_value = x * 3.0;
        let options = variant.numeric_options.as_ref().unwrap();
        assert!(
            options.iter().any(|o| (o - decoy_value).abs() < 1e-6),
            "expected decoy value {decoy_value} among options {options:?}"
        );
        assert_eq!(
            options
                .iter()
                .filter(|o| (**o - variant.correct_answer).abs() < 1e-6)
                .count(),
            1,
            "correct answer must appear exactly once"
        );
    }

    #[test]
    fn generate_for_templates_without_decoy_is_unaffected() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let template_id = insert_template_with_decoy(&conn, None);

        let payload = GenerateForTemplatesPayload {
            template_ids: vec![template_id],
            count: 1,
            base_seed: 12345,
            mode: TemplateMode::Closed,
            difficulty: "medium".into(),
            option_count: 5,
            custom_spread_percent: None,
        };

        let results = do_generate_for_templates(&conn, &payload).expect("generate");
        let variant = &results[0].variants[0];
        assert_eq!(variant.numeric_options.as_ref().unwrap().len(), 5);
    }

    /// The export dialog's per-row "Odchylka (%)" override, end to end:
    /// a custom percent must produce a measurably wider option spread than
    /// the same seed/difficulty without it.
    #[test]
    fn custom_spread_percent_overrides_difficulty_for_the_whole_call() {
        let state = setup();
        let conn = state.db.lock().expect("lock");
        let template_id = insert_template_with_decoy(&conn, None);

        let base_payload = GenerateForTemplatesPayload {
            template_ids: vec![template_id],
            count: 10,
            base_seed: 777,
            mode: TemplateMode::Closed,
            difficulty: "medium".into(),
            option_count: 5,
            custom_spread_percent: None,
        };

        let max_relative_deviation = |results: &[GeneratedTemplate]| -> f64 {
            results[0]
                .variants
                .iter()
                .flat_map(|v| v.numeric_options.as_ref().unwrap().iter())
                .zip(results[0].variants.iter().flat_map(|v| {
                    std::iter::repeat(v.correct_answer).take(v.numeric_options.as_ref().unwrap().len())
                }))
                .map(|(&option, correct)| (option - correct).abs() / correct)
                .fold(0.0_f64, f64::max)
        };

        let without_override = do_generate_for_templates(&conn, &base_payload).expect("generate");
        let without_override_max = max_relative_deviation(&without_override);
        assert!(
            without_override_max <= 0.51,
            "medium preset should never exceed ~50% deviation, got {without_override_max}"
        );

        let with_override_payload = GenerateForTemplatesPayload {
            custom_spread_percent: Some(90.0),
            ..base_payload
        };
        let with_override = do_generate_for_templates(&conn, &with_override_payload).expect("generate");
        let with_override_max = max_relative_deviation(&with_override);
        assert!(
            with_override_max > 0.55,
            "a 90% custom_spread_percent should exceed the medium preset's 50% ceiling, got {with_override_max}"
        );
    }

    /// The reported defect: a multi-target question (two semicolon-separated
    /// equations, e.g. "calculate both mol and g") showed no unit at all for
    /// either result. "Jednotka výsledku" now accepts a `;`-separated unit
    /// per `[symbol]` answer-target marker, in order.
    #[test]
    fn multi_target_question_gets_units_from_semicolon_separated_result_unit() {
        let state = setup();
        let conn = state.db.lock().expect("lock");

        let var = Variable::new("V".into(), "V".into(), 10.0, 100.0, 1.0, "cm3".into(), 0);
        VariableRepo::insert_raw(&conn, &var).expect("insert variable");

        let template = Template::new(
            "Vyjádřete [[V]] cm3 vody v mol a g. [n][m]".into(),
            "n = V / 10; m = n * 5".into(),
            "n = V / 10; m = n × 5".into(),
            None,
            "mol;g".into(),
            2,
        );
        let constraint = ResultConstraint::new(
            template.id,
            Some(0.0),
            Some(10000.0),
            None,
            ConstraintType::Range,
        );
        let tv = TemplateVariable {
            template_id: template.id,
            variable_id: var.id,
            placeholder: "V".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
        };
        TemplateRepo::insert(&conn, &template, &[tv], &[], Some(&constraint), &[])
            .expect("insert template");

        let payload = GenerateForTemplatesPayload {
            template_ids: vec![template.id],
            count: 1,
            base_seed: 42,
            mode: TemplateMode::Closed,
            difficulty: "medium".into(),
            option_count: 5,
            custom_spread_percent: None,
        };

        let results = do_generate_for_templates(&conn, &payload).expect("generate");
        let answers = results[0].variants[0].answers_data.as_ref().unwrap();
        assert_eq!(answers.len(), 2);
        assert_eq!(answers[0].symbol, "n");
        assert_eq!(answers[0].unit.as_deref(), Some("mol"));
        assert_eq!(answers[1].symbol, "m");
        assert_eq!(answers[1].unit.as_deref(), Some("g"));
    }
    fn projekt_question(mode: TemplateMode) -> ProjektQuestion {
        ProjektQuestion {
            template_id: Uuid::new_v4(),
            question_text: "Vypočítejte [n mol][m g]".into(),
            result_unit: "mol;g".into(),
            point_value: 3,
            correct_answer: Some(2.0),
            override_answer: None,
            assigned_values: HashMap::new(),
            assigned_strings: HashMap::new(),
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: None,
            result_precision: 2,
            significant_digits: None,
            force_scientific: false,
            numeric_options: None,
            correct_option: None,
            alternate_option: None,
            interval_lo: Some(1.8),
            interval_hi: Some(2.2),
            answers_data: Some(vec![
                crate::models::AnswerField {
                    symbol: "n".into(),
                    value: 2.0,
                    unit: Some("mol".into()),
                    numeric_options: None,
                    correct_option: None,
                    alternate_option: None,
                    interval_lo: Some(1.8),
                    interval_hi: Some(2.2),
                },
                crate::models::AnswerField {
                    symbol: "m".into(),
                    value: 4.0,
                    unit: Some("g".into()),
                    numeric_options: None,
                    correct_option: None,
                    alternate_option: None,
                    interval_lo: Some(3.8),
                    interval_hi: Some(4.2),
                },
            ]),
            mode,
            seed: 1,
        }
    }

    /// A projekt used to be a lossy round trip: `ProjektQuestion` carried no
    /// answer targets and no alternace, so a two-answer question exported
    /// from a projekt came out as a one-answer question (unit "mol;g" and
    /// all), and an alternace question lost its second `ok` row.
    #[test]
    fn projekt_export_keeps_answer_targets_and_the_alternace() {
        let state = setup();
        let data_dir = std::env::temp_dir().join(format!("projekt-export-{}", Uuid::new_v4()));
        let conn = state.db.lock().expect("lock");

        let projekt = do_save_projekt(
            &conn,
            &data_dir,
            SaveProjektPayload {
                name: "Test".into(),
                topic_name: None,
                mode: TemplateMode::Open,
                questions: vec![projekt_question(TemplateMode::Open)],
            },
        )
        .expect("save projekt");

        let export = do_export_projekt_to_txt(
            &conn,
            &data_dir,
            ExportProjektToTxtPayload {
                projekt_id: projekt.id,
                filename: "test".into(),
            },
        )
        .expect("export projekt");

        assert!(
            export.content.contains(" n =  :n1  mol\n"),
            "first target missing from projekt export:\n{}",
            export.content
        );
        assert!(
            export.content.contains(" m =  :n2  g\n"),
            "second target missing from projekt export:\n{}",
            export.content
        );
        assert!(
            export.content.contains(":n1=1,80..2,20:n2=3,80..4,20 ok 3"),
            "evaluation row lost a target:\n{}",
            export.content
        );
        assert!(
            !export.content.contains("mol;g"),
            "the raw multi-unit string reached the export:\n{}",
            export.content
        );

        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// Projekt files written before those fields existed must keep loading.
    #[test]
    fn projekt_question_json_without_the_new_fields_still_loads() {
        let legacy = r#"{
            "templateId": "00000000-0000-0000-0000-000000000001",
            "questionText": "Vypočítejte hmotnost.",
            "resultUnit": "g",
            "pointValue": 2,
            "correctAnswer": 12.0,
            "overrideAnswer": null,
            "assignedValues": {},
            "assignedStrings": {},
            "variablePrecisions": {},
            "resultPrecision": 2,
            "numericOptions": null,
            "correctOption": null,
            "intervalLo": 11.0,
            "intervalHi": 13.0,
            "mode": "open",
            "seed": 7
        }"#;

        let parsed: ProjektQuestion = serde_json::from_str(legacy).expect("legacy projekt question");
        assert!(parsed.answers_data.is_none());
        assert!(parsed.alternate_option.is_none());
    }
}
