use crate::db::DbError;
use crate::models::{Variable, VariableType};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct VariableRepo;

impl VariableRepo {
    pub fn insert(conn: &Connection, v: &Variable) -> Result<(), DbError> {
        v.validate().map_err(DbError::Validation)?;
        Self::insert_raw(conn, v)
    }

    /// Insert a variable without running validation (used by importers).
    pub fn insert_raw(conn: &Connection, v: &Variable) -> Result<(), DbError> {
        let string_values_json = v
            .string_values
            .as_ref()
            .map(|values| serde_json::to_string(values).unwrap_or_default())
            .unwrap_or_default();
        let paired_constants_json = v
            .paired_constants
            .as_ref()
            .map(|c| serde_json::to_string(c).unwrap_or_default())
            .unwrap_or_default();
        conn.execute(
            "INSERT INTO variables (id, name, symbol, var_type, min_value, max_value, step, unit, precision, string_values, paired_constants, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                v.id,
                v.name,
                v.symbol,
                var_type_to_str(&v.var_type),
                v.min_value,
                v.max_value,
                v.step,
                v.unit,
                v.precision,
                string_values_json,
                paired_constants_json,
                v.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_all(conn: &Connection) -> Result<Vec<Variable>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, name, symbol, var_type, min_value, max_value, step, unit, precision, string_values, created_at, paired_constants
             FROM variables ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| Ok(parse_variable_row(row)?))?;
        let mut vars = Vec::new();
        for r in rows {
            vars.push(r?);
        }
        Ok(vars)
    }

