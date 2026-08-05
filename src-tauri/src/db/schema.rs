use rusqlite::Connection;

/// Schema version — bumped for every migration to keep them idempotent.
#[allow(dead_code)]
const CURRENT_USER_VERSION: u32 = 13;

/// Run all migrations. Idempotent — safe to call on every startup.
pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    let user_version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if user_version < 1 {
        apply_migration_v1(conn)?;
        conn.pragma_update(None, "user_version", "1")?;
    }

    if user_version < 2 {
        apply_migration_v2(conn)?;
        conn.pragma_update(None, "user_version", "2")?;
    }

    if user_version < 3 {
        apply_migration_v3(conn)?;
        conn.pragma_update(None, "user_version", "3")?;
    }

    if user_version < 4 {
        apply_migration_v4(conn)?;
        conn.pragma_update(None, "user_version", "4")?;
    }

    if user_version < 5 {
        apply_migration_v5(conn)?;
        conn.pragma_update(None, "user_version", "5")?;
    }

    if user_version < 6 {
        apply_migration_v6(conn)?;
        conn.pragma_update(None, "user_version", "6")?;
    }

    if user_version < 7 {
        apply_migration_v7(conn)?;
        conn.pragma_update(None, "user_version", "7")?;
    }

    if user_version < 8 {
        apply_migration_v8(conn)?;
        conn.pragma_update(None, "user_version", "8")?;
    }

    if user_version < 9 {
        apply_migration_v9(conn)?;
        conn.pragma_update(None, "user_version", "9")?;
    }

    if user_version < 10 {
        apply_migration_v10(conn)?;
        conn.pragma_update(None, "user_version", "10")?;
    }

    if user_version < 11 {
        apply_migration_v11(conn)?;
        conn.pragma_update(None, "user_version", "11")?;
    }

    if user_version < 12 {
        apply_migration_v12(conn)?;
        conn.pragma_update(None, "user_version", "12")?;
    }

    if user_version < 13 {
        apply_migration_v13(conn)?;
        conn.pragma_update(None, "user_version", "13")?;
    }

    if user_version < 14 {
        apply_migration_v14(conn)?;
        conn.pragma_update(None, "user_version", "14")?;
    }

    Ok(())
}

