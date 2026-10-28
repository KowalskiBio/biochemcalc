//! The biomolecules teacher-action log (`biomolecule_history`, migration
//! v57): who changed what in the library. Written inside the mutation
//! `do_*` functions so every recorded action arrives with its actor.

use crate::db::DbError;
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

/// One log row, with the actor's username already joined for the page.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeHistoryRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub kind: String,
    pub action: String,
    pub label: String,
    pub detail: Option<String>,
    pub created_at: String,
}

pub struct BiomoleculeHistoryRepo;

impl BiomoleculeHistoryRepo {
    pub fn record(
        conn: &Connection,
        user_id: &Uuid,
        kind: &str,
        action: &str,
        label: &str,
        detail: Option<&str>,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO biomolecule_history
                 (id, user_id, kind, action, label, detail, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                Uuid::new_v4(),
                user_id,
                kind,
                action,
                label,
                detail,
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// Newest first, paginated for the page's load-more rhythm.
    pub fn list_all(
        conn: &Connection,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<BiomoleculeHistoryRecord>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT h.id, h.user_id, u.username, h.kind, h.action, h.label, h.detail, h.created_at
             FROM biomolecule_history h
             JOIN users u ON u.id = h.user_id
             ORDER BY h.created_at DESC, h.id DESC
             LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt
            .query_map(params![limit, offset], |row| {
                Ok(BiomoleculeHistoryRecord {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    username: row.get(2)?,
                    kind: row.get(3)?,
                    action: row.get(4)?,
                    label: row.get(5)?,
                    detail: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn clear_all(conn: &Connection) -> Result<(), DbError> {
        conn.execute("DELETE FROM biomolecule_history", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run_migrations(&conn).expect("migrations");
        conn
    }

    fn insert_user(conn: &Connection, username: &str) -> Uuid {
        let id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at)
             VALUES (?1, ?2, 'hash', 'teacher', ?3)",
            rusqlite::params![id, username, Utc::now().to_rfc3339()],
        )
        .expect("insert user");
        id
    }

    #[test]
    fn record_then_list_shows_newest_first_with_username() {
        let conn = setup_conn();
        let teacher = insert_user(&conn, "ucitel");

        BiomoleculeHistoryRepo::record(&conn, &teacher, "molecule", "create", "Alanin", None)
            .expect("first");
        // Equal timestamps keep the order deterministic via the id tiebreak;
        // touching the second row's clock makes ordering unambiguous anyway.
        conn.execute(
            "UPDATE biomolecule_history SET created_at = '2000-01-01T00:00:00Z'",
            [],
        )
        .expect("shuffle clock");
        BiomoleculeHistoryRepo::record(
            &conn,
            &teacher,
            "molecule",
            "delete",
            "Alanin",
            Some("jmeno: Alanin -> Ala"),
        )
        .expect("second");

        let entries = BiomoleculeHistoryRepo::list_all(&conn, 10, 0).expect("list");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].action, "delete");
        assert_eq!(entries[0].username, "ucitel");
        assert_eq!(entries[0].detail.as_deref(), Some("jmeno: Alanin -> Ala"));
        assert_eq!(entries[1].action, "create");
    }

    #[test]
    fn pagination_windows_and_clear_all() {
        let conn = setup_conn();
        let teacher = insert_user(&conn, "ucitel");
        for index in 0..7 {
            BiomoleculeHistoryRepo::record(
                &conn,
                &teacher,
                "category",
                "reorder",
                &format!("order {index}"),
                None,
            )
            .expect("record");
        }
        assert_eq!(BiomoleculeHistoryRepo::list_all(&conn, 3, 0).expect("page 1").len(), 3);
        let second = BiomoleculeHistoryRepo::list_all(&conn, 3, 3).expect("page 2");
        assert_eq!(second.len(), 3);
        assert_eq!(
            BiomoleculeHistoryRepo::list_all(&conn, 3, 6).expect("page 3").len(),
            1
        );

        BiomoleculeHistoryRepo::clear_all(&conn).expect("clear");
        assert!(
            BiomoleculeHistoryRepo::list_all(&conn, 50, 0)
                .expect("after clear")
                .is_empty()
        );
    }
}
