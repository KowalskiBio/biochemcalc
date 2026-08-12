use crate::db::DbError;
use crate::models::{TemplateDecoy, TemplateDecoyInput};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct TemplateDecoyRepo;

impl TemplateDecoyRepo {
    pub fn list_by_template(
        conn: &Connection,
        template_id: &Uuid,
    ) -> Result<Vec<TemplateDecoy>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, template_id, formula, option_count, position
             FROM template_decoys WHERE template_id = ?1 ORDER BY position ASC",
        )?;
        let rows = stmt.query_map(params![template_id], |row| {
            Ok(TemplateDecoy {
                id: row.get(0)?,
                template_id: row.get(1)?,
                formula: row.get(2)?,
                option_count: row.get(3)?,
                position: row.get(4)?,
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    /// Delete-then-reinsert, positions taken from list order. Call inside the
    /// same transaction as the owning `templates` UPDATE so a decoy list edit
    /// is atomic with the rest of the template save.
    pub fn replace_for_template(
        conn: &Connection,
        template_id: &Uuid,
        decoys: &[TemplateDecoyInput],
    ) -> Result<(), DbError> {
        conn.execute(
            "DELETE FROM template_decoys WHERE template_id = ?1",
            params![template_id],
        )?;
        for (position, decoy) in decoys.iter().enumerate() {
            conn.execute(
                "INSERT INTO template_decoys (id, template_id, formula, option_count, position)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    Uuid::new_v4(),
                    template_id,
                    decoy.formula,
                    decoy.option_count,
                    position as i32,
                ],
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Template;

    fn setup_conn_with_template() -> (Connection, Uuid) {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk on");

        let t = Template::new("Q?".into(), "X * 2".into(), "".into(), None, "g".into(), 2);
        crate::db::repos::TemplateRepo::insert(&conn, &t, &[], &[], None, &[])
            .expect("insert template");
        (conn, t.id)
    }

    #[test]
    fn list_by_template_returns_empty_for_no_decoys() {
        let (conn, template_id) = setup_conn_with_template();
        let decoys = TemplateDecoyRepo::list_by_template(&conn, &template_id).expect("list");
        assert!(decoys.is_empty());
    }

    #[test]
    fn replace_for_template_deletes_and_reinserts_in_position_order() {
        let (conn, template_id) = setup_conn_with_template();

        TemplateDecoyRepo::replace_for_template(
            &conn,
            &template_id,
            &[
                TemplateDecoyInput {
                    formula: "X * 3".into(),
                    option_count: 1,
                },
                TemplateDecoyInput {
                    formula: "X * 5".into(),
                    option_count: 2,
                },
            ],
        )
        .expect("first replace");

        let decoys = TemplateDecoyRepo::list_by_template(&conn, &template_id).expect("list");
        assert_eq!(decoys.len(), 2);
        assert_eq!(decoys[0].formula, "X * 3");
        assert_eq!(decoys[0].position, 0);
        assert_eq!(decoys[1].formula, "X * 5");
        assert_eq!(decoys[1].position, 1);

        // A second replace with a reordered, shorter list must fully
        // supersede the first — no leftover rows, positions renumbered.
        TemplateDecoyRepo::replace_for_template(
            &conn,
            &template_id,
            &[TemplateDecoyInput {
                formula: "X * 7".into(),
                option_count: 3,
            }],
        )
        .expect("second replace");

        let decoys = TemplateDecoyRepo::list_by_template(&conn, &template_id).expect("list");
        assert_eq!(decoys.len(), 1);
        assert_eq!(decoys[0].formula, "X * 7");
        assert_eq!(decoys[0].option_count, 3);
        assert_eq!(decoys[0].position, 0);
    }
}
