use crate::db::DbError;
use crate::models::VariableHistoryEntry;
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct VariableHistoryRepo;

impl VariableHistoryRepo {
    pub fn record_change(
        conn: &Connection,
        variable_id: &Uuid,
        template_id: &Uuid,
        field_name: &str,
        old_value: Option<&str>,
        new_value: Option<&str>,
    ) -> Result<VariableHistoryEntry, DbError> {
        let id = Uuid::new_v4();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO variable_history (id, variable_id, template_id, field_name, old_value, new_value, changed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, variable_id, template_id, field_name, old_value, new_value, now],
        )?;

        Ok(VariableHistoryEntry {
            id,
            variable_id: *variable_id,
            template_id: *template_id,
            field_name: field_name.to_string(),
            old_value: old_value.map(|s| s.to_string()),
            new_value: new_value.map(|s| s.to_string()),
            changed_at: Utc::now(),
        })
    }

    pub fn list_by_template(
        conn: &Connection,
        template_id: &Uuid,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<VariableHistoryEntry>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, variable_id, template_id, field_name, old_value, new_value, changed_at
             FROM variable_history WHERE template_id = ?1
             ORDER BY changed_at DESC LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![template_id, limit, offset], |row| {
            Ok(VariableHistoryEntry {
                id: row.get(0)?,
                variable_id: row.get(1)?,
                template_id: row.get(2)?,
                field_name: row.get(3)?,
                old_value: row.get(4)?,
                new_value: row.get(5)?,
                changed_at: parse_dt(row.get::<_, String>(6)?),
            })
        })?;
        let mut entries = Vec::new();
        for r in rows {
            entries.push(r?);
        }
        Ok(entries)
    }

    pub fn list_all(
        conn: &Connection,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<VariableHistoryEntry>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, variable_id, template_id, field_name, old_value, new_value, changed_at
             FROM variable_history
             ORDER BY changed_at DESC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, offset], |row| {
            Ok(VariableHistoryEntry {
                id: row.get(0)?,
                variable_id: row.get(1)?,
                template_id: row.get(2)?,
                field_name: row.get(3)?,
                old_value: row.get(4)?,
                new_value: row.get(5)?,
                changed_at: parse_dt(row.get::<_, String>(6)?),
            })
        })?;
        let mut entries = Vec::new();
        for r in rows {
            entries.push(r?);
        }
        Ok(entries)
    }

    pub fn delete_for_template(conn: &Connection, template_id: &Uuid) -> Result<(), DbError> {
        conn.execute(
            "DELETE FROM variable_history WHERE template_id = ?1",
            params![template_id],
        )?;
        Ok(())
    }
}

