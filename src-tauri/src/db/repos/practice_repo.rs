//! Storage for the student practice generator: which question a student was
//! served, and how it is to be graded.
//!
//! The grading fields live here rather than travelling to the browser with
//! the question — see the migration v19 comment in `db::schema`.

use crate::db::DbError;
use crate::models::{AnswerField, TemplateMode};
use chrono::Utc;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use uuid::Uuid;

/// A served-but-not-yet-graded question, plus everything needed to grade it.
#[derive(Debug, Clone)]
pub struct PracticeAttemptRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub template_id: Uuid,
    pub topic_id: Uuid,
    pub point_value: u8,
    pub mode: TemplateMode,
    pub correct_answer: f64,
    pub correct_option: Option<u8>,
    pub interval_lo: Option<f64>,
    pub interval_hi: Option<f64>,
    /// Present only for multi-answer questions (`[n mol][m g]`-style).
    pub answers_data: Option<Vec<AnswerField>>,
    /// The random values drawn for each placeholder when this question was
    /// served. Stored so reports can reconstruct the exact question snapshot.
    pub assigned_values: HashMap<String, f64>,
    pub assigned_strings: HashMap<String, String>,
    /// Closed single-answer only: the numeric options as served.
    pub numeric_options: Option<Vec<f64>>,
}

/// One row of the leaderboard. `correct_count` is the headline score —
/// how many questions this account has answered correctly.
#[derive(Debug, Clone)]
pub struct LeaderboardRow {
    pub user_id: Uuid,
    pub username: String,
    pub correct_count: i64,
    pub answered_count: i64,
    /// Points earned: the point value (2/3/4) of every correct answer, summed.
    pub points: i64,
}

/// A topic a student can practise, with the difficulties it actually has
/// questions for.
#[derive(Debug, Clone)]
pub struct PracticeTopicRow {
    pub topic_id: Uuid,
    pub name: String,
    pub point_value: u8,
    pub question_count: i64,
}

pub struct PracticeRepo;