fn apply_migration_v1(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS variables (
            id BLOB PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            min_value REAL NOT NULL,
            max_value REAL NOT NULL,
            step REAL NOT NULL,
            unit TEXT NOT NULL,
            precision INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_variables_symbol ON variables(symbol);

        CREATE TABLE IF NOT EXISTS constants (
            id BLOB PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL UNIQUE,
            value REAL NOT NULL,
            unit TEXT NOT NULL,
            is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_constants_symbol ON constants(symbol);

        CREATE TABLE IF NOT EXISTS templates (
            id BLOB PRIMARY KEY NOT NULL,
            question_text TEXT NOT NULL,
            formula TEXT NOT NULL,
            result_unit TEXT NOT NULL,
            point_value INTEGER NOT NULL CHECK (point_value IN (2, 3, 4)),
            mode TEXT NOT NULL CHECK (mode IN ('closed', 'open')),
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_templates_point_value ON templates(point_value);
        CREATE INDEX IF NOT EXISTS idx_templates_mode ON templates(mode);

        CREATE TABLE IF NOT EXISTS template_variables (
            template_id BLOB NOT NULL,
            variable_id BLOB NOT NULL,
            placeholder TEXT NOT NULL,
            PRIMARY KEY (template_id, variable_id),
            FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
            FOREIGN KEY (variable_id) REFERENCES variables(id) ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS idx_template_variables_template ON template_variables(template_id);

        CREATE TABLE IF NOT EXISTS template_constants (
            template_id BLOB NOT NULL,
            constant_id BLOB NOT NULL,
            PRIMARY KEY (template_id, constant_id),
            FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
            FOREIGN KEY (constant_id) REFERENCES constants(id) ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS idx_template_constants_template ON template_constants(template_id);

        CREATE TABLE IF NOT EXISTS result_constraints (
            id BLOB PRIMARY KEY NOT NULL,
            template_id BLOB NOT NULL UNIQUE,
            min_result REAL,
            max_result REAL,
            sd_allowed REAL,
            constraint_type TEXT NOT NULL CHECK (constraint_type IN ('range', 'sd', 'both')),
            FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_result_constraints_template ON result_constraints(template_id);

        CREATE TABLE IF NOT EXISTS categories (
            id BLOB PRIMARY KEY NOT NULL,
            point_value INTEGER NOT NULL UNIQUE CHECK (point_value IN (2, 3, 4)),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sets (
            id BLOB PRIMARY KEY NOT NULL,
            category_id BLOB NOT NULL,
            set_index INTEGER NOT NULL CHECK (set_index BETWEEN 1 AND 4),
            mode TEXT NOT NULL CHECK (mode IN ('closed', 'open')),
            UNIQUE (category_id, set_index),
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_sets_category ON sets(category_id);

        CREATE TABLE IF NOT EXISTS set_templates (
            set_id BLOB NOT NULL,
            template_id BLOB NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (set_id, template_id),
            FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE,
            FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_set_templates_set ON set_templates(set_id);

        CREATE TABLE IF NOT EXISTS variants (
            id BLOB PRIMARY KEY NOT NULL,
            template_id BLOB NOT NULL,
            assigned_values TEXT NOT NULL,
            correct_answer REAL NOT NULL,
            distractors TEXT,
            interval_lo REAL,
            interval_hi REAL,
            seed INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_variants_template ON variants(template_id);

        CREATE TABLE IF NOT EXISTS category_packages (
            id BLOB PRIMARY KEY NOT NULL,
            point_value INTEGER NOT NULL CHECK (point_value IN (2, 3, 4)),
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_category_packages_point_value ON category_packages(point_value);

        CREATE TABLE IF NOT EXISTS set_packages (
            id BLOB PRIMARY KEY NOT NULL,
            category_package_id BLOB NOT NULL,
            set_index INTEGER NOT NULL CHECK (set_index BETWEEN 1 AND 4),
            mode TEXT NOT NULL CHECK (mode IN ('closed', 'open')),
            FOREIGN KEY (category_package_id) REFERENCES category_packages(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_set_packages_package ON set_packages(category_package_id);

        CREATE TABLE IF NOT EXISTS variant_packages (
            id BLOB PRIMARY KEY NOT NULL,
            set_package_id BLOB NOT NULL,
            variant_id BLOB NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (set_package_id) REFERENCES set_packages(id) ON DELETE CASCADE,
            FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_variant_packages_set ON variant_packages(set_package_id);

        CREATE TABLE IF NOT EXISTS wizard_sessions (
            id BLOB PRIMARY KEY NOT NULL,
            point_value INTEGER,
            student_count INTEGER NOT NULL DEFAULT 25,
            sets TEXT NOT NULL,
            dirty INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS output_files (
            id BLOB PRIMARY KEY NOT NULL,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            category_package_ids TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('draft', 'generating', 'ready', 'exported', 'failed')),
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_output_files_created_at ON output_files(created_at);

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        ",
    )?;

    Ok(())
}

fn apply_migration_v2(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Re-create the variants table with the 6-option closed-answer layout.
    // Existing generated variants are dropped because the old `distractors`
    // column cannot be losslessly migrated to `numeric_options` + `correct_option`.
    conn.execute_batch(
        "
        PRAGMA foreign_keys = OFF;

        DROP TABLE IF EXISTS variants;

        CREATE TABLE IF NOT EXISTS variants (
            id BLOB PRIMARY KEY NOT NULL,
            template_id BLOB NOT NULL,
            assigned_values TEXT NOT NULL,
            correct_answer REAL NOT NULL,
            numeric_options TEXT,
            correct_option INTEGER,
            interval_lo REAL,
            interval_hi REAL,
            seed INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_variants_template ON variants(template_id);

        PRAGMA foreign_keys = ON;
        ",
    )?;

    Ok(())
}

fn apply_migration_v3(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = OFF;

        -- 1. Create the topics table.
        CREATE TABLE IF NOT EXISTS topics (
            id BLOB PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        -- 2. Create a default migration topic for any pre-existing data.
        INSERT OR IGNORE INTO topics (id, name, created_at)
        VALUES (X'00000000000000000000000000000000', 'Default', '1970-01-01T00:00:00Z');

        -- 3. Migrate categories: add topic_id, relax UNIQUE constraint.
        CREATE TABLE categories_new (
            id BLOB PRIMARY KEY NOT NULL,
            topic_id BLOB NOT NULL,
            point_value INTEGER NOT NULL CHECK (point_value IN (2, 3, 4)),
            created_at TEXT NOT NULL,
            UNIQUE (topic_id, point_value),
            FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
        );
        INSERT INTO categories_new (id, topic_id, point_value, created_at)
            SELECT id, X'00000000000000000000000000000000', point_value, created_at
            FROM categories;
        DROP TABLE categories;
        ALTER TABLE categories_new RENAME TO categories;

        -- 4. Migrate templates: drop mode column, add topic_id.
        CREATE TABLE templates_new (
            id BLOB PRIMARY KEY NOT NULL,
            question_text TEXT NOT NULL,
            formula TEXT NOT NULL,
            result_unit TEXT NOT NULL,
            point_value INTEGER NOT NULL CHECK (point_value IN (2, 3, 4)),
            topic_id BLOB NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
        );
        INSERT INTO templates_new (id, question_text, formula, result_unit, point_value, topic_id, created_at)
            SELECT id, question_text, formula, result_unit, point_value,
                   X'00000000000000000000000000000000', created_at
            FROM templates;
        DROP TABLE templates;
        ALTER TABLE templates_new RENAME TO templates;

        CREATE INDEX IF NOT EXISTS idx_templates_point_value ON templates(point_value);
        CREATE INDEX IF NOT EXISTS idx_templates_topic ON templates(topic_id);

        PRAGMA foreign_keys = ON;
        ",
    )?;

    Ok(())
}

fn apply_migration_v4(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = OFF;

        -- Drop the overly restrictive UNIQUE constraint on variable symbols.
        -- Variables are identified by UUID and linked per-template, so duplicate
        -- symbols across different templates are fine. Symbols only need to be
        -- unique within a single template's variable set (enforced by usage).
        CREATE TABLE variables_new (
            id BLOB PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            min_value REAL NOT NULL,
            max_value REAL NOT NULL,
            step REAL NOT NULL,
            unit TEXT NOT NULL,
            precision INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        INSERT INTO variables_new
            SELECT id, name, symbol, min_value, max_value, step, unit, precision, created_at
            FROM variables;

        DROP TABLE variables;
        ALTER TABLE variables_new RENAME TO variables;

        CREATE INDEX IF NOT EXISTS idx_variables_symbol ON variables(symbol);

        PRAGMA foreign_keys = ON;
        ",
    )
}

fn apply_migration_v5(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = OFF;

        -- Add variable type and string values support.
        ALTER TABLE variables ADD COLUMN var_type TEXT NOT NULL DEFAULT 'numeric';
        ALTER TABLE variables ADD COLUMN string_values TEXT;

        -- Generated variants may also contain string variable assignments.
        ALTER TABLE variants ADD COLUMN assigned_strings TEXT;

        -- History of variable changes per template and globally.
        CREATE TABLE IF NOT EXISTS variable_history (
            id BLOB PRIMARY KEY NOT NULL,
            variable_id BLOB NOT NULL,
            template_id BLOB NOT NULL,
            field_name TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            changed_at TEXT NOT NULL,
            FOREIGN KEY (variable_id) REFERENCES variables(id) ON DELETE CASCADE,
            FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_variable_history_template ON variable_history(template_id);
        CREATE INDEX IF NOT EXISTS idx_variable_history_variable ON variable_history(variable_id);
        CREATE INDEX IF NOT EXISTS idx_variable_history_changed_at ON variable_history(changed_at);

        -- Metadata table for temporary projects (Projekty).
        -- Actual question content is stored as JSON files in app_data_dir/projekty/.
        CREATE TABLE IF NOT EXISTS projekty (
            id BLOB PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            question_count INTEGER NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('closed', 'open')),
            topic_name TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_projekty_updated_at ON projekty(updated_at);

        PRAGMA foreign_keys = ON;
        ",
    )
}

fn apply_migration_v6(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = OFF;

        -- Per-question human-readable equation text and imported numeric answer.
        ALTER TABLE templates ADD COLUMN equation_text TEXT NOT NULL DEFAULT '';
        ALTER TABLE templates ADD COLUMN numeric_answer REAL DEFAULT NULL;

        PRAGMA foreign_keys = ON;
        ",
    )
}

fn apply_migration_v7(conn: &Connection) -> Result<(), rusqlite::Error> {
    let ans_links: Vec<(Vec<u8>, Vec<u8>, String)> = conn
        .prepare(
            "SELECT tv.template_id, tv.variable_id, v.symbol
             FROM template_variables tv
             JOIN variables v ON v.id = tv.variable_id
             WHERE tv.placeholder = 'ANS'",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, Vec<u8>>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    for (template_id, variable_id, symbol) in ans_links {
        conn.execute(
            "DELETE FROM template_variables WHERE template_id = ?1 AND variable_id = ?2",
            [&template_id, &variable_id],
        )?;
        conn.execute(
            "UPDATE templates SET formula = '' WHERE formula = ?1",
            [&symbol],
        )?;
    }

    conn.execute(
        "DELETE FROM variables
         WHERE name = 'Answer'
           AND NOT EXISTS (
               SELECT 1 FROM template_variables tv WHERE tv.variable_id = variables.id
           )",
        [],
    )?;

    Ok(())
}

fn apply_migration_v8(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Restore the numeric answer for templates that lost it when the legacy ANS
    // placeholder variable was removed in v7. If any generated variants still
    // exist, their correct_answer is the best available source of the original
    // imported answer.
    conn.execute(
        "UPDATE templates
         SET numeric_answer = (
             SELECT correct_answer
             FROM variants
             WHERE variants.template_id = templates.id
             ORDER BY created_at ASC
             LIMIT 1
         )
         WHERE numeric_answer IS NULL
           AND EXISTS (
               SELECT 1 FROM variants WHERE variants.template_id = templates.id
           )",
        [],
    )?;

    Ok(())
}

fn apply_migration_v9(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Convert legacy {{...}} placeholder syntax to the new [[...]] syntax in
    // stored question and equation text. Placeholder names themselves (e.g.
    // V00, ms) are preserved; only the surrounding brackets change.
    conn.execute(
        "UPDATE templates
         SET question_text = REPLACE(REPLACE(question_text, '{{', '[['), '}}', ']]')
         WHERE question_text LIKE '%{{%';",
        [],
    )?;
    conn.execute(
        "UPDATE templates
         SET equation_text = REPLACE(REPLACE(equation_text, '{{', '[['), '}}', ']]')
         WHERE equation_text LIKE '%{{%';",
        [],
    )?;

    Ok(())
}

fn apply_migration_v10(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS template_history (
            id BLOB PRIMARY KEY NOT NULL,
            template_id BLOB NOT NULL,
            field_name TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            changed_at TEXT NOT NULL,
            FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_template_history_template ON template_history(template_id);
        CREATE INDEX IF NOT EXISTS idx_template_history_changed_at ON template_history(changed_at);
        ",
    )?;

    Ok(())
}

fn apply_migration_v11(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TEMP TABLE duplicates AS
        WITH ranked AS (
            SELECT
                id,
                TRIM(question_text) AS normalized_text,
                ROW_NUMBER() OVER (
                    PARTITION BY TRIM(question_text)
                    ORDER BY created_at ASC
                ) AS rn
            FROM templates
        ),
        keepers AS (
            SELECT id, normalized_text FROM ranked WHERE rn = 1
        )
        SELECT r.id AS dup_id, k.id AS keep_id
        FROM ranked r
        JOIN keepers k ON r.normalized_text = k.normalized_text
        WHERE r.rn > 1;

        INSERT OR IGNORE INTO set_templates (set_id, template_id, sort_order)
        SELECT st.set_id, d.keep_id, st.sort_order
        FROM set_templates st
        JOIN duplicates d ON st.template_id = d.dup_id;

        DELETE FROM templates WHERE id IN (SELECT dup_id FROM duplicates);

        DROP TABLE duplicates;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_unique_question_text
        ON templates(TRIM(question_text));
        ",
    )?;

    Ok(())
}

fn apply_migration_v12(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TEMP TABLE duplicates AS
        WITH ranked AS (
            SELECT
                id,
                TRIM(question_text) AS normalized_text,
                ROW_NUMBER() OVER (
                    PARTITION BY TRIM(question_text)
                    ORDER BY created_at ASC
                ) AS rn
            FROM templates
        ),
        keepers AS (
            SELECT id, normalized_text FROM ranked WHERE rn = 1
        )
        SELECT r.id AS dup_id, k.id AS keep_id
        FROM ranked r
        JOIN keepers k ON r.normalized_text = k.normalized_text
        WHERE r.rn > 1;

        INSERT OR IGNORE INTO set_templates (set_id, template_id, sort_order)
        SELECT st.set_id, d.keep_id, st.sort_order
        FROM set_templates st
        JOIN duplicates d ON st.template_id = d.dup_id;

        DELETE FROM templates WHERE id IN (SELECT dup_id FROM duplicates);

        DROP TABLE duplicates;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_unique_question_text
        ON templates(TRIM(question_text));
        ",
    )?;

    Ok(())
}

fn apply_migration_v13(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        ALTER TABLE constants ADD COLUMN formula TEXT;
        ",
    )?;

    Ok(())
}

fn apply_migration_v14(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        ALTER TABLE template_variables ADD COLUMN greater_than_variable_id BLOB REFERENCES variables(id) ON DELETE SET NULL;
        ALTER TABLE template_variables ADD COLUMN less_than_variable_id BLOB REFERENCES variables(id) ON DELETE SET NULL;
        ",
    )?;

    Ok(())
}
