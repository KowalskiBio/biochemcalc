use crate::db::DbError;
use crate::models::{InviteCode, Role};
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct InviteCodeRepo;

/// How long a freshly minted invite code stays usable.
pub const INVITE_CODE_TTL_DAYS: i64 = 7;

const SELECT_COLUMNS: &str =
    "code, role, created_by, created_at, expires_at, revoked_at, use_count";

impl InviteCodeRepo {
    /// Mint a code for `role`, revoking whatever code that role had before —
    /// only one invite per role is ever live, so handing out a new one
    /// reliably invalidates the old one. Both steps share a transaction so a
    /// failure can't leave a role with two active codes (or none).
    pub fn create(
        conn: &Connection,
        code: &str,
        role: Role,
        created_by: Option<Uuid>,
    ) -> Result<(), DbError> {
        let now = Utc::now();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE invite_codes SET revoked_at = ?2 WHERE role = ?1 AND revoked_at IS NULL",
            params![role.as_str(), now.to_rfc3339()],
        )?;
        tx.execute(
            "INSERT INTO invite_codes (code, role, created_by, created_at, expires_at, use_count)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            params![
                code,
                role.as_str(),
                created_by,
                now.to_rfc3339(),
                (now + Duration::days(INVITE_CODE_TTL_DAYS)).to_rfc3339(),
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Look up a code, returning it only if it is neither revoked nor expired.
    /// Codes are deliberately multi-use: a whole class registers with one.
    pub fn find_valid(conn: &Connection, code: &str) -> Result<Option<InviteCode>, DbError> {
        let result = conn.query_row(
            &format!(
                "SELECT {SELECT_COLUMNS} FROM invite_codes
                 WHERE code = ?1 AND revoked_at IS NULL AND expires_at > ?2"
            ),
            params![code, Utc::now().to_rfc3339()],
            row_to_invite,
        );
        match result {
            Ok(invite) => Ok(Some(invite)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    /// Every code a teacher can still hand out, newest first.
    pub fn list_active(conn: &Connection) -> Result<Vec<InviteCode>, DbError> {
        let mut stmt = conn.prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM invite_codes
             WHERE revoked_at IS NULL AND expires_at > ?1
             ORDER BY created_at DESC"
        ))?;
        let rows = stmt.query_map(params![Utc::now().to_rfc3339()], row_to_invite)?;
        rows.map(|r| r.map_err(DbError::Sqlite)).collect()
    }

    /// Record one more registration against a code.
    pub fn record_use(conn: &Connection, code: &str) -> Result<(), DbError> {
        conn.execute(
            "UPDATE invite_codes SET use_count = use_count + 1 WHERE code = ?1",
            params![code],
        )?;
        Ok(())
    }

    /// Retire a code immediately, whatever its expiry.
    pub fn revoke(conn: &Connection, code: &str) -> Result<(), DbError> {
        let affected = conn.execute(
            "UPDATE invite_codes SET revoked_at = ?2 WHERE code = ?1 AND revoked_at IS NULL",
            params![code, Utc::now().to_rfc3339()],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Active invite code {code}")));
        }
        Ok(())
    }
}

fn row_to_invite(row: &rusqlite::Row) -> rusqlite::Result<InviteCode> {
    let role_str: String = row.get(1)?;
    let role = Role::parse(&role_str).unwrap_or(Role::Student);
    let revoked_at: Option<String> = row.get(5)?;
    Ok(InviteCode {
        code: row.get(0)?,
        role,
        created_by: row.get(2)?,
        created_at: parse_dt(row.get::<_, String>(3)?),
        expires_at: parse_dt(row.get::<_, String>(4)?),
        revoked_at: revoked_at.map(parse_dt),
        use_count: row.get(6)?,
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

    #[allow(dead_code)] // test helper: seeds a user row for FK-referencing fixtures
    fn insert_user(conn: &Connection) -> Uuid {
        use crate::db::repos::user_repo::{UserRecord, UserRepo};
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: format!("user-{}", Uuid::new_v4()),
            password_hash: "h".into(),
            role: Role::Student,
            created_at: Utc::now(),
            protected: false,
            email: None,
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    #[test]
    fn create_then_find_valid() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "ABC123", Role::Student, None).expect("create");

        let found = InviteCodeRepo::find_valid(&conn, "ABC123")
            .expect("find")
            .expect("present");
        assert_eq!(found.role, Role::Student);
        assert!(found.revoked_at.is_none());
        assert_eq!(found.use_count, 0);
        assert_eq!(
            (found.expires_at - found.created_at).num_days(),
            INVITE_CODE_TTL_DAYS
        );
    }

    /// A code is deliberately reusable — a whole class registers with one.
    #[test]
    fn code_stays_valid_across_many_uses() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "CLASS", Role::Student, None).expect("create");

        for _ in 0..3 {
            InviteCodeRepo::record_use(&conn, "CLASS").expect("record use");
            assert!(
                InviteCodeRepo::find_valid(&conn, "CLASS")
                    .expect("find")
                    .is_some(),
                "code should survive being used"
            );
        }

        let found = InviteCodeRepo::find_valid(&conn, "CLASS")
            .expect("find")
            .expect("present");
        assert_eq!(found.use_count, 3);
    }

    /// Only one code per role is live: minting a new one kills its predecessor.
    #[test]
    fn creating_a_new_code_revokes_the_previous_one_for_that_role() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "OLD", Role::Student, None).expect("create old");
        InviteCodeRepo::create(&conn, "NEW", Role::Student, None).expect("create new");

