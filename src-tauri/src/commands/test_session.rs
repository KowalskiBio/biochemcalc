//! Fixed-batch test sessions: every question in a topic/point value
//! generated all at once, one variant each, and answered together, as
//! opposed to `commands::practice`'s endless one-at-a-time generator.
//!
//! Grading is not reimplemented here. A session's questions are ordinary
//! `practice_attempts` rows (tagged with `test_session_id`/`position`), so
//! `commands::practice::do_submit_answer` grades them unchanged, and they
//! count toward the same leaderboard as regular practice.

use crate::commands::practice::{build_question, entropy_seed, PracticeQuestion};
use crate::db::repos::{PracticeRepo, TestSessionRecord, TestSessionRepo};
use crate::db::DbError;
use crate::models::TemplateMode;
use chrono::{DateTime, Utc};
use rand::rngs::StdRng;
use rand::SeedableRng;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTestPayload {
    pub topic_id: Uuid,
    pub point_value: u8,
    /// `None` starts an untimed test: no deadline is ever enforced. The
    /// student-facing test start page always sends a value now, but this
    /// stays optional so a session started before that UI change keeps
    /// meaning what it always did.
    #[serde(default)]
    pub time_limit_seconds: Option<u32>,
    /// Restrict the test to this mode; `None` mixes both, same as
    /// `commands::practice::NextQuestionPayload::mode`.
    #[serde(default)]
    pub mode: Option<TemplateMode>,
    /// Restrict the test to this one set (sada); `None` draws from every set
    /// at the topic/difficulty, same as `NextQuestionPayload::set_id`.
    #[serde(default)]
    pub set_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestSessionView {
    pub session_id: Uuid,
    pub time_limit_seconds: Option<u32>,
    pub started_at: DateTime<Utc>,
    pub questions: Vec<PracticeQuestion>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishTestPayload {
    pub session_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResults {
    pub total_questions: i64,
    pub answered_count: i64,
    pub correct_count: i64,
    pub points: i64,
    pub elapsed_seconds: i64,
}

/// Generate every question in `topic_id` at `point_value` (optionally
/// narrowed to one `mode` and/or one `set_id`, same semantics as
/// `commands::practice::do_next_question`), one variant each, and bundle
/// them into a new session.
///
/// A template that fails to generate (its constraints are unsatisfiable for
/// the sampled values) is skipped rather than failing the whole test, the
/// same tolerance `commands::practice` already has for one-off generation
/// failures: one bad template must not read as "this whole test is broken."
/// The test fails outright only if every template failed.
pub fn do_start_test(
    conn: &Connection,
    user_id: &Uuid,
    payload: &StartTestPayload,
) -> Result<TestSessionView, DbError> {
    let mut template_ids = PracticeRepo::list_template_ids(
        conn,
        &payload.topic_id,
        payload.point_value,
        payload.set_id.as_ref(),
    )?;
    if let Some(wanted) = payload.mode {
        template_ids.retain(|(_, mode)| *mode == wanted);
    }
    if template_ids.is_empty() {
        return Err(DbError::NotFound(
            "Pro toto téma, obtížnost a typ otázek zatím nejsou žádné otázky".into(),
        ));
    }

    let session = TestSessionRecord {
        id: Uuid::new_v4(),
        user_id: *user_id,
        topic_id: payload.topic_id,
        point_value: payload.point_value,
        time_limit_seconds: payload.time_limit_seconds,
        started_at: Utc::now(),
        finished_at: None,
    };
    TestSessionRepo::insert(conn, &session)?;

    let mut rng = StdRng::seed_from_u64(entropy_seed());
    let mut questions = Vec::with_capacity(template_ids.len());
    for (position, (template_id, mode)) in template_ids.into_iter().enumerate() {
        // Interactive tests (like interactive practice) keep the correct
        // answer's position random; `build_question` already handles that
        // via `force_correct_first = false` internally.
        if let Ok(question) = build_question(
            conn,
            user_id,
            &payload.topic_id,
            &template_id,
            mode,
            &mut rng,
            Some(session.id),
            Some(position as i64),
            None,
        ) {
            questions.push(question);
        }
    }

    if questions.is_empty() {
        return Err(DbError::Validation(
            "Nepodařilo se vygenerovat žádnou otázku pro tento test".into(),
        ));
    }

    Ok(TestSessionView {
        session_id: session.id,
        time_limit_seconds: session.time_limit_seconds,
        started_at: session.started_at,
        questions,
    })
}

/// Mark a session finished and return its score summary. Idempotent: only
/// the first call records `finished_at`, so `elapsed_seconds` freezes at the
/// real finish moment even if a reloaded results page calls this again.
/// Ownership-checked: a session belongs to exactly the user who started it.
pub fn do_finish_test(
    conn: &Connection,
    user_id: &Uuid,
    payload: &FinishTestPayload,
) -> Result<TestResults, DbError> {
    let session = TestSessionRepo::get_owned(conn, &payload.session_id, user_id)?
        .ok_or_else(|| DbError::NotFound("Test nenalezen".into()))?;

    let finished_at = TestSessionRepo::mark_finished(conn, &session.id)?;
    let summary = TestSessionRepo::summarize(conn, &session.id)?;

    Ok(TestResults {
        total_questions: summary.total_questions,
        answered_count: summary.answered_count,
        correct_count: summary.correct_count,
        points: summary.points,
        elapsed_seconds: (finished_at - session.started_at).num_seconds().max(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::practice::{do_submit_answer, SubmitAnswerPayload};
    use crate::db::repos::{CategoryRepo, SetRepo, TemplateRepo, TopicRepo, UserRecord, UserRepo};
    use crate::models::{
        ConstraintType, ResultConstraint, Role, Template, TemplateMode, TemplateVariable, Topic,
        Variable,
    };

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk on");
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

    /// A topic with `count` distinct 2-point "double X" questions, each in
    /// its own closed set, following the same wiring `commands::practice`'s
    /// own tests use.
    fn seed_topic_with_questions(conn: &Connection, name: &str, count: usize) -> Uuid {
        let mut topic = Topic::new(name.to_string());
        topic.for_students = true;
        TopicRepo::insert(conn, &topic).expect("insert topic");

        let (_, sets) = CategoryRepo::create(conn, topic.id, 2).expect("create category");

        for i in 0..count {
            let variable = Variable::new(
                format!("Hmotnost {i}"),
                "X".into(),
                1.0,
                10.0,
                1.0,
                "g".into(),
                0,
            );
            crate::db::repos::VariableRepo::insert_raw(conn, &variable).expect("insert variable");

            let template = Template::new(
                format!("{name} {i}: kolik je dvojnásobek [[X]] g? [Y]"),
                "Y = X * 2".into(),
                "Y = X × 2".into(),
                None,
                "g".into(),
                2,
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
            TemplateRepo::insert(conn, &template, &[tv], &[], Some(&constraint), &[])
                .expect("insert template");
            // Spread across the 3 closed sets round-robin, just to exercise
            // more than one set feeding the same test.
            SetRepo::add_template(conn, &sets[i % 3].id, &template.id).expect("add to set");
        }

        topic.id
    }

    #[test]
    fn start_test_generates_one_question_per_template_in_the_topic() {
        let conn = setup_conn();
        let topic_id = seed_topic_with_questions(&conn, "Roztoky", 5);
        let student = insert_student(&conn, "student");

        let view = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                point_value: 2,
                time_limit_seconds: Some(600),
                mode: None,
                set_id: None,
            },
        )
        .expect("start test");

        assert_eq!(view.questions.len(), 5);
        assert_eq!(view.time_limit_seconds, Some(600));

        // Every question landed in the same session with distinct positions.
        let positions: std::collections::HashSet<i64> = {
            let mut stmt = conn
                .prepare("SELECT position FROM practice_attempts WHERE test_session_id = ?1")
                .expect("prepare");
            stmt.query_map(rusqlite::params![view.session_id], |row| row.get(0))
                .expect("query")
                .collect::<rusqlite::Result<_>>()
                .expect("collect")
        };
        assert_eq!(positions, (0..5i64).collect());
    }

    #[test]
    fn start_test_on_an_empty_topic_reports_no_questions() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");

        let result = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id: Uuid::new_v4(),
                point_value: 2,
                time_limit_seconds: None,
                mode: None,
                set_id: None,
            },
        );
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    /// A test restricted to one mode or one set (sada) must only ever draw
    /// from templates actually eligible under that restriction — the same
    /// guarantee `commands::practice::do_next_question` already has for
    /// interactive practice, now exercised for the fixed-batch test path.
    #[test]
    fn start_test_honors_an_explicit_mode_and_set_restriction() {
        let conn = setup_conn();
        let mut topic = Topic::new("Roztoky".into());
        topic.for_students = true;
        TopicRepo::insert(&conn, &topic).expect("insert topic");
        let (_, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create category");

        let variable = Variable::new("Hmotnost".into(), "X".into(), 1.0, 10.0, 1.0, "g".into(), 0);
        crate::db::repos::VariableRepo::insert_raw(&conn, &variable).expect("insert variable");

        let make_template = |question_text: &str| {
            let template = Template::new(
                question_text.into(),
                "Y = X * 2".into(),
                "Y = X × 2".into(),
                None,
                "g".into(),
                2,
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
            TemplateRepo::insert(&conn, &template, &[tv], &[], Some(&constraint), &[])
                .expect("insert template");
            template.id
        };

        // sets[0] is closed, sets[3] is open (see `CategoryRepo::create`).
        let closed_template = make_template("Closed-only: kolik je dvojnásobek [[X]] g? [Y]");
        SetRepo::add_template(&conn, &sets[0].id, &closed_template).expect("add to closed set");
        let open_template = make_template("Open-only: kolik je dvojnásobek [[X]] g? [Y]");
        SetRepo::add_template(&conn, &sets[3].id, &open_template).expect("add to open set");

        let student = insert_student(&conn, "student");

        let open_only = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id: topic.id,
                point_value: 2,
                time_limit_seconds: Some(600),
                mode: Some(TemplateMode::Open),
                set_id: None,
            },
        )
        .expect("open-mode test");
        assert_eq!(open_only.questions.len(), 1);
        assert_eq!(open_only.questions[0].mode, TemplateMode::Open);

        let closed_set_only = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id: topic.id,
                point_value: 2,
                time_limit_seconds: Some(600),
                mode: None,
                set_id: Some(sets[0].id),
            },
        )
        .expect("set-restricted test");
        assert_eq!(closed_set_only.questions.len(), 1);
        assert_eq!(closed_set_only.questions[0].mode, TemplateMode::Closed);

        // The combination this category has no questions for at all.
        let impossible = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id: topic.id,
                point_value: 2,
                time_limit_seconds: Some(600),
                mode: Some(TemplateMode::Open),
                set_id: Some(sets[0].id),
            },
        );
        assert!(matches!(impossible, Err(DbError::NotFound(_))));
    }

    /// The full loop: start a test, answer every question (mixing correct and
    /// wrong), finish it, and check the summary matches.
    #[test]
    fn finish_test_summarizes_answers_and_freezes_on_a_second_call() {
        let conn = setup_conn();
        let topic_id = seed_topic_with_questions(&conn, "Roztoky", 4);
        let student = insert_student(&conn, "student");

        let view = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                point_value: 2,
                time_limit_seconds: None,
                mode: None,
                set_id: None,
            },
        )
        .expect("start test");
        assert_eq!(view.questions.len(), 4);

        // Every seeded template lives in a closed set (see
        // `seed_topic_with_questions`), so every served question is closed
        // mode: answer by option index rather than a free-form value.
        for (i, question) in view.questions.iter().enumerate() {
            assert_eq!(question.mode, TemplateMode::Closed);
            let expected = question.assigned_values["X"] * 2.0;
            let options = question.answer_slots[0]
                .numeric_options
                .clone()
                .expect("closed question carries options");
            let want_correct = i % 2 == 0;
            let position = options
                .iter()
                .position(|o| ((*o - expected).abs() < 1e-9) == want_correct)
                .expect("an option matching the desired correctness exists")
                as u8;
            let payload = SubmitAnswerPayload {
                attempt_id: question.attempt_id,
                selected_option: Some(position + 1),
                answers: None,
            };
            do_submit_answer(&conn, &student, &payload).expect("grade");
        }

        let results = do_finish_test(
            &conn,
            &student,
            &FinishTestPayload {
                session_id: view.session_id,
            },
        )
        .expect("finish");

        assert_eq!(results.total_questions, 4);
        assert_eq!(results.answered_count, 4);
        assert_eq!(results.correct_count, 2, "questions 0 and 2 answered correctly");
        assert_eq!(results.points, 4, "2 correct answers at 2 points each");

        let again = do_finish_test(
            &conn,
            &student,
            &FinishTestPayload {
                session_id: view.session_id,
            },
        )
        .expect("finish again");
        assert_eq!(
            again.elapsed_seconds, results.elapsed_seconds,
            "a second finish call must not move the elapsed time"
        );
    }

    /// Once a session is finished, its questions must stop accepting new
    /// grading, even if the client somehow still holds a pending attempt.
    #[test]
    fn submit_answer_is_refused_once_the_session_is_finished() {
        let conn = setup_conn();
        let topic_id = seed_topic_with_questions(&conn, "Roztoky", 1);
        let student = insert_student(&conn, "student");

        let view = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                point_value: 2,
                time_limit_seconds: None,
                mode: None,
                set_id: None,
            },
        )
        .expect("start test");

        do_finish_test(
            &conn,
            &student,
            &FinishTestPayload {
                session_id: view.session_id,
            },
        )
        .expect("finish");

        let payload = SubmitAnswerPayload {
            attempt_id: view.questions[0].attempt_id,
            selected_option: Some(1),
            answers: None,
        };
        let result = do_submit_answer(&conn, &student, &payload);
        assert!(
            matches!(result, Err(DbError::Validation(_))),
            "grading a question from an already-finished session must be refused"
        );
    }

    /// A timed session's deadline is enforced server-side: once
    /// `started_at + time_limit_seconds` has passed, no further answer for
    /// that session may be graded, regardless of what the client believes.
    #[test]
    fn submit_answer_is_refused_after_the_timed_deadline_passes() {
        let conn = setup_conn();
        let topic_id = seed_topic_with_questions(&conn, "Roztoky", 1);
        let student = insert_student(&conn, "student");

        let view = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                point_value: 2,
                time_limit_seconds: Some(60),
                mode: None,
                set_id: None,
            },
        )
        .expect("start test");

        // Simulate the deadline having already passed, without depending on
        // real wall-clock time in the test.
        conn.execute(
            "UPDATE test_sessions SET started_at = ?1 WHERE id = ?2",
            rusqlite::params![
                (Utc::now() - chrono::Duration::seconds(120)).to_rfc3339(),
                view.session_id,
            ],
        )
        .expect("backdate session");

        let payload = SubmitAnswerPayload {
            attempt_id: view.questions[0].attempt_id,
            selected_option: Some(1),
            answers: None,
        };
        let result = do_submit_answer(&conn, &student, &payload);
        assert!(
            matches!(result, Err(DbError::Validation(_))),
            "grading after a timed session's deadline must be refused"
        );
    }

    #[test]
    fn finish_test_refuses_a_session_belonging_to_someone_else() {
        let conn = setup_conn();
        let topic_id = seed_topic_with_questions(&conn, "Roztoky", 1);
        let owner = insert_student(&conn, "owner");
        let other = insert_student(&conn, "other");

        let view = do_start_test(
            &conn,
            &owner,
            &StartTestPayload {
                topic_id,
                point_value: 2,
                time_limit_seconds: None,
                mode: None,
                set_id: None,
            },
        )
        .expect("start test");

        let result = do_finish_test(
            &conn,
            &other,
            &FinishTestPayload {
                session_id: view.session_id,
            },
        );
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }
}
