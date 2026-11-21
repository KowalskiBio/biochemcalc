//! `/api/biomolecules/*` — the Biomolekuly molecule library and the quiz
//! leaderboard. Reading is open to any logged-in account (the frontend
//! caches the whole dataset per session); category/molecule management is
//! teacher-only. Recording a quiz score needs Biomolekuly access.

use crate::commands::biomolecule_reports::{
    do_delete_biomolecule_question_report, do_get_biomolecule_question_report,
    do_list_biomolecule_question_reports, do_report_biomolecule_question,
    BiomoleculeQuestionReportDetail, BiomoleculeQuestionReportSummary,
    BiomoleculeReportQuestionPayload,
};
use crate::commands::biomolecules::{
    do_create_biomolecule_test, do_create_category, do_create_molecule, do_create_peptidovka_test,
    do_create_topic, do_delete_biomolecule_test, do_delete_category, do_delete_molecule,
    do_delete_peptidovka_test, do_delete_topic, do_list_available_biomolecule_tests,
    do_list_available_peptidovka_tests, do_list_biomolecule_tests, do_list_data,
    do_list_peptidovka_settings, do_list_peptidovka_tests, do_peptidovka_leaderboard,
    do_quiz_leaderboard, do_record_peptidovka_run, do_record_quiz_result, do_record_streak_result,
    do_reorder_categories, do_reorder_molecules, do_reorder_topics,
    do_start_biomolecule_test_attempt, do_start_peptidovka_test_attempt, do_streak_leaderboard,
    do_submit_biomolecule_test_attempt, do_submit_peptidovka_test_attempt, do_update_category_meta,
    do_update_molecule, do_update_peptidovka_settings, do_update_topic_meta,
    BiomoleculeHistoryPayload, BiomoleculeLeaderboardEntry, BiomoleculeStreakLeaderboardEntry,
    BiomoleculeTestIdPayload, BiomoleculeTestStartResult, BiomoleculeTestStudentView,
    BiomoleculeTestTeacherView, BiomoleculeTestView, CreateBiomoleculeTestPayload,
    CreateCategoryPayload, CreateMoleculePayload, CreatePeptidovkaTestPayload, CreateTopicPayload,
    DeleteCategoryPayload, DeleteMoleculePayload, DeleteTopicPayload, PeptidovkaLeaderboardPayload,
    PeptidovkaSettings, PeptidovkaTestIdPayload, PeptidovkaTestStartResult,
    PeptidovkaTestStudentView, PeptidovkaTestTeacherView, PeptidovkaTestView,
    QuizLeaderboardPayload, RecordPeptidovkaRunPayload, RecordQuizResultPayload,
    RecordStreakResultPayload, ReorderCategoriesPayload, ReorderMoleculesPayload,
    ReorderTopicsPayload, StreakLeaderboardPayload, SubmitBiomoleculeTestAttemptPayload,
    SubmitPeptidovkaTestAttemptPayload, UpdateCategoryMetaPayload, UpdateMoleculePayload,
    UpdatePeptidovkaSettingsPayload, UpdateTopicMetaPayload,
};
use crate::db::repos::biomolecule_repo::BiomoleculeData;
use crate::db::repos::{BiomoleculeHistoryRecord, BiomoleculeHistoryRepo};
use crate::db::AppState;
use crate::http::error::HttpError;
use crate::http::middleware::CurrentUser;
use axum::extract::{Extension, State};
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportIdPayload {
    id: Uuid,
}

async fn data(State(state): State<Arc<AppState>>) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_data(&conn)?))
}

async fn create_category(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<CreateCategoryPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_create_category(&conn, &user.id, payload)?))
}

async fn update_category_meta(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<UpdateCategoryMetaPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_update_category_meta(&conn, &user.id, payload)?))
}

async fn delete_category(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<DeleteCategoryPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_delete_category(&conn, &user.id, payload)?))
}

async fn create_topic(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<CreateTopicPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_create_topic(&conn, &user.id, payload)?))
}

async fn update_topic_meta(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<UpdateTopicMetaPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_update_topic_meta(&conn, &user.id, payload)?))
}

async fn delete_topic(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<DeleteTopicPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_delete_topic(&conn, &user.id, payload)?))
}

