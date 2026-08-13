use crate::db::DbError;
use crate::models::TopicGroup;
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct TopicGroupRepo;

impl TopicGroupRepo {
    pub fn insert(conn: &Connection, group: &TopicGroup) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO topic_groups (id, name, position, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![group.id, group.name, group.position, group.created_at.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn list_all(conn: &Connection) -> Result<Vec<TopicGroup>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, name, position, created_at FROM topic_groups ORDER BY position ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TopicGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                position: row.get(2)?,
                created_at: parse_dt(row.get::<_, String>(3)?),
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn rename(conn: &Connection, id: &Uuid, name: &str) -> Result<(), DbError> {
        let affected = conn.execute(
            "UPDATE topic_groups SET name = ?1 WHERE id = ?2",
            params![name, id],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("TopicGroup {id}")));
        }
        Ok(())
    }

    /// `ON DELETE SET NULL` on `topics.group_id` ungroups member topics at
    /// the DB level — no extra logic needed here.
    pub fn delete(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let affected = conn.execute("DELETE FROM topic_groups WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("TopicGroup {id}")));
        }
        Ok(())
    }

    /// Whole-list-replace reorder, mirroring `SetRepo::reorder`. Pass the
    /// full ordered group id list.
    pub fn reorder(conn: &Connection, group_ids: &[Uuid]) -> Result<(), DbError> {
        let tx = conn.unchecked_transaction()?;
        for (i, gid) in group_ids.iter().enumerate() {
            let affected = tx.execute(
                "UPDATE topic_groups SET position = ?1 WHERE id = ?2",
                params![i as i32, gid],
            )?;
            if affected == 0 {
                return Err(DbError::NotFound(format!("TopicGroup {gid}")));
            }
        }
        tx.commit()?;
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
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk on");
        conn
    }

    #[test]
    fn insert_and_list_groups_ordered_by_position() {
        let conn = setup_conn();
        let mut a = TopicGroup::new("2026/2027".into());
        a.position = 1;
        let mut b = TopicGroup::new("2025/2026".into());
        b.position = 0;
        TopicGroupRepo::insert(&conn, &a).expect("insert a");
        TopicGroupRepo::insert(&conn, &b).expect("insert b");

        let all = TopicGroupRepo::list_all(&conn).expect("list");
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, b.id, "position 0 should come first");
        assert_eq!(all[1].id, a.id);
    }

    #[test]
    fn rename_updates_name() {
        let conn = setup_conn();
        let group = TopicGroup::new("Old name".into());
        TopicGroupRepo::insert(&conn, &group).expect("insert");
        TopicGroupRepo::rename(&conn, &group.id, "New name").expect("rename");
        let all = TopicGroupRepo::list_all(&conn).expect("list");
        assert_eq!(all[0].name, "New name");
    }

    #[test]
    fn rename_unknown_group_is_not_found() {
        let conn = setup_conn();
        let result = TopicGroupRepo::rename(&conn, &Uuid::new_v4(), "X");
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    #[test]
    fn delete_removes_group_and_ungroups_topics() {
        let conn = setup_conn();
        let group = TopicGroup::new("Group".into());
        TopicGroupRepo::insert(&conn, &group).expect("insert group");

        let mut topic = crate::models::Topic::new("Topic".into());
        topic.group_id = Some(group.id);
        crate::db::repos::TopicRepo::insert(&conn, &topic).expect("insert topic");

        TopicGroupRepo::delete(&conn, &group.id).expect("delete group");

        let fetched = crate::db::repos::TopicRepo::get_by_id(&conn, &topic.id).expect("get topic");
        assert_eq!(fetched.group_id, None, "topic must be ungrouped, not deleted");
    }

    #[test]
    fn reorder_updates_positions() {
        let conn = setup_conn();
        let a = TopicGroup::new("A".into());
        let b = TopicGroup::new("B".into());
        let c = TopicGroup::new("C".into());
        TopicGroupRepo::insert(&conn, &a).expect("insert a");
        TopicGroupRepo::insert(&conn, &b).expect("insert b");
        TopicGroupRepo::insert(&conn, &c).expect("insert c");

        TopicGroupRepo::reorder(&conn, &[c.id, a.id, b.id]).expect("reorder");

        let all = TopicGroupRepo::list_all(&conn).expect("list");
        assert_eq!(all.iter().map(|g| g.id).collect::<Vec<_>>(), vec![c.id, a.id, b.id]);
    }
}
