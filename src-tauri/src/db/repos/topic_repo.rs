use crate::db::DbError;
use crate::models::Topic;
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct TopicRepo;

impl TopicRepo {
    pub fn insert(conn: &Connection, topic: &Topic) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO topics (id, name, created_at, for_students, is_test, group_id, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                topic.id,
                topic.name,
                topic.created_at.to_rfc3339(),
                topic.for_students as i32,
                topic.is_test as i32,
                topic.group_id,
                topic.position,
            ],
        )?;
        Ok(())
    }

    pub fn list_all(conn: &Connection) -> Result<Vec<Topic>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at, for_students, is_test, group_id, position FROM topics
             ORDER BY position ASC, created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Topic {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: parse_dt(row.get::<_, String>(2)?),
                for_students: row.get::<_, i32>(3)? != 0,
                is_test: row.get::<_, i32>(4)? != 0,
                group_id: row.get(5)?,
                position: row.get(6)?,
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            let topic = r?;
            if topic.id != Uuid::nil() {
                items.push(topic);
            }
        }
        Ok(items)
    }

    pub fn get_by_id(conn: &Connection, id: &Uuid) -> Result<Topic, DbError> {
        conn.query_row(
            "SELECT id, name, created_at, for_students, is_test, group_id, position FROM topics WHERE id = ?1",
            params![id],
            |row| {
                Ok(Topic {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: parse_dt(row.get::<_, String>(2)?),
                    for_students: row.get::<_, i32>(3)? != 0,
                    is_test: row.get::<_, i32>(4)? != 0,
                    group_id: row.get(5)?,
                    position: row.get(6)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound(format!("Topic {id}")),
            other => DbError::Sqlite(other),
        })
    }

    /// Deliberately never touches `group_id`/`position` — those are managed
    /// exclusively by `move_to_group`/`reorder_within_group`, so a plain
    /// rename (or either flag toggle) never clobbers group membership.
    /// `for_students` and `is_test` are independent: a test-only topic is
    /// not visible in the practice generator.
    pub fn update(conn: &Connection, topic: &Topic) -> Result<(), DbError> {
        let affected = conn.execute(
            "UPDATE topics SET name=?2, created_at=?3, for_students=?4, is_test=?5 WHERE id=?1",
            params![
                topic.id,
                topic.name,
                topic.created_at.to_rfc3339(),
                topic.for_students as i32,
                topic.is_test as i32
            ],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Topic {}", topic.id)));
        }
        Ok(())
    }

    pub fn delete(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let affected = conn.execute("DELETE FROM topics WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Topic {id}")));
        }
        Ok(())
    }

    /// Move a topic into `group_id` (or ungroup it with `None`), appending
    /// it at the end of that bucket's ordering.
    pub fn move_to_group(
        conn: &Connection,
        topic_id: &Uuid,
        group_id: Option<Uuid>,
    ) -> Result<(), DbError> {
        let tx = conn.unchecked_transaction()?;
        let next_position: i32 = tx
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM topics WHERE group_id IS ?1",
                params![group_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let affected = tx.execute(
            "UPDATE topics SET group_id = ?1, position = ?2 WHERE id = ?3",
            params![group_id, next_position, topic_id],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Topic {topic_id}")));
        }
        tx.commit()?;
        Ok(())
    }

    /// Reorder topics within one bucket (a group, or the "unsorted" bucket).
    /// Pass the full ordered id list for that bucket, mirroring
    /// `SetRepo::reorder`'s whole-list-replace convention.
    pub fn reorder_within_group(conn: &Connection, topic_ids: &[Uuid]) -> Result<(), DbError> {
        let tx = conn.unchecked_transaction()?;
        for (i, tid) in topic_ids.iter().enumerate() {
            let affected = tx.execute(
                "UPDATE topics SET position = ?1 WHERE id = ?2",
                params![i as i32, tid],
            )?;
            if affected == 0 {
                return Err(DbError::NotFound(format!("Topic {tid}")));
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
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    #[test]
    fn insert_and_list_topics() {
        let conn = setup_conn();
        let t = Topic::new("Test Topic".into());
        TopicRepo::insert(&conn, &t).expect("insert");
        let all = TopicRepo::list_all(&conn).expect("list");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Test Topic");
        assert!(!all.iter().any(|topic| topic.name == "Default"));
    }

    #[test]
    fn get_by_id_returns_topic() {
        let conn = setup_conn();
        let t = Topic::new("My Topic".into());
        TopicRepo::insert(&conn, &t).expect("insert");
        let fetched = TopicRepo::get_by_id(&conn, &t.id).expect("get");
        assert_eq!(fetched.name, "My Topic");
    }

    #[test]
    fn update_modifies_name() {
        let conn = setup_conn();
        let mut t = Topic::new("Old Name".into());
        TopicRepo::insert(&conn, &t).expect("insert");
        t.name = "New Name".into();
        TopicRepo::update(&conn, &t).expect("update");
        let fetched = TopicRepo::get_by_id(&conn, &t.id).expect("get");
        assert_eq!(fetched.name, "New Name");
    }

    #[test]
    fn delete_removes_topic() {
        let conn = setup_conn();
        let t = Topic::new("To Delete".into());
        TopicRepo::insert(&conn, &t).expect("insert");
        TopicRepo::delete(&conn, &t.id).expect("delete");
        let result = TopicRepo::get_by_id(&conn, &t.id);
        assert!(result.is_err());
    }

    #[test]
    fn for_students_flag_persists() {
        let conn = setup_conn();
        let mut t = Topic::new("Student Topic".into());
        t.for_students = true;
        TopicRepo::insert(&conn, &t).expect("insert");
        let fetched = TopicRepo::get_by_id(&conn, &t.id).expect("get");
        assert!(fetched.for_students);
    }

    #[test]
    fn is_test_flag_persists_independently_of_for_students() {
        let conn = setup_conn();
        let mut t = Topic::new("Test Topic".into());
        t.is_test = true;
        TopicRepo::insert(&conn, &t).expect("insert");
        let fetched = TopicRepo::get_by_id(&conn, &t.id).expect("get");
        assert!(fetched.is_test);
        assert!(
            !fetched.for_students,
            "a test-only topic stays teacher-only"
        );

        // Updating with for_students explicitly false keeps both flags as
        // sent: the two toggles never imply each other.
        TopicRepo::update(&conn, &t).expect("update");
        let fetched = TopicRepo::get_by_id(&conn, &t.id).expect("get again");
        assert!(!fetched.for_students);
        assert!(fetched.is_test);
    }

    #[test]
    fn update_never_touches_group_membership() {
        let conn = setup_conn();
        let group = crate::models::TopicGroup::new("Group".into());
        crate::db::repos::TopicGroupRepo::insert(&conn, &group).expect("insert group");

        let t = Topic::new("Topic".into());
        TopicRepo::insert(&conn, &t).expect("insert topic");
        TopicRepo::move_to_group(&conn, &t.id, Some(group.id)).expect("move to group");

        let mut renamed = TopicRepo::get_by_id(&conn, &t.id).expect("get");
        renamed.name = "Renamed".into();
        TopicRepo::update(&conn, &renamed).expect("update (rename)");

        let fetched = TopicRepo::get_by_id(&conn, &t.id).expect("get after rename");
        assert_eq!(fetched.name, "Renamed");
        assert_eq!(
            fetched.group_id,
            Some(group.id),
            "rename must not ungroup the topic"
        );
    }

    #[test]
    fn move_to_group_appends_at_the_end_of_the_target_bucket() {
        let conn = setup_conn();
        let group = crate::models::TopicGroup::new("Group".into());
        crate::db::repos::TopicGroupRepo::insert(&conn, &group).expect("insert group");

        let first = Topic::new("First".into());
        TopicRepo::insert(&conn, &first).expect("insert first");
        TopicRepo::move_to_group(&conn, &first.id, Some(group.id)).expect("move first");

        let second = Topic::new("Second".into());
        TopicRepo::insert(&conn, &second).expect("insert second");
        TopicRepo::move_to_group(&conn, &second.id, Some(group.id)).expect("move second");

        let first_fetched = TopicRepo::get_by_id(&conn, &first.id).expect("get first");
        let second_fetched = TopicRepo::get_by_id(&conn, &second.id).expect("get second");
        assert_eq!(first_fetched.position, 0);
        assert_eq!(second_fetched.position, 1);
    }

    #[test]
    fn move_to_group_none_ungroups_a_topic() {
        let conn = setup_conn();
        let group = crate::models::TopicGroup::new("Group".into());
        crate::db::repos::TopicGroupRepo::insert(&conn, &group).expect("insert group");

        let t = Topic::new("Topic".into());
        TopicRepo::insert(&conn, &t).expect("insert");
        TopicRepo::move_to_group(&conn, &t.id, Some(group.id)).expect("move into group");
        TopicRepo::move_to_group(&conn, &t.id, None).expect("move to unsorted");

        let fetched = TopicRepo::get_by_id(&conn, &t.id).expect("get");
        assert_eq!(fetched.group_id, None);
    }

    #[test]
    fn reorder_within_group_updates_positions() {
        let conn = setup_conn();
        let a = Topic::new("A".into());
        let b = Topic::new("B".into());
        let c = Topic::new("C".into());
        TopicRepo::insert(&conn, &a).expect("insert a");
        TopicRepo::insert(&conn, &b).expect("insert b");
        TopicRepo::insert(&conn, &c).expect("insert c");

        TopicRepo::reorder_within_group(&conn, &[c.id, a.id, b.id]).expect("reorder");

        let all = TopicRepo::list_all(&conn).expect("list");
        assert_eq!(
            all.iter().map(|t| t.id).collect::<Vec<_>>(),
            vec![c.id, a.id, b.id]
        );
    }
}
