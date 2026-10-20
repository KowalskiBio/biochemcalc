//! Storage for student Biomolekuly question reports: a flagged client-generated
//! quiz question, frozen as a JSON snapshot so the teacher sees exactly what
//! the student saw.
//!
//! The table deliberately has no foreign keys (see migration v53 in
//! `db::schema`): a report must survive its user being deleted, so the list
//! query LEFT JOINs and COALESCEs a Czech placeholder for a missing account.
//! `scope_slug` is a plain string — Biomolekuly scopes are client-side
//! category/topic slugs, not foreign keys.

use crate::db::DbError;
use rusqlite::{params, Connection};
use uuid::Uuid;

/// One stored report. `snapshot` is an opaque JSON string at this layer —
/// parsing it is the command layer's job.
#[derive(Debug, Clone)]
pub struct BiomoleculeQuestionReportRecord {
    pub id: Uuid,
    pub question_uid: String,
    pub user_id: Uuid,
    pub scope_slug: String,
    pub message: String,
    pub snapshot: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct BiomoleculeQuestionReportSummaryRow {
    pub id: Uuid,
    pub student_username: String,
    pub scope_slug: String,
    pub message: String,
    pub created_at: String,
}

pub struct BiomoleculeQuestionReportRepo;

impl BiomoleculeQuestionReportRepo {
    /// Plain INSERT: a duplicate `(user_id, question_uid)` surfaces as an
    /// error from the UNIQUE index (one report per served question).
    pub fn insert(
        conn: &Connection,
        record: &BiomoleculeQuestionReportRecord,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO biomolecule_question_reports (
                 id, question_uid, user_id, scope_slug, message, snapshot, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.id,
                record.question_uid,
                record.user_id,
                record.scope_slug,
                record.message,
                record.snapshot,
                record.created_at,
            ],
        )?;
        Ok(())
    }

