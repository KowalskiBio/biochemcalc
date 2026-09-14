//! Storage for fixed-batch test sessions (timed or untimed): a set of
//! questions generated all at once and answered together, as opposed to
//! `PracticeRepo`'s endless one-at-a-time practice generator. Grading stays
//! on `practice_attempts` (tagged via `test_session_id`/`position`); this
//! repo only owns the `test_sessions` row itself and its score summary.

use crate::db::DbError;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct TestSessionRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub topic_id: Uuid,
    pub point_value: u8,
    /// `None` means untimed: no deadline is ever enforced for this session.
    pub time_limit_seconds: Option<u32>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

/// A session's aggregate score, over however many of its questions have been
/// answered so far (a student can finish before answering everything).
#[derive(Debug, Clone, Copy)]
pub struct TestSessionSummary {
    pub total_questions: i64,
    pub answered_count: i64,
    pub correct_count: i64,
    pub points: i64,
}

pub struct TestSessionRepo;

impl TestSessionRepo {
    pub fn insert(conn: &Connection, session: &TestSessionRecord) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO test_sessions (
                 id, user_id, topic_id, point_value, time_limit_seconds, started_at, finished_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![
                session.id,
                session.user_id,
                session.topic_id,
                session.point_value,
                session.time_limit_seconds,
                session.started_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// A session, scoped to the user who started it: nobody else may finish
    /// it, read its deadline, or see its results.
    pub fn get_owned(
        conn: &Connection,
        id: &Uuid,
        user_id: &Uuid,
    ) -> Result<Option<TestSessionRecord>, DbError> {
        let result = conn.query_row(
            "SELECT id, user_id, topic_id, point_value, time_limit_seconds, started_at, finished_at
             FROM test_sessions
             WHERE id = ?1 AND user_id = ?2",
            params![id, user_id],
            |row| {
                let started_at: String = row.get(5)?;
                let finished_at: Option<String> = row.get(6)?;
                Ok(TestSessionRecord {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    topic_id: row.get(2)?,
                    point_value: row.get(3)?,
                    time_limit_seconds: row.get(4)?,
                    started_at: parse_rfc3339(&started_at),
                    finished_at: finished_at.as_deref().map(parse_rfc3339),
                })
            },
        );
        match result {
            Ok(session) => Ok(Some(session)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    /// Records `finished_at` the first time this is called for a session;
    /// later calls are no-ops so the elapsed time freezes at the real finish
    /// moment even if a results page is reloaded and calls this again.
    /// Returns the session's (possibly just-set) `finished_at`.
    pub fn mark_finished(conn: &Connection, id: &Uuid) -> Result<DateTime<Utc>, DbError> {
        let now = Utc::now();
        conn.execute(
            "UPDATE test_sessions SET finished_at = ?2 WHERE id = ?1 AND finished_at IS NULL",
            params![id, now.to_rfc3339()],
        )?;
        let finished_at: String = conn.query_row(
            "SELECT finished_at FROM test_sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(parse_rfc3339(&finished_at))
    }

    /// Score summary over every `practice_attempts` row tagged into this
    /// session, regardless of how many the student has actually answered.
    pub fn summarize(conn: &Connection, id: &Uuid) -> Result<TestSessionSummary, DbError> {
        conn.query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN is_correct IS NOT NULL THEN 1 ELSE 0 END),
                    SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN is_correct = 1 THEN point_value ELSE 0 END)
             FROM practice_attempts
             WHERE test_session_id = ?1",
            params![id],
            |row| {
                Ok(TestSessionSummary {
                    total_questions: row.get(0)?,
                    answered_count: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    correct_count: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    points: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                })
            },
        )
        .map_err(DbError::Sqlite)
    }
}

/// `DateTime::parse_from_rfc3339` never fails on a value this codebase wrote
/// itself via `to_rfc3339()`, so a parse failure would mean data corruption,
/// not a normal error path worth propagating through `Result`.
fn parse_rfc3339(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap_or_else(|e| panic!("stored timestamp {value:?} is not valid RFC3339: {e}"))
        .with_timezone(&Utc)
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

    fn insert_student(conn: &Connection, username: &str) -> Uuid {
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: username.into(),
            password_hash: "h".into(),
            role: Role::Student,
            created_at: Utc::now(),
            protected: false,
            email: None,
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    fn session(user_id: Uuid, time_limit_seconds: Option<u32>) -> TestSessionRecord {
        TestSessionRecord {
            id: Uuid::new_v4(),
            user_id,
            topic_id: Uuid::new_v4(),
            point_value: 2,
            time_limit_seconds,
            started_at: Utc::now(),
            finished_at: None,
        }
    }

    #[test]
    fn insert_and_get_owned_round_trips_a_session() {
        let conn = setup_conn();
        let user_id = insert_student(&conn, "student");
        let record = session(user_id, Some(600));
        TestSessionRepo::insert(&conn, &record).expect("insert");

        let fetched = TestSessionRepo::get_owned(&conn, &record.id, &user_id)
            .expect("get")
            .expect("found");
        assert_eq!(fetched.time_limit_seconds, Some(600));
        assert!(fetched.finished_at.is_none());
    }

    #[test]
    fn get_owned_hides_another_users_session() {
        let conn = setup_conn();
        let owner = insert_student(&conn, "owner");
        let other = insert_student(&conn, "other");
        let record = session(owner, None);
        TestSessionRepo::insert(&conn, &record).expect("insert");

        assert!(TestSessionRepo::get_owned(&conn, &record.id, &other)
            .expect("get")
            .is_none());
    }

    #[test]
    fn mark_finished_is_idempotent_and_freezes_the_first_timestamp() {
        let conn = setup_conn();
        let user_id = insert_student(&conn, "student");
        let record = session(user_id, None);
        TestSessionRepo::insert(&conn, &record).expect("insert");

        let first = TestSessionRepo::mark_finished(&conn, &record.id).expect("finish once");
        let second = TestSessionRepo::mark_finished(&conn, &record.id).expect("finish again");
        assert_eq!(
            first, second,
            "a second call must not overwrite the first finish time"
        );
    }

    #[test]
    fn summarize_counts_only_this_sessions_attempts() {
        let conn = setup_conn();
        let user_id = insert_student(&conn, "student");
        let record = session(user_id, None);
        TestSessionRepo::insert(&conn, &record).expect("insert");

        use crate::db::repos::{PracticeAttemptRecord, PracticeRepo};
        use crate::models::TemplateMode;
        use std::collections::HashMap;

        let make = |correct: Option<bool>, points: u8| {
            let id = Uuid::new_v4();
            PracticeRepo::insert(
                &conn,
                &PracticeAttemptRecord {
                    id,
                    user_id,
                    template_id: Uuid::new_v4(),
                    topic_id: record.topic_id,
                    point_value: points,
                    mode: TemplateMode::Open,
                    correct_answer: 1.0,
                    correct_option: None,
                    alternate_option: None,
                    interval_lo: Some(0.0),
                    interval_hi: Some(2.0),
                    answers_data: None,
                    assigned_values: HashMap::new(),
                    assigned_strings: HashMap::new(),
                    numeric_options: None,
                    test_session_id: Some(record.id),
                    position: Some(0),
                    streak_run_id: None,
                    option_sig_digits: None,
                },
            )
            .expect("insert attempt");
            if let Some(is_correct) = correct {
                PracticeRepo::mark_answered(&conn, &id, is_correct).expect("mark");
            }
        };

        make(Some(true), 2);
        make(Some(false), 3);
        make(None, 4); // still unanswered

        // An attempt from a different (unrelated) session must not be counted.
        let other_session = session(user_id, None);
        TestSessionRepo::insert(&conn, &other_session).expect("insert other session");
        PracticeRepo::insert(
            &conn,
            &PracticeAttemptRecord {
                id: Uuid::new_v4(),
                user_id,
                template_id: Uuid::new_v4(),
                topic_id: other_session.topic_id,
                point_value: 4,
                mode: TemplateMode::Open,
                correct_answer: 1.0,
                correct_option: None,
                alternate_option: None,
                interval_lo: Some(0.0),
                interval_hi: Some(2.0),
                answers_data: None,
                assigned_values: HashMap::new(),
                assigned_strings: HashMap::new(),
                numeric_options: None,
                test_session_id: Some(other_session.id),
                position: Some(0),
                streak_run_id: None,
                option_sig_digits: None,
            },
        )
        .expect("insert unrelated attempt");

        let summary = TestSessionRepo::summarize(&conn, &record.id).expect("summarize");
        assert_eq!(summary.total_questions, 3);
        assert_eq!(summary.answered_count, 2);
        assert_eq!(summary.correct_count, 1);
        assert_eq!(summary.points, 2);
    }
}
