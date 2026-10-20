use crate::db::DbError;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

/// Which piece of a topic's display text an update touches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TopicField {
    Name,
    Description,
}

impl TopicField {
    fn column(self) -> &'static str {
        match self {
            TopicField::Name => "name",
            TopicField::Description => "description",
        }
    }
}

/// Which piece of a category's display text an update touches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CategoryField {
    Name,
    Description,
    /// Moves the category under another topic (`value` = topic slug) or clears
    /// its topic assignment (`value` = None).
    Topic,
}

impl CategoryField {
    fn column(self) -> &'static str {
        match self {
            CategoryField::Name => "name",
            CategoryField::Description => "description",
            CategoryField::Topic => "topic_slug",
        }
    }
}

/// One topic grouping (Aminokyseliny / Nukleové kyseliny / …) above the
/// categories. `built_in` distinguishes the seeded topics only; they are
/// editable and deletable like any other.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeTopicInfo {
    pub slug: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub built_in: bool,
    /// Row version: writes may pass it back as `expectedUpdatedAt` so they
    /// only land if nobody changed the row in the meantime.
    pub updated_at: String,
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
    /// Topic grouping this category belongs to, or NULL when ungrouped.
    pub topic_slug: Option<String>,
    /// Row version, as on [`BiomoleculeTopicInfo::updated_at`].
    pub updated_at: String,
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
    /// Whether to recognize saccharides and draw a Haworth projection
    /// (true) or a plain skeletal structure (false).
    pub haworth: bool,
    pub traits: HashMap<String, String>,
    /// Row version, as on [`BiomoleculeTopicInfo::updated_at`]. Covers the
    /// traits too — they are only ever rewritten together with the row.
    pub updated_at: String,
}

/// The whole Biomolekuly library in one payload; every mutation returns a
/// fresh copy so the client replaces its dataset atomically.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomoleculeData {
    pub topics: Vec<BiomoleculeTopicInfo>,
    pub categories: Vec<BiomoleculeCategoryInfo>,
    pub molecules: Vec<BiomoleculeInfo>,
}

/// Where an updated molecule moves to: another category, at its end, under a
/// slug already checked to be free there.
pub struct MoleculeRelocation {
    pub category_slug: String,
    pub slug: String,
    pub position: i64,
}

/// Biomolekuly topics, categories, molecules, and traits (migrations v47/v51).
pub struct BiomoleculeRepo;

