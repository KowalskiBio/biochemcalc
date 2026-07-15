use crate::db::DbError;
use crate::models::{SetTemplate, TemplateMode};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct SetRepo;

impl SetRepo {
    /// Add a template to a set at the end of the ordering.
    pub fn add_template(
        conn: &Connection,
        set_id: &Uuid,
        template_id: &Uuid,
    ) -> Result<SetTemplate, DbError> {
        let next_order: u32 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM set_templates WHERE set_id = ?1",
                params![set_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        conn.execute(
            "INSERT INTO set_templates (set_id, template_id, sort_order) VALUES (?1, ?2, ?3)",
            params![set_id, template_id, next_order],
        )?;

        Ok(SetTemplate::new(*set_id, *template_id, next_order))
    }

    /// Remove a template from a set.
    pub fn remove_template(
        conn: &Connection,
        set_id: &Uuid,
        template_id: &Uuid,
    ) -> Result<(), DbError> {
        let affected = conn.execute(
            "DELETE FROM set_templates WHERE set_id = ?1 AND template_id = ?2",
            params![set_id, template_id],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!(
                "SetTemplate ({set_id}, {template_id})"
            )));
        }
        Ok(())
    }

    /// Reorder templates in a set. Pass the template IDs in the desired order.
    pub fn reorder(conn: &Connection, set_id: &Uuid, template_ids: &[Uuid]) -> Result<(), DbError> {
        let tx = conn.unchecked_transaction()?;
        for (i, tid) in template_ids.iter().enumerate() {
            let affected = tx.execute(
                "UPDATE set_templates SET sort_order = ?1 WHERE set_id = ?2 AND template_id = ?3",
                params![i as u32, set_id, tid],
            )?;
            if affected == 0 {
                return Err(DbError::NotFound(format!("SetTemplate ({set_id}, {tid})")));
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// List all templates in a set, ordered by sort_order.
    pub fn list_templates(conn: &Connection, set_id: &Uuid) -> Result<Vec<SetTemplate>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT set_id, template_id, sort_order
             FROM set_templates WHERE set_id = ?1 ORDER BY sort_order ASC",
        )?;
        let rows = stmt.query_map(params![set_id], |row| {
            Ok(SetTemplate {
                set_id: row.get(0)?,
                template_id: row.get(1)?,
                sort_order: row.get(2)?,
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn find_by_template_id(
        conn: &Connection,
        template_id: &Uuid,
    ) -> Result<Option<(Uuid, Uuid)>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT s.id, s.category_id
             FROM sets s
             INNER JOIN set_templates st ON s.id = st.set_id
             WHERE st.template_id = ?1
             LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![template_id], |row| {
            Ok((row.get::<_, Uuid>(0)?, row.get::<_, Uuid>(1)?))
        })?;
        if let Some(row) = rows.next() {
            return Ok(Some(row?));
        }
        Ok(None)
    }

    /// Update the answer mode for a set.
    pub fn update_mode(
        conn: &Connection,
        set_id: &Uuid,
        mode: TemplateMode,
    ) -> Result<(), DbError> {
        let affected = conn.execute(
            "UPDATE sets SET mode = ?1 WHERE id = ?2",
            params![serde_mode(mode), set_id],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Set {set_id}")));
        }
        Ok(())
    }
}

fn serde_mode(mode: TemplateMode) -> &'static str {
    match mode {
        TemplateMode::Closed => "closed",
        TemplateMode::Open => "open",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::CategoryRepo;
    use crate::models::{Template, Topic};
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn seed_topic(conn: &Connection) -> Topic {
        let t = Topic::new("Test".into());
        crate::db::repos::TopicRepo::insert(conn, &t).expect("insert topic");
        t
    }

    fn create_template(conn: &Connection, text: &str) -> Template {
        let t = Template::new(text.into(), "X".into(), "".into(), None, "g".into(), 2);
        crate::db::repos::TemplateRepo::insert(conn, &t, &[], &[], None).expect("insert tpl");
        t
    }

    #[test]
    fn add_and_list_templates_in_set() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (_, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");
        let set = &sets[0];

        let t1 = create_template(&conn, "Q1");
        let t2 = create_template(&conn, "Q2");

        SetRepo::add_template(&conn, &set.id, &t1.id).expect("add t1");
        SetRepo::add_template(&conn, &set.id, &t2.id).expect("add t2");

        let items = SetRepo::list_templates(&conn, &set.id).expect("list");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].sort_order, 0);
        assert_eq!(items[1].sort_order, 1);
    }

    #[test]
    fn remove_template_from_set() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (_, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");
        let set = &sets[0];
        let t = create_template(&conn, "Q");

        SetRepo::add_template(&conn, &set.id, &t.id).expect("add");
        SetRepo::remove_template(&conn, &set.id, &t.id).expect("remove");

        let items = SetRepo::list_templates(&conn, &set.id).expect("list");
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn reorder_templates() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (_, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");
        let set = &sets[0];

        let t1 = create_template(&conn, "A");
        let t2 = create_template(&conn, "B");
        let t3 = create_template(&conn, "C");

        SetRepo::add_template(&conn, &set.id, &t1.id).expect("add");
        SetRepo::add_template(&conn, &set.id, &t2.id).expect("add");
        SetRepo::add_template(&conn, &set.id, &t3.id).expect("add");

        // Reverse order
        SetRepo::reorder(&conn, &set.id, &[t3.id, t2.id, t1.id]).expect("reorder");

        let items = SetRepo::list_templates(&conn, &set.id).expect("list");
        assert_eq!(items[0].template_id, t3.id);
        assert_eq!(items[1].template_id, t2.id);
        assert_eq!(items[2].template_id, t1.id);
    }

    #[test]
    fn update_mode_on_set() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (_, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");
        let set_id = sets[0].id;

        // The first set is closed by default.
        SetRepo::update_mode(&conn, &set_id, TemplateMode::Open).expect("update mode");

        let (_, updated_sets) =
            CategoryRepo::get_with_sets(&conn, &sets[0].category_id).expect("get");
        assert_eq!(updated_sets[0].mode, TemplateMode::Open);
    }
}
