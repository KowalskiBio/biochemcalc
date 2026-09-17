//! Fixed-batch test sessions: a timed exam drawn from a topic the teacher
//! flagged as a test — random questions at each of the 2/3/4 point values,
//! mixed across all of the topic's sets, open or closed — generated all at
//! once and answered together, as opposed to `commands::practice`'s endless
//! one-at-a-time generator.
//!
//! There are two of them (`models::TestKind`), differing only in how many
//! questions each band contributes: the úvodní test, a topic's first, takes
//! 5 per band (15 in all), and the průběžný one takes 4 (12). A topic says
//! which it offers — either, or both — through `Topic::test_kind`.
//!
//! Grading is not reimplemented here. A session's questions are ordinary
//! `practice_attempts` rows (tagged with `test_session_id`/`position`), so
//! `commands::practice::do_submit_answer` grades them unchanged, and they
//! count toward the same leaderboard as regular practice.

use crate::commands::practice::{build_question, entropy_seed, PracticeQuestion};
use crate::db::repos::{PracticeRepo, TestSessionRecord, TestSessionRepo, TopicRepo};
use crate::db::DbError;
use crate::models::TestKind;
use chrono::{DateTime, Utc};
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::SeedableRng;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The point-value bands every test draws from, mirroring the fixed
/// `CHECK (point_value IN (2, 3, 4))` buckets a topic is filed under.
pub const TEST_POINT_VALUE_BANDS: [u8; 3] = [2, 3, 4];

/// How many questions each band contributes, per test kind: 3 bands x 5 =
/// 15 questions for the úvodní test, 3 x 4 = 12 for the průběžný one. Read
/// it off the kind rather than from here — `TestKind::questions_per_band`.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTestPayload {
    pub topic_id: Uuid,
    /// Which of the two tests to sit. The topic must offer it; the student
    /// reaches this through a per-kind start page listing only those that do.
    pub kind: TestKind,
    /// `None` starts an untimed test: no deadline is ever enforced. The
    /// student-facing test start page always sends a value now, but this
    /// stays optional so a session started before that UI change keeps
    /// meaning what it always did.
    #[serde(default)]
    pub time_limit_seconds: Option<u32>,
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

/// A template eligible for one band, deduplicated to a single (id, mode)
/// pair: a template linked into both an open and a closed set is one
/// question, drawn once, in one of those modes.
fn dedupe_templates(
    pairs: Vec<(Uuid, crate::models::TemplateMode)>,
) -> Vec<(Uuid, crate::models::TemplateMode)> {
    let mut seen = std::collections::HashSet::new();
    pairs
        .into_iter()
        .filter(|(id, _)| seen.insert(*id))
        .collect()
}

