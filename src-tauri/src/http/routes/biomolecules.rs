//! `/api/biomolecules/*` — Biomolekuly category display text (name and
//! description). Reading is open to any logged-in account; editing is
//! teacher-only. The quiz leaderboard is open to any logged-in account;
//! recording a quiz score needs Biomolekuly access.

use crate::commands::biomolecules::{
    do_list_category_overrides, do_quiz_leaderboard, do_record_quiz_result, do_update_category,
    BiomoleculeLeaderboardEntry, QuizLeaderboardPayload, RecordQuizResultPayload,
    UpdateCategoryPayload,
};
use crate::db::repos::biomolecule_category_repo::CategoryOverride;
use crate::db::AppState;
use crate::http::error::HttpError;
use crate::http::middleware::CurrentUser;
use axum::extract::{Extension, State};
use axum::routing::post;
use axum::{Json, Router};
use std::collections::HashMap;
use std::sync::Arc;

async fn category_overrides(
    State(state): State<Arc<AppState>>,
) -> Result<Json<HashMap<String, CategoryOverride>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_category_overrides(&conn)?))
}

async fn update_category(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<UpdateCategoryPayload>,
) -> Result<Json<HashMap<String, CategoryOverride>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_update_category(&conn, &user.id, payload)?))
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

/// Any authenticated user.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/category-overrides", post(category_overrides))
        .route("/leaderboard", post(leaderboard))
}

/// Accounts with Biomolekuly access.
pub fn quiz_router() -> Router<Arc<AppState>> {
    Router::new().route("/record-quiz-result", post(record_quiz_result))
}

/// Teacher only.
pub fn teacher_router() -> Router<Arc<AppState>> {
    Router::new().route("/update-category", post(update_category))
}
