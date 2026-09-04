use crate::db::DbError;
use crate::models::{Role, User};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use uuid::Uuid;

/// Internal representation of a `users` row, including the password hash.
/// Never sent to the frontend — auth commands convert this to [`User`] before
/// returning anything over HTTP.
#[derive(Debug, Clone)]
pub struct UserRecord {
    pub id: Uuid,
    pub username: String,
    pub password_hash: String,
    pub role: Role,
    pub created_at: DateTime<Utc>,
    pub protected: bool,
    pub email: Option<String>,
}

impl UserRecord {
    pub fn into_public(self) -> User {
        User {
            id: self.id,
            username: self.username,
            role: self.role,
            created_at: self.created_at,
            protected: self.protected,
            email: self.email,
        }
    }
}

pub struct UserRepo;

impl UserRepo {
    pub fn insert(conn: &Connection, user: &UserRecord) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at, protected, email) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                user.id,
                user.username,
                user.password_hash,
                user.role.as_str(),
                user.created_at.to_rfc3339(),
                user.protected,
                user.email,
            ],
        )
        .map_err(|e| match &e {
            rusqlite::Error::SqliteFailure(err, Some(msg))
                if err.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                if msg.contains("users.email") {
                    DbError::Conflict("This email is already registered".into())
                } else {
                    DbError::Conflict(format!("Username {} is already taken", user.username))
                }
            }
            rusqlite::Error::SqliteFailure(err, _)
                if err.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                DbError::Conflict(format!("Username {} is already taken", user.username))
            }
            _ => DbError::Sqlite(e),
        })?;
        Ok(())
    }

    pub fn find_by_username(
        conn: &Connection,
        username: &str,
    ) -> Result<Option<UserRecord>, DbError> {
        let result = conn.query_row(
            "SELECT id, username, password_hash, role, created_at, protected, email FROM users WHERE username = ?1 COLLATE NOCASE",
            params![username],
            row_to_record,
        );
        match result {
            Ok(record) => Ok(Some(record)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    /// Case-insensitive, like `find_by_username`. Used only by the
    /// forgot-password flow — see `commands::auth::do_forgot_password`.
    pub fn find_by_email(conn: &Connection, email: &str) -> Result<Option<UserRecord>, DbError> {
        let result = conn.query_row(
            "SELECT id, username, password_hash, role, created_at, protected, email FROM users WHERE email = ?1 COLLATE NOCASE",
            params![email],
            row_to_record,
        );
        match result {
            Ok(record) => Ok(Some(record)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    pub fn get_by_id(conn: &Connection, id: &Uuid) -> Result<UserRecord, DbError> {
        conn.query_row(
            "SELECT id, username, password_hash, role, created_at, protected, email FROM users WHERE id = ?1",
            params![id],
            row_to_record,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound(format!("User {id}")),
            other => DbError::Sqlite(other),
        })
    }

    pub fn count_all(conn: &Connection) -> Result<i64, DbError> {
        conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
            .map_err(DbError::Sqlite)
    }

    pub fn list_all(conn: &Connection) -> Result<Vec<UserRecord>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, username, password_hash, role, created_at, protected, email FROM users ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_record)?;
        rows.map(|r| r.map_err(DbError::Sqlite)).collect()
    }

    /// Cascades to `sessions` (FK `ON DELETE CASCADE`) and clears the
    /// `created_by`/`used_by` references on `invite_codes` (FK
    /// `ON DELETE SET NULL`) — see migration v15.
    pub fn delete(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let affected = conn.execute("DELETE FROM users WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("User {id}")));
        }
        Ok(())
    }

    pub fn update_password(conn: &Connection, id: &Uuid, new_hash: &str) -> Result<(), DbError> {
        let affected = conn.execute(
            "UPDATE users SET password_hash = ?2 WHERE id = ?1",
            params![id, new_hash],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("User {id}")));
        }
        Ok(())
    }
}