impl PracticeRepo {
    /// Every (topic, point value) pair that has at least one question, with
    /// its question count.
    ///
    /// Questions are reachable as topic → category (one per point value) →
    /// set → template. `templates.topic_id`/`point_value` are *not* used:
    /// the importer writes a nil topic id to that column (see
    /// `TemplateRepo::insert`), so the join is the only source of truth for
    /// which topic a question belongs to.
    pub fn list_practice_topics(conn: &Connection) -> Result<Vec<PracticeTopicRow>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT tp.id, tp.name, c.point_value, COUNT(DISTINCT st.template_id)
             FROM topics tp
             JOIN categories c ON c.topic_id = tp.id
             JOIN sets s ON s.category_id = c.id
             JOIN set_templates st ON st.set_id = s.id
             WHERE tp.for_students = 1
             GROUP BY tp.id, c.point_value
             HAVING COUNT(DISTINCT st.template_id) > 0
             ORDER BY tp.name COLLATE NOCASE, c.point_value",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(PracticeTopicRow {
                    topic_id: row.get(0)?,
                    name: row.get(1)?,
                    point_value: row.get(2)?,
                    question_count: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Ids of every question in a topic at a given difficulty.
    pub fn list_template_ids(
        conn: &Connection,
        topic_id: &Uuid,
        point_value: u8,
    ) -> Result<Vec<Uuid>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT st.template_id
             FROM set_templates st
             JOIN sets s ON s.id = st.set_id
             JOIN categories c ON c.id = s.category_id
             WHERE c.topic_id = ?1 AND c.point_value = ?2",
        )?;
        let ids = stmt
            .query_map(params![topic_id, point_value], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<Uuid>>>()?;
        Ok(ids)
    }

    pub fn insert(conn: &Connection, attempt: &PracticeAttemptRecord) -> Result<(), DbError> {
        let answers_data = attempt
            .answers_data
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let assigned_values = serde_json::to_string(&attempt.assigned_values)?;
        let assigned_strings = serde_json::to_string(&attempt.assigned_strings)?;
        let numeric_options = attempt
            .numeric_options
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        conn.execute(
            "INSERT INTO practice_attempts (
                 id, user_id, template_id, topic_id, point_value, mode,
                 correct_answer, correct_option, interval_lo, interval_hi,
                 answers_data, is_correct, created_at, answered_at,
                 assigned_values, assigned_strings, numeric_options
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, NULL, ?13, ?14, ?15)",
            params![
                attempt.id,
                attempt.user_id,
                attempt.template_id,
                attempt.topic_id,
                attempt.point_value,
                attempt.mode.as_str(),
                attempt.correct_answer,
                attempt.correct_option,
                attempt.interval_lo,
                attempt.interval_hi,
                answers_data,
                Utc::now().to_rfc3339(),
                assigned_values,
                assigned_strings,
                numeric_options,
            ],
        )?;
        Ok(())
    }

    /// The attempt a student may still answer: theirs, and not yet graded.
    /// Scoping by `user_id` stops one student from grading (and scoring on)
    /// another's question; excluding already-graded rows stops anyone from
    /// resubmitting the same attempt until they hit the right answer.
    pub fn find_pending(
        conn: &Connection,
        id: &Uuid,
        user_id: &Uuid,
    ) -> Result<Option<PracticeAttemptRecord>, DbError> {
        Self::find_by_query(
            conn,
            "SELECT id, user_id, template_id, topic_id, point_value, mode,
                    correct_answer, correct_option, interval_lo, interval_hi, answers_data,
                    assigned_values, assigned_strings, numeric_options
             FROM practice_attempts
             WHERE id = ?1 AND user_id = ?2 AND is_correct IS NULL",
            params![id, user_id],
        )
    }

    /// Any attempt belonging to this user (pending or answered).
    /// Used by the question reports module to verify ownership.
    pub fn find_by_id_for_user(
        conn: &Connection,
        id: &Uuid,
        user_id: &Uuid,
    ) -> Result<Option<PracticeAttemptRecord>, DbError> {
        Self::find_by_query(
            conn,
            "SELECT id, user_id, template_id, topic_id, point_value, mode,
                    correct_answer, correct_option, interval_lo, interval_hi, answers_data,
                    assigned_values, assigned_strings, numeric_options
             FROM practice_attempts
             WHERE id = ?1 AND user_id = ?2",
            params![id, user_id],
        )
    }

    fn find_by_query(
        conn: &Connection,
        sql: &str,
        p: impl rusqlite::Params,
    ) -> Result<Option<PracticeAttemptRecord>, DbError> {
        let result = conn.query_row(sql, p, |row| {
            let mode: String = row.get(5)?;
            let answers_data_json: Option<String> = row.get(10)?;
            let assigned_values_json: Option<String> = row.get(11)?;
            let assigned_strings_json: Option<String> = row.get(12)?;
            let numeric_options_json: Option<String> = row.get(13)?;
            Ok((
                PracticeAttemptRecord {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    template_id: row.get(2)?,
                    topic_id: row.get(3)?,
                    point_value: row.get(4)?,
                    mode: TemplateMode::parse(&mode).unwrap_or(TemplateMode::Open),
                    correct_answer: row.get(6)?,
                    correct_option: row.get(7)?,
                    interval_lo: row.get(8)?,
                    interval_hi: row.get(9)?,
                    answers_data: None,
                    assigned_values: HashMap::new(),
                    assigned_strings: HashMap::new(),
                    numeric_options: None,
                },
                answers_data_json,
                assigned_values_json,
                assigned_strings_json,
                numeric_options_json,
            ))
        });

        match result {
            Ok((mut record, answers_json, av_json, as_json, no_json)) => {
                record.answers_data = answers_json
                    .as_deref()
                    .map(serde_json::from_str)
                    .transpose()?;
                record.assigned_values = av_json
                    .as_deref()
                    .map(serde_json::from_str)
                    .transpose()?
                    .unwrap_or_default();
                record.assigned_strings = as_json
                    .as_deref()
                    .map(serde_json::from_str)
                    .transpose()?
                    .unwrap_or_default();
                record.numeric_options = no_json
                    .as_deref()
                    .map(serde_json::from_str)
                    .transpose()?;
                Ok(Some(record))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    pub fn mark_answered(conn: &Connection, id: &Uuid, is_correct: bool) -> Result<(), DbError> {
        conn.execute(
            "UPDATE practice_attempts SET is_correct = ?2, answered_at = ?3 WHERE id = ?1",
            params![id, is_correct as i64, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    /// Everyone worth showing on the leaderboard: all students (so a student
    /// with no answers yet still sees themselves), plus anyone else who has
    /// actually practised — a teacher trying the generator earns a place too.
    ///
    /// `SUM(CASE ...)` rather than `COUNT(...) FILTER (...)`: the filter
    /// clause needs SQLite 3.30+, and nothing else in this codebase assumes a
    /// minimum version of the bundled library.
    pub fn leaderboard(conn: &Connection) -> Result<Vec<LeaderboardRow>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT u.id,
                    u.username,
                    SUM(CASE WHEN pa.is_correct = 1 THEN 1 ELSE 0 END) AS correct_count,
                    SUM(CASE WHEN pa.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS answered_count,
                    SUM(CASE WHEN pa.is_correct = 1 THEN pa.point_value ELSE 0 END) AS points
             FROM users u
             LEFT JOIN practice_attempts pa ON pa.user_id = u.id
             GROUP BY u.id
             HAVING u.role = 'student' OR answered_count > 0
             ORDER BY correct_count DESC, points DESC, answered_count ASC, u.username COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LeaderboardRow {
                    user_id: row.get(0)?,
                    username: row.get(1)?,
                    correct_count: row.get(2)?,
                    answered_count: row.get(3)?,
                    points: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::user_repo::{UserRecord, UserRepo};
    use crate::models::Role;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn insert_user(conn: &Connection, username: &str, role: Role) -> Uuid {
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: username.into(),
            password_hash: "h".into(),
            role,
            created_at: Utc::now(),
            protected: false,
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    fn attempt(user_id: Uuid, point_value: u8) -> PracticeAttemptRecord {
        PracticeAttemptRecord {
            id: Uuid::new_v4(),
            user_id,
            template_id: Uuid::new_v4(),
            topic_id: Uuid::new_v4(),
            point_value,
            mode: TemplateMode::Open,
            correct_answer: 42.0,
            correct_option: None,
            interval_lo: Some(41.0),
            interval_hi: Some(43.0),
            answers_data: None,
            assigned_values: HashMap::new(),
            assigned_strings: HashMap::new(),
            numeric_options: None,
        }
    }

    #[test]
    fn pending_attempt_is_found_once_and_then_closed() {
        let conn = setup_conn();
        let user_id = insert_user(&conn, "student", Role::Student);
        let record = attempt(user_id, 3);
        PracticeRepo::insert(&conn, &record).expect("insert attempt");

        let found = PracticeRepo::find_pending(&conn, &record.id, &user_id)
            .expect("find")
            .expect("pending");
        assert_eq!(found.correct_answer, 42.0);
        assert_eq!(found.interval_hi, Some(43.0));

        PracticeRepo::mark_answered(&conn, &record.id, false).expect("mark");

        // A second submission for the same attempt must find nothing — this is
        // what stops a student retrying one question until it scores.
        assert!(PracticeRepo::find_pending(&conn, &record.id, &user_id)
            .expect("find again")
            .is_none());
    }

    #[test]
    fn another_students_attempt_is_not_visible() {
        let conn = setup_conn();
        let owner = insert_user(&conn, "owner", Role::Student);
        let other = insert_user(&conn, "other", Role::Student);
        let record = attempt(owner, 2);
        PracticeRepo::insert(&conn, &record).expect("insert attempt");

        assert!(PracticeRepo::find_pending(&conn, &record.id, &other)
            .expect("find")
            .is_none());
    }

    #[test]
    fn leaderboard_ranks_by_correct_answers_and_includes_idle_students() {
        let conn = setup_conn();
        let busy = insert_user(&conn, "busy", Role::Student);
        let idle = insert_user(&conn, "idle", Role::Student);
        let teacher = insert_user(&conn, "teacher", Role::Teacher);

        for (user, point_value, correct) in [
            (busy, 4u8, true),
            (busy, 2, true),
            (busy, 3, false),
            (teacher, 2, true),
        ] {
            let record = attempt(user, point_value);
            PracticeRepo::insert(&conn, &record).expect("insert");
            PracticeRepo::mark_answered(&conn, &record.id, correct).expect("mark");
        }

        let board = PracticeRepo::leaderboard(&conn).expect("leaderboard");
        let names: Vec<&str> = board.iter().map(|r| r.username.as_str()).collect();
        assert_eq!(names, vec!["busy", "teacher", "idle"]);

        let top = &board[0];
        assert_eq!(top.correct_count, 2);
        assert_eq!(top.answered_count, 3);
        assert_eq!(top.points, 6, "4 + 2 points for the two correct answers");

        // A student who has not practised yet still appears, on zero.
        let idle_row = board.iter().find(|r| r.username == "idle").expect("idle row");
        assert_eq!(idle_row.user_id, idle);
        assert_eq!(idle_row.answered_count, 0);
    }
}
