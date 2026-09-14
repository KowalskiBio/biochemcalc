//! Process-hardening utilities for 24/7 unattended operation.
//!
//! Three concerns live here:
//! - [`lock_db`] recovers the database mutex after a panic instead of letting
//!   one poisoned lock fail every subsequent command until restart.
//! - [`atomic_write`] writes files via a sibling temp file + rename so a crash
//!   mid-write can never leave a truncated JSON/txt file behind.
//! - [`guard_panic`] converts a panic inside a command into a typed error so a
//!   malformed template or engine bug degrades one operation instead of
//!   killing the whole process.

use crate::db::DbError;
use rusqlite::Connection;
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

/// Lock the shared database connection, recovering from mutex poisoning.
///
/// A panic while a command held the lock poisons the mutex; without recovery
/// every later command fails with an IO error until the app is restarted.
/// rusqlite rolls back in-flight transactions when a lock guard is dropped
/// during unwind, so the connection returns to its last committed state and
/// taking it over is sound.
pub fn lock_db(db: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    db.lock().unwrap_or_else(|poisoned| {
        log::warn!("database mutex poisoned by an earlier panic; recovering the guard");
        poisoned.into_inner()
    })
}

/// Write `contents` to `path` atomically: write a sibling temp file, flush and
/// fsync it, then rename over the target. A crash at any point leaves either
/// the old file or the new file intact — never a truncated one.
pub fn atomic_write(path: impl AsRef<Path>, contents: &str) -> std::io::Result<()> {
    let path = path.as_ref();
    let file_name = path.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("atomic_write: path has no file name: {}", path.display()),
        )
    })?;

    let mut tmp_path = path.to_path_buf();
    tmp_path.set_file_name(format!(".{}.tmp", file_name.to_string_lossy()));

    let write_result = (|| {
        let mut file = std::fs::File::create(&tmp_path)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&tmp_path, path)
    })();

    if write_result.is_err() {
        // Best-effort cleanup so temp files do not accumulate.
        let _ = std::fs::remove_file(&tmp_path);
    }

    write_result
}

/// Run `f`, converting a panic into `DbError::Internal` instead of letting it
/// unwind into the Tauri runtime and take the process down. Used around
/// commands that call into the generation/export engine, which still contains
/// `unwrap`/`expect` paths on malformed user data.
pub fn guard_panic<T, F>(operation: &str, f: F) -> Result<T, DbError>
where
    F: FnOnce() -> Result<T, DbError>,
{
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(result) => result,
        Err(payload) => {
            let detail = if let Some(s) = payload.downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown panic payload".to_string()
            };
            log::error!("{operation} panicked: {detail}");
            Err(DbError::Internal(format!(
                "{operation} failed unexpectedly: {detail}"
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_creates_file_with_contents() {
        let dir = std::env::temp_dir().join(format!("biochemcalc-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("projekt.json");

        atomic_write(&path, "{\"ok\":true}").expect("write");

        assert_eq!(
            std::fs::read_to_string(&path).expect("read"),
            "{\"ok\":true}"
        );
        assert!(
            !dir.join(".projekt.json.tmp").exists(),
            "temp file must not linger"
        );
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn atomic_write_overwrites_existing_file() {
        let dir = std::env::temp_dir().join(format!("biochemcalc-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("export.txt");

        atomic_write(&path, "old").expect("first write");
        atomic_write(&path, "new").expect("second write");

        assert_eq!(std::fs::read_to_string(&path).expect("read"), "new");
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn lock_db_recovers_from_poisoned_mutex() {
        use std::sync::Arc;

        let db = Arc::new(Mutex::new(
            Connection::open_in_memory().expect("in-memory db"),
        ));

        // Poison the mutex by panicking in a thread while holding the lock.
        let db_clone = Arc::clone(&db);
        let handle = std::thread::spawn(move || {
            let _guard = db_clone.lock().expect("lock in thread");
            panic!("simulated crash while holding the db lock");
        });
        let _ = handle.join();

        assert!(db.is_poisoned(), "mutex should be poisoned after the panic");

        // lock_db must recover instead of failing.
        let guard = lock_db(&db);
        guard
            .execute_batch("CREATE TABLE t (id INTEGER);")
            .expect("connection still usable after recovery");
    }

    #[test]
    fn guard_panic_passes_through_ok_and_err() {
        let ok: Result<i32, DbError> = guard_panic("no-op", || Ok(7));
        assert_eq!(ok.expect("ok"), 7);

        let err: Result<i32, DbError> =
            guard_panic("no-op", || Err(DbError::Validation("bad input".into())));
        assert!(matches!(err, Err(DbError::Validation(_))));
    }

    #[test]
    fn guard_panic_converts_panic_to_internal_error() {
        let result: Result<i32, DbError> = guard_panic("explode", || panic!("boom"));
        match result {
            Err(DbError::Internal(msg)) => {
                assert!(msg.contains("explode"), "operation name in message: {msg}");
                assert!(msg.contains("boom"), "panic detail in message: {msg}");
            }
            other => panic!("expected Internal error, got {other:?}"),
        }
    }
}
