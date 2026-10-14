use crate::db::DbError;
use crate::models::{InviteCode, Role, SectionAccess};
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct InviteCodeRepo;

/// How long a freshly minted invite code stays usable.
pub const INVITE_CODE_TTL_DAYS: i64 = 7;

const SELECT_COLUMNS: &str =
    "code, role, created_by, created_at, expires_at, revoked_at, use_count, sections";

impl InviteCodeRepo {
    /// Mint a code for `role` scoped to `sections`, revoking whatever code
    /// that same (role, sections) pair had before — only one invite per scope
    /// is ever live, so handing out a new one reliably invalidates the old
    /// one, while codes for other scopes (another class) keep working. Both
    /// steps share a transaction so a failure can't leave a scope with two
    /// active codes (or none).
    pub fn create(
        conn: &Connection,
        code: &str,
        role: Role,
        sections: SectionAccess,
        created_by: Option<Uuid>,
    ) -> Result<(), DbError> {
        let now = Utc::now();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE invite_codes SET revoked_at = ?3
             WHERE role = ?1 AND sections = ?2 AND revoked_at IS NULL",
            params![role.as_str(), sections.as_str(), now.to_rfc3339()],
        )?;
        tx.execute(
            "INSERT INTO invite_codes (code, role, sections, created_by, created_at, expires_at, use_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            params![
                code,
                role.as_str(),
                sections.as_str(),
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
        sections: SectionAccess::parse(&row.get::<_, String>(7)?)
            .unwrap_or(SectionAccess::Calculations),
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
            sections: crate::models::SectionAccess::Calculations,
            preferred_section: None,
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    #[test]
    fn create_then_find_valid() {
        let conn = setup_conn();
        InviteCodeRepo::create(
            &conn,
            "ABC123",
            Role::Student,
            SectionAccess::Calculations,
            None,
        )
        .expect("create");

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
        InviteCodeRepo::create(
            &conn,
            "CLASS",
            Role::Student,
            SectionAccess::Calculations,
            None,
        )
        .expect("create");

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

    /// Only one code per scope is live: minting a new one kills its predecessor.
    #[test]
    fn creating_a_new_code_revokes_the_previous_one_for_that_role() {
        let conn = setup_conn();
        InviteCodeRepo::create(
            &conn,
            "OLD",
            Role::Student,
            SectionAccess::Calculations,
            None,
        )
        .expect("create old");
        InviteCodeRepo::create(
            &conn,
            "NEW",
            Role::Student,
            SectionAccess::Calculations,
            None,
        )
        .expect("create new");

        assert!(
            InviteCodeRepo::find_valid(&conn, "OLD")
                .expect("find")
                .is_none(),
            "superseded code must stop working"
        );
        assert!(InviteCodeRepo::find_valid(&conn, "NEW")
            .expect("find")
            .is_some());
    }

    /// Different section scopes are independent — a biomolecules code
    /// doesn't kill a calculations one, so two classes can register at once.
    #[test]
    fn different_section_scopes_have_independent_codes() {
        let conn = setup_conn();
        InviteCodeRepo::create(
            &conn,
            "CALC",
            Role::Student,
            SectionAccess::Calculations,
            None,
        )
        .expect("create calc");
        InviteCodeRepo::create(
            &conn,
            "BIO",
            Role::Student,
            SectionAccess::Biomolecules,
            None,
        )
        .expect("create bio");
        InviteCodeRepo::create(&conn, "BOTH", Role::Student, SectionAccess::Both, None)
            .expect("create both");
        InviteCodeRepo::create(
            &conn,
            "BIO2",
            Role::Student,
            SectionAccess::Biomolecules,
            None,
        )
        .expect("create bio2");

        let mut active: Vec<(String, SectionAccess)> = InviteCodeRepo::list_active(&conn)
            .expect("list")
            .into_iter()
            .map(|c| (c.code, c.sections))
            .collect();
        active.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(
            active,
            vec![
                ("BIO2".to_string(), SectionAccess::Biomolecules),
                ("BOTH".to_string(), SectionAccess::Both),
                ("CALC".to_string(), SectionAccess::Calculations),
            ],
            "only the superseded same-scope code is revoked"
        );
    }

    /// Roles are independent — issuing a student code leaves the teacher one alone.
    #[test]
    fn roles_have_independent_codes() {
        let conn = setup_conn();
        InviteCodeRepo::create(
            &conn,
            "TEACH",
            Role::Teacher,
            SectionAccess::Calculations,
            None,
        )
        .expect("create teacher");
        InviteCodeRepo::create(
            &conn,
            "STUD",
            Role::Student,
            SectionAccess::Calculations,
            None,
        )
        .expect("create student");

        assert!(InviteCodeRepo::find_valid(&conn, "TEACH")
            .expect("find")
            .is_some());
        assert!(InviteCodeRepo::find_valid(&conn, "STUD")
            .expect("find")
            .is_some());

        let active = InviteCodeRepo::list_active(&conn).expect("list");
        assert_eq!(active.len(), 2);
    }

    #[test]
    fn revoked_code_is_no_longer_valid_or_listed() {
        let conn = setup_conn();
        InviteCodeRepo::create(
            &conn,
            "KILLME",
            Role::Student,
            SectionAccess::Calculations,
            None,
        )
        .expect("create");
        InviteCodeRepo::revoke(&conn, "KILLME").expect("revoke");

        assert!(InviteCodeRepo::find_valid(&conn, "KILLME")
            .expect("find")
            .is_none());
        assert!(InviteCodeRepo::list_active(&conn).expect("list").is_empty());
    }

    #[test]
    fn revoking_twice_is_not_found() {
        let conn = setup_conn();
        InviteCodeRepo::create(
            &conn,
            "GONE",
            Role::Student,
            SectionAccess::Calculations,
            None,
        )
        .expect("create");
        InviteCodeRepo::revoke(&conn, "GONE").expect("revoke");

        let result = InviteCodeRepo::revoke(&conn, "GONE");
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    #[test]
    fn expired_code_is_rejected_and_not_listed() {
        let conn = setup_conn();
        InviteCodeRepo::create(
            &conn,
            "STALE",
            Role::Student,
            SectionAccess::Calculations,
            None,
        )
        .expect("create");
        // Backdate the expiry rather than sleeping.
        conn.execute(
            "UPDATE invite_codes SET expires_at = ?2 WHERE code = ?1",
            params!["STALE", (Utc::now() - Duration::days(1)).to_rfc3339()],
        )
        .expect("backdate");

        assert!(InviteCodeRepo::find_valid(&conn, "STALE")
            .expect("find")
            .is_none());
        assert!(InviteCodeRepo::list_active(&conn).expect("list").is_empty());
    }

    #[test]
    fn unknown_code_is_none() {
        let conn = setup_conn();
        let found = InviteCodeRepo::find_valid(&conn, "NOPE").expect("find");
        assert!(found.is_none());
    }
}