async fn create_molecule(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<CreateMoleculePayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_create_molecule(&conn, &user.id, payload)?))
}

async fn update_molecule(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<UpdateMoleculePayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_update_molecule(&conn, &user.id, payload)?))
}

async fn delete_molecule(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<DeleteMoleculePayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_delete_molecule(&conn, &user.id, payload)?))
}

async fn reorder_topics(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<ReorderTopicsPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_reorder_topics(&conn, &user.id, payload)?))
}

async fn reorder_categories(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<ReorderCategoriesPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_reorder_categories(&conn, &user.id, payload)?))
}

async fn reorder_molecules(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<ReorderMoleculesPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_reorder_molecules(&conn, &user.id, payload)?))
}

async fn record_quiz_result(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<RecordQuizResultPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_record_quiz_result(&conn, &user.id, payload)?;
    Ok(())
}

async fn leaderboard(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<QuizLeaderboardPayload>,
) -> Result<Json<Vec<BiomoleculeLeaderboardEntry>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_quiz_leaderboard(&conn, &payload)?))
}

async fn record_streak_result(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<RecordStreakResultPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_record_streak_result(&conn, &user.id, payload)?;
    Ok(())
}

async fn streak_leaderboard(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<StreakLeaderboardPayload>,
) -> Result<Json<Vec<BiomoleculeStreakLeaderboardEntry>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_streak_leaderboard(&conn, &payload)?))
}

async fn peptidovka_leaderboard(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<PeptidovkaLeaderboardPayload>,
) -> Result<Json<Vec<BiomoleculeStreakLeaderboardEntry>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_peptidovka_leaderboard(&conn, &payload)?))
}

async fn peptidovka_settings(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<PeptidovkaSettings>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_peptidovka_settings(&conn)?))
}

async fn update_peptidovka_settings(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<UpdatePeptidovkaSettingsPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_update_peptidovka_settings(&conn, &user.id, payload)?;
    Ok(())
}

async fn biomolecule_history(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<BiomoleculeHistoryPayload>,
) -> Result<Json<Vec<BiomoleculeHistoryRecord>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(BiomoleculeHistoryRepo::list_all(
        &conn,
        payload.limit.unwrap_or(50),
        payload.offset.unwrap_or(0),
    )?))
}

async fn clear_biomolecule_history(State(state): State<Arc<AppState>>) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    BiomoleculeHistoryRepo::clear_all(&conn)?;
    Ok(())
}

async fn record_peptidovka_run(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<RecordPeptidovkaRunPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_record_peptidovka_run(&conn, &user.id, payload)?;
    Ok(())
}

async fn report_question(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<BiomoleculeReportQuestionPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_report_biomolecule_question(&conn, &user.id, &payload)?;
    Ok(())
}

async fn list_question_reports(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<BiomoleculeQuestionReportSummary>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_biomolecule_question_reports(&conn)?))
}

async fn get_question_report(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ReportIdPayload>,
) -> Result<Json<BiomoleculeQuestionReportDetail>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_get_biomolecule_question_report(
        &conn,
        &payload.id,
    )?))
}

async fn delete_question_report(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ReportIdPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_delete_biomolecule_question_report(&conn, &payload.id)?;
    Ok(())
}

async fn create_biomolecule_test(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<CreateBiomoleculeTestPayload>,
) -> Result<Json<BiomoleculeTestView>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_create_biomolecule_test(&conn, &user.id, payload)?))
}

async fn delete_biomolecule_test(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<BiomoleculeTestIdPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_delete_biomolecule_test(&conn, &user.id, &payload.test_id)?;
    Ok(())
}

async fn list_biomolecule_tests(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
) -> Result<Json<Vec<BiomoleculeTestTeacherView>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_biomolecule_tests(&conn, &user.id)?))
}

async fn available_biomolecule_tests(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
) -> Result<Json<Vec<BiomoleculeTestStudentView>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_available_biomolecule_tests(&conn, &user.id)?))
}

async fn start_biomolecule_test(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<BiomoleculeTestIdPayload>,
) -> Result<Json<BiomoleculeTestStartResult>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_start_biomolecule_test_attempt(
        &conn,
        &user.id,
        &payload.test_id,
    )?))
}

