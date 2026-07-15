use crate::db::DbError;
use crate::models::{Projekt, TemplateMode};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct ProjektRepo;

impl ProjektRepo {
    pub fn insert(conn: &Connection, p: &Projekt) -> Result<(), DbError> {
        if p.name.trim().is_empty() {
            return Err(DbError::Validation("Projekt name must not be empty".into()));
        }
        conn.execute(
            "INSERT INTO projekty (id, name, file_path, question_count, mode, topic_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                p.id,
                p.name,
                p.file_path,
                p.question_count as i64,
                mode_to_str(&p.mode),
                p.topic_name.as_deref(),
                p.created_at.to_rfc3339(),
                p.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_all(conn: &Connection) -> Result<Vec<Projekt>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, name, file_path, question_count, mode, topic_name, created_at, updated_at
             FROM projekty ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Projekt {
                id: row.get(0)?,
                name: row.get(1)?,
                file_path: row.get(2)?,
                question_count: row.get::<_, i64>(3)? as u32,
                mode: str_to_mode(&row.get::<_, String>(4)?),
                topic_name: row.get(5)?,
                created_at: parse_dt(row.get::<_, String>(6)?),
                updated_at: parse_dt(row.get::<_, String>(7)?),
            })
        })?;
        let mut projekty = Vec::new();
        for r in rows {
            projekty.push(r?);
        }
        Ok(projekty)
    }

    pub fn get_by_id(conn: &Connection, id: &Uuid) -> Result<Projekt, DbError> {
        conn.query_row(
            "SELECT id, name, file_path, question_count, mode, topic_name, created_at, updated_at
             FROM projekty WHERE id = ?1",
            params![id],
            |row| {
                Ok(Projekt {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    file_path: row.get(2)?,
                    question_count: row.get::<_, i64>(3)? as u32,
                    mode: str_to_mode(&row.get::<_, String>(4)?),
                    topic_name: row.get(5)?,
                    created_at: parse_dt(row.get::<_, String>(6)?),
                    updated_at: parse_dt(row.get::<_, String>(7)?),
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound(format!("Projekt {id}")),
            other => DbError::Sqlite(other),
        })
    }

    pub fn update(conn: &Connection, p: &Projekt) -> Result<(), DbError> {
        if p.name.trim().is_empty() {
            return Err(DbError::Validation("Projekt name must not be empty".into()));
        }
        let affected = conn.execute(
            "UPDATE projekty SET name=?2, file_path=?3, question_count=?4, mode=?5, \
             topic_name=?6, created_at=?7, updated_at=?8 WHERE id=?1",
            params![
                p.id,
                p.name,
                p.file_path,
                p.question_count as i64,
                mode_to_str(&p.mode),
                p.topic_name.as_deref(),
                p.created_at.to_rfc3339(),
                p.updated_at.to_rfc3339(),
            ],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Projekt {}", p.id)));
        }
        Ok(())
    }

    pub fn delete(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let affected = conn.execute("DELETE FROM projekty WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Projekt {id}")));
        }
        Ok(())
    }
}

fn mode_to_str(mode: &TemplateMode) -> &'static str {
    match mode {
        TemplateMode::Closed => "closed",
        TemplateMode::Open => "open",
    }
}

fn str_to_mode(s: &str) -> TemplateMode {
    match s {
        "closed" => TemplateMode::Closed,
        "open" => TemplateMode::Open,
        other => panic!("invalid TemplateMode value in DB: {other}"),
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
    use chrono::Utc;
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn sample_projekt(name: &str, _order: u32) -> Projekt {
        Projekt {
            id: Uuid::new_v4(),
            name: name.into(),
            file_path: format!("/tmp/projekty/{}.json", name),
            question_count: 5,
            mode: TemplateMode::Closed,
            topic_name: Some("Kinematika".into()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn insert_and_get_by_id() {
        let conn = setup_conn();
        let p = sample_projekt("Testovaci projekt", 1);
        ProjektRepo::insert(&conn, &p).expect("insert");
        let fetched = ProjektRepo::get_by_id(&conn, &p.id).expect("get");
        assert_eq!(fetched.name, "Testovaci projekt");
        assert_eq!(fetched.file_path, p.file_path);
        assert_eq!(fetched.question_count, 5);
        assert_eq!(fetched.mode, TemplateMode::Closed);
        assert_eq!(fetched.topic_name, Some("Kinematika".into()));
    }

    #[test]
    fn insert_rejects_empty_name() {
        let conn = setup_conn();
        let mut p = sample_projekt("", 1);
        p.name = "".into();
        let err = ProjektRepo::insert(&conn, &p);
        assert!(err.is_err());
        match err.unwrap_err() {
            DbError::Validation(msg) => assert!(msg.contains("empty")),
            other => panic!("expected Validation error, got {other:?}"),
        }
    }

    #[test]
    fn list_all_returns_ordered_by_updated_at_desc() {
        let conn = setup_conn();
        let mut p1 = sample_projekt("Alpha", 1);
        let mut p2 = sample_projekt("Beta", 2);
        let mut p3 = sample_projekt("Gamma", 3);

        // Set updated_at so that p3 is newest, then p1, then p2 (oldest).
        p2.updated_at = Utc::now() - chrono::Duration::hours(2);
        p1.updated_at = Utc::now() - chrono::Duration::hours(1);
        p3.updated_at = Utc::now();

        ProjektRepo::insert(&conn, &p1).expect("insert p1");
        ProjektRepo::insert(&conn, &p2).expect("insert p2");
        ProjektRepo::insert(&conn, &p3).expect("insert p3");

        let all = ProjektRepo::list_all(&conn).expect("list");
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].name, "Gamma"); // newest first
        assert_eq!(all[1].name, "Alpha");
        assert_eq!(all[2].name, "Beta"); // oldest last
    }

    #[test]
    fn update_changes_name_and_updated_at() {
        let conn = setup_conn();
        let mut p = sample_projekt("Puvodni nazev", 1);
        ProjektRepo::insert(&conn, &p).expect("insert");

        let new_name = "Zmeneny nazev".to_string();
        p.name = new_name.clone();
        p.updated_at = Utc::now() + chrono::Duration::minutes(5);
        ProjektRepo::update(&conn, &p).expect("update");

        let fetched = ProjektRepo::get_by_id(&conn, &p.id).expect("get");
        assert_eq!(fetched.name, new_name);
        assert!(fetched.updated_at > p.created_at);
    }

    #[test]
    fn delete_removes_projekt() {
        let conn = setup_conn();
        let p = sample_projekt("Ke smazani", 1);
        ProjektRepo::insert(&conn, &p).expect("insert");
        ProjektRepo::delete(&conn, &p.id).expect("delete");
        let result = ProjektRepo::get_by_id(&conn, &p.id);
        assert!(result.is_err());
        match result.unwrap_err() {
            DbError::NotFound(msg) => assert!(msg.contains(&p.id.to_string())),
            other => panic!("expected NotFound error, got {other:?}"),
        }
    }

    #[test]
    fn delete_nonexistent_returns_not_found() {
        let conn = setup_conn();
        let result = ProjektRepo::delete(&conn, &Uuid::new_v4());
        assert!(result.is_err());
        match result.unwrap_err() {
            DbError::NotFound(_) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn get_by_id_nonexistent_returns_not_found() {
        let conn = setup_conn();
        let result = ProjektRepo::get_by_id(&conn, &Uuid::new_v4());
        assert!(result.is_err());
        match result.unwrap_err() {
            DbError::NotFound(_) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }
}
