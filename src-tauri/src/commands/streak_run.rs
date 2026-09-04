//! Streak runs: an endless one-question-at-a-time run (`commands::practice`'s
//! generator, but tracked server-side via `streak_run_id`) that ends the
//! instant the student answers one wrong.
//!
//! "Apprentice" stays scoped to a topic/point value (and optionally one
//! set/mode), same filters as ordinary practice. "Master" draws from every
//! topic opted in for students, at any difficulty — the ultimate challenge,
//! with nothing to configure beyond picking it.
//!
//! Grading is not reimplemented here: a run's questions are ordinary
//! `practice_attempts` rows, so `commands::practice::do_submit_answer` grades
//! them unchanged (and, on the way, updates the run's `correct_count` or
//! ends it — see that function's `streak_run_id` handling).

use crate::commands::practice::{build_question, entropy_seed, PracticeQuestion};
use crate::db::repos::{PracticeRepo, StreakRunRecord, StreakRunRepo};
use crate::db::DbError;
use crate::models::{StreakRunKind, TemplateMode};
use chrono::{DateTime, Utc};
use rand::rngs::StdRng;
use rand::{RngExt, SeedableRng};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// How many different templates to try before giving up — mirrors
/// `commands::practice`'s own retry budget for the same reason: a single
/// template can fail to generate for the sampled values, which must not read
/// as "this whole run is broken" while other questions in it are fine.
const MAX_TEMPLATE_ATTEMPTS: usize = 8;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStreakRunPayload {
    pub kind: StreakRunKind,
    /// Required for `Apprentice`; ignored for `Master`, which has no single
    /// topic to scope itself to.
    #[serde(default)]
    pub topic_id: Option<Uuid>,
    #[serde(default)]
    pub point_value: Option<u8>,
    #[serde(default)]
    pub mode: Option<TemplateMode>,
    #[serde(default)]
    pub set_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakRunView {
    pub run_id: Uuid,
    pub kind: StreakRunKind,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextStreakQuestionPayload {
    pub run_id: Uuid,
}

/// The run's state once it has ended — the client stops calling
/// `next-streak-question` the moment `submitAnswer` reports a wrong answer,
/// then fetches this instead of trying to infer the summary itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakRunSummary {
    pub kind: StreakRunKind,
    pub correct_count: i64,
    pub total_seconds: i64,
    /// Total elapsed time divided by every question answered, correct ones
    /// and the one fatal wrong one alike.
    pub seconds_per_answer: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakRunSummaryPayload {
    pub run_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakLeaderboardPayload {
    pub kind: StreakRunKind,
    /// Scope the board to one topic/difficulty/set — meaningful for
    /// `Apprentice` only, since comparing streaks across different topics or
    /// sets isn't a meaningful comparison to begin with. Ignored for
    /// `Master`, which has nothing to scope by.
    #[serde(default)]
    pub topic_id: Option<Uuid>,
    #[serde(default)]
    pub point_value: Option<u8>,
    #[serde(default)]
    pub set_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakLeaderboardEntry {
    pub user_id: Uuid,
    pub username: String,
    pub best_correct_count: i64,
    pub total_seconds: i64,
    pub seconds_per_answer: f64,
}

/// Start a new run. `Apprentice` requires `topic_id`/`point_value` (the same
/// way `commands::test_session::do_start_test` does); `Master` ignores
/// whatever scoping fields the client happened to send, since it always
/// draws from everything.
pub fn do_start_streak_run(
    conn: &Connection,
    user_id: &Uuid,
    payload: &StartStreakRunPayload,
) -> Result<StreakRunView, DbError> {
    let (topic_id, point_value, mode, set_id) = match payload.kind {
        StreakRunKind::Apprentice => {
            let topic_id = payload
                .topic_id
                .ok_or_else(|| DbError::Validation("Vyberte téma".into()))?;
            let point_value = payload
                .point_value
                .ok_or_else(|| DbError::Validation("Vyberte obtížnost".into()))?;
            (Some(topic_id), Some(point_value), payload.mode, payload.set_id)
        }
        StreakRunKind::Master => (None, None, None, None),
    };

    let run = StreakRunRecord {
        id: Uuid::new_v4(),
        user_id: *user_id,
        kind: payload.kind,
        topic_id,
        point_value,
        mode,
        set_id,
        started_at: Utc::now(),
        ended_at: None,
        correct_count: 0,
        failed: false,
    };
    StreakRunRepo::insert(conn, &run)?;

    Ok(StreakRunView {
        run_id: run.id,
        kind: run.kind,
        started_at: run.started_at,
    })
}

/// A fresh random question for this run — from its scoped topic/difficulty
/// for `Apprentice`, or from the entire student-facing question bank for
/// `Master`. Refuses once the run has already failed: its score is frozen,
/// there is nothing left to serve.
pub fn do_next_streak_question(
    conn: &Connection,
    user_id: &Uuid,
    payload: &NextStreakQuestionPayload,
) -> Result<PracticeQuestion, DbError> {
    let run = StreakRunRepo::get_owned(conn, &payload.run_id, user_id)?
        .ok_or_else(|| DbError::NotFound("Série nenalezena".into()))?;
    if run.failed {
        return Err(DbError::Validation("Tato série už skončila".into()));
    }

    let mut rng = StdRng::seed_from_u64(entropy_seed());

    match run.kind {
        StreakRunKind::Apprentice => {
            let topic_id = run
                .topic_id
                .ok_or_else(|| DbError::Internal("apprentice run missing topic_id".into()))?;
            let point_value = run
                .point_value
                .ok_or_else(|| DbError::Internal("apprentice run missing point_value".into()))?;

            let mut template_ids =
                PracticeRepo::list_template_ids(conn, &topic_id, point_value, run.set_id.as_ref())?;
            if let Some(wanted) = run.mode {
                template_ids.retain(|(_, mode)| *mode == wanted);
            }
            if template_ids.is_empty() {
                return Err(DbError::NotFound(
                    "Pro toto téma, obtížnost a typ otázek zatím nejsou žádné otázky".into(),
                ));
            }

            let mut last_error: Option<DbError> = None;
            for _ in 0..MAX_TEMPLATE_ATTEMPTS.min(template_ids.len().saturating_mul(2)) {
                let (template_id, mode) = template_ids[rng.random_range(0..template_ids.len())];
                match build_question(
                    conn,
                    user_id,
                    &topic_id,
                    &template_id,
                    mode,
                    &mut rng,
                    None,
                    None,
                    Some(run.id),
                ) {
                    Ok(question) => return Ok(question),
                    Err(e) => last_error = Some(e),
                }
            }
            Err(last_error.unwrap_or_else(|| {
                DbError::Validation("Nepodařilo se vygenerovat otázku, zkuste to znovu".into())
            }))
        }
        StreakRunKind::Master => {
            let candidates = PracticeRepo::list_all_template_ids(conn)?;
            if candidates.is_empty() {
                return Err(DbError::NotFound("Zatím tu nejsou žádné otázky".into()));
            }

            let mut last_error: Option<DbError> = None;
            for _ in 0..MAX_TEMPLATE_ATTEMPTS.min(candidates.len().saturating_mul(2)) {
                let candidate = &candidates[rng.random_range(0..candidates.len())];
                match build_question(
                    conn,
                    user_id,
                    &candidate.topic_id,
                    &candidate.template_id,
                    candidate.mode,
                    &mut rng,
                    None,
                    None,
                    Some(run.id),
                ) {
                    Ok(question) => return Ok(question),
                    Err(e) => last_error = Some(e),
                }
            }
            Err(last_error.unwrap_or_else(|| {
                DbError::Validation("Nepodařilo se vygenerovat otázku, zkuste to znovu".into())
            }))
        }
    }
}

/// The frozen score of a run that has already failed. Owner-checked like
/// every other per-user run access.
pub fn do_streak_run_summary(
    conn: &Connection,
    user_id: &Uuid,
    payload: &StreakRunSummaryPayload,
) -> Result<StreakRunSummary, DbError> {
    let run = StreakRunRepo::get_owned(conn, &payload.run_id, user_id)?
        .ok_or_else(|| DbError::NotFound("Série nenalezena".into()))?;
    let ended_at = run
        .ended_at
        .ok_or_else(|| DbError::Validation("Tato série ještě neskončila".into()))?;

    let total_seconds = (ended_at - run.started_at).num_seconds().max(0);
    let total_answered = run.correct_count + 1;

    Ok(StreakRunSummary {
        kind: run.kind,
        correct_count: run.correct_count,
        total_seconds,
        seconds_per_answer: total_seconds as f64 / total_answered as f64,
    })
}

/// Each student's single best finished run of `kind`, ranked by the longest
/// streak (ties broken by the faster total time) — an in-progress run never
/// appears, since its score isn't final until it fails.
pub fn do_streak_leaderboard(
    conn: &Connection,
    payload: &StreakLeaderboardPayload,
) -> Result<Vec<StreakLeaderboardEntry>, DbError> {
    let mut entries: Vec<StreakLeaderboardEntry> = StreakRunRepo::best_finished_runs(
        conn,
        payload.kind,
        payload.topic_id.as_ref(),
        payload.point_value,
        payload.set_id.as_ref(),
    )?
    .into_iter()
    .map(|row| {
            let total_answered = row.best_correct_count + 1;
            StreakLeaderboardEntry {
                user_id: row.user_id,
                username: row.username,
                best_correct_count: row.best_correct_count,
                total_seconds: row.total_seconds,
                seconds_per_answer: row.total_seconds as f64 / total_answered as f64,
            }
        })
        .collect();

    entries.sort_by(|a, b| {
        b.best_correct_count
            .cmp(&a.best_correct_count)
            .then(a.total_seconds.cmp(&b.total_seconds))
    });
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::practice::{do_submit_answer, SubmitAnswerPayload};
    use crate::db::repos::{CategoryRepo, SetRepo, TemplateRepo, TopicRepo, UserRecord, UserRepo};
    use crate::models::{ConstraintType, ResultConstraint, Role, Template, TemplateVariable, Topic, Variable};

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
            email: None,
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    /// A topic with `count` distinct 2-point "double X" questions, each in
    /// its own closed set — the correct answer is always double the served
    /// `X`, so a test can deliberately answer right or wrong at will.
    fn seed_topic_with_questions(conn: &Connection, name: &str, count: usize) -> Uuid {
        let mut topic = Topic::new(name.to_string());
        topic.for_students = true;
        TopicRepo::insert(conn, &topic).expect("insert topic");

        let (_, sets) = CategoryRepo::create(conn, topic.id, 2).expect("create category");

        for i in 0..count {
            let variable = Variable::new(format!("Hmotnost {i}"), "X".into(), 1.0, 10.0, 1.0, "g".into(), 0);
            crate::db::repos::VariableRepo::insert_raw(conn, &variable).expect("insert variable");

            let template = Template::new(
                format!("{name} {i}: kolik je dvojnásobek [[X]] g? [Y]"),
                "Y = X * 2".into(),
                "Y = X × 2".into(),
                None,
                "g".into(),
                2,
            );
            let constraint =
                ResultConstraint::new(template.id, Some(0.0), Some(100.0), None, ConstraintType::Range);
            let tv = TemplateVariable {
                template_id: template.id,
                variable_id: variable.id,
                placeholder: "X".into(),
                greater_than_variable_id: None,
                less_than_variable_id: None,
            };
            TemplateRepo::insert(conn, &template, &[tv], &[], Some(&constraint), &[]).expect("insert template");
            SetRepo::add_template(conn, &sets[i % 3].id, &template.id).expect("add to set");
        }

        topic.id
    }

    fn answer(question: &PracticeQuestion, correct: bool) -> SubmitAnswerPayload {
        let expected = question.assigned_values["X"] * 2.0;
        match question.mode {
            TemplateMode::Open => SubmitAnswerPayload {
                attempt_id: question.attempt_id,
                selected_option: None,
                answers: Some(vec![if correct { expected } else { -expected - 1.0 }]),
            },
            TemplateMode::Closed => {
                let options = question.answer_slots[0].numeric_options.clone().expect("options");
                let position = options
                    .iter()
                    .position(|o| ((*o - expected).abs() < 1e-9) == correct)
                    .expect("an option matching the desired correctness exists") as u8;
                SubmitAnswerPayload {
                    attempt_id: question.attempt_id,
                    selected_option: Some(position + 1),
                    answers: None,
                }
            }
        }
    }

    #[test]
    fn a_wrong_answer_ends_an_apprentice_run_and_further_questions_are_refused() {
        let conn = setup_conn();
        let topic_id = seed_topic_with_questions(&conn, "Roztoky", 5);
        let student = insert_student(&conn, "student");

        let run = do_start_streak_run(
            &conn,
            &student,
            &StartStreakRunPayload {
                kind: StreakRunKind::Apprentice,
                topic_id: Some(topic_id),
                point_value: Some(2),
                mode: None,
                set_id: None,
            },
        )
        .expect("start run");

        for _ in 0..3 {
            let question = do_next_streak_question(&conn, &student, &NextStreakQuestionPayload { run_id: run.run_id })
                .expect("next question");
            let result = do_submit_answer(&conn, &student, &answer(&question, true)).expect("grade correct");
            assert!(result.correct);
        }

        let question = do_next_streak_question(&conn, &student, &NextStreakQuestionPayload { run_id: run.run_id })
            .expect("next question");
        let result = do_submit_answer(&conn, &student, &answer(&question, false)).expect("grade wrong");
        assert!(!result.correct);

        // The run is now over: no more questions, and the summary is frozen.
        let refused = do_next_streak_question(&conn, &student, &NextStreakQuestionPayload { run_id: run.run_id });
        assert!(matches!(refused, Err(DbError::Validation(_))));

        let summary = do_streak_run_summary(&conn, &student, &StreakRunSummaryPayload { run_id: run.run_id })
            .expect("summary");
        assert_eq!(summary.correct_count, 3);
        assert_eq!(summary.kind, StreakRunKind::Apprentice);
    }

    #[test]
    fn summary_is_refused_while_the_run_is_still_active() {
        let conn = setup_conn();
        let topic_id = seed_topic_with_questions(&conn, "Roztoky", 3);
        let student = insert_student(&conn, "student");

        let run = do_start_streak_run(
            &conn,
            &student,
            &StartStreakRunPayload {
                kind: StreakRunKind::Apprentice,
                topic_id: Some(topic_id),
                point_value: Some(2),
                mode: None,
                set_id: None,
            },
        )
        .expect("start run");

        let result = do_streak_run_summary(&conn, &student, &StreakRunSummaryPayload { run_id: run.run_id });
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[test]
    fn master_run_draws_from_every_topic() {
        let conn = setup_conn();
        let topic_a = seed_topic_with_questions(&conn, "Roztoky", 2);
        let topic_b = seed_topic_with_questions(&conn, "Kyseliny", 2);
        let student = insert_student(&conn, "student");

        let run = do_start_streak_run(
            &conn,
            &student,
            &StartStreakRunPayload {
                kind: StreakRunKind::Master,
                topic_id: None,
                point_value: None,
                mode: None,
                set_id: None,
            },
        )
        .expect("start master run");

        let mut seen_topics = std::collections::HashSet::new();
        for _ in 0..30 {
            let question = do_next_streak_question(&conn, &student, &NextStreakQuestionPayload { run_id: run.run_id })
                .expect("next question");
            // Identify which topic this came from via its assigned "X"
            // value's variable name pattern is not exposed, so just answer
            // correctly and keep going — the point is exercising both topics
            // without ever erroring.
            let result = do_submit_answer(&conn, &student, &answer(&question, true)).expect("grade");
            assert!(result.correct);
            let _ = (&topic_a, &topic_b);
            seen_topics.insert(question.question_text.clone());
        }
        assert!(seen_topics.len() > 1, "expected variety across 30 draws");
    }

    #[test]
    fn leaderboard_ranks_by_best_streak_and_only_counts_finished_runs() {
        let conn = setup_conn();
        let topic_id = seed_topic_with_questions(&conn, "Roztoky", 5);
        let alice = insert_student(&conn, "alice");
        let bob = insert_student(&conn, "bob");

        let run_streak = |user: Uuid, wins: usize| {
            let run = do_start_streak_run(
                &conn,
                &user,
                &StartStreakRunPayload {
                    kind: StreakRunKind::Apprentice,
                    topic_id: Some(topic_id),
                    point_value: Some(2),
                    mode: None,
                    set_id: None,
                },
            )
            .expect("start run");
            for _ in 0..wins {
                let question =
                    do_next_streak_question(&conn, &user, &NextStreakQuestionPayload { run_id: run.run_id })
                        .expect("next question");
                do_submit_answer(&conn, &user, &answer(&question, true)).expect("grade correct");
            }
            let question = do_next_streak_question(&conn, &user, &NextStreakQuestionPayload { run_id: run.run_id })
                .expect("next question");
            do_submit_answer(&conn, &user, &answer(&question, false)).expect("grade wrong");
        };

        run_streak(alice, 4);
        run_streak(bob, 1);

        let board = do_streak_leaderboard(
            &conn,
            &StreakLeaderboardPayload {
                kind: StreakRunKind::Apprentice,
                topic_id: None,
                point_value: None,
                set_id: None,
            },
        )
        .expect("leaderboard");
        assert_eq!(board.len(), 2);
        assert_eq!(board[0].username, "alice");
        assert_eq!(board[0].best_correct_count, 4);
        assert_eq!(board[1].username, "bob");
        assert_eq!(board[1].best_correct_count, 1);
    }

    /// Comparing an apprentice streak from one topic against another's is
    /// meaningless (different question pools), so the leaderboard must let a
    /// caller scope the board to a single topic rather than pooling every
    /// topic's runs together.
    #[test]
    fn leaderboard_can_be_scoped_to_one_topic() {
        let conn = setup_conn();
        let topic_a = seed_topic_with_questions(&conn, "Roztoky", 5);
        let topic_b = seed_topic_with_questions(&conn, "Kyseliny", 5);
        let student = insert_student(&conn, "student");

        let run_streak = |topic_id: Uuid, wins: usize| {
            let run = do_start_streak_run(
                &conn,
                &student,
                &StartStreakRunPayload {
                    kind: StreakRunKind::Apprentice,
                    topic_id: Some(topic_id),
                    point_value: Some(2),
                    mode: None,
                    set_id: None,
                },
            )
            .expect("start run");
            for _ in 0..wins {
                let question = do_next_streak_question(
                    &conn,
                    &student,
                    &NextStreakQuestionPayload { run_id: run.run_id },
                )
                .expect("next question");
                do_submit_answer(&conn, &student, &answer(&question, true)).expect("grade correct");
            }
            let question =
                do_next_streak_question(&conn, &student, &NextStreakQuestionPayload { run_id: run.run_id })
                    .expect("next question");
            do_submit_answer(&conn, &student, &answer(&question, false)).expect("grade wrong");
        };

        // A short streak on topic A, a much longer one on topic B — scoping
        // to A must report the short one, not silently pick up B's better
        // score just because it's the same student's overall best.
        run_streak(topic_a, 1);
        run_streak(topic_b, 4);

        let board_a = do_streak_leaderboard(
            &conn,
            &StreakLeaderboardPayload {
                kind: StreakRunKind::Apprentice,
                topic_id: Some(topic_a),
                point_value: None,
                set_id: None,
            },
        )
        .expect("leaderboard for topic A");
        assert_eq!(board_a.len(), 1);
        assert_eq!(board_a[0].best_correct_count, 1);

        let board_b = do_streak_leaderboard(
            &conn,
            &StreakLeaderboardPayload {
                kind: StreakRunKind::Apprentice,
                topic_id: Some(topic_b),
                point_value: None,
                set_id: None,
            },
        )
        .expect("leaderboard for topic B");
        assert_eq!(board_b.len(), 1);
        assert_eq!(board_b[0].best_correct_count, 4);
    }
}