fn row_to_record(row: &rusqlite::Row) -> rusqlite::Result<UserRecord> {
    let role_str: String = row.get(3)?;
    let role = Role::parse(&role_str).unwrap_or(Role::Student);
    Ok(UserRecord {
        id: row.get(0)?,
        username: row.get(1)?,
        password_hash: row.get(2)?,
        role,
        created_at: parse_dt(row.get::<_, String>(4)?),
        protected: row.get(5)?,
        email: row.get(6)?,
    })
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

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn sample_user(username: &str, role: Role) -> UserRecord {
        UserRecord {
            id: Uuid::new_v4(),
            username: username.into(),
            password_hash: "hash".into(),
            role,
            created_at: Utc::now(),
            protected: false,
            email: None,
        }
    }

    #[test]
    fn insert_then_find_by_username() {
        let conn = setup_conn();
        let user = sample_user("teacher1", Role::Teacher);
        UserRepo::insert(&conn, &user).expect("insert");

        let found = UserRepo::find_by_username(&conn, "teacher1")
            .expect("find")
            .expect("present");
        assert_eq!(found.id, user.id);
        assert_eq!(found.role, Role::Teacher);
    }

    #[test]
    fn find_by_username_is_case_insensitive() {
        let conn = setup_conn();
        let user = sample_user("StudentOne", Role::Student);
        UserRepo::insert(&conn, &user).expect("insert");

        let found = UserRepo::find_by_username(&conn, "studentone")
            .expect("find")
            .expect("present");
        assert_eq!(found.id, user.id);
    }

    #[test]
    fn duplicate_username_conflicts() {
        let conn = setup_conn();
        UserRepo::insert(&conn, &sample_user("dup", Role::Teacher)).expect("first insert");
        let result = UserRepo::insert(&conn, &sample_user("dup", Role::Student));
        assert!(matches!(result, Err(DbError::Conflict(_))));
    }

    #[test]
    fn count_all_reflects_inserts() {
        let conn = setup_conn();
        assert_eq!(UserRepo::count_all(&conn).expect("count"), 0);
        UserRepo::insert(&conn, &sample_user("only", Role::Teacher)).expect("insert");
        assert_eq!(UserRepo::count_all(&conn).expect("count"), 1);
    }

    #[test]
    fn list_all_returns_every_user() {
        let conn = setup_conn();
        UserRepo::insert(&conn, &sample_user("alice", Role::Teacher)).expect("insert");
        UserRepo::insert(&conn, &sample_user("bob", Role::Student)).expect("insert");

        let all = UserRepo::list_all(&conn).expect("list");
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|u| u.username == "alice"));
        assert!(all.iter().any(|u| u.username == "bob"));
    }

    #[test]
    fn delete_removes_user_and_sessions() {
        use crate::db::repos::SessionRepo;
        use chrono::Duration;

        let conn = setup_conn();
        let user = sample_user("todelete", Role::Student);
        UserRepo::insert(&conn, &user).expect("insert");
        SessionRepo::create(&conn, "tok", &user.id, Utc::now() + Duration::days(1))
            .expect("create session");

        UserRepo::delete(&conn, &user.id).expect("delete");

        assert!(matches!(
            UserRepo::get_by_id(&conn, &user.id),
            Err(DbError::NotFound(_))
        ));
        assert!(SessionRepo::find_valid(&conn, "tok")
            .expect("find session")
            .is_none());
    }

    #[test]
    fn delete_unknown_user_is_not_found() {
        let conn = setup_conn();
        let result = UserRepo::delete(&conn, &Uuid::new_v4());
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    #[test]
    fn update_password_changes_hash() {
        let conn = setup_conn();
        let user = sample_user("haschanged", Role::Teacher);
        UserRepo::insert(&conn, &user).expect("insert");

        UserRepo::update_password(&conn, &user.id, "new-hash").expect("update password");

        let found = UserRepo::get_by_id(&conn, &user.id).expect("get");
        assert_eq!(found.password_hash, "new-hash");
    }

    #[test]
    fn update_password_unknown_user_is_not_found() {
        let conn = setup_conn();
        let result = UserRepo::update_password(&conn, &Uuid::new_v4(), "new-hash");
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    #[test]
    fn insert_with_email_then_find_by_email() {
        let conn = setup_conn();
        let mut user = sample_user("emailed", Role::Student);
        user.email = Some("Student@Example.com".into());
        UserRepo::insert(&conn, &user).expect("insert");

        let found = UserRepo::find_by_email(&conn, "student@example.com")
            .expect("find")
            .expect("present");
        assert_eq!(found.id, user.id);
    }

    #[test]
    fn duplicate_email_conflicts_case_insensitively() {
        let conn = setup_conn();
        let mut first = sample_user("first", Role::Student);
        first.email = Some("dup@example.com".into());
        UserRepo::insert(&conn, &first).expect("first insert");

        let mut second = sample_user("second", Role::Student);
        second.email = Some("DUP@Example.com".into());
        let result = UserRepo::insert(&conn, &second);
        assert!(matches!(result, Err(DbError::Conflict(_))));
    }

    #[test]
    fn null_email_allows_multiple_accounts() {
        let conn = setup_conn();
        UserRepo::insert(&conn, &sample_user("noemail1", Role::Student)).expect("first insert");
        UserRepo::insert(&conn, &sample_user("noemail2", Role::Student)).expect("second insert");

        assert_eq!(UserRepo::count_all(&conn).expect("count"), 2);
    }

    #[test]
    fn find_by_email_for_unknown_address_is_none() {
        let conn = setup_conn();
        let found = UserRepo::find_by_email(&conn, "nobody@example.com").expect("find");
        assert!(found.is_none());
    }
}
