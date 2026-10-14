use crate::db::DbError;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

/// Which piece of a category's display text an override replaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CategoryField {
    Name,
    Description,
}

impl CategoryField {
    fn column(self) -> &'static str {
        match self {
            CategoryField::Name => "name",
            CategoryField::Description => "description",
        }
    }
}

/// One category's overrides; `None` = use the built-in text.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryOverride {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Display-text overrides for Biomolekuly categories (migration v44).
pub struct BiomoleculeCategoryRepo;

impl BiomoleculeCategoryRepo {
    /// Every override, keyed by category slug.
    pub fn list(conn: &Connection) -> Result<HashMap<String, CategoryOverride>, DbError> {
        let mut stmt = conn
            .prepare("SELECT category_id, name, description FROM biomolecule_category_overrides")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get(0)?,
                CategoryOverride {
                    name: row.get(1)?,
                    description: row.get(2)?,
                },
            ))
        })?;
        rows.map(|r| r.map_err(DbError::Sqlite)).collect()
    }

    /// Set (`Some`) or clear (`None`) one field. A row whose fields are all
    /// cleared is deleted, so "no row" stays the only spelling of "built-in".
    pub fn set_field(
        conn: &Connection,
        category_id: &str,
        field: CategoryField,
        value: Option<&str>,
        updated_by: Option<Uuid>,
    ) -> Result<(), DbError> {
        let column = field.column();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            &format!(
                "INSERT INTO biomolecule_category_overrides (category_id, {column}, updated_at, updated_by)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(category_id) DO UPDATE SET
                     {column} = excluded.{column},
                     updated_at = excluded.updated_at,
                     updated_by = excluded.updated_by"
            ),
            params![category_id, value, Utc::now().to_rfc3339(), updated_by],
        )?;
        tx.execute(
            "DELETE FROM biomolecule_category_overrides
             WHERE category_id = ?1 AND name IS NULL AND description IS NULL",
            params![category_id],
        )?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn
    }

    #[test]
    fn fields_are_independent_and_clearing_both_drops_the_row() {
        let conn = setup_conn();
        let id = "aminokyseliny";
        BiomoleculeCategoryRepo::set_field(&conn, id, CategoryField::Name, Some("AK"), None)
            .expect("set name");
        BiomoleculeCategoryRepo::set_field(
            &conn,
            id,
            CategoryField::Description,
            Some("Popis"),
            None,
        )
        .expect("set description");
        BiomoleculeCategoryRepo::set_field(&conn, id, CategoryField::Name, None, None)
            .expect("clear name");

        let all = BiomoleculeCategoryRepo::list(&conn).expect("list");
        assert_eq!(
            all[id],
            CategoryOverride {
                name: None,
                description: Some("Popis".into())
            }
        );

        BiomoleculeCategoryRepo::set_field(&conn, id, CategoryField::Description, None, None)
            .expect("clear description");
        assert!(BiomoleculeCategoryRepo::list(&conn)
            .expect("list")
            .is_empty());
    }
}
