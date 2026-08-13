//! One route per existing Tauri command, all teacher-only (mounted under
//! `/api/cmd/*` and gated by `require_auth` + `require_teacher` in
//! `http::mod`). Each handler calls the exact same repo/engine functions the
//! Tauri command already calls — no business logic lives here, only
//! HTTP<->Rust plumbing.
//!
//! `import_test1`/`import_reparse_test1` are deliberately not exposed here:
//! they read a hardcoded absolute path on the original developer's machine
//! (`src/commands/importer.rs`) and are dev-only debugging tools, not
//! something any web user should be able to trigger.

use crate::commands::reports::{
    do_delete_question_report, do_get_question_report, do_list_question_reports,
    QuestionReportDetail, QuestionReportSummary,
};
use crate::commands::{
    self, BulkImportTemplatesPayload, ClearTemplateHistoryPayload, CreateCategoryPayload,
    CreateConstantPayload, CreateSetPayload, CreateTemplatePayload, CreateTopicGroupPayload,
    CreateTopicPayload, CreateVariablePayload, DeleteProjektPayload, ExportPayload,
    ExportProjektToTxtPayload, ExportResult, GenerateForTemplatesPayload, GeneratedTemplate,
    LoadProjektPayload, MoveSetPayload, MoveTopicToGroupPayload, OutputFileContent,
    RegenerateVariantPayload, RenameTopicGroupPayload, ReorderTemplatesPayload,
    ReorderTopicGroupsPayload, ReorderTopicsInGroupPayload, SaveProjektPayload,
    SetTemplatePayload, TemplateLocation, TemplateWithDetails, UpdateConstantPayload,
    UpdateProjektPayload, UpdateSetNamePayload, UpdateSetModePayload, UpdateTemplatePayload,
    UpdateTemplateWithVariablesPayload, UpdateTemplatesByEquationPayload, UpdateTopicPayload,
    UpdateVariablePayload, VictorChatPayload, VictorResponse, VictorSettings,
    VictorSettingsPayload,
};
use crate::db::repos::{
    CategoryRepo, ConstantRepo, OutputFileRepo, ProjektRepo, SetRepo, TemplateHistoryRepo,
    TemplateRepo, TopicGroupRepo, TopicRepo, VariableHistoryRepo, VariableRepo,
};
use crate::db::AppState;
use crate::http::error::HttpError;
use crate::models::{
    Category, Constant, Projekt, ProjektContent, Set, SetTemplate, Template,
    TemplateHistoryEntry, Topic, TopicGroup, Variable, VariableHistoryEntry, Variant,
};
use crate::models::OutputFile;
use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Small request-body shapes for commands that don't already have a payload
// struct (single id, or a couple of named scalars).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdBody {
    id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TopicIdBody {
    topic_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetIdBody {
    set_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaginationBody {
    limit: u32,
    offset: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateIdPaginationBody {
    template_id: Uuid,
    limit: u32,
    offset: u32,
}

macro_rules! conn {
    ($state:expr) => {
        crate::util::lock_db(&$state.db)
    };
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

async fn create_topic(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateTopicPayload>,
) -> Result<Json<Topic>, HttpError> {
    let conn = conn!(state);
    let topic = Topic::new(payload.name);
    TopicRepo::insert(&conn, &topic)?;
    Ok(Json(topic))
}

async fn list_topics(State(state): State<Arc<AppState>>) -> Result<Json<Vec<Topic>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(TopicRepo::list_all(&conn)?))
}

async fn get_topic(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<Json<Topic>, HttpError> {
    let conn = conn!(state);
    Ok(Json(TopicRepo::get_by_id(&conn, &body.id)?))
}

async fn update_topic(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateTopicPayload>,
) -> Result<Json<Topic>, HttpError> {
    let conn = conn!(state);
    // group_id/position are preserved from the existing row — TopicRepo::update
    // never touches them, so the response must reflect their actual persisted
    // values rather than defaulting to "unsorted".
    let existing = TopicRepo::get_by_id(&conn, &payload.id)?;
    let topic = Topic {
        id: payload.id,
        name: payload.name,
        created_at: chrono::Utc::now(),
        for_students: payload.for_students,
        group_id: existing.group_id,
        position: existing.position,
    };
    TopicRepo::update(&conn, &topic)?;
    Ok(Json(topic))
}

async fn delete_topic(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    TopicRepo::delete(&conn, &body.id)?;
    Ok(())
}

async fn duplicate_topic(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<Json<Topic>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_duplicate_topic(&conn, &body.id)?))
}

// ---------------------------------------------------------------------------
// Topic groups ("Skupiny")
// ---------------------------------------------------------------------------

async fn create_topic_group(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateTopicGroupPayload>,
) -> Result<Json<TopicGroup>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_create_topic_group(&conn, payload)?))
}