async fn submit_biomolecule_test(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<SubmitBiomoleculeTestAttemptPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_submit_biomolecule_test_attempt(
        &conn,
        &user.id,
        &payload.attempt_id,
        payload.total_count,
        payload.correct_count,
        payload.detail_json.as_deref(),
    )?;
    Ok(())
}

async fn create_peptidovka_test(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<CreatePeptidovkaTestPayload>,
) -> Result<Json<PeptidovkaTestView>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_create_peptidovka_test(&conn, &user.id, payload)?))
}

async fn delete_peptidovka_test(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<PeptidovkaTestIdPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_delete_peptidovka_test(&conn, &user.id, &payload.test_id)?;
    Ok(())
}

async fn list_peptidovka_tests(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
) -> Result<Json<Vec<PeptidovkaTestTeacherView>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_peptidovka_tests(&conn, &user.id)?))
}

async fn available_peptidovka_tests(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
) -> Result<Json<Vec<PeptidovkaTestStudentView>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_available_peptidovka_tests(&conn, &user.id)?))
}

async fn start_peptidovka_test(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<PeptidovkaTestIdPayload>,
) -> Result<Json<PeptidovkaTestStartResult>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_start_peptidovka_test_attempt(
        &conn,
        &user.id,
        &payload.test_id,
    )?))
}

async fn submit_peptidovka_test(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<SubmitPeptidovkaTestAttemptPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_submit_peptidovka_test_attempt(
        &conn,
        &user.id,
        &payload.attempt_id,
        payload.total_count,
        payload.correct_count,
        payload.detail_json.as_deref(),
    )?;
    Ok(())
}

/// Any authenticated user.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/data", post(data))
        .route("/leaderboard", post(leaderboard))
        .route("/streak-leaderboard", post(streak_leaderboard))
        .route("/peptidovka-leaderboard", post(peptidovka_leaderboard))
        .route("/peptidovka-settings", post(peptidovka_settings))
        .route("/record-peptidovka-run", post(record_peptidovka_run))
}

/// Accounts with Biomolekuly access.
pub fn quiz_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/record-quiz-result", post(record_quiz_result))
        .route("/record-streak-result", post(record_streak_result))
        .route("/report-question", post(report_question))
        .route(
            "/available-biomolecule-tests",
            post(available_biomolecule_tests),
        )
        .route("/start-biomolecule-test", post(start_biomolecule_test))
        .route("/submit-biomolecule-test", post(submit_biomolecule_test))
        .route(
            "/available-peptidovka-tests",
            post(available_peptidovka_tests),
        )
        .route("/start-peptidovka-test", post(start_peptidovka_test))
        .route("/submit-peptidovka-test", post(submit_peptidovka_test))
}

/// Teacher only.
pub fn teacher_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/create-topic", post(create_topic))
        .route("/update-topic-meta", post(update_topic_meta))
        .route("/delete-topic", post(delete_topic))
        .route("/create-category", post(create_category))
        .route("/update-category-meta", post(update_category_meta))
        .route("/delete-category", post(delete_category))
        .route("/create-molecule", post(create_molecule))
        .route("/update-molecule", post(update_molecule))
        .route("/delete-molecule", post(delete_molecule))
        .route("/reorder-topics", post(reorder_topics))
        .route("/reorder-categories", post(reorder_categories))
        .route("/reorder-molecules", post(reorder_molecules))
        .route(
            "/update-peptidovka-settings",
            post(update_peptidovka_settings),
        )
        .route("/biomolecule-history", post(biomolecule_history))
        .route(
            "/clear-biomolecule-history",
            post(clear_biomolecule_history),
        )
        .route("/list-question-reports", post(list_question_reports))
        .route("/get-question-report", post(get_question_report))
        .route("/delete-question-report", post(delete_question_report))
        .route("/create-biomolecule-test", post(create_biomolecule_test))
        .route("/delete-biomolecule-test", post(delete_biomolecule_test))
        .route("/biomolecule-tests", post(list_biomolecule_tests))
        .route("/create-peptidovka-test", post(create_peptidovka_test))
        .route("/delete-peptidovka-test", post(delete_peptidovka_test))
        .route("/peptidovka-tests", post(list_peptidovka_tests))
}
