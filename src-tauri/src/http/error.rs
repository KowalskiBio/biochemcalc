use crate::db::DbError;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

/// Wraps [`DbError`] for use as an Axum handler error type. `DbError`
/// already serializes as `{"kind": "...", "message": "..."}`
/// (`src/db/mod.rs`), which the frontend's `extractErrorMessage` already
/// parses unmodified — no new error shape to teach the client.
pub struct HttpError(pub DbError);

impl From<DbError> for HttpError {
    fn from(e: DbError) -> Self {
        HttpError(e)
    }
}

impl IntoResponse for HttpError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            DbError::NotFound(_) => StatusCode::NOT_FOUND,
            DbError::Validation(_) => StatusCode::BAD_REQUEST,
            DbError::Conflict(_) => StatusCode::CONFLICT,
            DbError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            DbError::Sqlite(_) | DbError::Serde(_) | DbError::Io(_) | DbError::Internal(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (status, Json(self.0)).into_response()
    }
}
