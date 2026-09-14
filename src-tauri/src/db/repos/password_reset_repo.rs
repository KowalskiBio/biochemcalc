use crate::db::DbError;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct PasswordResetTokenRecord {
    #[allow(dead_code)] // mirrors the table; no reader needs the token back
    pub token: String,
    pub user_id: Uuid,
    pub expires_at: DateTime<Utc>,
}

pub struct PasswordResetTokenRepo;

impl PasswordResetTokenRepo {
    pub fn create(
        conn: &Connection,
        token: &str,
        user_id: &Uuid,
        expires_at: DateTime<Utc>,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
            params![token, user_id, Utc::now().to_rfc3339(), expires_at.to_rfc3339()],
        )?;
        Ok(())
    }

    /// A token is valid only if neither expired nor already consumed.
    pub fn find_valid(
        conn: &Connection,
        token: &str,
    ) -> Result<Option<PasswordResetTokenRecord>, DbError> {
        let result = conn.query_row(
            "SELECT token, user_id, expires_at FROM password_reset_tokens
             WHERE token = ?1 AND used_at IS NULL",
            params![token],
            |row| {
                Ok(PasswordResetTokenRecord {
                    token: row.get(0)?,
                    user_id: row.get(1)?,
                    expires_at: parse_dt(row.get::<_, String>(2)?),
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

    pub fn mark_used(conn: &Connection, token: &str) -> Result<(), DbError> {
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ?2 WHERE token = ?1",
            params![token, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    /// Supersede any still-pending tokens for this user — same "one active
    /// wins" idiom as `InviteCodeRepo::create` revoking the previous code,
    /// so requesting a second reset link invalidates the first.
    pub fn invalidate_all_for_user(conn: &Connection, user_id: &Uuid) -> Result<(), DbError> {
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ?2 WHERE user_id = ?1 AND used_at IS NULL",
            params![user_id, Utc::now().to_rfc3339()],
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
    use crate::db::repos::user_repo::{UserRecord, UserRepo};
    use crate::models::Role;
    use chrono::Duration;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn insert_user(conn: &Connection) -> Uuid {
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: format!("user-{}", Uuid::new_v4()),
            password_hash: "h".into(),
            role: Role::Student,
            created_at: Utc::now(),
            protected: false,
            email: Some(format!("{}@example.com", Uuid::new_v4())),
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    #[test]
    fn create_then_find_valid() {
        let conn = setup_conn();
        let user_id = insert_user(&conn);
        PasswordResetTokenRepo::create(&conn, "tok1", &user_id, Utc::now() + Duration::hours(1))
            .expect("create token");

        let found = PasswordResetTokenRepo::find_valid(&conn, "tok1")
            .expect("find")
            .expect("present");
        assert_eq!(found.user_id, user_id);
    }

    #[test]
    fn expired_token_not_returned() {
        let conn = setup_conn();
        let user_id = insert_user(&conn);
        PasswordResetTokenRepo::create(
            &conn,
            "tok-expired",
            &user_id,
            Utc::now() - Duration::seconds(1),
        )
        .expect("create token");

        let found = PasswordResetTokenRepo::find_valid(&conn, "tok-expired").expect("find");
        assert!(found.is_none());
    }

    #[test]
    fn used_token_not_returned() {
        let conn = setup_conn();
        let user_id = insert_user(&conn);
        PasswordResetTokenRepo::create(
            &conn,
            "tok-used",
            &user_id,
            Utc::now() + Duration::hours(1),
        )
        .expect("create token");
        PasswordResetTokenRepo::mark_used(&conn, "tok-used").expect("mark used");

        let found = PasswordResetTokenRepo::find_valid(&conn, "tok-used").expect("find");
        assert!(found.is_none());
    }

    #[test]
    fn invalidate_all_for_user_kills_pending_tokens() {
        let conn = setup_conn();
        let user_id = insert_user(&conn);
        PasswordResetTokenRepo::create(&conn, "tok-old", &user_id, Utc::now() + Duration::hours(1))
            .expect("create old token");

        PasswordResetTokenRepo::invalidate_all_for_user(&conn, &user_id).expect("invalidate");

        assert!(PasswordResetTokenRepo::find_valid(&conn, "tok-old")
            .expect("find")
            .is_none());
    }

    #[test]
    fn unknown_token_is_none() {
        let conn = setup_conn();
        let found = PasswordResetTokenRepo::find_valid(&conn, "nope").expect("find");
        assert!(found.is_none());
    }
}
