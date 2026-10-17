//! Storage for Biomolekuly streak runs (Učeň/Mistr): an endless
//! one-question-at-a-time run that ends on the first wrong answer. The whole
//! run is graded client-side, so — exactly like `BiomoleculeQuizRepo` — a row
//! here is only the client's reported aggregate for one finished run, never a
//! per-attempt record. Migration v49 owns the table.

use crate::db::DbError;
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

/// One user's single best Biomolekuly streak of a given kind, for the
/// leaderboard.
#[derive(Debug, Clone)]
pub struct BiomoleculeStreakLeaderboardRow {
    pub user_id: Uuid,
    pub username: String,
    pub best_correct_count: i64,
    pub total_seconds: f64,
}

/// Finished Biomolekuly streak runs (migration v49).
pub struct BiomoleculeStreakRepo;

impl BiomoleculeStreakRepo {
    pub fn insert(
        conn: &Connection,
        user_id: &Uuid,
        kind: &str,
        correct_count: i64,
        total_seconds: f64,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO biomolecule_streak_runs
                 (id, user_id, kind, correct_count, total_seconds, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                Uuid::new_v4(),
                user_id,
                kind,
                correct_count,
                total_seconds,
                Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    /// Each user's single best finished run of `kind`: the longest streak,
    /// ties broken by the faster total time. Runs of the other kind never
    /// appear, and unlike the calculations streak there is no topic/set scoping
    /// — a Biomolekuly streak is always over the whole library.
    ///
    /// The best-per-user fold happens in Rust (mirroring
    /// `StreakRunRepo::best_finished_runs`), so the query just fetches every
    /// run of the kind joined to its owner's username.
    pub fn best_per_user(
        conn: &Connection,
        kind: &str,
    ) -> Result<Vec<BiomoleculeStreakLeaderboardRow>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT sr.user_id, u.username, sr.correct_count, sr.total_seconds
             FROM biomolecule_streak_runs sr
             JOIN users u ON u.id = sr.user_id
             WHERE sr.kind = ?1",
        )?;
        let rows = stmt
            .query_map(params![kind], |row| {
                Ok((
                    row.get::<_, Uuid>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, f64>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut best: std::collections::HashMap<Uuid, BiomoleculeStreakLeaderboardRow> =
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
                .or_insert(BiomoleculeStreakLeaderboardRow {
                    user_id,
                    username,
                    best_correct_count: correct_count,
                    total_seconds,
                });
        }

        let mut board: Vec<BiomoleculeStreakLeaderboardRow> = best.into_values().collect();
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
    fn best_per_user_picks_the_longest_streak_and_tie_breaks_on_time() {
        let conn = setup_conn();
        let alice = insert_student(&conn, "alice");
        let bob = insert_student(&conn, "bob");

        // Alice: a shorter run, then a longer one.
        BiomoleculeStreakRepo::insert(&conn, &alice, "apprentice", 3, 20.0).expect("insert");
        BiomoleculeStreakRepo::insert(&conn, &alice, "apprentice", 8, 40.0).expect("insert");
        // Bob: two equally long runs — the faster one wins.
        BiomoleculeStreakRepo::insert(&conn, &bob, "apprentice", 8, 30.0).expect("insert");
        BiomoleculeStreakRepo::insert(&conn, &bob, "apprentice", 8, 25.0).expect("insert");

        let board = BiomoleculeStreakRepo::best_per_user(&conn, "apprentice").expect("board");
        assert_eq!(board.len(), 2, "one row per user, not per run");
        // Bob's 8/25.0 edges out Alice's 8/40.0 on time.
        assert_eq!(board[0].username, "bob");
        assert_eq!(board[0].best_correct_count, 8);
        assert_eq!(board[0].total_seconds, 25.0);
        assert_eq!(board[1].username, "alice");
        assert_eq!(board[1].best_correct_count, 8);
        assert_eq!(board[1].total_seconds, 40.0);
    }

    #[test]
    fn best_per_user_isolates_kinds() {
        let conn = setup_conn();
        let alice = insert_student(&conn, "alice");

        BiomoleculeStreakRepo::insert(&conn, &alice, "apprentice", 4, 10.0).expect("insert");
        BiomoleculeStreakRepo::insert(&conn, &alice, "master", 9, 10.0).expect("insert");

        let apprentice = BiomoleculeStreakRepo::best_per_user(&conn, "apprentice").expect("board");
        assert_eq!(apprentice.len(), 1);
        assert_eq!(apprentice[0].best_correct_count, 4);

        let master = BiomoleculeStreakRepo::best_per_user(&conn, "master").expect("board");
        assert_eq!(master.len(), 1);
        assert_eq!(master[0].best_correct_count, 9);
    }
}
