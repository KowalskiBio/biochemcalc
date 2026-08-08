//! Storage for student question reports: a flagged practice question, frozen
//! as a JSON snapshot so the teacher sees exactly what the student saw.
//!
//! The table deliberately has no foreign keys (see migration v22 in
//! `db::schema`): a report must survive its user/topic being deleted, so the
//! list query LEFT JOINs and COALESCEs Czech placeholders for missing rows.

use crate::db::DbError;
use rusqlite::{params, Connection};
use uuid::Uuid;

/// One stored report. `snapshot` is an opaque JSON string at this layer —
/// parsing it is the command layer's job.
#[derive(Debug, Clone)]
pub struct QuestionReportRecord {
    pub id: Uuid,
    pub attempt_id: Uuid,
    pub user_id: Uuid,
    pub topic_id: Uuid,
    pub point_value: u8,
    pub message: String,
    pub snapshot: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct QuestionReportSummaryRow {
    pub id: Uuid,
    pub student_username: String,
    pub topic_name: String,
    pub point_value: u8,
    pub message: String,
    pub created_at: String,
}

pub struct QuestionReportRepo;

impl QuestionReportRepo {
    /// Plain INSERT: a duplicate `attempt_id` surfaces as an error from the
    /// UNIQUE constraint (one report per served question).
    pub fn insert(conn: &Connection, record: &QuestionReportRecord) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO question_reports (
                 id, attempt_id, user_id, topic_id, point_value, message, snapshot, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                record.id,
                record.attempt_id,
                record.user_id,
                record.topic_id,
                record.point_value,
                record.message,
                record.snapshot,
                record.created_at,
            ],
        )?;
        Ok(())
    }

    /// Every report, newest first. Names come from LEFT JOINs with COALESCE
    /// fallbacks: a deleted user/topic must not hide the report (no FKs).
    pub fn list_summaries(conn: &Connection) -> Result<Vec<QuestionReportSummaryRow>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT r.id,
                    COALESCE(u.username, '(smazaný uživatel)'),
                    COALESCE(t.name, '(smazané téma)'),
                    r.point_value,
                    r.message,
                    r.created_at
             FROM question_reports r
             LEFT JOIN users u ON u.id = r.user_id
             LEFT JOIN topics t ON t.id = r.topic_id
             ORDER BY r.created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(QuestionReportSummaryRow {
                    id: row.get(0)?,
                    student_username: row.get(1)?,
                    topic_name: row.get(2)?,
                    point_value: row.get(3)?,
                    message: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_by_id(
        conn: &Connection,
        id: &Uuid,
    ) -> Result<Option<QuestionReportRecord>, DbError> {
        let result = conn.query_row(
            "SELECT id, attempt_id, user_id, topic_id, point_value, message, snapshot, created_at
             FROM question_reports
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(QuestionReportRecord {
                    id: row.get(0)?,
                    attempt_id: row.get(1)?,
                    user_id: row.get(2)?,
                    topic_id: row.get(3)?,
                    point_value: row.get(4)?,
                    message: row.get(5)?,
                    snapshot: row.get(6)?,
                    created_at: row.get(7)?,
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
        let removed = conn.execute("DELETE FROM question_reports WHERE id = ?1", params![id])?;
        Ok(removed > 0)
    }

    /// Check if an attempt has been graded (is_correct field). Returns:
    /// - `Ok(None)` if the attempt row doesn't exist anymore
    /// - `Ok(Some(None))` if the attempt exists but hasn't been answered yet
    /// - `Ok(Some(bool))` if the attempt has been graded
    pub fn attempt_is_correct(
        conn: &Connection,
        attempt_id: &Uuid,
    ) -> Result<Option<Option<bool>>, DbError> {
        let result = conn.query_row(
            "SELECT is_correct FROM practice_attempts WHERE id = ?1",
            params![attempt_id],
            |row| row.get::<_, Option<i64>>(0),
        );
        match result {
            Ok(opt_val) => Ok(opt_val.map(|v| Some(v != 0))),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
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
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    fn insert_topic(conn: &Connection, name: &str) -> Uuid {
        let id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO topics (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![id, name, "2026-08-07T09:00:00Z"],
        )
        .expect("insert topic");
        id
    }

    fn report(user_id: Uuid, topic_id: Uuid, created_at: &str) -> QuestionReportRecord {
        QuestionReportRecord {
            id: Uuid::new_v4(),
            attempt_id: Uuid::new_v4(),
            user_id,
            topic_id,
            point_value: 3,
            message: "Špatný výsledek".into(),
            snapshot: r#"{"question_text":"Kolik je 1+1?"}"#.into(),
            created_at: created_at.into(),
        }
    }

    #[test]
    fn insert_then_get_by_id_round_trips_all_fields() {
        let conn = setup_conn();
        let record = report(Uuid::new_v4(), Uuid::new_v4(), "2026-08-07T10:00:00Z");
        QuestionReportRepo::insert(&conn, &record).expect("insert");

        let found = QuestionReportRepo::get_by_id(&conn, &record.id)
            .expect("get")
            .expect("present");
        assert_eq!(found.id, record.id);
        assert_eq!(found.attempt_id, record.attempt_id);
        assert_eq!(found.user_id, record.user_id);
        assert_eq!(found.topic_id, record.topic_id);
        assert_eq!(found.point_value, 3);
        assert_eq!(found.message, "Špatný výsledek");
        assert_eq!(found.snapshot, r#"{"question_text":"Kolik je 1+1?"}"#);
        assert_eq!(found.created_at, "2026-08-07T10:00:00Z");

        assert!(QuestionReportRepo::get_by_id(&conn, &Uuid::new_v4())
            .expect("get missing")
            .is_none());
    }

    #[test]
    fn summaries_list_newest_first_with_joined_names() {
        let conn = setup_conn();
        let user_id = insert_user(&conn, "žák1");
        let topic_id = insert_topic(&conn, "Rovnice");

        let older = report(user_id, topic_id, "2026-08-07T10:00:00Z");
        let newer = report(user_id, topic_id, "2026-08-07T11:00:00Z");
        QuestionReportRepo::insert(&conn, &older).expect("insert older");
        QuestionReportRepo::insert(&conn, &newer).expect("insert newer");

        let rows = QuestionReportRepo::list_summaries(&conn).expect("list");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, newer.id, "newest first");
        assert_eq!(rows[1].id, older.id);
        assert_eq!(rows[0].student_username, "žák1");
        assert_eq!(rows[0].topic_name, "Rovnice");
        assert_eq!(rows[0].point_value, 3);
        assert_eq!(rows[0].message, newer.message);
        assert_eq!(rows[0].created_at, "2026-08-07T11:00:00Z");
    }

    #[test]
    fn duplicate_attempt_id_is_rejected() {
        let conn = setup_conn();
        let first = report(Uuid::new_v4(), Uuid::new_v4(), "2026-08-07T10:00:00Z");
        QuestionReportRepo::insert(&conn, &first).expect("first insert");

        let mut second = report(Uuid::new_v4(), Uuid::new_v4(), "2026-08-07T11:00:00Z");
        second.attempt_id = first.attempt_id;
        assert!(QuestionReportRepo::insert(&conn, &second).is_err());
    }

    #[test]
    fn missing_user_and_topic_still_list_with_fallbacks() {
        let conn = setup_conn();
        // No user/topic rows inserted: question_reports has no foreign keys,
        // so the parent rows may simply be absent.
        let record = report(Uuid::new_v4(), Uuid::new_v4(), "2026-08-07T10:00:00Z");
        QuestionReportRepo::insert(&conn, &record).expect("insert");

        let rows = QuestionReportRepo::list_summaries(&conn).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].student_username, "(smazaný uživatel)");
        assert_eq!(rows[0].topic_name, "(smazané téma)");
    }

    #[test]
    fn delete_reports_rows_affected() {
        let conn = setup_conn();
        let record = report(Uuid::new_v4(), Uuid::new_v4(), "2026-08-07T10:00:00Z");
        QuestionReportRepo::insert(&conn, &record).expect("insert");

        assert!(QuestionReportRepo::delete(&conn, &record.id).expect("delete"));
        assert!(!QuestionReportRepo::delete(&conn, &record.id).expect("second delete"));
        assert!(QuestionReportRepo::get_by_id(&conn, &record.id)
            .expect("get after delete")
            .is_none());
    }

    // The three-state behavior of attempt_is_correct is tested end-to-end
    // via commands::reports tests (happy path, report-after-answer shows is_correct).
}
