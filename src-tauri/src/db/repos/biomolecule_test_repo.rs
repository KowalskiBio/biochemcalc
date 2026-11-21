//! Storage for teacher-created Biomolekuly tests and their per-student
//! attempts (migration v63). The command layer owns validation and the
//! response shapes; this repo is deliberately just the SQL.

use crate::db::DbError;
use rusqlite::{params, Connection, Row};
use uuid::Uuid;

const TEST_COLUMNS: &str = "id, title, created_by, created_at, updated_at,
     category_slugs, molecule_ids, question_types, question_count, question_set,
     monochrome, available_from, available_to, seed";

const ATTEMPT_COLUMNS: &str = "id, test_id, user_id, seed, started_at,
     submitted_at, total_count, correct_count, detail_json";

/// One `biomolecule_tests` row, JSON blobs still as stored text.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct BiomoleculeTestRecord {
    pub id: Uuid,
    pub title: String,
    pub created_by: Uuid,
    pub created_at: String,
    pub updated_at: String,
    pub category_slugs: String,
    pub molecule_ids: String,
    pub question_types: String,
    pub question_count: i64,
    pub question_set: String,
    pub monochrome: bool,
    pub available_from: String,
    pub available_to: String,
    pub seed: i64,
}

/// The fully-validated fields of a new test (ids/JSON already normalized).
pub struct NewBiomoleculeTest {
    pub title: String,
    pub created_by: Uuid,
    pub category_slugs: String,
    pub molecule_ids: String,
    pub question_types: String,
    pub question_count: i64,
    pub question_set: String,
    pub monochrome: bool,
    pub available_from: String,
    pub available_to: String,
    pub seed: i64,
}

/// One `biomolecule_test_attempts` row.
#[derive(Debug, Clone)]
pub struct BiomoleculeTestAttemptRecord {
    pub id: Uuid,
    pub test_id: Uuid,
    pub user_id: Uuid,
    pub seed: i64,
    pub started_at: String,
    pub submitted_at: Option<String>,
    pub total_count: Option<i64>,
    pub correct_count: Option<i64>,
    pub detail_json: Option<String>,
}

/// An attempt summary joined with the student's username for the teacher view.
#[derive(Debug, Clone)]
pub struct BiomoleculeTestAttemptSummaryRow {
    pub attempt: BiomoleculeTestAttemptRecord,
    pub username: String,
}

/// A student eligible to sit tests (Biomolekuly section access).
#[derive(Debug, Clone)]
pub struct BiomoleculeTestRosterRow {
    pub user_id: Uuid,
    pub username: String,
}

pub struct BiomoleculeTestRepo;