async fn list_topic_groups(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<TopicGroup>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(TopicGroupRepo::list_all(&conn)?))
}

async fn rename_topic_group(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RenameTopicGroupPayload>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    TopicGroupRepo::rename(&conn, &payload.id, &payload.name)?;
    Ok(())
}

async fn delete_topic_group(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    TopicGroupRepo::delete(&conn, &body.id)?;
    Ok(())
}

async fn reorder_topic_groups(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ReorderTopicGroupsPayload>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    TopicGroupRepo::reorder(&conn, &payload.group_ids)?;
    Ok(())
}

async fn move_topic_to_group(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveTopicToGroupPayload>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    TopicRepo::move_to_group(&conn, &payload.topic_id, payload.group_id)?;
    Ok(())
}

async fn reorder_topics_in_group(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ReorderTopicsInGroupPayload>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    TopicRepo::reorder_within_group(&conn, &payload.topic_ids)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

async fn create_variable(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateVariablePayload>,
) -> Result<Json<Variable>, HttpError> {
    let conn = conn!(state);
    let variable = commands::build_variable_from_payload(payload);
    VariableRepo::insert(&conn, &variable)?;
    Ok(Json(variable))
}

async fn list_variables(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Variable>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(VariableRepo::list_all(&conn)?))
}

async fn get_variable(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<Json<Variable>, HttpError> {
    let conn = conn!(state);
    Ok(Json(VariableRepo::get_by_id(&conn, &body.id)?))
}

async fn update_variable(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateVariablePayload>,
) -> Result<Json<Variable>, HttpError> {
    let conn = conn!(state);
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
        created_at: chrono::Utc::now(),
    };
    VariableRepo::update(&conn, &variable)?;
    Ok(Json(variable))
}

async fn delete_variable(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    VariableRepo::delete(&conn, &body.id)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

async fn create_constant(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateConstantPayload>,
) -> Result<Json<Constant>, HttpError> {
    let conn = conn!(state);
    let mut constant = Constant::new(
        payload.name,
        payload.symbol,
        payload.value,
        payload.unit,
        payload.is_builtin,
    );
    constant.formula = payload.formula;
    ConstantRepo::insert(&conn, &constant)?;
    Ok(Json(constant))
}

async fn list_constants(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Constant>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(ConstantRepo::list_all(&conn)?))
}

async fn get_constant(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<Json<Constant>, HttpError> {
    let conn = conn!(state);
    Ok(Json(ConstantRepo::get_by_id(&conn, &body.id)?))
}

async fn update_constant(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateConstantPayload>,
) -> Result<Json<Constant>, HttpError> {
    let conn = conn!(state);
    let existing = ConstantRepo::get_by_id(&conn, &payload.id)?;
    let constant = Constant {
        id: payload.id,
        name: payload.name,
        symbol: payload.symbol,
        value: payload.value,
        unit: payload.unit,
        is_builtin: existing.is_builtin,
        formula: payload.formula,
        created_at: chrono::Utc::now(),
    };
    ConstantRepo::update(&conn, &constant)?;
    Ok(Json(constant))
}

async fn delete_constant(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    ConstantRepo::delete(&conn, &body.id)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

async fn create_template(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateTemplatePayload>,
) -> Result<Json<Template>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_create_template(&conn, payload)?))
}

async fn list_templates(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Template>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(TemplateRepo::list_all(&conn)?))
}

async fn get_template(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<Json<Template>, HttpError> {
    let conn = conn!(state);
    Ok(Json(TemplateRepo::get_by_id(&conn, &body.id)?))
}

async fn get_template_with_details(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<Json<TemplateWithDetails>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::load_template_with_details(&conn, &body.id)?))
}

async fn get_template_location(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<Json<Option<TemplateLocation>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_get_template_location(&conn, &body.id)?))
}

async fn update_template(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateTemplatePayload>,
) -> Result<Json<Template>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_update_template(&conn, payload)?))
}

async fn update_templates_by_equation(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateTemplatesByEquationPayload>,
) -> Result<Json<usize>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_update_templates_by_equation(
        &conn, payload,
    )?))
}

async fn update_template_with_variables(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateTemplateWithVariablesPayload>,
) -> Result<Json<TemplateWithDetails>, HttpError> {
    let conn = conn!(state);
    let id = payload.id;
    commands::apply_template_variable_mutations(&conn, payload)?;
    Ok(Json(commands::load_template_with_details(&conn, &id)?))
}

