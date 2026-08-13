use crate::db::DbError;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct SessionRecord {
    #[allow(dead_code)] // mirrors the sessions table; no reader yet
    pub token: String,
    pub user_id: Uuid,
    #[allow(dead_code)] // mirrors the sessions table; no reader yet
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

pub struct SessionRepo;

impl SessionRepo {
    pub fn create(
        conn: &Connection,
        token: &str,
        user_id: &Uuid,
        expires_at: DateTime<Utc>,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
            params![token, user_id, Utc::now().to_rfc3339(), expires_at.to_rfc3339()],
        )?;
        Ok(())
    }

    /// Look up a session by token, ignoring (but not deleting) expired rows.
    pub fn find_valid(conn: &Connection, token: &str) -> Result<Option<SessionRecord>, DbError> {
        let result = conn.query_row(
            "SELECT token, user_id, created_at, expires_at FROM sessions WHERE token = ?1",
            params![token],
            |row| {
                Ok(SessionRecord {
                    token: row.get(0)?,
                    user_id: row.get(1)?,
                    created_at: parse_dt(row.get::<_, String>(2)?),
                    expires_at: parse_dt(row.get::<_, String>(3)?),
                })
            },
        );
        match result {
            Ok(record) if record.expires_at > Utc::now() => Ok(Some(record)),
            Ok(_) => Ok(None),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    /// Slide the session's expiry forward on use.
    pub fn extend(conn: &Connection, token: &str, expires_at: DateTime<Utc>) -> Result<(), DbError> {
        conn.execute(
            "UPDATE sessions SET expires_at = ?2 WHERE token = ?1",
            params![token, expires_at.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn delete(conn: &Connection, token: &str) -> Result<(), DbError> {
        conn.execute("DELETE FROM sessions WHERE token = ?1", params![token])?;
        Ok(())
    }

    /// Opportunistic cleanup, called on login/register rather than via a
    /// separate sweep job.
    pub fn delete_expired(conn: &Connection) -> Result<(), DbError> {
        conn.execute(
            "DELETE FROM sessions WHERE expires_at <= ?1",
            params![Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }
}

fn parse_dt(s: String) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&s)
        .unwrap_or_else(|_| {
            DateTime::parse_from_rfc3339("1970-01-01T00:00:00Z").expect("hardcoded fallback")
        })
        .with_timezone(&Utc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn insert_user(conn: &Connection) -> Uuid {
        use crate::db::repos::user_repo::{UserRecord, UserRepo};
        use crate::models::Role;
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: "u".into(),
            password_hash: "h".into(),
            role: Role::Teacher,
            created_at: Utc::now(),
            protected: false,
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    #[test]
    fn create_then_find_valid() {
        let conn = setup_conn();
        let user_id = insert_user(&conn);
        SessionRepo::create(&conn, "tok1", &user_id, Utc::now() + Duration::days(1))
            .expect("create session");

        let found = SessionRepo::find_valid(&conn, "tok1")
            .expect("find")
            .expect("present");
        assert_eq!(found.user_id, user_id);
    }

    #[test]
    fn expired_session_is_not_returned() {
        let conn = setup_conn();
        let user_id = insert_user(&conn);
        SessionRepo::create(&conn, "tok-expired", &user_id, Utc::now() - Duration::seconds(1))
            .expect("create session");

        let found = SessionRepo::find_valid(&conn, "tok-expired").expect("find");
        assert!(found.is_none());
    }

    #[test]
    fn delete_removes_session() {
        let conn = setup_conn();
        let user_id = insert_user(&conn);
        SessionRepo::create(&conn, "tok2", &user_id, Utc::now() + Duration::days(1))
            .expect("create session");
        SessionRepo::delete(&conn, "tok2").expect("delete");

        let found = SessionRepo::find_valid(&conn, "tok2").expect("find");
        assert!(found.is_none());
    }
}
