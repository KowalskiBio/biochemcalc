use crate::db::DbError;
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

/// One row of the Biomolekuly leaderboard, summed over a user's finished
/// quizzes (optionally in one category).
#[derive(Debug, Clone)]
pub struct BiomoleculeLeaderboardRow {
    pub user_id: Uuid,
    pub username: String,
    pub correct_count: i64,
    pub answered_count: i64,
    pub quiz_count: i64,
    /// Weighted score: hard-mode correct answers count double.
    pub points: i64,
}

/// Finished Biomolekuly quiz scores (migration v45).
pub struct BiomoleculeQuizRepo;

impl BiomoleculeQuizRepo {
    pub fn insert(
        conn: &Connection,
        user_id: &Uuid,
        category_id: &str,
        correct_count: i64,
        total_count: i64,
        mode: &str,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO biomolecule_quiz_results
                 (id, user_id, category_id, correct_count, total_count, mode, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                Uuid::new_v4(),
                user_id,
                category_id,
                correct_count,
                total_count,
                mode,
                Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    /// Mirrors `PracticeRepo::leaderboard`: every student with Biomolekuly
    /// access (so an idle one still sees themselves), plus anyone else who
    /// has finished a quiz. `category_id` narrows the scores to one category.
    pub fn leaderboard(
        conn: &Connection,
        category_id: Option<&str>,
    ) -> Result<Vec<BiomoleculeLeaderboardRow>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT u.id,
                    u.username,
                    COALESCE(SUM(r.correct_count), 0) AS correct_count,
                    COALESCE(SUM(r.total_count), 0) AS answered_count,
                    COUNT(r.id) AS quiz_count,
                    COALESCE(SUM(CASE WHEN r.mode = 'hard'
                                      THEN r.correct_count * 2
                                      ELSE r.correct_count END), 0) AS points
             FROM users u
             LEFT JOIN biomolecule_quiz_results r
                 ON r.user_id = u.id AND (?1 IS NULL OR r.category_id = ?1)
             GROUP BY u.id
             HAVING (u.role = 'student' AND u.sections != 'calculations') OR quiz_count > 0
             ORDER BY points DESC, answered_count ASC, u.username COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map(params![category_id], |row| {
                Ok(BiomoleculeLeaderboardRow {
                    user_id: row.get(0)?,
                    username: row.get(1)?,
                    correct_count: row.get(2)?,
                    answered_count: row.get(3)?,
                    quiz_count: row.get(4)?,
                    points: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
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
        conn
    }

    fn insert_user(conn: &Connection, username: &str, role: Role, sections: SectionAccess) -> Uuid {
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: username.into(),
            password_hash: "h".into(),
            role,
            created_at: Utc::now(),
            protected: false,
            email: None,
            sections,
            preferred_section: None,
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    #[test]
    fn leaderboard_sums_quizzes_filters_by_category_and_section() {
        let conn = setup_conn();
        let busy = insert_user(&conn, "busy", Role::Student, SectionAccess::Biomolecules);
        insert_user(&conn, "idle", Role::Student, SectionAccess::Both);
        insert_user(
            &conn,
            "calc-only",
            Role::Student,
            SectionAccess::Calculations,
        );
        let teacher = insert_user(&conn, "teacher", Role::Teacher, SectionAccess::Both);

        BiomoleculeQuizRepo::insert(&conn, &busy, "aminokyseliny", 8, 10, "easy").expect("insert");
        BiomoleculeQuizRepo::insert(&conn, &busy, "dusikate-baze", 4, 5, "easy").expect("insert");
        BiomoleculeQuizRepo::insert(&conn, &teacher, "dusikate-baze", 5, 5, "easy")
            .expect("insert");

        let board = BiomoleculeQuizRepo::leaderboard(&conn, None).expect("leaderboard");
        let names: Vec<&str> = board.iter().map(|r| r.username.as_str()).collect();
        assert_eq!(names, vec!["busy", "teacher", "idle"]);
        assert_eq!(board[0].correct_count, 12);
        assert_eq!(board[0].answered_count, 15);
        assert_eq!(board[0].quiz_count, 2);
        assert_eq!(board[0].points, 12);

        let bases =
            BiomoleculeQuizRepo::leaderboard(&conn, Some("dusikate-baze")).expect("leaderboard");
        let names: Vec<&str> = bases.iter().map(|r| r.username.as_str()).collect();
        assert_eq!(names, vec!["teacher", "busy", "idle"]);
        assert_eq!(bases[1].correct_count, 4);
    }

    #[test]
    fn hard_mode_correct_answers_double_the_points() {
        let conn = setup_conn();
        let easy = insert_user(&conn, "easy", Role::Student, SectionAccess::Biomolecules);
        let hard = insert_user(&conn, "hard", Role::Student, SectionAccess::Biomolecules);

        // Identical raw scores, but one quiz was finished in hard mode.
        BiomoleculeQuizRepo::insert(&conn, &easy, "aminokyseliny", 5, 5, "easy").expect("insert");
        BiomoleculeQuizRepo::insert(&conn, &hard, "aminokyseliny", 5, 5, "hard").expect("insert");

        let board = BiomoleculeQuizRepo::leaderboard(&conn, None).expect("leaderboard");
        assert_eq!(board[0].username, "hard");
        assert_eq!(board[0].points, 10);
        assert_eq!(board[0].correct_count, 5);
        assert_eq!(board[1].username, "easy");
        assert_eq!(board[1].points, 5);
    }
}
