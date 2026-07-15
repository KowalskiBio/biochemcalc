use crate::db::DbError;
use crate::models::{Constant, ATOMIC_ELEMENTS};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct ConstantRepo;

impl ConstantRepo {
    /// Insert a single constant.
    pub fn insert(conn: &Connection, c: &Constant) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO constants (id, name, symbol, value, unit, is_builtin, formula, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                c.id,
                c.name,
                c.symbol,
                c.value,
                c.unit,
                c.is_builtin as i32,
                c.formula,
                c.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// Seed the built-in constants if the constants table is empty.
    /// Returns the number of constants inserted.
    pub fn seed_builtins_if_empty(conn: &Connection) -> Result<usize, DbError> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM constants WHERE is_builtin = 1",
            [],
            |row| row.get(0),
        )?;
        if count > 0 {
            return Ok(0);
        }
        let builtins = Constant::builtin_constants();
        let mut inserted = 0;
        for c in &builtins {
            Self::insert(conn, c)?;
            inserted += 1;
        }
        Ok(inserted)
    }

    pub fn seed_atomic_weights_if_missing(conn: &Connection) -> Result<usize, DbError> {
        let mut inserted = 0;
        for (symbol, name, weight) in ATOMIC_ELEMENTS.iter().copied() {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM constants WHERE symbol = ?1",
                params![symbol],
                |row| row.get(0),
            )?;
            if exists > 0 {
                continue;
            }
            let mut constant = Constant::new(
                name.to_string(),
                symbol.to_string(),
                weight,
                "g/mol".to_string(),
                false,
            );
            constant.formula = Some(symbol.to_string());
            Self::insert(conn, &constant)?;
            inserted += 1;
        }
        Ok(inserted)
    }

    pub fn list_all(conn: &Connection) -> Result<Vec<Constant>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, name, symbol, value, unit, is_builtin, formula, created_at
             FROM constants ORDER BY is_builtin DESC, created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Constant {
                id: row.get(0)?,
                name: row.get(1)?,
                symbol: row.get(2)?,
                value: row.get(3)?,
                unit: row.get(4)?,
                is_builtin: row.get::<_, i32>(5)? != 0,
                formula: row.get(6)?,
                created_at: parse_dt(row.get::<_, String>(7)?),
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn get_by_id(conn: &Connection, id: &Uuid) -> Result<Constant, DbError> {
        conn.query_row(
            "SELECT id, name, symbol, value, unit, is_builtin, formula, created_at
             FROM constants WHERE id = ?1",
            params![id],
            |row| {
                Ok(Constant {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    symbol: row.get(2)?,
                    value: row.get(3)?,
                    unit: row.get(4)?,
                    is_builtin: row.get::<_, i32>(5)? != 0,
                    formula: row.get(6)?,
                    created_at: parse_dt(row.get::<_, String>(7)?),
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound(format!("Constant {id}")),
            other => DbError::Sqlite(other),
        })
    }

    pub fn update(conn: &Connection, c: &Constant) -> Result<(), DbError> {
        let affected = conn.execute(
            "UPDATE constants SET name=?2, symbol=?3, value=?4, unit=?5, is_builtin=?6, \
             formula=?7, created_at=?8 WHERE id=?1",
            params![
                c.id,
                c.name,
                c.symbol,
                c.value,
                c.unit,
                c.is_builtin as i32,
                c.formula,
                c.created_at.to_rfc3339(),
            ],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Constant {}", c.id)));
        }
        Ok(())
    }

    pub fn delete(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let affected = conn.execute("DELETE FROM constants WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Constant {id}")));
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
    fn seed_builtins_on_empty_db() {
        let conn = setup_conn();
        let count = ConstantRepo::seed_builtins_if_empty(&conn).expect("seed");
        assert_eq!(count, 5);
    }

    #[test]
    fn seed_builtins_idempotent() {
        let conn = setup_conn();
        ConstantRepo::seed_builtins_if_empty(&conn).expect("first seed");
        let count = ConstantRepo::seed_builtins_if_empty(&conn).expect("second seed");
        assert_eq!(count, 0);
    }

    #[test]
    fn insert_and_list() {
        let conn = setup_conn();
        let c = Constant::new("Test".into(), "T".into(), 42.0, "".into(), false);
        ConstantRepo::insert(&conn, &c).expect("insert");
        let all = ConstantRepo::list_all(&conn).expect("list");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].symbol, "T");
    }

    #[test]
    fn delete_non_builtin_works() {
        let conn = setup_conn();
        let c = Constant::new("Del".into(), "D".into(), 1.0, "".into(), false);
        ConstantRepo::insert(&conn, &c).expect("insert");
        ConstantRepo::delete(&conn, &c.id).expect("delete");
        let result = ConstantRepo::get_by_id(&conn, &c.id);
        assert!(result.is_err());
    }

    #[test]
    fn delete_builtin_works() {
        let conn = setup_conn();
        ConstantRepo::seed_builtins_if_empty(&conn).expect("seed");
        let all = ConstantRepo::list_all(&conn).expect("list");
        let builtin = all
            .iter()
            .find(|c| c.is_builtin)
            .expect("at least one builtin");
        ConstantRepo::delete(&conn, &builtin.id).expect("delete builtin");
        let result = ConstantRepo::get_by_id(&conn, &builtin.id);
        assert!(result.is_err());
    }

    #[test]
    fn seed_atomic_weights_inserts_all_elements() {
        let conn = setup_conn();
        ConstantRepo::seed_builtins_if_empty(&conn).expect("seed builtins");
        let inserted =
            ConstantRepo::seed_atomic_weights_if_missing(&conn).expect("seed atomic weights");
        assert_eq!(inserted, ATOMIC_ELEMENTS.len());

        let all = ConstantRepo::list_all(&conn).expect("list");
        let atomic_weights: Vec<_> = all
            .into_iter()
            .filter(|c| !c.is_builtin && c.unit == "g/mol")
            .collect();
        assert_eq!(atomic_weights.len(), ATOMIC_ELEMENTS.len());

        let hydrogen = atomic_weights
            .iter()
            .find(|c| c.symbol == "H")
            .expect("hydrogen seeded");
        assert!((hydrogen.value - 1.01).abs() < f64::EPSILON);
    }

    #[test]
    fn seed_atomic_weights_is_idempotent() {
        let conn = setup_conn();
        ConstantRepo::seed_builtins_if_empty(&conn).expect("seed builtins");
        ConstantRepo::seed_atomic_weights_if_missing(&conn).expect("first seed");
        let second = ConstantRepo::seed_atomic_weights_if_missing(&conn).expect("second seed");
        assert_eq!(second, 0);
    }
}
