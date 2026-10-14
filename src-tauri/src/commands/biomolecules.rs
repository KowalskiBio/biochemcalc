//! Biomolekuly: teacher-editable category display text (name and
//! description). The molecule data and categories live in the frontend
//! (`src/lib/molecules`); the server only stores overrides so an edit shows
//! for everyone — plus the scores of finished quizzes, for the section's
//! leaderboard.

use crate::db::repos::biomolecule_category_repo::{CategoryField, CategoryOverride};
use crate::db::repos::{BiomoleculeCategoryRepo, BiomoleculeLeaderboardRow, BiomoleculeQuizRepo};
use crate::db::DbError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

const MAX_NAME_CHARS: usize = 80;
const MAX_DESCRIPTION_CHARS: usize = 300;

/// Generous upper bound on one quiz's length — the "all molecules" option of
/// the biggest category is well under this. Stops a hand-crafted request
/// from claiming a thousand correct answers in one go.
const MAX_QUIZ_QUESTIONS: i64 = 100;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCategoryPayload {
    pub category_id: String,
    pub field: CategoryField,
    /// `None` or blank restores the built-in text.
    #[serde(default)]
    pub value: Option<String>,
}

/// Category slugs are route segments ("dusikate-baze") — anything else can't
/// be a real category, so reject it rather than store junk.
fn is_valid_category_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub fn do_list_category_overrides(
    conn: &Connection,
) -> Result<HashMap<String, CategoryOverride>, DbError> {
    BiomoleculeCategoryRepo::list(conn)
}

