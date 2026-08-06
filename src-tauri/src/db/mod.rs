use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

pub mod repos;
pub mod schema;

/// Shared application state. Held in Tauri managed state on the desktop
/// build; wrapped in an `Arc` for Axum's shared `State<S>` on the HTTP
/// server (see `src/http`).
pub struct AppState {
    pub db: Mutex<Connection>,
    /// Where per-install files live: `biochemcalc.sqlite`, `projekty/*.json`,
    /// exported `.txt` files. Resolved from Tauri's app-data dir on desktop,
    /// or `BIOCHEMCALC_DATA_DIR` on the HTTP server.
    pub data_dir: PathBuf,
}

impl AppState {
    /// Create a new state with a default in-memory connection.
    /// The real connection is set up in `initialize_db` during `.setup()`.
    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        schema::run_migrations(&conn)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(Self {
            db: Mutex::new(conn),
            data_dir: std::env::temp_dir(),
        })
    }
}

/// Open (creating if necessary) the SQLite database at
/// `data_dir/biochemcalc.sqlite` and run migrations. Shared by the Tauri
/// desktop build and the HTTP server — neither needs anything beyond a
/// directory path.
pub fn open_and_migrate(data_dir: &Path) -> Result<Connection, DbError> {
    std::fs::create_dir_all(data_dir)
        .map_err(|e| DbError::Io(format!("Failed to create app data dir: {e}")))?;

    let db_path = data_dir.join("biochemcalc.sqlite");

    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    schema::run_migrations(&conn)?;

    Ok(conn)
}

/// Initialize the database file in the Tauri app-data directory, returning
/// both the connection and the resolved directory (the latter is stored on
/// `AppState` so commands like `export_to_txt` no longer need their own
/// `AppHandle` to find it).
pub fn initialize_db(app: &tauri::App) -> Result<(Connection, PathBuf), DbError> {
    let app_data_dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| DbError::Io(format!("Failed to resolve app data dir: {e}")))?;

    let conn = open_and_migrate(&app_data_dir)?;
    Ok((conn, app_data_dir))
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

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),
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
            DbError::Internal(_) => "internal",
            DbError::Unauthorized(_) => "unauthorized",
        }
    }
}
