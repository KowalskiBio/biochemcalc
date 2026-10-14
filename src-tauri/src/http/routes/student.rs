//! `/api/student/*` — the practice generator and leaderboard.
//!
//! Split in two: [`router`] (practice, tests, streak runs, reports) is the
//! laboratory-calculations section and sits behind `require_calculations`;
//! [`leaderboard_router`] is shared by every section.
//!
//! Mounted behind `require_auth` but *not* `require_teacher`: this is the
//! only part of the API a student account can reach. Every handler derives
//! the acting user from the session (`CurrentUser`) rather than from the
//! request body, so no client can practise, score, or grade as someone else.

use crate::commands::practice::{
    do_leaderboard, do_list_practice_topics, do_list_test_topics, do_next_question,
    do_submit_answer, LeaderboardEntry, NextQuestionPayload, PracticeAnswerResult,
    PracticeQuestion, PracticeTopic, SubmitAnswerPayload, TestTopicOption,
};
use crate::commands::reports::{do_report_question, ReportQuestionPayload};
use crate::commands::streak_run::{
    do_next_streak_question, do_start_streak_run, do_streak_leaderboard, do_streak_run_summary,
    NextStreakQuestionPayload, StartStreakRunPayload, StreakLeaderboardEntry,
    StreakLeaderboardPayload, StreakRunSummary, StreakRunSummaryPayload, StreakRunView,
};
use crate::commands::test_session::{
    do_finish_test, do_start_test, FinishTestPayload, StartTestPayload, TestResults,
    TestSessionView,
};
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

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct TestTopicsPayload {
    /// Which test the student is about to sit — the bar for being listed
    /// differs, since the úvodní test needs a bigger band than the průběžný.
    kind: crate::models::TestKind,
}

/// Taken as raw bytes rather than through the `Json` extractor on purpose:
/// a browser running a cached bundle from before the split calls this with
/// no body and no `Content-Type` at all, which `Json` rejects outright. Such
/// a client gets the průběžný list, which is the list it always got.
async fn test_topics(
    State(state): State<Arc<AppState>>,
    body: axum::body::Bytes,
) -> Result<Json<Vec<TestTopicOption>>, HttpError> {
    let payload: TestTopicsPayload = if body.is_empty() {
        TestTopicsPayload::default()
    } else {
        serde_json::from_slice(&body).map_err(|e| {
            HttpError::from(crate::db::DbError::Validation(format!(
                "Neplatný požadavek: {e}"
            )))
        })?
    };
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_test_topics(&conn, payload.kind)?))
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

async fn start_test(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<StartTestPayload>,
) -> Result<Json<TestSessionView>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_start_test(&conn, &user.id, &payload)?))
}

async fn finish_test(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<FinishTestPayload>,
) -> Result<Json<TestResults>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_finish_test(&conn, &user.id, &payload)?))
}

async fn start_streak_run(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<StartStreakRunPayload>,
) -> Result<Json<StreakRunView>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_start_streak_run(&conn, &user.id, &payload)?))
}

async fn next_streak_question(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<NextStreakQuestionPayload>,
) -> Result<Json<PracticeQuestion>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_next_streak_question(&conn, &user.id, &payload)?))
}

async fn streak_run_summary(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<StreakRunSummaryPayload>,
) -> Result<Json<StreakRunSummary>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_streak_run_summary(&conn, &user.id, &payload)?))
}

async fn streak_leaderboard(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<StreakLeaderboardPayload>,
) -> Result<Json<Vec<StreakLeaderboardEntry>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_streak_leaderboard(&conn, &payload)?))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/topics", post(topics))
        .route("/test-topics", post(test_topics))
        .route("/next-question", post(next_question))
        .route("/submit-answer", post(submit_answer))
        .route("/report-question", post(report_question))
        .route("/start-test", post(start_test))
        .route("/finish-test", post(finish_test))
        .route("/start-streak-run", post(start_streak_run))
        .route("/next-streak-question", post(next_streak_question))
        .route("/streak-run-summary", post(streak_run_summary))
}

/// Leaderboards stay reachable from every section.
pub fn leaderboard_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/leaderboard", post(leaderboard))
        .route("/streak-leaderboard", post(streak_leaderboard))
}