    pub fn get_by_id(conn: &Connection, id: &Uuid) -> Result<Variable, DbError> {
        conn.query_row(
            "SELECT id, name, symbol, var_type, min_value, max_value, step, unit, precision, string_values, created_at, paired_constants
             FROM variables WHERE id = ?1",
            params![id],
            |row| parse_variable_row(row),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound(format!("Variable {id}")),
            other => DbError::Sqlite(other),
        })
    }

    pub fn update(conn: &Connection, v: &Variable) -> Result<(), DbError> {
        v.validate().map_err(DbError::Validation)?;
        let string_values_json = v
            .string_values
            .as_ref()
            .map(|values| serde_json::to_string(values).unwrap_or_default())
            .unwrap_or_default();
        let paired_constants_json = v
            .paired_constants
            .as_ref()
            .map(|c| serde_json::to_string(c).unwrap_or_default())
            .unwrap_or_default();
        let affected = conn.execute(
            "UPDATE variables SET name=?2, symbol=?3, var_type=?4, min_value=?5, max_value=?6, step=?7, \
             unit=?8, precision=?9, string_values=?10, paired_constants=?11, created_at=?12 WHERE id=?1",
            params![
                v.id,
                v.name,
                v.symbol,
                var_type_to_str(&v.var_type),
                v.min_value,
                v.max_value,
                v.step,
                v.unit,
                v.precision,
                string_values_json,
                paired_constants_json,
                v.created_at.to_rfc3339(),
            ],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Variable {}", v.id)));
        }
        Ok(())
    }

    pub fn delete(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let affected = conn.execute("DELETE FROM variables WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Variable {id}")));
        }
        Ok(())
    }

    /// Count how many templates reference a variable.
    pub fn count_usage(conn: &Connection, id: &Uuid) -> Result<u32, DbError> {
        let count: u32 = conn.query_row(
            "SELECT COUNT(*) FROM template_variables WHERE variable_id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Delete a variable only if it is not referenced by any template.
    /// Returns true if the variable was deleted, false if it was kept because it is still in use.
    pub fn delete_if_unused(conn: &Connection, id: &Uuid) -> Result<bool, DbError> {
        if Self::count_usage(conn, id)? > 0 {
            return Ok(false);
        }
        Self::delete(conn, id)?;
        Ok(true)
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

fn var_type_to_str(var_type: &VariableType) -> &'static str {
    match var_type {
        VariableType::Numeric => "numeric",
        VariableType::String => "string",
    }
}

fn var_type_from_str(s: &str) -> VariableType {
    match s {
        "string" => VariableType::String,
        _ => VariableType::Numeric,
    }
}

fn parse_string_values(s: String) -> Option<Vec<String>> {
    if s.is_empty() {
        return None;
    }
    serde_json::from_str(&s).ok()
}

fn parse_paired_constants(
    s: String,
) -> Option<Vec<std::collections::HashMap<String, f64>>> {
    if s.is_empty() {
        return None;
    }
    serde_json::from_str(&s).ok()
}

fn parse_variable_row(row: &rusqlite::Row) -> Result<Variable, rusqlite::Error> {
    Ok(Variable {
        id: row.get(0)?,
        name: row.get(1)?,
        symbol: row.get(2)?,
        var_type: var_type_from_str(&row.get::<_, String>(3)?),
        min_value: row.get(4)?,
        max_value: row.get(5)?,
        step: row.get(6)?,
        unit: row.get(7)?,
        precision: row.get(8)?,
        string_values: row
            .get::<_, Option<String>>(9)?
            .map(parse_string_values)
            .flatten(),
        paired_constants: row
            .get::<_, Option<String>>(11)?
            .and_then(|s| parse_paired_constants(s)),
        greater_than: None,
        less_than: None,
        created_at: parse_dt(row.get::<_, String>(10)?),
    })
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
    fn insert_and_list_variable() {
        let conn = setup_conn();
        let v = Variable::new(
            "Hmotnost".into(),
            "m".into(),
            1.0,
            100.0,
            0.1,
            "g".into(),
            1,
        );
        VariableRepo::insert(&conn, &v).expect("insert");
        let all = VariableRepo::list_all(&conn).expect("list");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].symbol, "m");
    }

    #[test]
    fn get_by_id_returns_variable() {
        let conn = setup_conn();
        let v = Variable::new("Objem".into(), "V".into(), 0.0, 1000.0, 1.0, "ml".into(), 0);
        VariableRepo::insert(&conn, &v).expect("insert");
        let fetched = VariableRepo::get_by_id(&conn, &v.id).expect("get");
        assert_eq!(fetched.name, "Objem");
    }

    #[test]
    fn update_modifies_values() {
        let conn = setup_conn();
        let mut v = Variable::new(
            "Teplota".into(),
            "T".into(),
            0.0,
            100.0,
            0.5,
            "°C".into(),
            1,
        );
        VariableRepo::insert(&conn, &v).expect("insert");
        v.name = "Teplota Celsia".into();
        VariableRepo::update(&conn, &v).expect("update");
        let fetched = VariableRepo::get_by_id(&conn, &v.id).expect("get");
        assert_eq!(fetched.name, "Teplota Celsia");
    }

    #[test]
    fn delete_removes_variable() {
        let conn = setup_conn();
        let v = Variable::new("Cas".into(), "t".into(), 0.0, 60.0, 1.0, "s".into(), 0);
        VariableRepo::insert(&conn, &v).expect("insert");
        VariableRepo::delete(&conn, &v.id).expect("delete");
        let result = VariableRepo::get_by_id(&conn, &v.id);
        assert!(result.is_err());
    }

    #[test]
    fn validation_rejects_invalid_variable() {
        let v = Variable::new("".into(), "X".into(), 5.0, 0.0, 1.0, "g".into(), 0);
        let err = v.validate();
        assert!(err.is_err());
    }

    #[test]
    fn count_usage_returns_zero_for_unused_variable() {
        let conn = setup_conn();
        let v = Variable::new("M".into(), "m".into(), 1.0, 100.0, 0.1, "g".into(), 1);
        VariableRepo::insert(&conn, &v).expect("insert");
        assert_eq!(VariableRepo::count_usage(&conn, &v.id).unwrap(), 0);
    }

    #[test]
    fn count_usage_returns_one_for_linked_variable() {
        let conn = setup_conn();
        let v = Variable::new("M".into(), "m".into(), 1.0, 100.0, 0.1, "g".into(), 1);
        VariableRepo::insert(&conn, &v).expect("insert variable");

        let topic_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO topics (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![topic_id, "Test topic", chrono::Utc::now().to_rfc3339()],
        )
        .expect("insert topic");
        let template_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO templates (id, question_text, formula, result_unit, point_value, topic_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![template_id, "question", "ANS", "g", 2, topic_id, chrono::Utc::now().to_rfc3339()],
        ).expect("insert template");
        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder) VALUES (?1, ?2, ?3)",
            params![template_id, v.id, "V00"],
        ).expect("insert link");

        assert_eq!(VariableRepo::count_usage(&conn, &v.id).unwrap(), 1);
    }

    #[test]
    fn delete_if_unused_removes_unused_variable() {
        let conn = setup_conn();
        let v = Variable::new("M".into(), "m".into(), 1.0, 100.0, 0.1, "g".into(), 1);
        VariableRepo::insert(&conn, &v).expect("insert");
        assert!(VariableRepo::delete_if_unused(&conn, &v.id).unwrap());
        assert!(VariableRepo::get_by_id(&conn, &v.id).is_err());
    }

    #[test]
    fn delete_if_unused_keeps_shared_variable() {
        let conn = setup_conn();
        let v = Variable::new("M".into(), "m".into(), 1.0, 100.0, 0.1, "g".into(), 1);
        VariableRepo::insert(&conn, &v).expect("insert variable");

        let topic_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO topics (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![topic_id, "Test topic", chrono::Utc::now().to_rfc3339()],
        )
        .expect("insert topic");
        let template_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO templates (id, question_text, formula, result_unit, point_value, topic_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![template_id, "question", "ANS", "g", 2, topic_id, chrono::Utc::now().to_rfc3339()],
        ).expect("insert template");
        conn.execute(
            "INSERT INTO template_variables (template_id, variable_id, placeholder) VALUES (?1, ?2, ?3)",
            params![template_id, v.id, "V00"],
        ).expect("insert link");

        assert!(!VariableRepo::delete_if_unused(&conn, &v.id).unwrap());
        assert!(VariableRepo::get_by_id(&conn, &v.id).is_ok());
    }

    #[test]
    fn insert_and_retrieve_string_variable() {
        let conn = setup_conn();
        let v = Variable::new_string(
            "Látka".into(),
            "S".into(),
            vec!["KOH".into(), "NaOH".into()],
        );
        VariableRepo::insert(&conn, &v).expect("insert string variable");
        let fetched = VariableRepo::get_by_id(&conn, &v.id).expect("get");
        assert_eq!(fetched.var_type, VariableType::String);
        assert_eq!(
            fetched.string_values,
            Some(vec!["KOH".into(), "NaOH".into()])
        );
    }

    #[test]
    fn validation_rejects_empty_string_values() {
        let v = Variable::new_string("Látka".into(), "S".into(), vec![]);
        assert!(v.validate().is_err());
    }
}
