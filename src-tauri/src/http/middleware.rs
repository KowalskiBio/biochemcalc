//! Session-cookie auth and role gating for the HTTP API.
//!
//! Sessions are opaque DB-backed tokens (see `commands::auth`), not JWTs —
//! deliberately, since this is a single-VM, single-process deployment with
//! no need for stateless cross-service verification. The cookie carries no
//! `Secure` flag yet because deployment is plain HTTP for now; that must be
//! added the moment TLS/a domain exists (see deploy notes in the plan).

use crate::db::repos::{SessionRepo, UserRepo};
use crate::db::AppState;
use crate::models::{Role, User};
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{Duration, Utc};
use std::sync::Arc;

pub const SESSION_COOKIE_NAME: &str = "session";
const SESSION_TTL_DAYS: i64 = 30;

/// The authenticated user, attached to request extensions by [`require_auth`].
#[derive(Clone)]
pub struct CurrentUser(pub User);

/// The raw session token, attached alongside `CurrentUser` so `/api/auth/logout`
/// can delete the exact session row without re-parsing the cookie itself.
#[derive(Clone)]
pub struct SessionTokenExt(pub String);

pub fn extract_session_token(headers: &HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    let prefix = format!("{SESSION_COOKIE_NAME}=");
    cookie_header.split(';').find_map(|part| {
        let value = part.trim().strip_prefix(&prefix)?;
        (!value.is_empty()).then(|| value.to_string())
    })
}

pub fn session_cookie_header(token: &str, max_age_secs: i64) -> String {
    format!("{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_secs}")
}

pub fn clear_session_cookie_header() -> String {
    format!("{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
}

fn error_response(status: StatusCode, kind: &str, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({"kind": kind, "message": message})),
    )
        .into_response()
}

fn unauthorized() -> Response {
    error_response(
        StatusCode::UNAUTHORIZED,
        "unauthorized",
        "Log in to continue",
    )
}

/// Synchronous on purpose: keeping the `MutexGuard` entirely inside a plain
/// (non-`async`) function call, rather than a `{ ... }` block or manual
/// `drop()` inside `require_auth` itself, guarantees it can never end up
/// part of that `async fn`'s generator state — a `MutexGuard` isn't `Send`,
/// and an item merely *dropped* before the trailing `.await` doesn't
/// reliably keep the generated future `Send` in every case.
fn resolve_user_for_token(state: &AppState, token: &str) -> Option<User> {
    let conn = crate::util::lock_db(&state.db);
    let session = SessionRepo::find_valid(&conn, token).ok().flatten()?;
    let user = UserRepo::get_by_id(&conn, &session.user_id)
        .ok()?
        .into_public();
    // Best-effort: a failed slide shouldn't block the request.
    let _ = SessionRepo::extend(&conn, token, Utc::now() + Duration::days(SESSION_TTL_DAYS));
    Some(user)
}

/// Resolves the session cookie into a `CurrentUser` request extension, or
/// short-circuits with 401.
pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Response {
    let Some(token) = extract_session_token(req.headers()) else {
        return unauthorized();
    };

    let Some(user) = resolve_user_for_token(&state, &token) else {
        return unauthorized();
    };

    req.extensions_mut().insert(CurrentUser(user));
    req.extensions_mut().insert(SessionTokenExt(token));
    next.run(req).await
}

/// Must run *after* [`require_auth`] (i.e. be the inner layer) — it only
/// reads the `CurrentUser` extension `require_auth` attaches.
pub async fn require_teacher(req: Request, next: Next) -> Response {
    match req.extensions().get::<CurrentUser>() {
        Some(CurrentUser(user)) if user.role == Role::Teacher => next.run(req).await,
        Some(_) => error_response(StatusCode::FORBIDDEN, "forbidden", "Teacher role required"),
        None => unauthorized(),
    }
}

pub fn set_cookie_header(response: &mut Response, value: String) {
    if let Ok(header_value) = HeaderValue::from_str(&value) {
        response
            .headers_mut()
            .insert(header::SET_COOKIE, header_value);
    }
}
