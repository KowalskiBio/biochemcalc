use crate::db::DbError;
use crate::models::{Category, Set, TemplateMode};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct CategoryRepo;

impl CategoryRepo {
    /// Create a category under a topic and auto-generate 4 sets (3 closed, 1 open).
    pub fn create(
        conn: &Connection,
        topic_id: Uuid,
        point_value: u8,
    ) -> Result<(Category, Vec<Set>), DbError> {
        if ![2, 3, 4].contains(&point_value) {
            return Err(DbError::Validation("Point value must be 2, 3, or 4".into()));
        }

        let category = Category::new(topic_id, point_value);
        let tx = conn.unchecked_transaction()?;

        tx.execute(
            "INSERT INTO categories (id, topic_id, point_value, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![category.id, category.topic_id, category.point_value, category.created_at.to_rfc3339()],
        )?;

        let sets = Self::create_sets_in_tx(&tx, category.id)?;
        tx.commit()?;

        Ok((category, sets))
    }

    fn create_sets_in_tx(
        tx: &rusqlite::Transaction,
        category_id: Uuid,
    ) -> Result<Vec<Set>, DbError> {
        let modes = [
            TemplateMode::Closed,
            TemplateMode::Closed,
            TemplateMode::Closed,
            TemplateMode::Open,
        ];
        let mut sets = Vec::new();
        for (i, &mode) in modes.iter().enumerate() {
            let set_index = (i + 1) as u8;
            let set = Set::new(category_id, set_index, mode);
            tx.execute(
                "INSERT INTO sets (id, category_id, set_index, mode) VALUES (?1, ?2, ?3, ?4)",
                params![set.id, set.category_id, set.set_index, serde_mode(set.mode)],
            )?;
            sets.push(set);
        }
        Ok(sets)
    }

    pub fn list_all(conn: &Connection) -> Result<Vec<Category>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, topic_id, point_value, created_at FROM categories ORDER BY point_value ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                topic_id: row.get(1)?,
                point_value: row.get(2)?,
                created_at: parse_dt(row.get::<_, String>(3)?),
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn list_by_topic(conn: &Connection, topic_id: &Uuid) -> Result<Vec<Category>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, topic_id, point_value, created_at FROM categories WHERE topic_id = ?1 ORDER BY point_value ASC",
        )?;
        let rows = stmt.query_map(params![topic_id], |row| {
            Ok(Category {
                id: row.get(0)?,
                topic_id: row.get(1)?,
                point_value: row.get(2)?,
                created_at: parse_dt(row.get::<_, String>(3)?),
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn get_by_id(conn: &Connection, id: &Uuid) -> Result<Category, DbError> {
        conn.query_row(
            "SELECT id, topic_id, point_value, created_at FROM categories WHERE id = ?1",
            params![id],
            |row| {
                Ok(Category {
                    id: row.get(0)?,
                    topic_id: row.get(1)?,
                    point_value: row.get(2)?,
                    created_at: parse_dt(row.get::<_, String>(3)?),
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound(format!("Category {id}")),
            other => DbError::Sqlite(other),
        })
    }

    /// Get a category together with its 4 sets.
    pub fn get_with_sets(
        conn: &Connection,
        category_id: &Uuid,
    ) -> Result<(Category, Vec<Set>), DbError> {
        let category = Self::get_by_id(conn, category_id)?;
        let sets = Self::get_sets_for_category(conn, category_id)?;
        Ok((category, sets))
    }

    pub fn get_sets_for_category(
        conn: &Connection,
        category_id: &Uuid,
    ) -> Result<Vec<Set>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, category_id, set_index, mode
             FROM sets WHERE category_id = ?1 ORDER BY set_index ASC",
        )?;
        let rows = stmt.query_map(params![category_id], |row| {
            Ok(Set {
                id: row.get(0)?,
                category_id: row.get(1)?,
                set_index: row.get(2)?,
                mode: parse_mode(&row.get::<_, String>(3)?),
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn delete(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let affected = conn.execute("DELETE FROM categories WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Category {id}")));
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

fn parse_mode(s: &str) -> TemplateMode {
    match s {
        "open" => TemplateMode::Open,
        _ => TemplateMode::Closed,
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
    use crate::models::Topic;
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn seed_topic(conn: &Connection) -> Topic {
        let t = Topic::new("Test Topic".into());
        crate::db::repos::TopicRepo::insert(conn, &t).expect("insert topic");
        t
    }

    #[test]
    fn create_category_produces_4_sets_with_correct_modes() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create");
        assert_eq!(cat.topic_id, topic.id);
        assert_eq!(cat.point_value, 2);
        assert_eq!(sets.len(), 4);
        assert_eq!(sets[0].mode, TemplateMode::Closed);
        assert_eq!(sets[1].mode, TemplateMode::Closed);
        assert_eq!(sets[2].mode, TemplateMode::Closed);
        assert_eq!(sets[3].mode, TemplateMode::Open);
        assert_eq!(sets[0].set_index, 1);
        assert_eq!(sets[3].set_index, 4);
    }

    #[test]
    fn create_invalid_point_value_fails() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let result = CategoryRepo::create(&conn, topic.id, 5);
        assert!(result.is_err());
    }

    #[test]
    fn get_with_sets_returns_category_and_sets() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat, _) = CategoryRepo::create(&conn, topic.id, 3).expect("create");
        let (fetched, fetched_sets) = CategoryRepo::get_with_sets(&conn, &cat.id).expect("get");
        assert_eq!(fetched.point_value, 3);
        assert_eq!(fetched_sets.len(), 4);
    }

    #[test]
    fn list_all_and_by_topic_returns_categories() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        CategoryRepo::create(&conn, topic.id, 2).expect("create 2");
        CategoryRepo::create(&conn, topic.id, 4).expect("create 4");
        let all = CategoryRepo::list_all(&conn).expect("list");
        assert_eq!(all.len(), 2);
        let by_topic = CategoryRepo::list_by_topic(&conn, &topic.id).expect("by topic");
        assert_eq!(by_topic.len(), 2);
    }

    #[test]
    fn delete_removes_category_and_sets() {
        let conn = setup_conn();
        let topic = seed_topic(&conn);
        let (cat, _) = CategoryRepo::create(&conn, topic.id, 2).expect("create");
        CategoryRepo::delete(&conn, &cat.id).expect("delete");
        let result = CategoryRepo::get_by_id(&conn, &cat.id);
        assert!(result.is_err());
    }
}
