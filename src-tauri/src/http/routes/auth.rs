use crate::commands::auth::{
    do_change_password, do_create_invite_code, do_delete_user, do_forgot_password,
    do_list_invite_codes, do_list_users, do_login, do_logout, do_register, do_reset_password,
    do_revoke_invite_code, AuthSession, ChangePasswordPayload, CreateInviteCodePayload,
    ForgotPasswordPayload, LoginPayload, RegisterPayload, ResetPasswordPayload,
};
use crate::db::AppState;
use crate::http::error::HttpError;
use crate::http::middleware::{
    clear_session_cookie_header, session_cookie_header, set_cookie_header, CurrentUser,
    SessionTokenExt,
};
use crate::models::{InviteCode, User};
use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteUserBody {
    id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevokeInviteCodeBody {
    code: String,
}

fn session_response(session: AuthSession) -> Response {
    let max_age = (session.expires_at - chrono::Utc::now())
        .num_seconds()
        .max(0);
    let mut response = Json(session.user).into_response();
    set_cookie_header(
        &mut response,
        session_cookie_header(&session.token, max_age),
    );
    response
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginPayload>,
) -> Result<Response, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    let session = do_login(&conn, payload)?;
    Ok(session_response(session))
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterPayload>,
) -> Result<Response, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    let session = do_register(&conn, payload)?;
    Ok(session_response(session))
}

/// Always returns `204` whether or not `payload.email` belongs to an
/// account — the response must never leak that (see
/// `do_forgot_password`'s doc comment). The DB lock is dropped (the `{ }`
/// block) before `.await`-ing the mailer, mirroring `resolve_user_for_token`
/// in `middleware.rs`: a `MutexGuard` isn't `Send`, so it can't cross an
/// await point inside this `async fn`.
async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ForgotPasswordPayload>,
) -> Result<StatusCode, HttpError> {
    let issued = {
        let conn = crate::util::lock_db(&state.db);
        do_forgot_password(&conn, payload)?
    };
    if let Some(issued) = issued {
        let reset_link = format!(
            "{}/reset-password?token={}",
            state.public_base_url, issued.token
        );
        state
            .mailer
            .send_reset_email(
                issued.user.email.as_deref().unwrap_or_default(),
                &issued.user.username,
                &reset_link,
            )
            .await;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ResetPasswordPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_reset_password(&conn, payload)?;
    Ok(())
}

async fn logout(
    State(state): State<Arc<AppState>>,
    Extension(SessionTokenExt(token)): Extension<SessionTokenExt>,
) -> Result<Response, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_logout(&conn, &token)?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    set_cookie_header(&mut response, clear_session_cookie_header());
    Ok(response)
}

async fn me(Extension(CurrentUser(user)): Extension<CurrentUser>) -> Json<User> {
    Json(user)
}

async fn change_password(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<ChangePasswordPayload>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_change_password(&conn, &user.id, payload)?;
    Ok(())
}

async fn create_invite_code(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(payload): Json<CreateInviteCodePayload>,
) -> Result<Json<InviteCode>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_create_invite_code(&conn, &user.id, payload)?))
}

async fn list_invite_codes(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<InviteCode>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_invite_codes(&conn)?))
}

async fn revoke_invite_code(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RevokeInviteCodeBody>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_revoke_invite_code(&conn, &body.code)?;
    Ok(())
}

async fn list_users(State(state): State<Arc<AppState>>) -> Result<Json<Vec<User>>, HttpError> {
    let conn = crate::util::lock_db(&state.db);
    Ok(Json(do_list_users(&conn)?))
}

async fn delete_user(
    State(state): State<Arc<AppState>>,
    Extension(CurrentUser(user)): Extension<CurrentUser>,
    Json(body): Json<DeleteUserBody>,
) -> Result<(), HttpError> {
    let conn = crate::util::lock_db(&state.db);
    do_delete_user(&conn, &user.id, &body.id)?;
    Ok(())
}

/// Public: no session required.
pub fn public_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/login", post(login))
        .route("/register", post(register))
        .route("/forgot-password", post(forgot_password))
        .route("/reset-password", post(reset_password))
}

/// Any authenticated user (teacher or student).
///
/// `/me` is `post`, not `get`, purely for consistency with `apiFetch`'s
/// always-POST convention on the frontend (`src/lib/http.ts`) — there's no
/// REST purity concern here since this is a single trusted first-party
/// client, not a public API.
pub fn authenticated_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/logout", post(logout))
        .route("/me", post(me))
        .route("/change-password", post(change_password))
}

/// Teacher only — issuing invite codes is how new accounts get created at
/// all, so it must not be reachable by students. Same for seeing/managing
/// the account list.
pub fn teacher_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/invite-code", post(create_invite_code))
        .route("/invite-codes", post(list_invite_codes))
        .route("/invite-codes/revoke", post(revoke_invite_code))
        .route("/users", post(list_users))
        .route("/users/delete", post(delete_user))
}