/// Sample `payload.kind.questions_per_band()` templates at each of
/// `TEST_POINT_VALUE_BANDS` from the topic's whole pool (every set at that
/// point value, open or closed), then shuffle the combined 15 (úvodní) or
/// 12 (průběžný) so the bands are interleaved rather than served as three
/// consecutive blocks.
///
/// A template that fails to generate (its constraints are unsatisfiable for
/// the sampled values) is skipped rather than failing the whole test, the
/// same tolerance `commands::practice` already has for one-off generation
/// failures: one bad template must not read as "this whole test is broken."
/// The test fails outright only if every template failed. Unfilled bands
/// (fewer eligible templates than the kind wants) are a hard error:
/// `do_list_test_topics` only offers topics whose bands are all full for
/// that kind, so a student reaching this means the teacher emptied a band
/// in the meantime.
pub fn do_start_test(
    conn: &Connection,
    user_id: &Uuid,
    payload: &StartTestPayload,
) -> Result<TestSessionView, DbError> {
    let topic = TopicRepo::get_by_id(conn, &payload.topic_id)?;
    if !topic.is_test {
        return Err(DbError::Validation(
            "Toto téma není označeno jako test".into(),
        ));
    }
    if !topic.test_kind.offers(payload.kind) {
        return Err(DbError::Validation(
            "Toto téma nenabízí tento typ testu".into(),
        ));
    }
    let per_band = payload.kind.questions_per_band();

    let mut rng = StdRng::seed_from_u64(entropy_seed());
    let mut selected: Vec<(Uuid, crate::models::TemplateMode)> = Vec::new();
    for band in TEST_POINT_VALUE_BANDS {
        let pool = dedupe_templates(PracticeRepo::list_template_ids(
            conn,
            &payload.topic_id,
            band,
            None,
        )?);
        if pool.len() < per_band {
            return Err(DbError::Validation(format!(
                "Test potřebuje alespoň {per_band} otázky za {} bodů, téma jich má jen {}",
                band,
                pool.len()
            )));
        }
        let mut band_pool = pool;
        band_pool.shuffle(&mut rng);
        selected.extend(band_pool.into_iter().take(per_band));
    }
    selected.shuffle(&mut rng);

    let session = TestSessionRecord {
        id: Uuid::new_v4(),
        user_id: *user_id,
        topic_id: payload.topic_id,
        kind: payload.kind,
        // Sentinel: a test spans all three point-value bands, and each
        // question's real point value lives on its own practice_attempt.
        point_value: 0,
        time_limit_seconds: payload.time_limit_seconds,
        started_at: Utc::now(),
        finished_at: None,
    };
    TestSessionRepo::insert(conn, &session)?;

    let mut questions = Vec::with_capacity(selected.len());
    for (position, (template_id, mode)) in selected.into_iter().enumerate() {
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
        ConstraintType, ResultConstraint, Role, Set, Template, TemplateMode, TemplateVariable,
        TestOffer, Topic, Variable,
    };

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

    /// Seed `count` distinct "double X" questions at one point value,
    /// spread round-robin across the category's closed sets, and return
    /// those sets so a test can add more templates to them.
    fn seed_band(
        conn: &Connection,
        name: &str,
        topic_id: Uuid,
        point_value: u8,
        count: usize,
    ) -> Vec<Set> {
        let (_, sets) = CategoryRepo::create(conn, topic_id, point_value).expect("create category");

        for i in 0..count {
            let variable = Variable::new(
                format!("Hmotnost {point_value}-{i}"),
                "X".into(),
                1.0,
                10.0,
                1.0,
                "g".into(),
                0,
            );
            crate::db::repos::VariableRepo::insert_raw(conn, &variable).expect("insert variable");

            let template = Template::new(
                format!("{name} {point_value}-{i}: kolik je dvojnásobek [[X]] g? [Y]"),
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
            TemplateRepo::insert(conn, &template, &[tv], &[], Some(&constraint), &[])
                .expect("insert template");
            // Spread across the 3 closed sets round-robin, just to
            // exercise more than one set feeding the same band.
            SetRepo::add_template(conn, &sets[i % 3].id, &template.id).expect("add to set");
        }

        sets
    }

    /// A test-flagged topic with the given number of distinct questions at
    /// each of the given point values, all served closed (answerable by
    /// option index), following the same wiring `commands::practice`'s own
    /// tests use.
    fn seed_test_topic(conn: &Connection, name: &str, bands: &[(u8, usize)]) -> Uuid {
        seed_test_topic_offering(conn, name, TestOffer::Both, bands)
    }

    fn seed_test_topic_offering(
        conn: &Connection,
        name: &str,
        offer: TestOffer,
        bands: &[(u8, usize)],
    ) -> Uuid {
        let mut topic = Topic::new(name.to_string());
        topic.is_test = true;
        topic.test_kind = offer;
        TopicRepo::insert(conn, &topic).expect("insert topic");

        for &(point_value, count) in bands {
            seed_band(conn, name, topic.id, point_value, count);
        }

        topic.id
    }

    /// A full 12-question test topic: 5/6/4 templates at 2/3/4 points, so
    /// every band is over the 4-question minimum (and two of them are over
    /// it, exercising the random draw actually picking a subset).
    fn seed_full_test_topic(conn: &Connection, name: &str) -> Uuid {
        seed_test_topic(conn, name, &[(2, 5), (3, 6), (4, 4)])
    }

    /// The úvodní test is the průběžný one plus a question in every band:
    /// 5 x 3 = 15 rather than 4 x 3 = 12.
    #[test]
    fn uvodni_test_draws_five_questions_per_band() {
        let conn = setup_conn();
        let topic_id = seed_test_topic(&conn, "Roztoky", &[(2, 6), (3, 6), (4, 6)]);
        let student = insert_student(&conn, "student");

        let view = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                kind: TestKind::Uvodni,
                time_limit_seconds: Some(1200),
            },
        )
        .expect("start test");

        assert_eq!(view.questions.len(), 15);
        let mut per_band = std::collections::HashMap::new();
        for question in &view.questions {
            *per_band.entry(question.point_value).or_insert(0usize) += 1;
        }
        assert_eq!(per_band.get(&2), Some(&5));
        assert_eq!(per_band.get(&3), Some(&5));
        assert_eq!(per_band.get(&4), Some(&5));
    }

    /// A topic offers one kind, or both. Sitting a kind it does not offer is
    /// refused: it would silently be a differently-sized test.
    #[test]
    fn start_test_refuses_a_kind_the_topic_does_not_offer() {
        let conn = setup_conn();
        let prubezny_only = seed_test_topic_offering(
            &conn,
            "Jen průběžný",
            TestOffer::Prubezny,
            &[(2, 6), (3, 6), (4, 6)],
        );
        let uvodni_only = seed_test_topic_offering(
            &conn,
            "Jen úvodní",
            TestOffer::Uvodni,
            &[(2, 6), (3, 6), (4, 6)],
        );
        let student = insert_student(&conn, "student");

        let start = |topic_id, kind| {
            do_start_test(
                &conn,
                &student,
                &StartTestPayload {
                    topic_id,
                    kind,
                    time_limit_seconds: None,
                },
            )
        };

        assert!(matches!(
            start(prubezny_only, TestKind::Uvodni),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            start(uvodni_only, TestKind::Prubezny),
            Err(DbError::Validation(_))
        ));

        // The kind each one does offer still works.
        assert_eq!(
            start(prubezny_only, TestKind::Prubezny)
                .expect("průběžný")
                .questions
                .len(),
            12
        );
        assert_eq!(
            start(uvodni_only, TestKind::Uvodni)
                .expect("úvodní")
                .questions
                .len(),
            15
        );
    }

    /// A band big enough for the průběžný test can still be too small for the
    /// úvodní one, which wants a fifth question from it.
    #[test]
    fn a_band_of_four_serves_prubezny_but_not_uvodni() {
        let conn = setup_conn();
        let topic_id = seed_test_topic(&conn, "Roztoky", &[(2, 4), (3, 6), (4, 6)]);
        let student = insert_student(&conn, "student");

        let start = |kind| {
            do_start_test(
                &conn,
                &student,
                &StartTestPayload {
                    topic_id,
                    kind,
                    time_limit_seconds: None,
                },
            )
        };

        assert_eq!(
            start(TestKind::Prubezny).expect("průběžný").questions.len(),
            12
        );
        assert!(matches!(
            start(TestKind::Uvodni),
            Err(DbError::Validation(_))
        ));
    }

    #[test]
    fn start_test_draws_four_questions_per_band_shuffled() {
        let conn = setup_conn();
        let topic_id = seed_full_test_topic(&conn, "Roztoky");
        let student = insert_student(&conn, "student");

        let view = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                kind: TestKind::Prubezny,
                time_limit_seconds: Some(1200),
            },
        )
        .expect("start test");

        assert_eq!(view.questions.len(), 12);
        assert_eq!(view.time_limit_seconds, Some(1200));

        let mut per_band = std::collections::HashMap::new();
        for question in &view.questions {
            *per_band.entry(question.point_value).or_insert(0usize) += 1;
        }
        assert_eq!(per_band.get(&2), Some(&4));
        assert_eq!(per_band.get(&3), Some(&4));
        assert_eq!(per_band.get(&4), Some(&4));

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
        assert_eq!(positions, (0..12i64).collect());
    }

    #[test]
    fn start_test_on_an_unknown_topic_is_not_found() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");

        let result = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id: Uuid::new_v4(),
                kind: TestKind::Prubezny,
                time_limit_seconds: None,
            },
        );
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    #[test]
    fn start_test_refuses_a_topic_not_flagged_as_test() {
        let conn = setup_conn();
        let topic_id = seed_full_test_topic(&conn, "Roztoky");
        let student = insert_student(&conn, "student");

        // Unflag the topic without touching its questions.
        let mut topic = TopicRepo::get_by_id(&conn, &topic_id).expect("get topic");
        topic.is_test = false;
        TopicRepo::update(&conn, &topic).expect("update topic");

        let result = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                kind: TestKind::Prubezny,
                time_limit_seconds: None,
            },
        );
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[test]
    fn start_test_refuses_an_underfilled_band() {
        let conn = setup_conn();
        let topic_id = seed_test_topic(&conn, "Roztoky", &[(2, 5), (3, 6), (4, 3)]);
        let student = insert_student(&conn, "student");

        let result = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                kind: TestKind::Prubezny,
                time_limit_seconds: None,
            },
        );
        assert!(
            matches!(result, Err(DbError::Validation(_))),
            "a band with only 3 questions cannot fill a 4-question slot"
        );
    }

    /// A template linked into both a closed and an open set is one question:
    /// it must be drawn once (in one of its modes), never twice.
    #[test]
    fn start_test_counts_a_dual_mode_template_only_once() {
        let conn = setup_conn();
        let mut topic = Topic::new("Roztoky".into());
        topic.is_test = true;
        TopicRepo::insert(&conn, &topic).expect("insert topic");

        // 3 plain closed templates + 1 dual-mode template at 2 points (the
        // dual one links into both a closed and the open set), full bands
        // at 3 and 4 points.
        let two_point_sets = seed_band(&conn, "Roztoky", topic.id, 2, 3);
        seed_band(&conn, "Roztoky", topic.id, 3, 4);
        seed_band(&conn, "Roztoky", topic.id, 4, 4);
        let student = insert_student(&conn, "student");

        let variable = Variable::new(
            "Hmotnost dual".into(),
            "X".into(),
            1.0,
            10.0,
            1.0,
            "g".into(),
            0,
        );
        crate::db::repos::VariableRepo::insert_raw(&conn, &variable).expect("insert variable");
        let template = Template::new(
            "Dual-mode: kolik je dvojnásobek [[X]] g? [Y]".into(),
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
        let closed_set = two_point_sets
            .iter()
            .find(|s| s.mode == TemplateMode::Closed)
            .expect("closed set");
        let open_set = two_point_sets
            .iter()
            .find(|s| s.mode == TemplateMode::Open)
            .expect("open set");
        SetRepo::add_template(&conn, &closed_set.id, &template.id).expect("add to closed set");
        SetRepo::add_template(&conn, &open_set.id, &template.id).expect("add to open set");

        let view = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id: topic.id,
                kind: TestKind::Prubezny,
                time_limit_seconds: None,
            },
        )
        .expect("start test");

        let two_point_texts: Vec<&str> = view
            .questions
            .iter()
            .filter(|q| q.point_value == 2)
            .map(|q| q.question_text.as_str())
            .collect();
        assert_eq!(two_point_texts.len(), 4);
        assert_eq!(
            two_point_texts
                .iter()
                .filter(|t| t.contains("Dual-mode"))
                .count(),
            1,
            "the dual-mode template must appear at most once"
        );
    }

    /// The full loop: start a test, answer every question (mixing correct and
    /// wrong), finish it, and check the summary matches.
    #[test]
    fn finish_test_summarizes_answers_and_freezes_on_a_second_call() {
        let conn = setup_conn();
        let topic_id = seed_full_test_topic(&conn, "Roztoky");
        let student = insert_student(&conn, "student");

        let view = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                kind: TestKind::Prubezny,
                time_limit_seconds: None,
            },
        )
        .expect("start test");
        assert_eq!(view.questions.len(), 12);

        // Every seeded template lives in a closed set (see
        // `seed_test_topic`), so every served question is closed
        // mode: answer by option index rather than a free-form value.
        let mut expected_points = 0i64;
        for (i, question) in view.questions.iter().enumerate() {
            assert_eq!(question.mode, TemplateMode::Closed);
            let expected = question.assigned_values["X"] * 2.0;
            let options = question.answer_slots[0]
                .numeric_options
                .clone()
                .expect("closed question carries options");
            let want_correct = i % 2 == 0;
            if want_correct {
                expected_points += question.point_value as i64;
            }
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

        assert_eq!(results.total_questions, 12);
        assert_eq!(results.answered_count, 12);
        assert_eq!(
            results.correct_count, 6,
            "every other question answered correctly"
        );
        assert_eq!(results.points, expected_points);

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
        let topic_id = seed_full_test_topic(&conn, "Roztoky");
        let student = insert_student(&conn, "student");

        let view = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                kind: TestKind::Prubezny,
                time_limit_seconds: None,
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
        let topic_id = seed_full_test_topic(&conn, "Roztoky");
        let student = insert_student(&conn, "student");

        let view = do_start_test(
            &conn,
            &student,
            &StartTestPayload {
                topic_id,
                kind: TestKind::Prubezny,
                time_limit_seconds: Some(60),
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
        let topic_id = seed_full_test_topic(&conn, "Roztoky");
        let owner = insert_student(&conn, "owner");
        let other = insert_student(&conn, "other");

        let view = do_start_test(
            &conn,
            &owner,
            &StartTestPayload {
                topic_id,
                kind: TestKind::Prubezny,
                time_limit_seconds: None,
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