async fn delete_template(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    TemplateRepo::delete(&conn, &body.id)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async fn list_variable_history_by_template(
    State(state): State<Arc<AppState>>,
    Json(body): Json<TemplateIdPaginationBody>,
) -> Result<Json<Vec<VariableHistoryEntry>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(VariableHistoryRepo::list_by_template(
        &conn,
        &body.template_id,
        body.limit,
        body.offset,
    )?))
}

async fn list_all_variable_history(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PaginationBody>,
) -> Result<Json<Vec<VariableHistoryEntry>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(VariableHistoryRepo::list_all(
        &conn, body.limit, body.offset,
    )?))
}

async fn list_template_history_by_template(
    State(state): State<Arc<AppState>>,
    Json(body): Json<TemplateIdPaginationBody>,
) -> Result<Json<Vec<TemplateHistoryEntry>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(TemplateHistoryRepo::list_by_template(
        &conn,
        &body.template_id,
        body.limit,
        body.offset,
    )?))
}

async fn list_all_template_history(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PaginationBody>,
) -> Result<Json<Vec<TemplateHistoryEntry>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(TemplateHistoryRepo::list_all(
        &conn, body.limit, body.offset,
    )?))
}

async fn clear_template_history(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ClearTemplateHistoryPayload>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    VariableHistoryRepo::delete_for_template(&conn, &payload.template_id)?;
    TemplateHistoryRepo::delete_for_template(&conn, &payload.template_id)?;
    Ok(())
}

async fn clear_all_history(State(state): State<Arc<AppState>>) -> Result<(), HttpError> {
    let conn = conn!(state);
    conn.execute("DELETE FROM variable_history", [])
        .map_err(crate::db::DbError::Sqlite)?;
    conn.execute("DELETE FROM template_history", [])
        .map_err(crate::db::DbError::Sqlite)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Categories and sets
// ---------------------------------------------------------------------------

async fn create_category(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateCategoryPayload>,
) -> Result<Json<Category>, HttpError> {
    let conn = conn!(state);
    let (category, _) = CategoryRepo::create(&conn, payload.topic_id, payload.point_value)?;
    Ok(Json(category))
}

async fn list_categories(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Category>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(CategoryRepo::list_all(&conn)?))
}

async fn list_categories_by_topic(
    State(state): State<Arc<AppState>>,
    Json(body): Json<TopicIdBody>,
) -> Result<Json<Vec<Category>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(CategoryRepo::list_by_topic(&conn, &body.topic_id)?))
}

async fn get_category(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<Json<Category>, HttpError> {
    let conn = conn!(state);
    Ok(Json(CategoryRepo::get_by_id(&conn, &body.id)?))
}

async fn get_category_with_sets(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<Json<(Category, Vec<Set>)>, HttpError> {
    let conn = conn!(state);
    Ok(Json(CategoryRepo::get_with_sets(&conn, &body.id)?))
}

async fn delete_category(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    CategoryRepo::delete(&conn, &body.id)?;
    Ok(())
}

async fn create_set(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateSetPayload>,
) -> Result<Json<Set>, HttpError> {
    let conn = conn!(state);
    Ok(Json(SetRepo::create(
        &conn,
        payload.category_id,
        payload.mode,
    )?))
}

async fn update_set_name(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateSetNamePayload>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    SetRepo::update_name(&conn, &payload.set_id, payload.name.as_deref())?;
    Ok(())
}

async fn move_set(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveSetPayload>,
) -> Result<Json<u8>, HttpError> {
    let conn = conn!(state);
    Ok(Json(SetRepo::move_to_category(
        &conn,
        &payload.set_id,
        &payload.target_category_id,
    )?))
}

async fn update_set_mode(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateSetModePayload>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    SetRepo::update_mode(&conn, &payload.set_id, payload.mode)?;
    Ok(())
}

async fn add_template_to_set(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SetTemplatePayload>,
) -> Result<Json<SetTemplate>, HttpError> {
    let conn = conn!(state);
    Ok(Json(SetRepo::add_template(
        &conn,
        &payload.set_id,
        &payload.template_id,
    )?))
}

async fn remove_template_from_set(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SetTemplatePayload>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    SetRepo::remove_template(&conn, &payload.set_id, &payload.template_id)?;
    Ok(())
}

async fn reorder_templates_in_set(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ReorderTemplatesPayload>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    SetRepo::reorder(&conn, &payload.set_id, &payload.template_ids)?;
    Ok(())
}

async fn get_set_with_templates(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SetIdBody>,
) -> Result<Json<(Set, Vec<TemplateWithDetails>)>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_get_set_with_templates(
        &conn,
        &body.set_id,
    )?))
}

