//! Biomolekuly question report module: students can flag broken client-side
//! quiz questions, teachers see them with a frozen snapshot of what the student
//! saw.
//!
//! Unlike the calculations version (`commands::reports`), Biomolekuly quiz
//! questions are generated entirely in the browser and have no
//! `practice_attempts` row to point at. The client therefore sends the whole
//! question snapshot, which is stored verbatim in
//! `biomolecule_question_reports.snapshot`.

use crate::db::repos::{BiomoleculeQuestionReportRecord, BiomoleculeQuestionReportRepo, UserRepo};
use crate::db::DbError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Upper bound on a report message; anything longer is almost certainly a
/// pasted essay or a hand-crafted request.
const MAX_REPORT_MESSAGE_CHARS: usize = 4000;

// ---------------------------------------------------------------------------
// Payloads and DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeReportQuestionPayload {
    /// `${sessionSeed}-${questionIndex}`, issued by the client.
    pub question_uid: String,
    pub scope_slug: String,
    pub message: String,
    /// Client-built JSON blob describing exactly what the student saw.
    pub snapshot: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeQuestionReportSummary {
    pub id: Uuid,
    pub student_username: String,
    pub scope_slug: String,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeQuestionReportDetail {
    pub id: Uuid,
    pub question_uid: String,
    pub message: String,
    pub created_at: String,
    pub student_username: String,
    pub scope_slug: String,
    pub snapshot: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/// File a report about a Biomolekuly quiz question the student was served.
///
/// - Validates the message is non-empty and reasonably short.
/// - Requires the client-issued question uid and a scope slug.
/// - Stores the client snapshot verbatim.
/// - Inserts the report; duplicate `(user_id, question_uid)` → Validation.
pub fn do_report_biomolecule_question(
    conn: &Connection,
    user_id: &Uuid,
    payload: &BiomoleculeReportQuestionPayload,
) -> Result<(), DbError> {
    let message = payload.message.trim();
    if message.is_empty() {
        return Err(DbError::Validation(
            "Popište, co je na otázce špatně.".into(),
        ));
    }
    if message.chars().count() > MAX_REPORT_MESSAGE_CHARS {
        return Err(DbError::Validation("Hlášení je příliš dlouhé.".into()));
    }

    let question_uid = payload.question_uid.trim();
    let scope_slug = payload.scope_slug.trim();
    if question_uid.is_empty() || scope_slug.is_empty() {
        return Err(DbError::Validation("Tuto otázku nahlásit nelze.".into()));
    }

    let snapshot_json = serde_json::to_string(&payload.snapshot)?;

    let record = BiomoleculeQuestionReportRecord {
        id: Uuid::new_v4(),
        question_uid: question_uid.to_string(),
        user_id: *user_id,
        scope_slug: scope_slug.to_string(),
        message: message.to_string(),
        snapshot: snapshot_json,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    match BiomoleculeQuestionReportRepo::insert(conn, &record) {
        Ok(()) => Ok(()),
        Err(DbError::Sqlite(e)) => {
            if e.to_string().contains("UNIQUE") {
                Err(DbError::Validation(
                    "Tuto otázku jste již nahlásili.".into(),
                ))
            } else {
                Err(DbError::Sqlite(e))
            }
        }
        Err(other) => Err(other),
    }
}

/// List all Biomolekuly question reports with joined usernames.
pub fn do_list_biomolecule_question_reports(
    conn: &Connection,
) -> Result<Vec<BiomoleculeQuestionReportSummary>, DbError> {
    let rows = BiomoleculeQuestionReportRepo::list_summaries(conn)?;
    Ok(rows
        .into_iter()
        .map(|row| BiomoleculeQuestionReportSummary {
            id: row.id,
            student_username: row.student_username,
            scope_slug: row.scope_slug,
            message: row.message,
            created_at: row.created_at,
        })
        .collect())
}

/// Get full details of one Biomolekuly question report.
pub fn do_get_biomolecule_question_report(
    conn: &Connection,
    id: &Uuid,
) -> Result<BiomoleculeQuestionReportDetail, DbError> {
    let report = BiomoleculeQuestionReportRepo::get_by_id(conn, id)?
        .ok_or_else(|| DbError::NotFound("Hlášení neexistuje.".into()))?;

    let snapshot: serde_json::Value = serde_json::from_str(&report.snapshot)?;

    let student_username = UserRepo::get_by_id(conn, &report.user_id)
        .map(|u| u.username)
        .unwrap_or_else(|_| "(smazaný uživatel)".into());

    Ok(BiomoleculeQuestionReportDetail {
        id: report.id,
        question_uid: report.question_uid,
        message: report.message,
        created_at: report.created_at,
        student_username,
        scope_slug: report.scope_slug,
        snapshot,
    })
}

/// Delete a Biomolekuly question report.
pub fn do_delete_biomolecule_question_report(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
    if !BiomoleculeQuestionReportRepo::delete(conn, id)? {
        return Err(DbError::NotFound("Hlášení neexistuje.".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::{UserRecord, UserRepo};
    use crate::models::{Role, SectionAccess};
    use chrono::Utc;
    use serde_json::json;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn insert_student(conn: &Connection, username: &str) -> Uuid {
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: username.into(),
            password_hash: "h".into(),
            role: Role::Student,
            created_at: Utc::now(),
            protected: false,
            email: None,
            sections: SectionAccess::Biomolecules,
            preferred_section: None,
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    fn payload(question_uid: &str, message: &str) -> BiomoleculeReportQuestionPayload {
        BiomoleculeReportQuestionPayload {
            question_uid: question_uid.into(),
            scope_slug: "sacharidy".into(),
            message: message.into(),
            snapshot: json!({
                "questionText": "Který cukr je aldóza?",
                "options": ["glukóza", "fruktóza"],
                "correctOption": 1,
                "categorySlug": "sacharidy",
            }),
        }
    }

    #[test]
    fn happy_path_report_then_list_then_detail() {
        let conn = setup_conn();
        let student = insert_student(&conn, "žák1");

        let report = payload("seed-1-0", "Špatná správná odpověď");
        do_report_biomolecule_question(&conn, &student, &report).expect("report");

        let summaries = do_list_biomolecule_question_reports(&conn).expect("list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].student_username, "žák1");
        assert_eq!(summaries[0].scope_slug, "sacharidy");
        assert_eq!(summaries[0].message, "Špatná správná odpověď");

        let detail = do_get_biomolecule_question_report(&conn, &summaries[0].id).expect("detail");
        assert_eq!(detail.question_uid, "seed-1-0");
        assert_eq!(detail.message, "Špatná správná odpověď");
        assert_eq!(detail.student_username, "žák1");
        assert_eq!(detail.scope_slug, "sacharidy");
        // The snapshot round-trips verbatim, field for field.
        assert_eq!(detail.snapshot, report.snapshot);
    }

    #[test]
    fn empty_message_rejected() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");
        let report = payload("seed-1-0", "   ");

        let err = do_report_biomolecule_question(&conn, &student, &report).unwrap_err();
        assert!(matches!(err, DbError::Validation(_)));
        assert_eq!(
            err.to_string(),
            "Validation error: Popište, co je na otázce špatně."
        );
    }

    #[test]
    fn over_long_message_rejected() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");
        let report = payload("seed-1-0", &"x".repeat(MAX_REPORT_MESSAGE_CHARS + 1));

        let err = do_report_biomolecule_question(&conn, &student, &report).unwrap_err();
        assert!(matches!(err, DbError::Validation(_)));
        assert_eq!(
            err.to_string(),
            "Validation error: Hlášení je příliš dlouhé."
        );
    }

    #[test]
    fn blank_question_uid_rejected() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");
        let report = payload("   ", "Chybná otázka");

        let err = do_report_biomolecule_question(&conn, &student, &report).unwrap_err();
        assert!(matches!(err, DbError::Validation(_)));
        assert_eq!(
            err.to_string(),
            "Validation error: Tuto otázku nahlásit nelze."
        );
    }

    #[test]
    fn duplicate_report_rejected() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");

        do_report_biomolecule_question(&conn, &student, &payload("seed-1-0", "První hlášení"))
            .expect("first report");

        let err =
            do_report_biomolecule_question(&conn, &student, &payload("seed-1-0", "Druhé hlášení"))
                .unwrap_err();
        assert!(matches!(err, DbError::Validation(_)));
        assert!(err.to_string().contains("již nahlásili"));
    }

    #[test]
    fn get_unknown_id_returns_not_found() {
        let conn = setup_conn();
        let err = do_get_biomolecule_question_report(&conn, &Uuid::new_v4()).unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
        assert!(err.to_string().contains("Hlášení neexistuje"));
    }

    #[test]
    fn delete_unknown_id_returns_not_found() {
        let conn = setup_conn();
        let err = do_delete_biomolecule_question_report(&conn, &Uuid::new_v4()).unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
        assert!(err.to_string().contains("Hlášení neexistuje"));
    }
}
