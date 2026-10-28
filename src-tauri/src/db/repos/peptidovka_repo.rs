//! Storage for Peptidovka: the per-mode game settings a teacher edits and the
//! finished-run aggregates a future leaderboard will rank. Exactly like the
//! Biomolekuly streak, a run is graded client-side, so a row is only the
//! client's reported aggregate for one finished run. Migration v56 owns both
//! tables.

use crate::db::DbError;
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

/// One mode's editable Peptidovka settings. `slugs_json` is the raw JSON
/// array of molecule slugs as stored; the command layer parses it into a
/// `Vec<String>` for the API.
#[derive(Debug, Clone)]
pub struct PeptidovkaSettingsRecord {
    pub mode: String,
    pub min_len: i64,
    pub max_len: i64,
    pub seconds_per_aa: i64,
    pub slugs_json: String,
}

/// One user's single best Peptidovka run of a given mode, for the future
/// leaderboard.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct PeptidovkaLeaderboardRow {
    pub user_id: Uuid,
    pub username: String,
    pub best_correct_count: i64,
    pub total_seconds: f64,
}

/// Peptidovka settings and finished runs (migration v56).
pub struct PeptidovkaRepo;

impl PeptidovkaRepo {
    /// Both modes' settings, Učeň first (the teacher-facing order).
    pub fn list_settings(conn: &Connection) -> Result<Vec<PeptidovkaSettingsRecord>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT mode, min_len, max_len, seconds_per_aa, slugs
             FROM peptidovka_settings
             ORDER BY CASE mode WHEN 'ucen' THEN 0 ELSE 1 END, mode",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(PeptidovkaSettingsRecord {
                    mode: row.get(0)?,
                    min_len: row.get(1)?,
                    max_len: row.get(2)?,
                    seconds_per_aa: row.get(3)?,
                    slugs_json: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Replace one mode's settings; the mode is the primary key.
    pub fn upsert_settings(
        conn: &Connection,
        mode: &str,
        min_len: i64,
        max_len: i64,
        seconds_per_aa: i64,
        slugs_json: &str,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO peptidovka_settings
                 (mode, min_len, max_len, seconds_per_aa, slugs)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(mode) DO UPDATE SET
                 min_len = excluded.min_len,
                 max_len = excluded.max_len,
                 seconds_per_aa = excluded.seconds_per_aa,
                 slugs = excluded.slugs",
            params![mode, min_len, max_len, seconds_per_aa, slugs_json],
        )?;
        Ok(())
    }

    pub fn insert_run(
        conn: &Connection,
        user_id: &Uuid,
        mode: &str,
        correct_count: i64,
        total_seconds: f64,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO peptidovka_runs
                 (id, user_id, mode, correct_count, total_seconds, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                Uuid::new_v4(),
                user_id,
                mode,
                correct_count,
                total_seconds,
                Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    /// Each user's single best finished run of `mode`: the longest streak,
    /// ties broken by the faster total time. Mirrors
    /// `BiomoleculeStreakRepo::best_per_user`.
    #[allow(dead_code)]
    pub fn best_per_user(
        conn: &Connection,
        mode: &str,
    ) -> Result<Vec<PeptidovkaLeaderboardRow>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT pr.user_id, u.username, pr.correct_count, pr.total_seconds
             FROM peptidovka_runs pr
             JOIN users u ON u.id = pr.user_id
             WHERE pr.mode = ?1",
        )?;
        let rows = stmt
            .query_map(params![mode], |row| {
                Ok((
                    row.get::<_, Uuid>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, f64>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut best: std::collections::HashMap<Uuid, PeptidovkaLeaderboardRow> =
            std::collections::HashMap::new();
        for (user_id, username, correct_count, total_seconds) in rows {
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
                .or_insert(PeptidovkaLeaderboardRow {
                    user_id,
                    username,
                    best_correct_count: correct_count,
                    total_seconds,
                });
        }

        let mut board: Vec<PeptidovkaLeaderboardRow> = best.into_values().collect();
        board.sort_by(|a, b| {
            b.best_correct_count
                .cmp(&a.best_correct_count)
                .then(
                    a.total_seconds
                        .partial_cmp(&b.total_seconds)
                        .unwrap_or(std::cmp::Ordering::Equal),
                )
                .then_with(|| {
                    a.username
                        .to_ascii_lowercase()
                        .cmp(&b.username.to_ascii_lowercase())
                })
        });
        Ok(board)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::{UserRecord, UserRepo};
    use crate::models::{Role, SectionAccess};

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

    #[test]
    fn best_per_user_picks_the_longest_run_and_tie_breaks_on_time() {
        let conn = setup_conn();
        let alice = insert_student(&conn, "alice");
        let bob = insert_student(&conn, "bob");

        PeptidovkaRepo::insert_run(&conn, &alice, "ucen", 3, 20.0).expect("insert");
        PeptidovkaRepo::insert_run(&conn, &alice, "ucen", 8, 40.0).expect("insert");
        PeptidovkaRepo::insert_run(&conn, &bob, "ucen", 8, 30.0).expect("insert");
        PeptidovkaRepo::insert_run(&conn, &bob, "ucen", 8, 25.0).expect("insert");

        let board = PeptidovkaRepo::best_per_user(&conn, "ucen").expect("board");
        assert_eq!(board.len(), 2, "one row per user, not per run");
        assert_eq!(board[0].username, "bob");
        assert_eq!(board[0].best_correct_count, 8);
        assert_eq!(board[0].total_seconds, 25.0);
        assert_eq!(board[1].username, "alice");
        assert_eq!(board[1].total_seconds, 40.0);
    }

    #[test]
    fn best_per_user_isolates_modes() {
        let conn = setup_conn();
        let alice = insert_student(&conn, "alice");

        PeptidovkaRepo::insert_run(&conn, &alice, "ucen", 4, 10.0).expect("insert");
        PeptidovkaRepo::insert_run(&conn, &alice, "mistr", 9, 10.0).expect("insert");

        let ucen = PeptidovkaRepo::best_per_user(&conn, "ucen").expect("board");
        assert_eq!(ucen.len(), 1);
        assert_eq!(ucen[0].best_correct_count, 4);

        let mistr = PeptidovkaRepo::best_per_user(&conn, "mistr").expect("board");
        assert_eq!(mistr.len(), 1);
        assert_eq!(mistr[0].best_correct_count, 9);
    }
}