    /// Every report, newest first. The username comes from a LEFT JOIN with a
    /// COALESCE fallback: a deleted user must not hide the report (no FKs).
    pub fn list_summaries(
        conn: &Connection,
    ) -> Result<Vec<BiomoleculeQuestionReportSummaryRow>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT r.id,
                    COALESCE(u.username, '(smazaný uživatel)'),
                    r.scope_slug,
                    r.message,
                    r.created_at
             FROM biomolecule_question_reports r
             LEFT JOIN users u ON u.id = r.user_id
             ORDER BY r.created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(BiomoleculeQuestionReportSummaryRow {
                    id: row.get(0)?,
                    student_username: row.get(1)?,
                    scope_slug: row.get(2)?,
                    message: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_by_id(
        conn: &Connection,
        id: &Uuid,
    ) -> Result<Option<BiomoleculeQuestionReportRecord>, DbError> {
        let result = conn.query_row(
            "SELECT id, question_uid, user_id, scope_slug, message, snapshot, created_at
             FROM biomolecule_question_reports
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(BiomoleculeQuestionReportRecord {
                    id: row.get(0)?,
                    question_uid: row.get(1)?,
                    user_id: row.get(2)?,
                    scope_slug: row.get(3)?,
                    message: row.get(4)?,
                    snapshot: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        );
        match result {
            Ok(record) => Ok(Some(record)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    /// `true` when a row was actually removed — the command layer turns
    /// `false` into NotFound.
    pub fn delete(conn: &Connection, id: &Uuid) -> Result<bool, DbError> {
        let removed = conn.execute(
            "DELETE FROM biomolecule_question_reports WHERE id = ?1",
            params![id],
        )?;
        Ok(removed > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::user_repo::{UserRecord, UserRepo};
    use crate::models::Role;
    use chrono::Utc;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn insert_user(conn: &Connection, username: &str) -> Uuid {
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: username.into(),
            password_hash: "h".into(),
            role: Role::Student,
            created_at: Utc::now(),
            protected: false,
            email: None,
            sections: crate::models::SectionAccess::Biomolecules,
            preferred_section: None,
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    fn report(
        user_id: Uuid,
        question_uid: &str,
        created_at: &str,
    ) -> BiomoleculeQuestionReportRecord {
        BiomoleculeQuestionReportRecord {
            id: Uuid::new_v4(),
            question_uid: question_uid.into(),
            user_id,
            scope_slug: "sacharidy".into(),
            message: "Špatná odpověď".into(),
            snapshot: r#"{"question_text":"Který cukr?"}"#.into(),
            created_at: created_at.into(),
        }
    }

    #[test]
    fn insert_then_get_by_id_round_trips_all_fields() {
        let conn = setup_conn();
        let record = report(Uuid::new_v4(), "seed-1-0", "2026-08-07T10:00:00Z");
        BiomoleculeQuestionReportRepo::insert(&conn, &record).expect("insert");

        let found = BiomoleculeQuestionReportRepo::get_by_id(&conn, &record.id)
            .expect("get")
            .expect("present");
        assert_eq!(found.id, record.id);
        assert_eq!(found.question_uid, "seed-1-0");
        assert_eq!(found.user_id, record.user_id);
        assert_eq!(found.scope_slug, "sacharidy");
        assert_eq!(found.message, "Špatná odpověď");
        assert_eq!(found.snapshot, r#"{"question_text":"Který cukr?"}"#);
        assert_eq!(found.created_at, "2026-08-07T10:00:00Z");

        assert!(
            BiomoleculeQuestionReportRepo::get_by_id(&conn, &Uuid::new_v4())
                .expect("get missing")
                .is_none()
        );
    }

    #[test]
    fn summaries_list_newest_first_with_joined_names() {
        let conn = setup_conn();
        let user_id = insert_user(&conn, "žák1");

        let older = report(user_id, "seed-1-0", "2026-08-07T10:00:00Z");
        let newer = report(user_id, "seed-1-1", "2026-08-07T11:00:00Z");
        BiomoleculeQuestionReportRepo::insert(&conn, &older).expect("insert older");
        BiomoleculeQuestionReportRepo::insert(&conn, &newer).expect("insert newer");

        let rows = BiomoleculeQuestionReportRepo::list_summaries(&conn).expect("list");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, newer.id, "newest first");
        assert_eq!(rows[1].id, older.id);
        assert_eq!(rows[0].student_username, "žák1");
        assert_eq!(rows[0].scope_slug, "sacharidy");
        assert_eq!(rows[0].message, newer.message);
        assert_eq!(rows[0].created_at, "2026-08-07T11:00:00Z");
    }

    #[test]
    fn duplicate_user_and_question_uid_is_rejected() {
        let conn = setup_conn();
        let user_id = Uuid::new_v4();
        let first = report(user_id, "seed-1-0", "2026-08-07T10:00:00Z");
        BiomoleculeQuestionReportRepo::insert(&conn, &first).expect("first insert");

        let duplicate = report(user_id, "seed-1-0", "2026-08-07T11:00:00Z");
        assert!(BiomoleculeQuestionReportRepo::insert(&conn, &duplicate).is_err());

        // Another student reporting the same served question is allowed.
        let other = report(Uuid::new_v4(), "seed-1-0", "2026-08-07T11:00:00Z");
        BiomoleculeQuestionReportRepo::insert(&conn, &other).expect("other student");
    }

    #[test]
    fn missing_user_still_lists_with_fallback() {
        let conn = setup_conn();
        // No user row inserted: biomolecule_question_reports has no foreign
        // keys, so the parent row may simply be absent.
        let record = report(Uuid::new_v4(), "seed-1-0", "2026-08-07T10:00:00Z");
        BiomoleculeQuestionReportRepo::insert(&conn, &record).expect("insert");

        let rows = BiomoleculeQuestionReportRepo::list_summaries(&conn).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].student_username, "(smazaný uživatel)");
    }

    #[test]
    fn delete_reports_rows_affected() {
        let conn = setup_conn();
        let record = report(Uuid::new_v4(), "seed-1-0", "2026-08-07T10:00:00Z");
        BiomoleculeQuestionReportRepo::insert(&conn, &record).expect("insert");

        assert!(BiomoleculeQuestionReportRepo::delete(&conn, &record.id).expect("delete"));
        assert!(!BiomoleculeQuestionReportRepo::delete(&conn, &record.id).expect("second delete"));
        assert!(BiomoleculeQuestionReportRepo::get_by_id(&conn, &record.id)
            .expect("get after delete")
            .is_none());
    }
}
