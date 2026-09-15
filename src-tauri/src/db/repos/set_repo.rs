use crate::db::DbError;
use crate::models::{SetTemplate, TemplateMode};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct SetRepo;

impl SetRepo {
    /// Append a new set to a category with the next available set_index.
    pub fn create(
        conn: &Connection,
        category_id: Uuid,
        mode: TemplateMode,
        name: Option<&str>,
    ) -> Result<crate::models::Set, DbError> {
        let next_index: u8 = conn
            .query_row(
                "SELECT COALESCE(MAX(set_index), 0) + 1 FROM sets WHERE category_id = ?1",
                params![category_id],
                |row| row.get(0),
            )
            .unwrap_or(1);

        let mut set = crate::models::Set::new(category_id, next_index, mode);
        set.name = name.map(|n| crate::util::normalize_name_dashes(n));
        conn.execute(
            "INSERT INTO sets (id, category_id, set_index, mode, name) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                set.id,
                set.category_id,
                set.set_index,
                serde_mode(set.mode),
                set.name
            ],
        )?;
        Ok(set)
    }

    /// Copy (link) every template from `source_set_id` into `target_set_id`,
    /// appended after the target's existing templates. The source set is left
    /// untouched and templates already present in the target are skipped.
    /// All of the source's templates adopt the target category's point value.
    /// Returns the number of newly linked templates.
    pub fn merge_into(
        conn: &Connection,
        source_set_id: &Uuid,
        target_set_id: &Uuid,
    ) -> Result<u32, DbError> {
        if source_set_id == target_set_id {
            return Ok(0);
        }
        let tx = conn.unchecked_transaction()?;

        let target_point_value: u8 = tx.query_row(
            "SELECT c.point_value FROM categories c
             INNER JOIN sets s ON s.category_id = c.id
             WHERE s.id = ?1",
            params![target_set_id],
            |row| row.get(0),
        )?;

        let offset: u32 = tx
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM set_templates WHERE set_id = ?1",
                params![target_set_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let inserted = tx.execute(
            "INSERT OR IGNORE INTO set_templates (set_id, template_id, sort_order)
             SELECT ?1, st.template_id, st.sort_order + ?2
             FROM set_templates st WHERE st.set_id = ?3 ORDER BY st.sort_order",
            params![target_set_id, offset, source_set_id],
        )?;

        tx.execute(
            "UPDATE templates SET point_value = ?1 WHERE id IN (
                SELECT st.template_id FROM set_templates st WHERE st.set_id = ?2
            )",
            params![target_point_value, source_set_id],
        )?;

        tx.commit()?;
        Ok(inserted as u32)
    }

    /// Create a new set (with optional name) whose templates are links to
    /// every template of the given source sets, in the order the sources were
    /// passed. Duplicates across sources are linked only once. All sources
    /// must live in `category_id` so the shared templates' point values stay
    /// consistent with the new set's category.
    pub fn create_aggregate(
        conn: &Connection,
        category_id: Uuid,
        mode: TemplateMode,
        name: Option<&str>,
        source_set_ids: &[Uuid],
    ) -> Result<crate::models::Set, DbError> {
        if source_set_ids.is_empty() {
            return Err(DbError::Validation(
                "Aggregate set needs at least one source set".into(),
            ));
        }
        let tx = conn.unchecked_transaction()?;

        for sid in source_set_ids {
            let source_category: Uuid = tx.query_row(
                "SELECT category_id FROM sets WHERE id = ?1",
                params![sid],
                |row| row.get(0),
            )?;
            if source_category != category_id {
                return Err(DbError::Validation(
                    "Aggregate sources must be in the same category as the new set".into(),
                ));
            }
        }

        let set = Self::create(&tx, category_id, mode, name)?;

        for sid in source_set_ids {
            let next_order: u32 = tx
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM set_templates WHERE set_id = ?1",
                    params![set.id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            tx.execute(
                "INSERT OR IGNORE INTO set_templates (set_id, template_id, sort_order)
                 SELECT ?1, st.template_id, st.sort_order + ?2
                 FROM set_templates st WHERE st.set_id = ?3 ORDER BY st.sort_order",
                params![set.id, next_order, sid],
            )?;
        }

        tx.commit()?;
        Ok(set)
    }

    /// Raw single-row insert with an explicit `set_index`/`mode`/`name` —
    /// unlike `create` (which always auto-computes the next index). Used by
    /// topic duplication to replicate the source topic's exact set list.
    pub fn insert(conn: &Connection, set: &crate::models::Set) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO sets (id, category_id, set_index, mode, name) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                set.id,
                set.category_id,
                set.set_index,
                serde_mode(set.mode),
                set.name
            ],
        )?;
        Ok(())
    }

    /// Raw `set_templates` insert with an explicit `sort_order` — unlike
    /// `add_template` (which always auto-appends at `MAX+1`). Used by topic
    /// duplication to preserve the source set's exact template ordering.
    pub fn insert_link(
        conn: &Connection,
        set_id: &Uuid,
        template_id: &Uuid,
        sort_order: u32,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO set_templates (set_id, template_id, sort_order) VALUES (?1, ?2, ?3)",
            params![set_id, template_id, sort_order],
        )?;
        Ok(())
    }

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

    pub fn update_name(
        conn: &Connection,
        set_id: &Uuid,
        name: Option<&str>,
    ) -> Result<(), DbError> {
        let normalized = name.map(crate::util::normalize_name_dashes);
        let affected = conn.execute(
            "UPDATE sets SET name = ?1 WHERE id = ?2",
            params![normalized, set_id],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Set {set_id}")));
        }
        Ok(())
    }

    pub fn move_to_category(
        conn: &Connection,
        set_id: &Uuid,
        target_category_id: &Uuid,
    ) -> Result<u8, DbError> {
        let tx = conn.unchecked_transaction()?;

        let target_point_value: u8 = tx.query_row(
            "SELECT point_value FROM categories WHERE id = ?1",
            params![target_category_id],
            |row| row.get(0),
        )?;

        let next_index: u8 = tx
            .query_row(
                "SELECT COALESCE(MAX(set_index), 0) + 1 FROM sets WHERE category_id = ?1",
                params![target_category_id],
                |row| row.get(0),
            )
            .unwrap_or(1);

        tx.execute(
            "UPDATE sets SET category_id = ?1, set_index = ?2 WHERE id = ?3",
            params![target_category_id, next_index, set_id],
        )?;

        tx.execute(
            "UPDATE templates SET point_value = ?1 WHERE id IN (
                SELECT st.template_id FROM set_templates st WHERE st.set_id = ?2
            )",
            params![target_point_value, set_id],
        )?;

        tx.commit()?;
        Ok(next_index)
    }

    /// Delete a set. The `ON DELETE CASCADE` on `set_templates.set_id`
    /// removes the link rows, but the templates themselves are left intact
    /// (they may belong to other sets).
    pub fn delete(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let affected = conn.execute("DELETE FROM sets WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Set {id}")));
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
        crate::db::repos::TemplateRepo::insert(conn, &t, &[], &[], None, &[]).expect("insert tpl");
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

    /// A spaced hyphen in a set name becomes an en dash on the way in, both
    /// when the set is created and when it is later renamed; other hyphen
    /// shapes pass through untouched.
    #[test]
    fn set_names_normalize_spaced_hyphens_to_en_dashes() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (category, _sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");

        let created =
            SetRepo::create(&conn, category.id, TemplateMode::Closed, Some("Sada 1 - směsi"))
                .expect("create set");
        assert_eq!(created.name.as_deref(), Some("Sada 1 \u{2013} směsi"));

        let stored: Option<String> = conn
            .query_row(
                "SELECT name FROM sets WHERE id = ?1",
                params![created.id],
                |row| row.get(0),
            )
            .expect("fetch set");
        assert_eq!(stored.as_deref(), Some("Sada 1 \u{2013} směsi"));

        SetRepo::update_name(&conn, &created.id, Some("Přejmenovaná - sada")).expect("rename");
        let renamed: Option<String> = conn
            .query_row(
                "SELECT name FROM sets WHERE id = ?1",
                params![created.id],
                |row| row.get(0),
            )
            .expect("fetch set");
        assert_eq!(renamed.as_deref(), Some("Přejmenovaná \u{2013} sada"));

        // Compound words and uns spaced hyphens stay as typed.
        SetRepo::update_name(&conn, &created.id, Some("x-y")).expect("rename plain");
        let plain: Option<String> = conn
            .query_row(
                "SELECT name FROM sets WHERE id = ?1",
                params![created.id],
                |row| row.get(0),
            )
            .expect("fetch set");
        assert_eq!(plain.as_deref(), Some("x-y"));
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

    #[test]
    fn create_appends_set_with_next_index_beyond_four() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");
        assert_eq!(sets.len(), 4);

        let fifth =
            SetRepo::create(&conn, cat.id, TemplateMode::Closed, None).expect("create 5th set");
        assert_eq!(fifth.set_index, 5);

        let sixth =
            SetRepo::create(&conn, cat.id, TemplateMode::Open, None).expect("create 6th set");
        assert_eq!(sixth.set_index, 6);
        assert_eq!(sixth.mode, TemplateMode::Open);

        let (_, all_sets) = CategoryRepo::get_with_sets(&conn, &cat.id).expect("get");
        assert_eq!(all_sets.len(), 6);
    }

    #[test]
    fn create_with_name_persists_it() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat, _) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");

        let set = SetRepo::create(&conn, cat.id, TemplateMode::Closed, Some("Opakování"))
            .expect("create named set");
        assert_eq!(set.name.as_deref(), Some("Opakování"));

        let (_, sets) = CategoryRepo::get_with_sets(&conn, &cat.id).expect("get");
        let found = sets.iter().find(|s| s.id == set.id).expect("found");
        assert_eq!(found.name.as_deref(), Some("Opakování"));
    }

    #[test]
    fn delete_removes_set_and_unlinks_templates_but_keeps_them() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");
        let set = &sets[0];

        let t1 = create_template(&conn, "Q1");
        SetRepo::add_template(&conn, &set.id, &t1.id).expect("add t1");

        SetRepo::delete(&conn, &set.id).expect("delete set");

        // The set is gone.
        let (_, remaining) = CategoryRepo::get_with_sets(&conn, &cat.id).expect("get");
        assert!(!remaining.iter().any(|s| s.id == set.id));

        // The link row is gone (cascade).
        let links = SetRepo::list_templates(&conn, &set.id).expect("list");
        assert!(links.is_empty());

        // The template itself still exists.
        let fetched = crate::db::repos::TemplateRepo::get_by_id(&conn, &t1.id).expect("get tpl");
        assert_eq!(fetched.id, t1.id);
    }

    #[test]
    fn delete_unknown_set_returns_not_found() {
        let conn = setup_conn();
        let err = SetRepo::delete(&conn, &Uuid::new_v4()).unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
    }

    #[test]
    fn merge_copies_templates_and_keeps_source() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");
        let source = &sets[0];
        let target = &sets[1];

        let t1 = create_template(&conn, "Q1");
        let t2 = create_template(&conn, "Q2");
        let t3 = create_template(&conn, "Q3");
        SetRepo::add_template(&conn, &source.id, &t1.id).expect("add t1");
        SetRepo::add_template(&conn, &source.id, &t2.id).expect("add t2");
        SetRepo::add_template(&conn, &target.id, &t3.id).expect("add t3");

        let inserted = SetRepo::merge_into(&conn, &source.id, &target.id).expect("merge");
        assert_eq!(inserted, 2);

        // Source untouched.
        let source_items = SetRepo::list_templates(&conn, &source.id).expect("list source");
        assert_eq!(source_items.len(), 2);

        // Target has its own template first, then the merged ones in order.
        let target_items = SetRepo::list_templates(&conn, &target.id).expect("list target");
        assert_eq!(target_items.len(), 3);
        assert_eq!(target_items[0].template_id, t3.id);
        assert_eq!(target_items[1].template_id, t1.id);
        assert_eq!(target_items[2].template_id, t2.id);
    }

    #[test]
    fn merge_dedupes_templates_already_in_target() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");
        let source = &sets[0];
        let target = &sets[1];

        let t1 = create_template(&conn, "Q1");
        SetRepo::add_template(&conn, &source.id, &t1.id).expect("add to source");
        SetRepo::add_template(&conn, &target.id, &t1.id).expect("add to target");

        let inserted = SetRepo::merge_into(&conn, &source.id, &target.id).expect("merge");
        assert_eq!(inserted, 0);
        let target_items = SetRepo::list_templates(&conn, &target.id).expect("list target");
        assert_eq!(target_items.len(), 1);
    }

    #[test]
    fn merge_across_categories_updates_point_values() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat2, sets2) = CategoryRepo::create(&conn, topic.id, 2).expect("create 2b cat");
        let (cat4, sets4) = CategoryRepo::create(&conn, topic.id, 4).expect("create 4b cat");
        let source = &sets2[0];
        let target = &sets4[0];

        let t = create_template(&conn, "Q");
        SetRepo::add_template(&conn, &source.id, &t.id).expect("add");

        SetRepo::merge_into(&conn, &source.id, &target.id).expect("merge");

        let point_value: u8 = conn
            .query_row(
                "SELECT point_value FROM templates WHERE id = ?1",
                params![t.id],
                |row| row.get(0),
            )
            .expect("query point value");
        assert_eq!(point_value, 4);

        // Source keeps its (now re-valued) template; both categories exist.
        assert_eq!(cat2.point_value, 2);
        assert_eq!(cat4.point_value, 4);
        assert_eq!(
            SetRepo::list_templates(&conn, &source.id)
                .expect("list source")
                .len(),
            1
        );
    }

    #[test]
    fn aggregate_links_all_sources_in_order_and_dedupes() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create cat");
        let s1 = &sets[0];
        let s2 = &sets[1];

        let t1 = create_template(&conn, "Q1");
        let t2 = create_template(&conn, "Q2");
        let t3 = create_template(&conn, "Q3");
        SetRepo::add_template(&conn, &s1.id, &t1.id).expect("add t1");
        SetRepo::add_template(&conn, &s1.id, &t2.id).expect("add t2");
        SetRepo::add_template(&conn, &s2.id, &t2.id).expect("add t2 dup");
        SetRepo::add_template(&conn, &s2.id, &t3.id).expect("add t3");

        let agg = SetRepo::create_aggregate(
            &conn,
            cat.id,
            TemplateMode::Open,
            Some("Souhrn"),
            &[s1.id, s2.id],
        )
        .expect("aggregate");
        assert_eq!(agg.name.as_deref(), Some("Souhrn"));
        assert_eq!(agg.mode, TemplateMode::Open);

        let items = SetRepo::list_templates(&conn, &agg.id).expect("list");
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].template_id, t1.id);
        assert_eq!(items[1].template_id, t2.id);
        assert_eq!(items[2].template_id, t3.id);

        // Sources untouched.
        assert_eq!(
            SetRepo::list_templates(&conn, &s1.id)
                .expect("list s1")
                .len(),
            2
        );
    }

    #[test]
    fn aggregate_rejects_foreign_category_and_empty_sources() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat2, _) = CategoryRepo::create(&conn, topic.id, 2).expect("create 2b cat");
        let (cat4, sets4) = CategoryRepo::create(&conn, topic.id, 4).expect("create 4b cat");

        let foreign =
            SetRepo::create_aggregate(&conn, cat2.id, TemplateMode::Closed, None, &[sets4[0].id]);
        assert!(matches!(foreign, Err(DbError::Validation(_))));

        let empty = SetRepo::create_aggregate(&conn, cat2.id, TemplateMode::Closed, None, &[]);
        assert!(matches!(empty, Err(DbError::Validation(_))));
    }
}
