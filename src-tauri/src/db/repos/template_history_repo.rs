use crate::db::DbError;
use crate::models::TemplateHistoryEntry;
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct TemplateHistoryRepo;

impl TemplateHistoryRepo {
    pub fn record_change(
        conn: &Connection,
        template_id: &Uuid,
        field_name: &str,
        old_value: Option<&str>,
        new_value: Option<&str>,
    ) -> Result<TemplateHistoryEntry, DbError> {
        let id = Uuid::new_v4();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO template_history (id, template_id, field_name, old_value, new_value, changed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, template_id, field_name, old_value, new_value, now],
        )?;

        Ok(TemplateHistoryEntry {
            id,
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
    ) -> Result<Vec<TemplateHistoryEntry>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, template_id, field_name, old_value, new_value, changed_at
             FROM template_history WHERE template_id = ?1
             ORDER BY changed_at DESC LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![template_id, limit, offset], |row| {
            Ok(TemplateHistoryEntry {
                id: row.get(0)?,
                template_id: row.get(1)?,
                field_name: row.get(2)?,
                old_value: row.get(3)?,
                new_value: row.get(4)?,
                changed_at: parse_dt(row.get::<_, String>(5)?),
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
    ) -> Result<Vec<TemplateHistoryEntry>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, template_id, field_name, old_value, new_value, changed_at
             FROM template_history
             ORDER BY changed_at DESC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, offset], |row| {
            Ok(TemplateHistoryEntry {
                id: row.get(0)?,
                template_id: row.get(1)?,
                field_name: row.get(2)?,
                old_value: row.get(3)?,
                new_value: row.get(4)?,
                changed_at: parse_dt(row.get::<_, String>(5)?),
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
            "DELETE FROM template_history WHERE template_id = ?1",
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

    fn insert_template(conn: &Connection) -> Uuid {
        let topic_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO topics (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![topic_id, "Test topic", chrono::Utc::now().to_rfc3339()],
        )
        .expect("insert topic");
        let template_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO templates (id, question_text, formula, equation_text, result_unit, point_value, topic_id, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                template_id,
                "question",
                "ANS",
                "",
                "g",
                2,
                topic_id,
                chrono::Utc::now().to_rfc3339(),
            ],
        )
        .expect("insert template");
        template_id
    }

    #[test]
    fn record_change_stores_entry() {
        let conn = setup_conn();
        let template_id = insert_template(&conn);

        let entry = TemplateHistoryRepo::record_change(
            &conn,
            &template_id,
            "questionText",
            Some("old"),
            Some("new"),
        )
        .expect("record_change");

        assert_eq!(entry.template_id, template_id);
        assert_eq!(entry.field_name, "questionText");
        assert_eq!(entry.old_value, Some("old".to_string()));
        assert_eq!(entry.new_value, Some("new".to_string()));

        let entries =
            TemplateHistoryRepo::list_by_template(&conn, &template_id, 10, 0).expect("list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, entry.id);
    }

    #[test]
    fn list_by_template_orders_by_changed_at_desc() {
        let conn = setup_conn();
        let template_id = insert_template(&conn);

        TemplateHistoryRepo::record_change(&conn, &template_id, "formula", Some("A"), Some("B"))
            .expect("record 1");
        TemplateHistoryRepo::record_change(
            &conn,
            &template_id,
            "equationText",
            Some("C"),
            Some("D"),
        )
        .expect("record 2");

        let entries =
            TemplateHistoryRepo::list_by_template(&conn, &template_id, 10, 0).expect("list");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].field_name, "equationText");
        assert_eq!(entries[1].field_name, "formula");
    }

    #[test]
    fn delete_for_template_removes_entries() {
        let conn = setup_conn();
        let template_id = insert_template(&conn);

        TemplateHistoryRepo::record_change(
            &conn,
            &template_id,
            "resultUnit",
            Some("g"),
            Some("kg"),
        )
        .expect("record");
        TemplateHistoryRepo::delete_for_template(&conn, &template_id).expect("delete");

        let entries =
            TemplateHistoryRepo::list_by_template(&conn, &template_id, 10, 0).expect("list");
        assert_eq!(entries.len(), 0);
    }
}