        assert!(
            InviteCodeRepo::find_valid(&conn, "OLD").expect("find").is_none(),
            "superseded code must stop working"
        );
        assert!(InviteCodeRepo::find_valid(&conn, "NEW").expect("find").is_some());
    }

    /// Roles are independent — issuing a student code leaves the teacher one alone.
    #[test]
    fn roles_have_independent_codes() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "TEACH", Role::Teacher, None).expect("create teacher");
        InviteCodeRepo::create(&conn, "STUD", Role::Student, None).expect("create student");

        assert!(InviteCodeRepo::find_valid(&conn, "TEACH").expect("find").is_some());
        assert!(InviteCodeRepo::find_valid(&conn, "STUD").expect("find").is_some());

        let active = InviteCodeRepo::list_active(&conn).expect("list");
        assert_eq!(active.len(), 2);
    }

    #[test]
    fn revoked_code_is_no_longer_valid_or_listed() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "KILLME", Role::Student, None).expect("create");
        InviteCodeRepo::revoke(&conn, "KILLME").expect("revoke");

        assert!(InviteCodeRepo::find_valid(&conn, "KILLME").expect("find").is_none());
        assert!(InviteCodeRepo::list_active(&conn).expect("list").is_empty());
    }

    #[test]
    fn revoking_twice_is_not_found() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "GONE", Role::Student, None).expect("create");
        InviteCodeRepo::revoke(&conn, "GONE").expect("revoke");

        let result = InviteCodeRepo::revoke(&conn, "GONE");
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    #[test]
    fn expired_code_is_rejected_and_not_listed() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "STALE", Role::Student, None).expect("create");
        // Backdate the expiry rather than sleeping.
        conn.execute(
            "UPDATE invite_codes SET expires_at = ?2 WHERE code = ?1",
            params!["STALE", (Utc::now() - Duration::days(1)).to_rfc3339()],
        )
        .expect("backdate");

        assert!(InviteCodeRepo::find_valid(&conn, "STALE").expect("find").is_none());
        assert!(InviteCodeRepo::list_active(&conn).expect("list").is_empty());
    }

    #[test]
    fn unknown_code_is_none() {
        let conn = setup_conn();
        let found = InviteCodeRepo::find_valid(&conn, "NOPE").expect("find");
        assert!(found.is_none());
    }
}
