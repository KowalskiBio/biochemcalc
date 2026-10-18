//! `/api/biomolecules/*` — the Biomolekuly molecule library and the quiz
//! leaderboard. Reading is open to any logged-in account (the frontend
//! caches the whole dataset per session); category/molecule management is
//! teacher-only. Recording a quiz score needs Biomolekuly access.

use crate::commands::biomolecules::{
    do_create_category, do_create_molecule, do_create_topic, do_delete_category, do_delete_molecule,
    do_delete_topic, do_list_data, do_quiz_leaderboard, do_record_quiz_result,
    do_record_streak_result, do_streak_leaderboard, do_update_category_meta, do_update_molecule,
    do_update_topic_meta, BiomoleculeLeaderboardEntry, BiomoleculeStreakLeaderboardEntry,
    CreateCategoryPayload, CreateMoleculePayload, CreateTopicPayload, DeleteCategoryPayload,
    DeleteMoleculePayload, DeleteTopicPayload, QuizLeaderboardPayload, RecordQuizResultPayload,
    RecordStreakResultPayload, StreakLeaderboardPayload, UpdateCategoryMetaPayload,
    UpdateMoleculePayload, UpdateTopicMetaPayload,
};
use crate::db::repos::biomolecule_repo::BiomoleculeData;
use crate::db::AppState;
use crate::http::error::HttpError;
use crate::http::middleware::CurrentUser;
use axum::extract::{Extension, State};
use axum::routing::post;
use axum::{Json, Router};
use std::sync::Arc;

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
    Json(payload): Json<DeleteCategoryPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_delete_category(&conn, payload)?))
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
    Json(payload): Json<DeleteTopicPayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_delete_topic(&conn, payload)?))
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
    Json(payload): Json<DeleteMoleculePayload>,
) -> Result<Json<BiomoleculeData>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_delete_molecule(&conn, payload)?))
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

/// Any authenticated user.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/data", post(data))
        .route("/leaderboard", post(leaderboard))
        .route("/streak-leaderboard", post(streak_leaderboard))
}

/// Accounts with Biomolekuly access.
pub fn quiz_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/record-quiz-result", post(record_quiz_result))
        .route("/record-streak-result", post(record_streak_result))
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
}
