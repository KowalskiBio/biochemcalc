use crate::db::DbError;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

/// Which piece of a category's display text an update touches.
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

/// One Biomolekuly category with its molecule count, in hub order.
/// `built_in` marks the seeded curated categories — they are editable
/// like any other, the flag only distinguishes them on the hub.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeCategoryInfo {
    pub slug: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub built_in: bool,
    pub molecule_count: i64,
}

/// One molecule with its traits (the optional, code-validated
/// characteristics — abbreviation, charge, polarity, …).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeInfo {
    pub id: Uuid,
    pub category_slug: String,
    pub slug: String,
    pub name: String,
    pub smiles: String,
    pub position: i64,
    /// Raw JSON Haworth projection spec, when the molecule has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection: Option<String>,
    pub traits: HashMap<String, String>,
}

/// The whole Biomolekuly library in one payload; every mutation returns a
/// fresh copy so the client replaces its dataset atomically.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeData {
    pub categories: Vec<BiomoleculeCategoryInfo>,
    pub molecules: Vec<BiomoleculeInfo>,
}

/// Biomolekuly categories, molecules, and traits (migration v47).
pub struct BiomoleculeRepo;

impl BiomoleculeRepo {
    /// Every category with its molecule count, in hub order.
    pub fn list_categories(conn: &Connection) -> Result<Vec<BiomoleculeCategoryInfo>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT c.slug, c.name, c.description, c.position, c.built_in,
                    (SELECT COUNT(*) FROM biomolecules m WHERE m.category_slug = c.slug)
             FROM biomolecule_categories c
             ORDER BY c.position, c.slug",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(BiomoleculeCategoryInfo {
                slug: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                built_in: row.get::<_, i64>(4)? != 0,
                molecule_count: row.get(5)?,
            })
        })?;
        rows.map(|r| r.map_err(DbError::Sqlite)).collect()
    }

    /// Every molecule with its traits, ordered per category.
    pub fn list_molecules(conn: &Connection) -> Result<Vec<BiomoleculeInfo>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, category_slug, slug, name, smiles, position, projection
             FROM biomolecules ORDER BY category_slug, position, slug",
        )?;
        let molecules = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, Uuid>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut trait_stmt = conn
            .prepare("SELECT molecule_id, trait, value FROM biomolecule_traits ORDER BY trait")?;
        let mut traits_by_molecule: HashMap<Uuid, Vec<(String, String)>> = HashMap::new();
        let trait_rows = trait_stmt.query_map([], |row| {
            Ok((
                row.get::<_, Uuid>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for row in trait_rows {
            let (molecule_id, trait_key, value) = row?;
            traits_by_molecule
                .entry(molecule_id)
                .or_default()
                .push((trait_key, value));
        }

        Ok(molecules
            .into_iter()
            .map(
                |(id, category_slug, slug, name, smiles, position, projection)| BiomoleculeInfo {
                    id,
                    category_slug,
                    slug,
                    name,
                    smiles,
                    position,
                    projection,
                    traits: traits_by_molecule.remove(&id).unwrap_or_default().into_iter()
                        .collect(),
                },
            )
            .collect())
    }

    /// The full dataset the client caches per session.
    pub fn list_data(conn: &Connection) -> Result<BiomoleculeData, DbError> {
        Ok(BiomoleculeData {
            categories: Self::list_categories(conn)?,
            molecules: Self::list_molecules(conn)?,
        })
    }

    pub fn category_exists(conn: &Connection, slug: &str) -> Result<bool, DbError> {
        Ok(conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM biomolecule_categories WHERE slug = ?1)",
            params![slug],
            |row| row.get(0),
        )?)
    }

    /// Next free position within the hub / within one category.
    pub fn next_category_position(conn: &Connection) -> Result<i64, DbError> {
        Ok(conn.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM biomolecule_categories",
            [],
            |row| row.get(0),
        )?)
    }

    pub fn next_molecule_position(conn: &Connection, category_slug: &str) -> Result<i64, DbError> {
        Ok(conn.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM biomolecules WHERE category_slug = ?1",
            params![category_slug],
            |row| row.get(0),
        )?)
    }

    pub fn insert_category(
        conn: &Connection,
        slug: &str,
        name: &str,
        description: Option<&str>,
        position: i64,
        created_by: &Uuid,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO biomolecule_categories
                 (slug, name, description, position, built_in, created_at, created_by, updated_at, updated_by)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?5, ?6)",
            params![
                slug,
                name,
                description,
                position,
                Utc::now().to_rfc3339(),
                created_by
            ],
        )?;
        Ok(())
    }

    /// Name writes refuse blank (categories must stay addressable);
    /// a blank description stores NULL.
    pub fn update_category_field(
        conn: &Connection,
        slug: &str,
        field: CategoryField,
        value: Option<&str>,
        updated_by: &Uuid,
    ) -> Result<(), DbError> {
        let column = field.column();
        let changed = conn.execute(
            &format!(
                "UPDATE biomolecule_categories
                 SET {column} = ?2, updated_at = ?3, updated_by = ?4
                 WHERE slug = ?1"
            ),
            params![slug, value, Utc::now().to_rfc3339(), updated_by],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("Category {slug} not found")));
        }
        Ok(())
    }

    pub fn delete_category(conn: &Connection, slug: &str) -> Result<(), DbError> {
        let changed = conn.execute(
            "DELETE FROM biomolecule_categories WHERE slug = ?1",
            params![slug],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("Category {slug} not found")));
        }
        Ok(())
    }

    pub fn molecule_name_taken(
        conn: &Connection,
        category_slug: &str,
        name: &str,
        exclude_id: Option<Uuid>,
    ) -> Result<bool, DbError> {
        Ok(conn.query_row(
            "SELECT EXISTS (
                 SELECT 1 FROM biomolecules
                 WHERE category_slug = ?1 AND name = ?2 COLLATE NOCASE
                   AND (?3 IS NULL OR id != ?3))",
            params![category_slug, name, exclude_id],
            |row| row.get(0),
        )?)
    }

    pub fn molecule_slug_taken(
        conn: &Connection,
        category_slug: &str,
        slug: &str,
        exclude_id: Option<Uuid>,
    ) -> Result<bool, DbError> {
        Ok(conn.query_row(
            "SELECT EXISTS (
                 SELECT 1 FROM biomolecules
                 WHERE category_slug = ?1 AND slug = ?2
                   AND (?3 IS NULL OR id != ?3))",
            params![category_slug, slug, exclude_id],
            |row| row.get(0),
        )?)
    }

    /// True when another molecule in the category already carries this trait
    /// value (letter codes must be unique for quiz questions to stay
    /// unambiguous). Empty/absent values never collide.
    pub fn trait_value_taken(
        conn: &Connection,
        category_slug: &str,
        trait_key: &str,
        value: &str,
        exclude_id: Option<Uuid>,
    ) -> Result<bool, DbError> {
        Ok(conn.query_row(
            "SELECT EXISTS (
                 SELECT 1 FROM biomolecule_traits t
                 JOIN biomolecules m ON m.id = t.molecule_id
                 WHERE m.category_slug = ?1 AND t.trait = ?2
                   AND t.value = ?3 COLLATE NOCASE
                   AND (?4 IS NULL OR t.molecule_id != ?4))",
            params![category_slug, trait_key, value, exclude_id],
            |row| row.get(0),
        )?)
    }

    /// Which category a molecule belongs to, for update validation.
    pub fn molecule_category(conn: &Connection, id: &Uuid) -> Result<Option<String>, DbError> {
        let mut stmt = conn.prepare("SELECT category_slug FROM biomolecules WHERE id = ?1")?;
        let mut rows = stmt.query_map(params![id], |row| row.get::<_, String>(0))?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn insert_molecule(
        conn: &Connection,
        category_slug: &str,
        slug: &str,
        name: &str,
        smiles: &str,
        projection: Option<&str>,
        position: i64,
        traits: &[(String, String)],
        created_by: &Uuid,
    ) -> Result<Uuid, DbError> {
        let id = Uuid::new_v4();
        let tx = conn.unchecked_transaction()?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO biomolecules
                 (id, category_slug, slug, name, smiles, projection, position, created_at, created_by, updated_at, updated_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?8, ?9)",
            params![id, category_slug, slug, name, smiles, projection, position, now, created_by],
        )?;
        for (trait_key, value) in traits {
            tx.execute(
                "INSERT INTO biomolecule_traits (molecule_id, trait, value) VALUES (?1, ?2, ?3)",
                params![id, trait_key, value],
            )?;
        }
        tx.commit()?;
        Ok(id)
    }

    /// Update name/SMILES and replace the trait set wholesale (the form
    /// always submits the full trait map, so a cleared field disappears).
    /// The slug stays — quiz identities and `pairsWith` references would
    /// silently break if a rename regenerated it.
    pub fn update_molecule(
        conn: &Connection,
        id: &Uuid,
        name: &str,
        smiles: &str,
        projection: Option<&str>,
        traits: &[(String, String)],
        updated_by: &Uuid,
    ) -> Result<(), DbError> {
        let tx = conn.unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE biomolecules
             SET name = ?2, smiles = ?3, projection = ?4, updated_at = ?5, updated_by = ?6
             WHERE id = ?1",
            params![id, name, smiles, projection, Utc::now().to_rfc3339(), updated_by],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("Molecule {id} not found")));
        }
        tx.execute(
            "DELETE FROM biomolecule_traits WHERE molecule_id = ?1",
            params![id],
        )?;
        for (trait_key, value) in traits {
            tx.execute(
                "INSERT INTO biomolecule_traits (molecule_id, trait, value) VALUES (?1, ?2, ?3)",
                params![id, trait_key, value],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_molecule(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let changed = conn.execute("DELETE FROM biomolecules WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("Molecule {id} not found")));
        }
        Ok(())
    }
}