/// Teacher-only (the HTTP layer gates it). Returns the full override map so
/// the client can replace its copy in one go.
pub fn do_update_category(
    conn: &Connection,
    teacher_id: &Uuid,
    payload: UpdateCategoryPayload,
) -> Result<HashMap<String, CategoryOverride>, DbError> {
    let category_id = payload.category_id.trim();
    if !is_valid_category_id(category_id) {
        return Err(DbError::Validation(format!(
            "Invalid category: {category_id}"
        )));
    }
    let max = match payload.field {
        CategoryField::Name => MAX_NAME_CHARS,
        CategoryField::Description => MAX_DESCRIPTION_CHARS,
    };
    let value = match payload.value.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(v) if v.chars().count() > max => {
            return Err(DbError::Validation(format!(
                "Text must be at most {max} characters"
            )));
        }
        Some(v) => Some(v),
    };
    BiomoleculeCategoryRepo::set_field(conn, category_id, payload.field, value, Some(*teacher_id))?;
    BiomoleculeCategoryRepo::list(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordQuizResultPayload {
    pub category_id: String,
    pub correct_count: i64,
    pub total_count: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuizLeaderboardPayload {
    /// Narrow the board to one category; omitted sums every category.
    pub category_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeLeaderboardEntry {
    pub user_id: String,
    pub username: String,
    pub correct_count: i64,
    pub answered_count: i64,
    pub quiz_count: i64,
}

/// Store the score of one finished quiz for the acting user. The quiz is
/// graded client-side, so this can only sanity-check the numbers.
pub fn do_record_quiz_result(
    conn: &Connection,
    user_id: &Uuid,
    payload: RecordQuizResultPayload,
) -> Result<(), DbError> {
    let category_id = payload.category_id.trim();
    if !is_valid_category_id(category_id) {
        return Err(DbError::Validation(format!(
            "Invalid category: {category_id}"
        )));
    }
    if !(1..=MAX_QUIZ_QUESTIONS).contains(&payload.total_count)
        || !(0..=payload.total_count).contains(&payload.correct_count)
    {
        return Err(DbError::Validation("Invalid quiz score".into()));
    }
    BiomoleculeQuizRepo::insert(
        conn,
        user_id,
        category_id,
        payload.correct_count,
        payload.total_count,
    )
}

pub fn do_quiz_leaderboard(
    conn: &Connection,
    payload: &QuizLeaderboardPayload,
) -> Result<Vec<BiomoleculeLeaderboardEntry>, DbError> {
    let category_id = payload
        .category_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    Ok(BiomoleculeQuizRepo::leaderboard(conn, category_id)?
        .into_iter()
        .map(
            |row: BiomoleculeLeaderboardRow| BiomoleculeLeaderboardEntry {
                user_id: row.user_id.to_string(),
                username: row.username,
                correct_count: row.correct_count,
                answered_count: row.answered_count,
                quiz_count: row.quiz_count,
            },
        )
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn
    }

    fn update(
        conn: &Connection,
        id: &str,
        field: CategoryField,
        value: Option<&str>,
    ) -> Result<HashMap<String, CategoryOverride>, DbError> {
        let teacher =
            crate::commands::auth::do_bootstrap_admin_if_empty(conn, "teacher", "teacherpassword1")
                .expect("bootstrap")
                .map(|u| u.id)
                .unwrap_or_else(|| {
                    crate::db::repos::UserRepo::find_by_username(conn, "teacher")
                        .expect("find")
                        .expect("present")
                        .id
                });
        do_update_category(
            conn,
            &teacher,
            UpdateCategoryPayload {
                category_id: id.into(),
                field,
                value: value.map(Into::into),
            },
        )
    }

    #[test]
    fn update_trims_and_blank_resets() {
        let conn = setup_conn();
        let all = update(
            &conn,
            "dusikate-baze",
            CategoryField::Description,
            Some("  Báze nukleových kyselin  "),
        )
        .expect("update");
        assert_eq!(
            all["dusikate-baze"].description.as_deref(),
            Some("Báze nukleových kyselin")
        );
        assert_eq!(all["dusikate-baze"].name, None);

        let all = update(
            &conn,
            "dusikate-baze",
            CategoryField::Description,
            Some("   "),
        )
        .expect("reset");
        assert!(all.is_empty());
    }

    #[test]
    fn rejects_bad_slug_and_overlong_text() {
        let conn = setup_conn();
        assert!(matches!(
            update(&conn, "../etc", CategoryField::Name, Some("x")),
            Err(DbError::Validation(_))
        ));
        let long_name = "a".repeat(MAX_NAME_CHARS + 1);
        assert!(matches!(
            update(
                &conn,
                "aminokyseliny",
                CategoryField::Name,
                Some(&long_name)
            ),
            Err(DbError::Validation(_))
        ));
        let long_description = "a".repeat(MAX_DESCRIPTION_CHARS + 1);
        assert!(matches!(
            update(
                &conn,
                "aminokyseliny",
                CategoryField::Description,
                Some(&long_description)
            ),
            Err(DbError::Validation(_))
        ));
        assert!(do_list_category_overrides(&conn).expect("list").is_empty());
    }

    #[test]
    fn record_quiz_result_rejects_impossible_scores() {
        let conn = setup_conn();
        let user = crate::commands::auth::do_bootstrap_admin_if_empty(
            &conn,
            "teacher",
            "teacherpassword1",
        )
        .expect("bootstrap")
        .expect("created")
        .id;
        let record = |correct, total| {
            do_record_quiz_result(
                &conn,
                &user,
                RecordQuizResultPayload {
                    category_id: "aminokyseliny".into(),
                    correct_count: correct,
                    total_count: total,
                },
            )
        };
        for (correct, total) in [(0, 0), (6, 5), (-1, 5), (1, MAX_QUIZ_QUESTIONS + 1)] {
            assert!(matches!(
                record(correct, total),
                Err(DbError::Validation(_))
            ));
        }
        record(7, 10).expect("valid score");

        let board =
            do_quiz_leaderboard(&conn, &QuizLeaderboardPayload::default()).expect("leaderboard");
        assert_eq!(board.len(), 1);
        assert_eq!(board[0].correct_count, 7);
        assert_eq!(board[0].answered_count, 10);
    }
}