// ---------------------------------------------------------------------------
// Generation / export
// ---------------------------------------------------------------------------

async fn generate_for_templates(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<GenerateForTemplatesPayload>,
) -> Result<Json<Vec<GeneratedTemplate>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_generate_for_templates(&conn, &payload)?))
}

async fn export_to_txt(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ExportPayload>,
) -> Result<Json<ExportResult>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_export_to_txt(
        &conn,
        &state.data_dir,
        payload,
    )?))
}

async fn list_output_files(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<OutputFile>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(OutputFileRepo::list_all(&conn)?))
}

async fn read_output_file(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<Json<OutputFileContent>, HttpError> {
    let conn = conn!(state);
    let file = OutputFileRepo::get_by_id(&conn, &body.id)?;
    let content = std::fs::read_to_string(&file.file_path)
        .map_err(|e| crate::db::DbError::Io(format!("Failed to read output file: {e}")))?;
    Ok(Json(OutputFileContent { file, content }))
}

async fn delete_output_file(
    State(state): State<Arc<AppState>>,
    Json(body): Json<IdBody>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    let file = OutputFileRepo::get_by_id(&conn, &body.id)?;
    if std::path::Path::new(&file.file_path).exists() {
        std::fs::remove_file(&file.file_path)
            .map_err(|e| crate::db::DbError::Io(format!("Failed to remove output file: {e}")))?;
    }
    OutputFileRepo::delete(&conn, &body.id)?;
    Ok(())
}

async fn regenerate_variant(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegenerateVariantPayload>,
) -> Result<Json<Variant>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_regenerate_variant(&conn, payload)?))
}

// ---------------------------------------------------------------------------
// Projekty
// ---------------------------------------------------------------------------

async fn save_projekt(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SaveProjektPayload>,
) -> Result<Json<Projekt>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_save_projekt(
        &conn,
        &state.data_dir,
        payload,
    )?))
}

async fn update_projekt(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateProjektPayload>,
) -> Result<Json<Projekt>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_update_projekt(&conn, payload)?))
}

async fn load_projekt(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoadProjektPayload>,
) -> Result<Json<ProjektContent>, HttpError> {
    let conn = conn!(state);
    let projekt = ProjektRepo::get_by_id(&conn, &payload.projekt_id)?;
    let json = std::fs::read_to_string(&projekt.file_path)
        .map_err(|e| crate::db::DbError::Io(format!("Failed to read projekt file: {e}")))?;
    let content: ProjektContent =
        serde_json::from_str(&json).map_err(crate::db::DbError::Serde)?;
    Ok(Json(content))
}

async fn list_projekty(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Projekt>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(ProjektRepo::list_all(&conn)?))
}

async fn delete_projekt(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DeleteProjektPayload>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    let projekt = ProjektRepo::get_by_id(&conn, &payload.projekt_id)?;
    let _ = std::fs::remove_file(&projekt.file_path);
    ProjektRepo::delete(&conn, &payload.projekt_id)?;
    Ok(())
}

async fn export_projekt_to_txt(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ExportProjektToTxtPayload>,
) -> Result<Json<ExportResult>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_export_projekt_to_txt(
        &conn,
        &state.data_dir,
        payload,
    )?))
}

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

async fn import_bulk_templates(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<BulkImportTemplatesPayload>,
) -> Result<Json<Topic>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_import_bulk_templates(&conn, payload)?))
}

// ---------------------------------------------------------------------------
// Victor
// ---------------------------------------------------------------------------

async fn get_victor_settings(
    State(state): State<Arc<AppState>>,
) -> Result<Json<VictorSettings>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_get_victor_settings(&conn)?))
}

async fn set_victor_settings(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<VictorSettingsPayload>,
) -> Result<Json<VictorSettings>, HttpError> {
    let conn = conn!(state);
    Ok(Json(commands::do_set_victor_settings(&conn, payload)?))
}

async fn chat_with_victor(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<VictorChatPayload>,
) -> Result<Json<VictorResponse>, HttpError> {
    let (api_base_url, api_key) = {
        let conn = conn!(state);
        commands::victor_settings_pair(&conn)?
    };
    Ok(Json(
        commands::do_chat_with_victor(&api_base_url, &api_key, payload).await?,
    ))
}

