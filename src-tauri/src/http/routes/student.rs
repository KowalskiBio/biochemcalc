//! `/api/student/*` — the practice generator and leaderboard.
//!
//! Mounted behind `require_auth` but *not* `require_teacher`: this is the
//! only part of the API a student account can reach. Every handler derives
//! the acting user from the session (`CurrentUser`) rather than from the
//! request body, so no client can practise, score, or grade as someone else.

use crate::commands::practice::{
    do_leaderboard, do_list_practice_topics, do_next_question, do_submit_answer, LeaderboardEntry,
    NextQuestionPayload, PracticeAnswerResult, PracticeQuestion, PracticeTopic,
    SubmitAnswerPayload,
};
use crate::commands::reports::{do_report_question, ReportQuestionPayload};
use crate::db::AppState;
use crate::http::error::HttpError;
use crate::http::middleware::CurrentUser;
use axum::extract::{Extension, State};
use axum::routing::post;
use axum::{Json, Router};
use std::sync::Arc;

async fn topics(State(state): State<Arc<AppState>>) -> Result<Json<Vec<PracticeTopic>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_practice_topics(&conn)?))
}

async fn next_question(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<NextQuestionPayload>,
) -> Result<Json<PracticeQuestion>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_next_question(&conn, &user.id, &payload)?))
}

async fn submit_answer(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<SubmitAnswerPayload>,
) -> Result<Json<PracticeAnswerResult>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_submit_answer(&conn, &user.id, &payload)?))
}

async fn leaderboard(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<LeaderboardEntry>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_leaderboard(&conn)?))
}

async fn report_question(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<ReportQuestionPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_report_question(&conn, &user.id, &payload)?;
    Ok(())
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/topics", post(topics))
        .route("/next-question", post(next_question))
        .route("/submit-answer", post(submit_answer))
        .route("/leaderboard", post(leaderboard))
        .route("/report-question", post(report_question))
}
