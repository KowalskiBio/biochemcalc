//! Question report module: students can flag broken questions, teachers see
//! them with a frozen snapshot of what the student saw.
//!
//! The snapshot is stored as JSON in `question_reports.snapshot` so a report
//! remains readable even if its template or topic is later deleted.

use crate::commands::generation::load_template_dependencies;
use crate::commands::practice::{
    answer_slots, correct_answers, constants_for_rendering, PracticeAnswerSlot, PracticeCorrectAnswer,
    PracticeVariable, PracticeQuestion,
};
use crate::commands::crud::TemplateLocation;
use crate::db::repos::{
    ConstantRepo, PracticeAttemptRecord, PracticeRepo, QuestionReportRecord, QuestionReportRepo,
    QuestionReportSummaryRow, TemplateRepo, TopicRepo, UserRepo,
};
use crate::db::DbError;
use crate::models::TemplateMode;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Payloads and DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportQuestionPayload {
    pub attempt_id: Uuid,
    pub message: String,
}

/// A frozen view of the question the student was served — the teacher sees
/// exactly what triggered the report. Mirrors the practice generator's output
/// but adds fields only relevant for a report (template_id, point_value).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeacherQuestionSnapshot {
    pub template_id: Uuid,
    pub question_text: String,
    pub result_unit: String,
    pub mode: TemplateMode,
    pub point_value: u8,
    pub variables: Vec<PracticeVariable>,
    pub assigned_values: HashMap<String, f64>,
    pub assigned_strings: HashMap<String, String>,
    pub constants: HashMap<String, f64>,
    pub answer_slots: Vec<PracticeAnswerSlot>,
    pub correct_answers: Vec<PracticeCorrectAnswer>,
    pub correct_option: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionReportSummary {
    pub id: Uuid,
    pub student_username: String,
    pub topic_name: String,
    pub point_value: u8,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionReportDetail {
    pub id: Uuid,
    pub attempt_id: Uuid,
    pub template_id: Uuid,
    pub message: String,
    pub created_at: String,
    pub student_username: String,
    pub topic_name: String,
    pub point_value: u8,
    pub is_correct: Option<bool>,
    pub location: Option<TemplateLocation>,
    pub question_text: String,
    pub result_unit: String,
    pub mode: TemplateMode,
    pub variables: Vec<PracticeVariable>,
    pub assigned_values: HashMap<String, f64>,
    pub assigned_strings: HashMap<String, String>,
    pub constants: HashMap<String, f64>,
    pub answer_slots: Vec<PracticeAnswerSlot>,
    pub correct_answers: Vec<PracticeCorrectAnswer>,
    pub correct_option: Option<u8>,
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/// File a report about a question the student was served.
///
/// - Validates the message is non-empty.
/// - Verifies the attempt belongs to this user.
/// - Builds a server-side snapshot from the attempt's data.
/// - Inserts the report; duplicate attempt_id → Validation error.
pub fn do_report_question(
    conn: &Connection,
    user_id: &Uuid,
    payload: &ReportQuestionPayload,
) -> Result<(), DbError> {
    if payload.message.trim().is_empty() {
        return Err(DbError::Validation("Popište, co je na otázce špatně.".into()));
    }

    let attempt =
        PracticeRepo::find_by_id_for_user(conn, &payload.attempt_id, user_id)?.ok_or_else(|| {
            DbError::NotFound("Tuto otázku nahlásit nelze.".into())
        })?;

    let template = TemplateRepo::get_by_id(conn, &attempt.template_id)?;

    let (variables, resolved_constants, _constraint, _fixed_values) =
        load_template_dependencies(conn, &template)?;

    let placeholders: HashMap<Uuid, String> =
        TemplateRepo::get_variables(conn, &template.id)?
            .into_iter()
            .map(|tv| (tv.variable_id, tv.placeholder))
            .collect();

    let practice_variables: Vec<PracticeVariable> = variables
        .into_iter()
        .map(|variable| {
            let placeholder = placeholders
                .get(&variable.id)
                .cloned()
                .unwrap_or_else(|| variable.symbol.clone());
            PracticeVariable {
                variable,
                placeholder,
            }
        })
        .collect();

    let all_constants = constants_for_rendering(conn, &resolved_constants)?;

    let snapshot = TeacherQuestionSnapshot {
        template_id: template.id,
        question_text: template.question_text.clone(),
        result_unit: template.result_unit.clone(),
        mode: attempt.mode.clone(),
        point_value: attempt.point_value,
        variables: practice_variables,
        assigned_values: attempt.assigned_values.clone(),
        assigned_strings: attempt.assigned_strings.clone(),
        constants: all_constants,
        answer_slots: build_answer_slots_from_attempt(&attempt, &template.result_unit),
        correct_answers: correct_answers(&attempt),
        correct_option: attempt.correct_option,
    };

    let snapshot_json = serde_json::to_string(&snapshot)?;

    let record = QuestionReportRecord {
        id: Uuid::new_v4(),
        attempt_id: payload.attempt_id,
        user_id: *user_id,
        topic_id: attempt.topic_id,
        point_value: attempt.point_value,
        message: payload.message.clone(),
        snapshot: snapshot_json,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    match QuestionReportRepo::insert(conn, &record) {
        Ok(()) => Ok(()),
        Err(DbError::Sqlite(e)) => {
            if e.to_string().contains("UNIQUE") {
                Err(DbError::Validation("Tuto otázku jste již nahlásili.".into()))
            } else {
                Err(DbError::Sqlite(e))
            }
        }
        Err(other) => Err(other),
    }
}

/// List all question reports with joined names.
pub fn do_list_question_reports(
    conn: &Connection,
) -> Result<Vec<QuestionReportSummary>, DbError> {
    let rows = QuestionReportRepo::list_summaries(conn)?;
    Ok(rows
        .into_iter()
        .map(|row| QuestionReportSummary {
            id: row.id,
            student_username: row.student_username,
            topic_name: row.topic_name,
            point_value: row.point_value,
            message: row.message,
            created_at: row.created_at,
        })
        .collect())
}

/// Get full details of one question report.
pub fn do_get_question_report(
    conn: &Connection,
    id: &Uuid,
) -> Result<QuestionReportDetail, DbError> {
    let report =
        QuestionReportRepo::get_by_id(conn, id)?
            .ok_or_else(|| DbError::NotFound("Hlášení neexistuje.".into()))?;

    let snapshot: TeacherQuestionSnapshot =
        serde_json::from_str(&report.snapshot)
            .map_err(|e| DbError::Serde(e))?;

    let is_correct =
        QuestionReportRepo::attempt_is_correct(conn, &report.attempt_id)?
            .flatten();  // Option<Option<bool>> -> Option<bool>

    let location = crud::do_get_template_location(conn, &snapshot.template_id)?;

    let topic_name = TopicRepo::get_by_id(conn, &report.topic_id)
        .map(|t| t.name)
        .unwrap_or_else(|_| "(smazané téma)".into());

    let student_username = UserRepo::get_by_id(conn, &report.user_id)
        .map(|u| u.username)
        .unwrap_or_else(|_| "(smazaný uživatel)".into());

    Ok(QuestionReportDetail {
        id: report.id,
        attempt_id: report.attempt_id,
        template_id: snapshot.template_id,
        message: report.message,
        created_at: report.created_at,
        student_username,
        topic_name,
        point_value: report.point_value,
        is_correct,
        location,
        question_text: snapshot.question_text,
        result_unit: snapshot.result_unit,
        mode: snapshot.mode,
        variables: snapshot.variables,
        assigned_values: snapshot.assigned_values,
        assigned_strings: snapshot.assigned_strings,
        constants: snapshot.constants,
        answer_slots: snapshot.answer_slots,
        correct_answers: snapshot.correct_answers,
        correct_option: snapshot.correct_option,
    })
}

/// Delete a question report.
pub fn do_delete_question_report(
    conn: &Connection,
    id: &Uuid,
) -> Result<(), DbError> {
    if !QuestionReportRepo::delete(conn, id)? {
        return Err(DbError::NotFound("Hlášení neexistuje.".into()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build answer slots from an attempt (mirrors practice.rs logic but sources
/// from the attempt rather than a variant).
fn build_answer_slots_from_attempt(
    attempt: &PracticeAttemptRecord,
    result_unit: &str,
) -> Vec<PracticeAnswerSlot> {
    let closed = matches!(attempt.mode, TemplateMode::Closed);

    match attempt.answers_data.as_ref() {
        Some(fields) if !fields.is_empty() => fields
            .iter()
            .map(|field| PracticeAnswerSlot {
                symbol: Some(field.symbol.clone()),
                unit: field.unit.clone(),
                numeric_options: if closed {
                    field.numeric_options.clone()
                } else {
                    None
                },
            })
            .collect(),
        _ => vec![PracticeAnswerSlot {
            symbol: None,
            unit: (!result_unit.is_empty()).then(|| result_unit.to_string()),
            numeric_options: if closed {
                attempt.numeric_options.clone()
            } else {
                None
            },
        }],
    }
}

// Re-export crud helper for template location lookup
mod crud {
    use crate::db::DbError;
    use crate::commands::crud::TemplateLocation;
    use crate::db::repos::{CategoryRepo, SetRepo};
    use rusqlite::Connection;
    use uuid::Uuid;

    pub(crate) fn do_get_template_location(
        conn: &Connection,
        id: &Uuid,
    ) -> Result<Option<TemplateLocation>, DbError> {
        if let Some((set_id, category_id)) = SetRepo::find_by_template_id(conn, id)? {
            let category = CategoryRepo::get_by_id(conn, &category_id)?;
            Ok(Some(TemplateLocation {
                set_id,
                category_id,
                topic_id: category.topic_id,
            }))
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::{
        CategoryRepo, SetRepo, UserRecord, UserRepo,
        topic_repo::TopicRepo as TPR, 
        variable_repo::VariableRepo as VPR,
        template_repo::TemplateRepo as TR,
    };
    use crate::models::{Role, TemplateMode, Topic, Variable, ConstraintType, ResultConstraint, Template, TemplateVariable};
    use chrono::Utc;

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
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    fn seed_topic_with_question(conn: &Connection, name: &str, point_value: u8) -> (Uuid, Uuid) {
        let mut topic = Topic::new(name.to_string());
        topic.for_students = true;
        TPR::insert(conn, &topic).expect("insert topic");

        let (_, sets) = CategoryRepo::create(conn, topic.id, point_value).expect("create category");

        let variable = Variable::new(
            "Hmotnost".into(),
            "X".into(),
            1.0,
            10.0,
            1.0,
            "g".into(),
            0,
        );
        VPR::insert_raw(conn, &variable).expect("insert variable");

        let template = Template::new(
            format!("{name}: kolik je dvojnásobek [[X]] g? [Y]"),
            "Y = X * 2".into(),
            "Y = X × 2".into(),
            None,
            "g".into(),
            point_value,
        );
        let constraint = ResultConstraint::new(
            template.id,
            Some(0.0),
            Some(100.0),
            None,
            ConstraintType::Range,
        );
        let tv = TemplateVariable {
            template_id: template.id,
            variable_id: variable.id,
            placeholder: "X".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
        };
        TR::insert(conn, &template, &[tv], &[], Some(&constraint))
            .expect("insert template");
        SetRepo::add_template(conn, &sets[0].id, &template.id).expect("add template to set");

        (topic.id, template.id)
    }

    fn serve_question(conn: &Connection, user_id: &Uuid, topic_id: &Uuid) -> PracticeQuestion {
        // Use the practice module's function to serve a real question
        super::super::practice::do_next_question(
            conn,
            user_id,
            &super::super::practice::NextQuestionPayload {
                topic_id: *topic_id,
                point_value: 2,
            },
        ).expect("serve question")
    }

    #[test]
    fn happy_path_report_then_list_then_detail() {
        let conn = setup_conn();
        let (topic_id, _template_id) = seed_topic_with_question(&conn, "Roztoky", 2);
        let student = insert_student(&conn, "žák1");

        let question = serve_question(&conn, &student, &topic_id);

        let payload = ReportQuestionPayload {
            attempt_id: question.attempt_id,
            message: "Špatně zaokrouhleno".into(),
        };

        do_report_question(&conn, &student, &payload).expect("report");

        let summaries = do_list_question_reports(&conn).expect("list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].student_username, "žák1");
        assert_eq!(summaries[0].topic_name, "Roztoky");
        assert_eq!(summaries[0].message, "Špatně zaokrouhleno");

        let detail = do_get_question_report(&conn, &summaries[0].id).expect("detail");
        assert_eq!(detail.message, "Špatně zaokrouhleno");
        assert!(!detail.question_text.is_empty());
        assert!(!detail.assigned_values.is_empty());
        assert!(!detail.correct_answers.is_empty());
        // correct_option is in the snapshot but not on PracticeQuestion (hidden from students)
        assert!(detail.location.is_some());
        assert_eq!(detail.location.as_ref().unwrap().topic_id, topic_id);
        assert_eq!(detail.is_correct, None);
    }

    #[test]
    fn empty_message_rejected() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");
        let payload = ReportQuestionPayload {
            attempt_id: Uuid::new_v4(),
            message: "   ".into(),
        };

        let err = do_report_question(&conn, &student, &payload).unwrap_err();
        assert!(matches!(err, DbError::Validation(_)));
        assert_eq!(
            err.to_string(),
            "Validation error: Popište, co je na otázce špatně."
        );
    }

    #[test]
    fn cannot_report_someone_elses_attempt() {
        let conn = setup_conn();
        let (topic_id, _template_id) = seed_topic_with_question(&conn, "Roztoky", 2);
        let student_a = insert_student(&conn, "studentA");
        let student_b = insert_student(&conn, "studentB");

        let question = serve_question(&conn, &student_a, &topic_id);

        let payload = ReportQuestionPayload {
            attempt_id: question.attempt_id,
            message: "Chybná otázka".into(),
        };

        let err = do_report_question(&conn, &student_b, &payload).unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
        assert!(err.to_string().contains("nahlásit nelze"));
    }

    #[test]
    fn report_after_submit_answer_shows_is_correct() {
        let conn = setup_conn();
        let (topic_id, _template_id) = seed_topic_with_question(&conn, "Roztoky", 2);
        let student = insert_student(&conn, "student");

        let question = serve_question(&conn, &student, &topic_id);

        // Answer correctly using double-the-value trick - handle both modes
        let expected = question.assigned_values["X"] * 2.0;
        let submit_payload = match question.mode {
            TemplateMode::Open => super::super::practice::SubmitAnswerPayload {
                attempt_id: question.attempt_id,
                selected_option: None,
                answers: Some(vec![expected]),
            },
            TemplateMode::Closed => {
                let options = question.answer_slots[0].numeric_options.clone().expect("options");
                let position = options.iter().position(|o| (o - expected).abs() < 1e-9)
                    .expect("correct value in options") as u8;
                super::super::practice::SubmitAnswerPayload {
                    attempt_id: question.attempt_id,
                    selected_option: Some(position + 1),
                    answers: None,
                }
            }
        };
        super::super::practice::do_submit_answer(&conn, &student, &submit_payload)
            .expect("submit correct answer");

        // Now report
        let report_payload = ReportQuestionPayload {
            attempt_id: question.attempt_id,
            message: "Po odpovědi hlášení".into(),
        };
        do_report_question(&conn, &student, &report_payload).expect("report after answer");

        let summaries = do_list_question_reports(&conn).expect("list");
        let detail = do_get_question_report(&conn, &summaries[0].id).expect("detail");
        assert_eq!(detail.is_correct, Some(true));
    }

    #[test]
    fn duplicate_report_rejected() {
        let conn = setup_conn();
        let (topic_id, _template_id) = seed_topic_with_question(&conn, "Roztoky", 2);
        let student = insert_student(&conn, "student");

        let question = serve_question(&conn, &student, &topic_id);

        let payload = ReportQuestionPayload {
            attempt_id: question.attempt_id,
            message: "První hlášení".into(),
        };
        do_report_question(&conn, &student, &payload).expect("first report");

        let payload2 = ReportQuestionPayload {
            attempt_id: question.attempt_id,
            message: "Druhé hlášení".into(),
        };
        let err = do_report_question(&conn, &student, &payload2).unwrap_err();
        assert!(matches!(err, DbError::Validation(_)));
        assert!(err.to_string().contains("již nahlásili"));
    }

    #[test]
    fn get_unknown_id_returns_not_found() {
        let conn = setup_conn();
        let err = do_get_question_report(&conn, &Uuid::new_v4()).unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
        assert!(err.to_string().contains("Hlášení neexistuje"));
    }

    #[test]
    fn delete_unknown_id_returns_not_found() {
        let conn = setup_conn();
        let err = do_delete_question_report(&conn, &Uuid::new_v4()).unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
        assert!(err.to_string().contains("Hlášení neexistuje"));
    }

    #[test]
    fn deleted_template_still_renders_from_snapshot() {
        let conn = setup_conn();
        let (topic_id, template_id) = seed_topic_with_question(&conn, "Roztoky", 2);
        let student = insert_student(&conn, "student");

        let question = serve_question(&conn, &student, &topic_id);

        let payload = ReportQuestionPayload {
            attempt_id: question.attempt_id,
            message: "Špatná otázka".into(),
        };
        do_report_question(&conn, &student, &payload).expect("report");

        // Delete the template and its set_templates reference (FK may block, so disable FKs)
        conn.execute_batch("PRAGMA foreign_keys = OFF;").expect("fk off");
        conn.execute(
            "DELETE FROM set_templates WHERE template_id = ?1",
            rusqlite::params![template_id],
        ).expect("delete set_templates entry");
        conn.execute(
            "DELETE FROM templates WHERE id = ?1",
            rusqlite::params![template_id],
        ).expect("delete template");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk on");

        let summaries = do_list_question_reports(&conn).expect("list");
        let detail = do_get_question_report(&conn, &summaries[0].id).expect("detail");

        // Snapshot still renders
        assert!(!detail.question_text.is_empty());
        assert_eq!(detail.template_id, template_id);
        // Location is now None because set_templates entry was removed
        assert!(detail.location.is_none());
    }
}