impl BiomoleculeTestRepo {
    pub fn insert(conn: &Connection, test: &NewBiomoleculeTest) -> Result<Uuid, DbError> {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO biomolecule_tests
                 (id, title, created_by, created_at, updated_at, category_slugs,
                  molecule_ids, question_types, question_count, question_set,
                  monochrome, available_from, available_to, seed)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                id,
                test.title,
                test.created_by,
                now,
                test.category_slugs,
                test.molecule_ids,
                test.question_types,
                test.question_count,
                test.question_set,
                test.monochrome,
                test.available_from,
                test.available_to,
                test.seed,
            ],
        )?;
        Ok(id)
    }

    pub fn find(
        conn: &Connection,
        test_id: &Uuid,
    ) -> Result<Option<BiomoleculeTestRecord>, DbError> {
        let mut stmt = conn.prepare(&format!(
            "SELECT {TEST_COLUMNS} FROM biomolecule_tests WHERE id = ?1"
        ))?;
        let mut rows = stmt.query(params![test_id])?;
        match rows.next()? {
            Some(row) => Ok(Some(map_test(row)?)),
            None => Ok(None),
        }
    }

    /// Newest first, all teachers' tests alike (the house convention).
    pub fn list(conn: &Connection) -> Result<Vec<BiomoleculeTestRecord>, DbError> {
        let mut stmt = conn.prepare(&format!(
            "SELECT {TEST_COLUMNS} FROM biomolecule_tests
             ORDER BY created_at DESC, id DESC"
        ))?;
        let rows = stmt.query_map([], map_test)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn delete(conn: &Connection, test_id: &Uuid) -> Result<usize, DbError> {
        Ok(conn.execute(
            "DELETE FROM biomolecule_tests WHERE id = ?1",
            params![test_id],
        )?)
    }

    pub fn attempt_count(conn: &Connection, test_id: &Uuid) -> Result<i64, DbError> {
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM biomolecule_test_attempts WHERE test_id = ?1",
            params![test_id],
            |row| row.get(0),
        )?)
    }

    pub fn attempt_summaries(
        conn: &Connection,
        test_id: &Uuid,
    ) -> Result<Vec<BiomoleculeTestAttemptSummaryRow>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT a.id, a.test_id, a.user_id, a.seed, a.started_at, a.submitted_at,
                    a.total_count, a.correct_count, a.detail_json, u.username
             FROM biomolecule_test_attempts a
             JOIN users u ON u.id = a.user_id
             WHERE a.test_id = ?1
             ORDER BY a.started_at ASC, u.username COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map(params![test_id], |row| {
            Ok(BiomoleculeTestAttemptSummaryRow {
                attempt: map_attempt(row)?,
                username: row.get(9)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Students whose section access includes Biomolekuly, so the teacher page
    /// can show "not submitted" names next to the attempts.
    pub fn eligible_roster(conn: &Connection) -> Result<Vec<BiomoleculeTestRosterRow>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, username FROM users
             WHERE role = 'student' AND sections IN ('biomolecules', 'both')
             ORDER BY username COLLATE NOCASE ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(BiomoleculeTestRosterRow {
                user_id: row.get(0)?,
                username: row.get(1)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn find_attempt(
        conn: &Connection,
        test_id: &Uuid,
        user_id: &Uuid,
    ) -> Result<Option<BiomoleculeTestAttemptRecord>, DbError> {
        let mut stmt = conn.prepare(&format!(
            "SELECT {ATTEMPT_COLUMNS} FROM biomolecule_test_attempts
             WHERE test_id = ?1 AND user_id = ?2"
        ))?;
        let mut rows = stmt.query(params![test_id, user_id])?;
        match rows.next()? {
            Some(row) => Ok(Some(map_attempt(row)?)),
            None => Ok(None),
        }
    }

    /// The attempt plus its test's deadline, for the submission grace check.
    pub fn find_attempt_with_deadline(
        conn: &Connection,
        attempt_id: &Uuid,
    ) -> Result<Option<(BiomoleculeTestAttemptRecord, String)>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT a.id, a.test_id, a.user_id, a.seed, a.started_at, a.submitted_at,
                    a.total_count, a.correct_count, a.detail_json, t.available_to
             FROM biomolecule_test_attempts a
             JOIN biomolecule_tests t ON t.id = a.test_id
             WHERE a.id = ?1",
        )?;
        let mut rows = stmt.query(params![attempt_id])?;
        match rows.next()? {
            Some(row) => Ok(Some((map_attempt(row)?, row.get(9)?))),
            None => Ok(None),
        }
    }

    pub fn insert_attempt(
        conn: &Connection,
        test_id: &Uuid,
        user_id: &Uuid,
        seed: i64,
    ) -> Result<BiomoleculeTestAttemptRecord, DbError> {
        let attempt = BiomoleculeTestAttemptRecord {
            id: Uuid::new_v4(),
            test_id: *test_id,
            user_id: *user_id,
            seed,
            started_at: chrono::Utc::now().to_rfc3339(),
            submitted_at: None,
            total_count: None,
            correct_count: None,
            detail_json: None,
        };
        conn.execute(
            "INSERT INTO biomolecule_test_attempts
                 (id, test_id, user_id, seed, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                attempt.id,
                attempt.test_id,
                attempt.user_id,
                attempt.seed,
                attempt.started_at,
            ],
        )?;
        Ok(attempt)
    }

    /// Idempotent by construction: only an unsubmitted row is updated, so a
    /// repeated submit returns 0 affected rows and never rewrites the result.
    pub fn mark_submitted(
        conn: &Connection,
        attempt_id: &Uuid,
        user_id: &Uuid,
        total_count: i64,
        correct_count: i64,
        detail_json: Option<&str>,
    ) -> Result<usize, DbError> {
        Ok(conn.execute(
            "UPDATE biomolecule_test_attempts
             SET submitted_at = ?3, total_count = ?4, correct_count = ?5, detail_json = ?6
             WHERE id = ?1 AND user_id = ?2 AND submitted_at IS NULL",
            params![
                attempt_id,
                user_id,
                chrono::Utc::now().to_rfc3339(),
                total_count,
                correct_count,
                detail_json,
            ],
        )?)
    }
}

fn map_test(row: &Row<'_>) -> rusqlite::Result<BiomoleculeTestRecord> {
    Ok(BiomoleculeTestRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        created_by: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        category_slugs: row.get(5)?,
        molecule_ids: row.get(6)?,
        question_types: row.get(7)?,
        question_count: row.get(8)?,
        question_set: row.get(9)?,
        monochrome: row.get(10)?,
        available_from: row.get(11)?,
        available_to: row.get(12)?,
        seed: row.get(13)?,
    })
}

fn map_attempt(row: &Row<'_>) -> rusqlite::Result<BiomoleculeTestAttemptRecord> {
    Ok(BiomoleculeTestAttemptRecord {
        id: row.get(0)?,
        test_id: row.get(1)?,
        user_id: row.get(2)?,
        seed: row.get(3)?,
        started_at: row.get(4)?,
        submitted_at: row.get(5)?,
        total_count: row.get(6)?,
        correct_count: row.get(7)?,
        detail_json: row.get(8)?,
    })
}