fn parse_dt(s: String) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(&s)
        .unwrap_or_else(|_| {
            chrono::DateTime::parse_from_rfc3339("1970-01-01T00:00:00Z")
                .expect("hardcoded fallback")
        })
        .with_timezone(&chrono::Utc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    /// Insert a topic and template so FK constraints are satisfied.
    fn insert_template(conn: &Connection) -> (Uuid, Uuid) {
        let topic_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO topics (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![topic_id, "Test topic", chrono::Utc::now().to_rfc3339()],
        )
        .expect("insert topic");
        let template_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO templates (id, question_text, formula, result_unit, point_value, topic_id, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                template_id,
                "question",
                "ANS",
                "g",
                2,
                topic_id,
                chrono::Utc::now().to_rfc3339(),
            ],
        )
        .expect("insert template");
        (topic_id, template_id)
    }

    /// Insert a variable so FK constraints are satisfied.
    fn insert_variable(conn: &Connection) -> Uuid {
        let var_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO variables (id, name, symbol, min_value, max_value, step, unit, precision, var_type, string_values, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                var_id,
                "TestVar",
                "tv",
                0.0,
                10.0,
                1.0,
                "u",
                0,
                "numeric",
                None::<&str>,
                chrono::Utc::now().to_rfc3339(),
            ],
        )
        .expect("insert variable");
        var_id
    }

    #[test]
    fn record_change_stores_entry() {
        let conn = setup_conn();
        let (_topic_id, template_id) = insert_template(&conn);
        let var_id = insert_variable(&conn);

        let entry = VariableHistoryRepo::record_change(
            &conn,
            &var_id,
            &template_id,
            "name",
            Some("old_name"),
            Some("new_name"),
        )
        .expect("record_change");

        assert_eq!(entry.variable_id, var_id);
        assert_eq!(entry.template_id, template_id);
        assert_eq!(entry.field_name, "name");
        assert_eq!(entry.old_value, Some("old_name".to_string()));
        assert_eq!(entry.new_value, Some("new_name".to_string()));

        // Verify it's actually in the DB via list_by_template.
        let entries =
            VariableHistoryRepo::list_by_template(&conn, &template_id, 10, 0).expect("list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, entry.id);
    }

    #[test]
    fn list_by_template_returns_correct_entries() {
        let conn = setup_conn();
        let (_topic_id, template_id) = insert_template(&conn);
        let var_id = insert_variable(&conn);

        VariableHistoryRepo::record_change(
            &conn,
            &var_id,
            &template_id,
            "symbol",
            Some("A"),
            Some("B"),
        )
        .expect("record 1");
        VariableHistoryRepo::record_change(
            &conn,
            &var_id,
            &template_id,
            "unit",
            Some("g"),
            Some("kg"),
        )
        .expect("record 2");

        let entries =
            VariableHistoryRepo::list_by_template(&conn, &template_id, 10, 0).expect("list");
        assert_eq!(entries.len(), 2);
        // Ordered by changed_at DESC, so record 2 (unit) comes first.
        assert_eq!(entries[0].field_name, "unit");
        assert_eq!(entries[1].field_name, "symbol");
    }

    #[test]
    fn list_all_returns_entries_across_templates() {
        let conn = setup_conn();
        let (_topic_id, t1) = insert_template(&conn);
        let var_id = insert_variable(&conn);

        // Second template in same topic.
        let t2 = Uuid::new_v4();
        conn.execute(
            "INSERT INTO templates (id, question_text, formula, result_unit, point_value, topic_id, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                t2,
                "q2",
                "ANS",
                "g",
                2,
                _topic_id,
                chrono::Utc::now().to_rfc3339(),
            ],
        )
        .expect("insert template 2");

        VariableHistoryRepo::record_change(&conn, &var_id, &t1, "name", Some("a"), Some("b"))
            .expect("record t1");
        VariableHistoryRepo::record_change(&conn, &var_id, &t2, "name", Some("x"), Some("y"))
            .expect("record t2");

        let entries = VariableHistoryRepo::list_all(&conn, 10, 0).expect("list_all");
        assert_eq!(entries.len(), 2);
        // Verify both template IDs are present.
        let template_ids: Vec<Uuid> = entries.iter().map(|e| e.template_id).collect();
        assert!(template_ids.contains(&t1));
        assert!(template_ids.contains(&t2));
    }

    #[test]
    fn delete_for_template_removes_entries() {
        let conn = setup_conn();
        let (_topic_id, template_id) = insert_template(&conn);
        let var_id = insert_variable(&conn);

        VariableHistoryRepo::record_change(
            &conn,
            &var_id,
            &template_id,
            "precision",
            Some("1"),
            Some("2"),
        )
        .expect("record");

        // Second template to verify selective deletion.
        let t2 = Uuid::new_v4();
        conn.execute(
            "INSERT INTO templates (id, question_text, formula, result_unit, point_value, topic_id, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                t2,
                "q2",
                "ANS",
                "g",
                2,
                _topic_id,
                chrono::Utc::now().to_rfc3339(),
            ],
        )
        .expect("insert template 2");
        VariableHistoryRepo::record_change(&conn, &var_id, &t2, "precision", Some("0"), Some("3"))
            .expect("record t2");

        VariableHistoryRepo::delete_for_template(&conn, &template_id).expect("delete");

        let t1_entries =
            VariableHistoryRepo::list_by_template(&conn, &template_id, 10, 0).expect("list t1");
        assert_eq!(t1_entries.len(), 0);

        let t2_entries = VariableHistoryRepo::list_by_template(&conn, &t2, 10, 0).expect("list t2");
        assert_eq!(t2_entries.len(), 1);
    }
}
