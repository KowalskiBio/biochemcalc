use crate::db::DbError;
use crate::models::Topic;
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct TopicRepo;

impl TopicRepo {
    pub fn insert(conn: &Connection, topic: &Topic) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO topics (id, name, created_at, for_students) VALUES (?1, ?2, ?3, ?4)",
            params![topic.id, topic.name, topic.created_at.to_rfc3339(), topic.for_students as i32],
        )?;
        Ok(())
    }

    pub fn list_all(conn: &Connection) -> Result<Vec<Topic>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at, for_students FROM topics ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Topic {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: parse_dt(row.get::<_, String>(2)?),
                for_students: row.get::<_, i32>(3)? != 0,
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
            "SELECT id, name, created_at, for_students FROM topics WHERE id = ?1",
            params![id],
            |row| {
                Ok(Topic {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: parse_dt(row.get::<_, String>(2)?),
                    for_students: row.get::<_, i32>(3)? != 0,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound(format!("Topic {id}")),
            other => DbError::Sqlite(other),
        })
    }

    pub fn update(conn: &Connection, topic: &Topic) -> Result<(), DbError> {
        let affected = conn.execute(
            "UPDATE topics SET name=?2, created_at=?3, for_students=?4 WHERE id=?1",
            params![topic.id, topic.name, topic.created_at.to_rfc3339(), topic.for_students as i32],
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
}
