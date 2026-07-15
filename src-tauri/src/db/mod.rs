use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub mod repos;
pub mod schema;

/// Shared application state held in Tauri managed state.
pub struct AppState {
    pub db: Mutex<Connection>,
}

impl AppState {
    /// Create a new state with a default in-memory connection.
    /// The real connection is set up in `initialize_db` during `.setup()`.
    pub fn new_in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        schema::run_migrations(&conn)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(Self {
            db: Mutex::new(conn),
        })
    }
}

/// Initialize the database file in the app-data directory.
pub fn initialize_db(app: &tauri::App) -> Result<Connection, DbError> {
    let app_data_dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| DbError::Io(format!("Failed to resolve app data dir: {e}")))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| DbError::Io(format!("Failed to create app data dir: {e}")))?;

    let db_path = app_data_dir.join("biochemcalc.sqlite");

    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    schema::run_migrations(&conn)?;

    Ok(conn)
}

/// Typed errors for the database layer.
/// Implements `Serialize` so Tauri commands can return structured error JSON.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Serde error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Conflict: {0}")]
    Conflict(String),
}

impl serde::Serialize for DbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("DbError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl DbError {
    fn kind(&self) -> &str {
        match self {
            DbError::Sqlite(_) => "sqlite",
            DbError::Serde(_) => "serde",
            DbError::Io(_) => "io",
            DbError::NotFound(_) => "not_found",
            DbError::Validation(_) => "validation",
            DbError::Conflict(_) => "conflict",
        }
    }
}