async fn list_question_reports(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<QuestionReportSummary>>, HttpError> {
    let conn = conn!(state);
    Ok(Json(do_list_question_reports(&conn)?))
}

async fn get_question_report(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<IdBody>,
) -> Result<Json<QuestionReportDetail>, HttpError> {
    let conn = conn!(state);
    Ok(Json(do_get_question_report(&conn, &payload.id)?))
}

async fn delete_question_report(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<IdBody>,
) -> Result<(), HttpError> {
    let conn = conn!(state);
    do_delete_question_report(&conn, &payload.id)?;
    Ok(())
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/create_topic", post(create_topic))
        .route("/list_topics", post(list_topics))
        .route("/get_topic", post(get_topic))
        .route("/update_topic", post(update_topic))
        .route("/delete_topic", post(delete_topic))
        .route("/duplicate_topic", post(duplicate_topic))
        .route("/create_topic_group", post(create_topic_group))
        .route("/list_topic_groups", post(list_topic_groups))
        .route("/rename_topic_group", post(rename_topic_group))
        .route("/delete_topic_group", post(delete_topic_group))
        .route("/reorder_topic_groups", post(reorder_topic_groups))
        .route("/move_topic_to_group", post(move_topic_to_group))
        .route("/reorder_topics_in_group", post(reorder_topics_in_group))
        .route("/create_variable", post(create_variable))
        .route("/list_variables", post(list_variables))
        .route("/get_variable", post(get_variable))
        .route("/update_variable", post(update_variable))
        .route("/delete_variable", post(delete_variable))
        .route("/create_constant", post(create_constant))
        .route("/list_constants", post(list_constants))
        .route("/get_constant", post(get_constant))
        .route("/update_constant", post(update_constant))
        .route("/delete_constant", post(delete_constant))
        .route("/create_template", post(create_template))
        .route("/list_templates", post(list_templates))
        .route("/get_template", post(get_template))
        .route(
            "/get_template_with_details",
            post(get_template_with_details),
        )
        .route("/get_template_location", post(get_template_location))
        .route("/update_template", post(update_template))
        .route(
            "/update_templates_by_equation",
            post(update_templates_by_equation),
        )
        .route(
            "/update_template_with_variables",
            post(update_template_with_variables),
        )
        .route("/delete_template", post(delete_template))
        .route(
            "/list_variable_history_by_template",
            post(list_variable_history_by_template),
        )
        .route("/list_all_variable_history", post(list_all_variable_history))
        .route(
            "/list_template_history_by_template",
            post(list_template_history_by_template),
        )
        .route("/list_all_template_history", post(list_all_template_history))
        .route("/clear_template_history", post(clear_template_history))
        .route("/clear_all_history", post(clear_all_history))
        .route("/create_category", post(create_category))
        .route("/list_categories", post(list_categories))
        .route("/list_categories_by_topic", post(list_categories_by_topic))
        .route("/get_category", post(get_category))
        .route("/get_category_with_sets", post(get_category_with_sets))
        .route("/delete_category", post(delete_category))
        .route("/create_set", post(create_set))
        .route("/update_set_name", post(update_set_name))
        .route("/move_set", post(move_set))
        .route("/update_set_mode", post(update_set_mode))
        .route("/add_template_to_set", post(add_template_to_set))
        .route(
            "/remove_template_from_set",
            post(remove_template_from_set),
        )
        .route(
            "/reorder_templates_in_set",
            post(reorder_templates_in_set),
        )
        .route("/get_set_with_templates", post(get_set_with_templates))
        .route("/generate_for_templates", post(generate_for_templates))
        .route("/export_to_txt", post(export_to_txt))
        .route("/list_output_files", post(list_output_files))
        .route("/read_output_file", post(read_output_file))
        .route("/delete_output_file", post(delete_output_file))
        .route("/regenerate_variant", post(regenerate_variant))
        .route("/save_projekt", post(save_projekt))
        .route("/update_projekt", post(update_projekt))
        .route("/load_projekt", post(load_projekt))
        .route("/list_projekty", post(list_projekty))
        .route("/delete_projekt", post(delete_projekt))
        .route("/export_projekt_to_txt", post(export_projekt_to_txt))
        .route("/import_bulk_templates", post(import_bulk_templates))
        .route("/get_victor_settings", post(get_victor_settings))
        .route("/set_victor_settings", post(set_victor_settings))
        .route("/chat_with_victor", post(chat_with_victor))
        .route("/list_question_reports", post(list_question_reports))
        .route("/get_question_report", post(get_question_report))
        .route("/delete_question_report", post(delete_question_report))
}
