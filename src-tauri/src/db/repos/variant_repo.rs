use crate::db::DbError;
use crate::models::Variant;
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct VariantRepo;

impl VariantRepo {
    /// Insert a generated variant. Serialises `assigned_values`, `assigned_strings`, and
    /// `numeric_options` to JSON text columns.
    pub fn insert(conn: &Connection, v: &Variant) -> Result<(), DbError> {
        let assigned_json = serde_json::to_string(&v.assigned_values)?;
        let assigned_strings_json = serde_json::to_string(&v.assigned_strings)?;
        let numeric_options_json = v
            .numeric_options
            .as_ref()
            .map(|d| serde_json::to_string(d))
            .transpose()?;

        conn.execute(
            "INSERT INTO variants (id, template_id, assigned_values, assigned_strings, correct_answer, \
             numeric_options, correct_option, interval_lo, interval_hi, seed, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                v.id,
                v.template_id,
                assigned_json,
                assigned_strings_json,
                v.correct_answer,
                numeric_options_json,
                v.correct_option,
                v.interval_lo,
                v.interval_hi,
                v.seed as i64,
                v.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// List all variants for a given template.
    pub fn list_by_template(
        conn: &Connection,
        template_id: &Uuid,
    ) -> Result<Vec<Variant>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, template_id, assigned_values, assigned_strings, correct_answer, numeric_options, \
             correct_option, interval_lo, interval_hi, seed, created_at
             FROM variants WHERE template_id = ?1 ORDER BY created_at ASC",
        )?;
        Self::query_variants(&mut stmt, params![template_id])
    }

    /// List all variants for a given set (through set_templates junction).
    /// This resolves set → templates → variants.
    pub fn list_by_set(conn: &Connection, set_id: &Uuid) -> Result<Vec<Variant>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT v.id, v.template_id, v.assigned_values, v.assigned_strings, v.correct_answer, v.numeric_options, \
             v.correct_option, v.interval_lo, v.interval_hi, v.seed, v.created_at
             FROM variants v
             INNER JOIN set_templates st ON v.template_id = st.template_id
             WHERE st.set_id = ?1
             ORDER BY st.sort_order ASC, v.created_at ASC",
        )?;
        Self::query_variants(&mut stmt, params![set_id])
    }

    fn query_variants(
        stmt: &mut rusqlite::Statement,
        params: &[&dyn rusqlite::types::ToSql],
    ) -> Result<Vec<Variant>, DbError> {
        let rows = stmt.query_map(params, |row| {
            let assigned_json: String = row.get(2)?;
            let assigned_strings_json: String = row.get(3)?;
            let numeric_options_json: Option<String> = row.get(5)?;
            Ok(Variant {
                id: row.get(0)?,
                template_id: row.get(1)?,
                assigned_values: serde_json::from_str(&assigned_json).unwrap_or_default(),
                assigned_strings: serde_json::from_str(&assigned_strings_json).unwrap_or_default(),
                correct_answer: row.get(4)?,
                numeric_options: numeric_options_json.and_then(|s| serde_json::from_str(&s).ok()),
                correct_option: row.get(6)?,
                interval_lo: row.get(7)?,
                interval_hi: row.get(8)?,
                seed: row.get::<_, i64>(9)? as u64,
                created_at: parse_dt(row.get::<_, String>(10)?),
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
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
    use crate::db::repos::{CategoryRepo, SetRepo, TopicRepo};
    use crate::models::{Template, Topic};
    use rusqlite::Connection;
    use std::collections::HashMap;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn seed_topic(conn: &Connection) -> Topic {
        let t = Topic::new("Test".into());
        TopicRepo::insert(conn, &t).expect("insert topic");
        t
    }

    #[test]
    fn insert_and_list_variant_by_template() {
        let conn = setup_conn();
        let t = Template::new("Q?".into(), "X".into(), "".into(), None, "g".into(), 2);
        crate::db::repos::TemplateRepo::insert(&conn, &t, &[], &[], None).expect("insert tpl");

        let mut vals = HashMap::new();
        vals.insert("X".into(), 42.0);
        let v = Variant::new(
            t.id,
            vals,
            HashMap::new(),
            42.0,
            Some(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            Some(1),
            None,
            None,
            12345,
        );
        VariantRepo::insert(&conn, &v).expect("insert");

        let variants = VariantRepo::list_by_template(&conn, &t.id).expect("list");
        assert_eq!(variants.len(), 1);
        assert_eq!(variants[0].correct_answer, 42.0);
    }

    #[test]
    fn list_by_set_returns_variants_from_all_set_templates() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (_, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");
        let set = &sets[0];

        let t1 = Template::new("Q1".into(), "X".into(), "".into(), None, "g".into(), 2);
        let t2 = Template::new("Q2".into(), "Y".into(), "".into(), None, "g".into(), 2);
        crate::db::repos::TemplateRepo::insert(&conn, &t1, &[], &[], None).expect("insert t1");
        crate::db::repos::TemplateRepo::insert(&conn, &t2, &[], &[], None).expect("insert t2");

        SetRepo::add_template(&conn, &set.id, &t1.id).expect("add t1");
        SetRepo::add_template(&conn, &set.id, &t2.id).expect("add t2");

        let v1 = Variant::new(
            t1.id,
            HashMap::new(),
            HashMap::new(),
            10.0,
            None,
            None,
            None,
            None,
            1,
        );
        let v2 = Variant::new(
            t2.id,
            HashMap::new(),
            HashMap::new(),
            20.0,
            None,
            None,
            None,
            None,
            2,
        );
        VariantRepo::insert(&conn, &v1).expect("insert v1");
        VariantRepo::insert(&conn, &v2).expect("insert v2");

        let variants = VariantRepo::list_by_set(&conn, &set.id).expect("list");
        assert_eq!(variants.len(), 2);
    }
}
