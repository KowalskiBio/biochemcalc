use crate::db::DbError;
use chrono::Utc;
use rusqlite::{params, Connection};

pub struct AppSettingsRepo;

impl AppSettingsRepo {
    pub fn get(conn: &Connection, key: &str) -> Result<Option<String>, DbError> {
        let result = conn.query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), DbError> {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now],
        )?;
        Ok(())
    }

    pub fn get_or_default(conn: &Connection, key: &str, default: &str) -> Result<String, DbError> {
        match Self::get(conn, key)? {
            Some(value) => Ok(value),
            None => Ok(default.to_owned()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    #[test]
    fn get_returns_none_for_missing_key() {
        let conn = setup_conn();
        let result = AppSettingsRepo::get(&conn, "missing_key").expect("get");
        assert!(result.is_none());
    }

    #[test]
    fn set_then_get_returns_value() {
        let conn = setup_conn();
        AppSettingsRepo::set(&conn, "test_key", "test_value").expect("set");
        let result = AppSettingsRepo::get(&conn, "test_key").expect("get");
        assert_eq!(result, Some("test_value".to_string()));
    }

    #[test]
    fn overwrite_works() {
        let conn = setup_conn();
        AppSettingsRepo::set(&conn, "overwrite_key", "first").expect("set");
        AppSettingsRepo::set(&conn, "overwrite_key", "second").expect("set");
        let result = AppSettingsRepo::get(&conn, "overwrite_key").expect("get");
        assert_eq!(result, Some("second".to_string()));
    }

    #[test]
    fn get_or_default_returns_default_when_missing() {
        let conn = setup_conn();
        let result =
            AppSettingsRepo::get_or_default(&conn, "missing", "fallback").expect("get_or_default");
        assert_eq!(result, "fallback");
    }

    #[test]
    fn get_or_default_returns_stored_value_when_present() {
        let conn = setup_conn();
        AppSettingsRepo::set(&conn, "present", "stored").expect("set");
        let result =
            AppSettingsRepo::get_or_default(&conn, "present", "fallback").expect("get_or_default");
        assert_eq!(result, "stored");
    }
}