impl BiomoleculeRepo {
    /// Every topic in hub order.
    pub fn list_topics(conn: &Connection) -> Result<Vec<BiomoleculeTopicInfo>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT slug, name, description, built_in, updated_at
             FROM biomolecule_topics
             ORDER BY position, slug",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(BiomoleculeTopicInfo {
                slug: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                built_in: row.get::<_, i64>(3)? != 0,
                updated_at: row.get(4)?,
            })
        })?;
        rows.map(|r| r.map_err(DbError::Sqlite)).collect()
    }

    /// Every category with its molecule count, in hub order.
    pub fn list_categories(conn: &Connection) -> Result<Vec<BiomoleculeCategoryInfo>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT c.slug, c.name, c.description, c.position, c.built_in,
                    (SELECT COUNT(*) FROM biomolecules m WHERE m.category_slug = c.slug),
                    c.topic_slug, c.updated_at
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
                topic_slug: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        rows.map(|r| r.map_err(DbError::Sqlite)).collect()
    }

    /// Every molecule with its traits, ordered per category.
    pub fn list_molecules(conn: &Connection) -> Result<Vec<BiomoleculeInfo>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, category_slug, slug, name, smiles, position, projection, haworth,
                    updated_at
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
                    row.get::<_, i64>(7)? != 0,
                    row.get::<_, String>(8)?,
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
                |(id, category_slug, slug, name, smiles, position, projection, haworth, updated_at)| BiomoleculeInfo {
                    id,
                    category_slug,
                    slug,
                    name,
                    smiles,
                    position,
                    projection,
                    haworth,
                    traits: traits_by_molecule.remove(&id).unwrap_or_default().into_iter()
                        .collect(),
                    updated_at,
                },
            )
            .collect())
    }

    /// The full dataset the client caches per session.
    pub fn list_data(conn: &Connection) -> Result<BiomoleculeData, DbError> {
        Ok(BiomoleculeData {
            topics: Self::list_topics(conn)?,
            categories: Self::list_categories(conn)?,
            molecules: Self::list_molecules(conn)?,
        })
    }

    pub fn topic_exists(conn: &Connection, slug: &str) -> Result<bool, DbError> {
        Ok(conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM biomolecule_topics WHERE slug = ?1)",
            params![slug],
            |row| row.get(0),
        )?)
    }

    /// True when another topic already carries this name (case-insensitive).
    /// Kept for callers that want a friendly duplicate-name error; the create
    /// path itself mirrors categories and uniquifies the slug instead.
    #[allow(dead_code)]
    pub fn topic_name_taken(
        conn: &Connection,
        name: &str,
        exclude_slug: Option<&str>,
    ) -> Result<bool, DbError> {
        Ok(conn.query_row(
            "SELECT EXISTS (
                 SELECT 1 FROM biomolecule_topics
                 WHERE name = ?1 COLLATE NOCASE
                   AND (?2 IS NULL OR slug != ?2))",
            params![name, exclude_slug],
            |row| row.get(0),
        )?)
    }

    /// Next free position among the topics.
    pub fn next_topic_position(conn: &Connection) -> Result<i64, DbError> {
        Ok(conn.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM biomolecule_topics",
            [],
            |row| row.get(0),
        )?)
    }

    pub fn insert_topic(
        conn: &Connection,
        slug: &str,
        name: &str,
        description: Option<&str>,
        position: i64,
        created_by: &Uuid,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO biomolecule_topics
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

    /// Name writes refuse blank (topics must stay addressable); a blank
    /// description stores NULL.
    pub fn update_topic_field(
        conn: &Connection,
        slug: &str,
        field: TopicField,
        value: Option<&str>,
        updated_by: &Uuid,
    ) -> Result<(), DbError> {
        let column = field.column();
        let changed = conn.execute(
            &format!(
                "UPDATE biomolecule_topics
                 SET {column} = ?2, updated_at = ?3, updated_by = ?4
                 WHERE slug = ?1"
            ),
            params![slug, value, Utc::now().to_rfc3339(), updated_by],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("Topic {slug} not found")));
        }
        Ok(())
    }

    /// Removes the topic only. Categories keep existing; the FK's
    /// `ON DELETE SET NULL` clears their `topic_slug`.
    pub fn delete_topic(conn: &Connection, slug: &str) -> Result<(), DbError> {
        let changed = conn.execute(
            "DELETE FROM biomolecule_topics WHERE slug = ?1",
            params![slug],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("Topic {slug} not found")));
        }
        Ok(())
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
        topic_slug: Option<&str>,
        position: i64,
        created_by: &Uuid,
    ) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO biomolecule_categories
                 (slug, name, description, topic_slug, position, built_in, created_at, created_by, updated_at, updated_by)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?6, ?7)",
            params![
                slug,
                name,
                description,
                topic_slug,
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
        haworth: bool,
        position: i64,
        traits: &[(String, String)],
        created_by: &Uuid,
    ) -> Result<Uuid, DbError> {
        let id = Uuid::new_v4();
        let tx = conn.unchecked_transaction()?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO biomolecules
                 (id, category_slug, slug, name, smiles, projection, haworth, position, created_at, created_by, updated_at, updated_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?9, ?10)",
            params![id, category_slug, slug, name, smiles, projection, haworth as i64, position, now, created_by],
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
        haworth: bool,
        traits: &[(String, String)],
        relocation: Option<&MoleculeRelocation>,
        updated_by: &Uuid,
    ) -> Result<(), DbError> {
        let tx = conn.unchecked_transaction()?;
        if let Some(to) = relocation {
            tx.execute(
                "UPDATE biomolecules SET category_slug = ?2, slug = ?3, position = ?4 WHERE id = ?1",
                params![id, to.category_slug, to.slug, to.position],
            )?;
        }
        let changed = tx.execute(
            "UPDATE biomolecules
             SET name = ?2, smiles = ?3, projection = ?4, haworth = ?5,
                 updated_at = ?6, updated_by = ?7
             WHERE id = ?1",
            params![id, name, smiles, projection, haworth as i64, Utc::now().to_rfc3339(), updated_by],
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

    /// Version (`updated_at`) of one row, `None` when it doesn't exist.
    pub fn topic_version(conn: &Connection, slug: &str) -> Result<Option<String>, DbError> {
        Ok(conn
            .query_row(
                "SELECT updated_at FROM biomolecule_topics WHERE slug = ?1",
                params![slug],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn category_version(conn: &Connection, slug: &str) -> Result<Option<String>, DbError> {
        Ok(conn
            .query_row(
                "SELECT updated_at FROM biomolecule_categories WHERE slug = ?1",
                params![slug],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn molecule_version(conn: &Connection, id: &Uuid) -> Result<Option<String>, DbError> {
        Ok(conn
            .query_row(
                "SELECT updated_at FROM biomolecules WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?)
    }

    /// Id → version of every molecule in one category.
    pub fn molecule_versions_in(
        conn: &Connection,
        category_slug: &str,
    ) -> Result<HashMap<Uuid, String>, DbError> {
        let mut stmt =
            conn.prepare("SELECT id, updated_at FROM biomolecules WHERE category_slug = ?1")?;
        let rows = stmt.query_map(params![category_slug], |row| Ok((row.get(0)?, row.get(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Topic slugs in hub order.
    pub fn topic_order(conn: &Connection) -> Result<Vec<String>, DbError> {
        let mut stmt =
            conn.prepare("SELECT slug FROM biomolecule_topics ORDER BY position, slug")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Category slugs in hub order.
    pub fn category_order(conn: &Connection) -> Result<Vec<String>, DbError> {
        let mut stmt =
            conn.prepare("SELECT slug FROM biomolecule_categories ORDER BY position, slug")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Molecule ids of one category in display order.
    pub fn molecule_order(conn: &Connection, category_slug: &str) -> Result<Vec<Uuid>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id FROM biomolecules WHERE category_slug = ?1 ORDER BY position, slug",
        )?;
        let rows = stmt.query_map(params![category_slug], |row| row.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Rewrites positions to follow `slugs` (already checked to be every topic).
    pub fn set_topic_order(conn: &Connection, slugs: &[String]) -> Result<(), DbError> {
        let tx = conn.unchecked_transaction()?;
        for (position, slug) in slugs.iter().enumerate() {
            tx.execute(
                "UPDATE biomolecule_topics SET position = ?2 WHERE slug = ?1",
                params![slug, position as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Rewrites positions to follow `slugs` (already checked to be every category).
    pub fn set_category_order(conn: &Connection, slugs: &[String]) -> Result<(), DbError> {
        let tx = conn.unchecked_transaction()?;
        for (position, slug) in slugs.iter().enumerate() {
            tx.execute(
                "UPDATE biomolecule_categories SET position = ?2 WHERE slug = ?1",
                params![slug, position as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Rewrites positions to follow `ids` (already checked to be every molecule
    /// of the category).
    pub fn set_molecule_order(conn: &Connection, ids: &[Uuid]) -> Result<(), DbError> {
        let tx = conn.unchecked_transaction()?;
        for (position, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE biomolecules SET position = ?2 WHERE id = ?1",
                params![id, position as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}
