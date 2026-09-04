//! Storage for streak runs: an endless one-question-at-a-time run that ends
//! the instant the student answers one wrong. Grading stays on
//! `practice_attempts` (tagged via `streak_run_id`), exactly the pattern
//! `TestSessionRepo` already uses for fixed-batch tests — this repo only owns
//! the `streak_runs` row itself and the leaderboard query over finished ones.

use crate::db::DbError;
use crate::models::{StreakRunKind, TemplateMode};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct StreakRunRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub kind: StreakRunKind,
    /// `None` for a master run, which has no single topic.
    pub topic_id: Option<Uuid>,
    pub point_value: Option<u8>,
    pub mode: Option<TemplateMode>,
    pub set_id: Option<Uuid>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub correct_count: i64,
    pub failed: bool,
}

/// One user's best finished run of a given kind, for the leaderboard.
#[derive(Debug, Clone)]
pub struct StreakLeaderboardRow {
    pub user_id: Uuid,
    pub username: String,
    pub best_correct_count: i64,
    pub total_seconds: i64,
}

pub struct StreakRunRepo;

impl StreakRunRepo {
    pub fn insert(conn: &Connection, run: &StreakRunRecord) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO streak_runs (
                 id, user_id, kind, topic_id, point_value, mode, set_id,
                 started_at, ended_at, correct_count, failed
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, 0, 0)",
            params![
                run.id,
                run.user_id,
                run.kind.as_str(),
                run.topic_id,
                run.point_value,
                run.mode.as_ref().map(TemplateMode::as_str),
                run.set_id,
                run.started_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// A run, scoped to the user who started it: nobody else may extend it,
    /// end it, or see its progress.
    pub fn get_owned(
        conn: &Connection,
        id: &Uuid,
        user_id: &Uuid,
    ) -> Result<Option<StreakRunRecord>, DbError> {
        let result = conn.query_row(
            "SELECT id, user_id, kind, topic_id, point_value, mode, set_id,
                    started_at, ended_at, correct_count, failed
             FROM streak_runs
             WHERE id = ?1 AND user_id = ?2",
            params![id, user_id],
            Self::map_row,
        );
        match result {
            Ok(run) => Ok(Some(run)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    /// Records a correct answer: bumps `correct_count` by one. A no-op past
    /// the point the run has already failed (there is nothing left to bump).
    pub fn record_correct(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        conn.execute(
            "UPDATE streak_runs SET correct_count = correct_count + 1
             WHERE id = ?1 AND failed = 0",
            params![id],
        )?;
        Ok(())
    }

    /// Ends the run on its first wrong answer. Idempotent — a second call
    /// (there should never be one, since a failed run stops serving new
    /// questions) leaves `ended_at` at its original value.
    pub fn record_failure(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        conn.execute(
            "UPDATE streak_runs SET failed = 1, ended_at = ?2
             WHERE id = ?1 AND failed = 0",
            params![id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    /// Each user's single best (highest `correct_count`, ties broken by the
    /// shorter total time) finished run of `kind` — an in-progress run never
    /// appears here, since its "score" isn't final until it fails.
    ///
    /// `topic_id`/`point_value`/`set_id` narrow it to runs scoped exactly
    /// that way — meaningful only for `Apprentice` (every `Master` run has
    /// `None` in all three columns already), since comparing "master" scores
    /// against each other never needed scoping to begin with, but comparing
    /// "apprentice" streaks across different topics or sets does not mean
    /// anything: a 10-streak on one narrow set and a 10-streak on a huge
    /// mixed topic aren't the same accomplishment.
    pub fn best_finished_runs(
        conn: &Connection,
        kind: StreakRunKind,
        topic_id: Option<&Uuid>,
        point_value: Option<u8>,
        set_id: Option<&Uuid>,
    ) -> Result<Vec<StreakLeaderboardRow>, DbError> {
        // `?N IS NULL OR column = ?N` rather than conditionally appending
        // clauses: it always binds the same four parameters regardless of
        // which filters are actually given, so there is no parameter-count
        // bookkeeping to get wrong.
        let mut stmt = conn.prepare(
            "SELECT sr.user_id, u.username, sr.correct_count, sr.started_at, sr.ended_at
             FROM streak_runs sr
             JOIN users u ON u.id = sr.user_id
             WHERE sr.kind = ?1 AND sr.failed = 1 AND sr.ended_at IS NOT NULL
               AND (?2 IS NULL OR sr.topic_id = ?2)
               AND (?3 IS NULL OR sr.point_value = ?3)
               AND (?4 IS NULL OR sr.set_id = ?4)",
        )?;
        let map_row = |row: &rusqlite::Row| {
            let user_id: Uuid = row.get(0)?;
            let username: String = row.get(1)?;
            let correct_count: i64 = row.get(2)?;
            let started_at: String = row.get(3)?;
            let ended_at: String = row.get(4)?;
            Ok((
                user_id,
                username,
                correct_count,
                parse_rfc3339(&started_at),
                parse_rfc3339(&ended_at),
            ))
        };
        let rows = stmt
            .query_map(
                params![kind.as_str(), topic_id, point_value, set_id],
                map_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut best: std::collections::HashMap<Uuid, StreakLeaderboardRow> =
            std::collections::HashMap::new();
        for (user_id, username, correct_count, started_at, ended_at) in rows {
            let total_seconds = (ended_at - started_at).num_seconds().max(0);
            best.entry(user_id)
                .and_modify(|existing| {
                    if correct_count > existing.best_correct_count
                        || (correct_count == existing.best_correct_count
                            && total_seconds < existing.total_seconds)
                    {
                        existing.best_correct_count = correct_count;
                        existing.total_seconds = total_seconds;
                    }
                })
                .or_insert(StreakLeaderboardRow {
                    user_id,
                    username,
                    best_correct_count: correct_count,
                    total_seconds,
                });
        }
        Ok(best.into_values().collect())
    }

    fn map_row(row: &rusqlite::Row) -> rusqlite::Result<StreakRunRecord> {
        let kind: String = row.get(2)?;
        let mode: Option<String> = row.get(5)?;
        let started_at: String = row.get(7)?;
        let ended_at: Option<String> = row.get(8)?;
        Ok(StreakRunRecord {
            id: row.get(0)?,
            user_id: row.get(1)?,
            kind: StreakRunKind::parse(&kind).unwrap_or(StreakRunKind::Apprentice),
            topic_id: row.get(3)?,
            point_value: row.get(4)?,
            mode: mode.as_deref().and_then(TemplateMode::parse),
            set_id: row.get(6)?,
            started_at: parse_rfc3339(&started_at),
            ended_at: ended_at.as_deref().map(parse_rfc3339),
            correct_count: row.get(9)?,
            failed: row.get::<_, i64>(10)? != 0,
        })
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

    fn apprentice_run(user_id: Uuid, topic_id: Uuid) -> StreakRunRecord {
        StreakRunRecord {
            id: Uuid::new_v4(),
            user_id,
            kind: StreakRunKind::Apprentice,
            topic_id: Some(topic_id),
            point_value: Some(2),
            mode: None,
            set_id: None,
            started_at: Utc::now(),
            ended_at: None,
            correct_count: 0,
            failed: false,
        }
    }

    #[test]
    fn insert_and_get_owned_round_trips_a_run() {
        let conn = setup_conn();
        let user_id = insert_student(&conn, "student");
        let topic_id = Uuid::new_v4();
        let record = apprentice_run(user_id, topic_id);
        StreakRunRepo::insert(&conn, &record).expect("insert");

        let fetched = StreakRunRepo::get_owned(&conn, &record.id, &user_id)
            .expect("get")
            .expect("found");
        assert_eq!(fetched.kind, StreakRunKind::Apprentice);
        assert_eq!(fetched.topic_id, Some(topic_id));
        assert_eq!(fetched.correct_count, 0);
        assert!(!fetched.failed);
        assert!(fetched.ended_at.is_none());
    }

    #[test]
    fn get_owned_hides_another_users_run() {
        let conn = setup_conn();
        let owner = insert_student(&conn, "owner");
        let other = insert_student(&conn, "other");
        let record = apprentice_run(owner, Uuid::new_v4());
        StreakRunRepo::insert(&conn, &record).expect("insert");

        assert!(StreakRunRepo::get_owned(&conn, &record.id, &other)
            .expect("get")
            .is_none());
    }

    #[test]
    fn record_correct_stops_incrementing_once_the_run_has_failed() {
        let conn = setup_conn();
        let user_id = insert_student(&conn, "student");
        let record = apprentice_run(user_id, Uuid::new_v4());
        StreakRunRepo::insert(&conn, &record).expect("insert");

        StreakRunRepo::record_correct(&conn, &record.id).expect("correct 1");
        StreakRunRepo::record_correct(&conn, &record.id).expect("correct 2");
        StreakRunRepo::record_failure(&conn, &record.id).expect("failure");
        // A stray correct grading after the run already failed (should not
        // happen in practice — `do_submit_answer` refuses it — but the repo
        // layer stays defensive) must not inflate the frozen score.
        StreakRunRepo::record_correct(&conn, &record.id).expect("correct after fail is a no-op");

        let fetched = StreakRunRepo::get_owned(&conn, &record.id, &user_id)
            .expect("get")
            .expect("found");
        assert_eq!(fetched.correct_count, 2);
        assert!(fetched.failed);
        assert!(fetched.ended_at.is_some());
    }

    #[test]
    fn record_failure_is_idempotent() {
        let conn = setup_conn();
        let user_id = insert_student(&conn, "student");
        let record = apprentice_run(user_id, Uuid::new_v4());
        StreakRunRepo::insert(&conn, &record).expect("insert");

        StreakRunRepo::record_failure(&conn, &record.id).expect("first failure");
        let first = StreakRunRepo::get_owned(&conn, &record.id, &user_id)
            .expect("get")
            .expect("found")
            .ended_at;
        StreakRunRepo::record_failure(&conn, &record.id).expect("second failure");
        let second = StreakRunRepo::get_owned(&conn, &record.id, &user_id)
            .expect("get")
            .expect("found")
            .ended_at;
        assert_eq!(first, second, "a second failure must not move ended_at");
    }

    #[test]
    fn best_finished_runs_picks_the_highest_streak_per_user_and_ignores_unfinished_ones() {
        let conn = setup_conn();
        let alice = insert_student(&conn, "alice");
        let bob = insert_student(&conn, "bob");

        // Alice: two finished runs, the second better than the first.
        let alice_first = apprentice_run(alice, Uuid::new_v4());
        StreakRunRepo::insert(&conn, &alice_first).expect("insert");
        StreakRunRepo::record_correct(&conn, &alice_first.id).expect("correct");
        StreakRunRepo::record_failure(&conn, &alice_first.id).expect("fail");

        let alice_second = apprentice_run(alice, Uuid::new_v4());
        StreakRunRepo::insert(&conn, &alice_second).expect("insert");
        for _ in 0..5 {
            StreakRunRepo::record_correct(&conn, &alice_second.id).expect("correct");
        }
        StreakRunRepo::record_failure(&conn, &alice_second.id).expect("fail");

        // Bob: one finished run, plus one still in progress that must not count.
        let bob_finished = apprentice_run(bob, Uuid::new_v4());
        StreakRunRepo::insert(&conn, &bob_finished).expect("insert");
        for _ in 0..3 {
            StreakRunRepo::record_correct(&conn, &bob_finished.id).expect("correct");
        }
        StreakRunRepo::record_failure(&conn, &bob_finished.id).expect("fail");

        let bob_active = apprentice_run(bob, Uuid::new_v4());
        StreakRunRepo::insert(&conn, &bob_active).expect("insert");
        for _ in 0..99 {
            StreakRunRepo::record_correct(&conn, &bob_active.id).expect("correct");
        }
        // Deliberately never failed — must be excluded from the leaderboard.

        let board = StreakRunRepo::best_finished_runs(&conn, StreakRunKind::Apprentice, None, None, None)
            .expect("leaderboard");
        assert_eq!(board.len(), 2, "one row per user, not per run");

        let alice_row = board.iter().find(|r| r.user_id == alice).expect("alice row");
        assert_eq!(alice_row.best_correct_count, 5, "the better of alice's two runs");

        let bob_row = board.iter().find(|r| r.user_id == bob).expect("bob row");
        assert_eq!(
            bob_row.best_correct_count, 3,
            "bob's unfinished 99-streak must not count"
        );
    }
}
