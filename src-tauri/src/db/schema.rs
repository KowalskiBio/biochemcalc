use rusqlite::Connection;

/// Schema version — bumped for every migration to keep them idempotent.
#[allow(dead_code)]
const CURRENT_USER_VERSION: u32 = 28;

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

    if user_version < 15 {
        apply_migration_v15(conn)?;
        conn.pragma_update(None, "user_version", "15")?;
    }

    if user_version < 16 {
        apply_migration_v16(conn)?;
        conn.pragma_update(None, "user_version", "16")?;
    }

    if user_version < 17 {
        apply_migration_v17(conn)?;
        conn.pragma_update(None, "user_version", "17")?;
    }

    if user_version < 18 {
        apply_migration_v18(conn)?;
        conn.pragma_update(None, "user_version", "18")?;
    }

    if user_version < 19 {
        apply_migration_v19(conn)?;
        conn.pragma_update(None, "user_version", "19")?;
    }

    if user_version < 20 {
        apply_migration_v20(conn)?;
        conn.pragma_update(None, "user_version", "20")?;
    }

    if user_version < 21 {
        apply_migration_v21(conn)?;
        conn.pragma_update(None, "user_version", "21")?;
    }

    if user_version < 22 {
        apply_migration_v22(conn)?;
        conn.pragma_update(None, "user_version", "22")?;
    }

    if user_version < 23 {
        apply_migration_v23(conn)?;
        conn.pragma_update(None, "user_version", "23")?;
    }

    if user_version < 24 {
        apply_migration_v24(conn)?;
        conn.pragma_update(None, "user_version", "24")?;
    }

    if user_version < 25 {
        apply_migration_v25(conn)?;
        conn.pragma_update(None, "user_version", "25")?;
    }

    if user_version < 26 {
        apply_migration_v26(conn)?;
        conn.pragma_update(None, "user_version", "26")?;
    }

    if user_version < 27 {
        apply_migration_v27(conn)?;
        conn.pragma_update(None, "user_version", "27")?;
    }

    if user_version < 28 {
        apply_migration_v28(conn)?;
        conn.pragma_update(None, "user_version", "28")?;
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
            set_index INTEGER NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('closed', 'open')),
            name TEXT,
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

/// Accounts, server-side sessions, and teacher-issued invite codes for the
/// web deployment. `role` gates access at the HTTP layer (see `src/http`);
/// there is no self-serve signup — registration always consumes a single-use
/// invite code minted by a teacher (or, for the very first account, seeded at
/// server startup from `BIOCHEMCALC_ADMIN_USERNAME`/`_PASSWORD`).
fn apply_migration_v15(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS users (
            id BLOB PRIMARY KEY NOT NULL,
            username TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
            created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase
        ON users(username COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY NOT NULL,
            user_id BLOB NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

        CREATE TABLE IF NOT EXISTS invite_codes (
            code TEXT PRIMARY KEY NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
            created_by BLOB REFERENCES users(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            used_by BLOB REFERENCES users(id) ON DELETE SET NULL,
            used_at TEXT
        );
        ",
    )?;

    Ok(())
}

/// Any teacher can delete any *other* account (see `do_delete_user`), but
/// nothing previously stopped one teacher from deleting a different teacher
/// — including the very first (bootstrap) admin account, which is how
/// invite-code issuance gets started at all. Adds a `protected` flag and
/// retroactively marks the earliest-created teacher account as protected, so
/// deployments that already have real users (created before this migration
/// existed) get the same protection without manual intervention.
fn apply_migration_v16(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        ALTER TABLE users ADD COLUMN protected INTEGER NOT NULL DEFAULT 0;

        UPDATE users SET protected = 1
        WHERE role = 'teacher'
        AND created_at = (SELECT MIN(created_at) FROM users WHERE role = 'teacher');
        ",
    )?;

    Ok(())
}

/// Invite codes change from single-use-forever to multi-use-but-expiring:
/// one active code per role, reusable by any number of people until it
/// expires (7 days) or a teacher revokes it. Generating a new code for a role
/// supersedes the previous one.
///
/// Existing rows are migrated conservatively — codes already consumed under
/// the old single-use rule stay dead rather than silently becoming reusable,
/// and where a role has several unused codes only the newest survives, so the
/// new one-active-code-per-role invariant holds from the first startup.
fn apply_migration_v17(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        ALTER TABLE invite_codes ADD COLUMN expires_at TEXT;
        ALTER TABLE invite_codes ADD COLUMN revoked_at TEXT;
        ALTER TABLE invite_codes ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;
        ",
    )?;

    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();

    // A code that was already redeemed must not come back to life as a
    // multi-use code.
    conn.execute(
        "UPDATE invite_codes SET revoked_at = used_at, use_count = 1 WHERE used_at IS NOT NULL",
        [],
    )?;

    // Backfill the 7-day window from each code's own creation time. Parsed in
    // Rust because the stored timestamps are RFC3339 with fractional seconds
    // and an offset, which SQLite's date functions do not reliably accept.
    let rows: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT code, created_at FROM invite_codes")?;
        let mapped = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        mapped.collect::<rusqlite::Result<_>>()?
    };
    for (code, created_at) in rows {
        let expires_at = chrono::DateTime::parse_from_rfc3339(&created_at)
            .map(|dt| dt.with_timezone(&chrono::Utc) + chrono::Duration::days(7))
            .unwrap_or(now)
            .to_rfc3339();
        conn.execute(
            "UPDATE invite_codes SET expires_at = ?2 WHERE code = ?1",
            rusqlite::params![code, expires_at],
        )?;
    }

    // Enforce one active code per role, keeping the most recently created.
    conn.execute(
        "UPDATE invite_codes SET revoked_at = ?1
         WHERE revoked_at IS NULL
           AND code NOT IN (
               SELECT code FROM invite_codes a
               WHERE a.revoked_at IS NULL
                 AND a.created_at = (
                     SELECT MAX(b.created_at) FROM invite_codes b
                     WHERE b.role = a.role AND b.revoked_at IS NULL
                 )
           )",
        rusqlite::params![now_str],
    )?;

    Ok(())
}

/// The bulk importer used to stamp every imported question with a blanket
/// `sd_allowed = 0.1`. Being an *absolute* tolerance it scaled terribly —
/// ±0.03 % of a 351 g answer but ±20 % of a 0.5 one — and, because an explicit
/// SD overrides the difficulty setting, it silently disabled the easy/medium/
/// hard tolerance control on every imported question.
///
/// Drop those blanket constraints so tolerance comes from difficulty again.
/// Only rows that are exactly the importer's fingerprint are touched: an `sd`
/// constraint of 0.1 carrying no range bounds. Anything a teacher set
/// deliberately (a different SD, or any min/max) is left alone.
fn apply_migration_v18(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM result_constraints
         WHERE constraint_type = 'sd'
           AND sd_allowed = 0.1
           AND min_result IS NULL
           AND max_result IS NULL",
        [],
    )?;
    Ok(())
}

/// One row per practice question served to a student, holding the grading
/// data (correct answer, correct option, tolerance interval) that the client
/// is deliberately never sent — a student grading their own answers in the
/// browser would make the leaderboard meaningless.
///
/// `template_id`/`topic_id` carry no foreign key on purpose: a teacher
/// editing or deleting a question later must not silently erase the score a
/// student already earned answering it.
fn apply_migration_v19(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS practice_attempts (
            id BLOB PRIMARY KEY NOT NULL,
            user_id BLOB NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            template_id BLOB NOT NULL,
            topic_id BLOB NOT NULL,
            point_value INTEGER NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('closed', 'open')),
            correct_answer REAL NOT NULL,
            correct_option INTEGER,
            interval_lo REAL,
            interval_hi REAL,
            answers_data TEXT,
            is_correct INTEGER,
            created_at TEXT NOT NULL,
            answered_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_practice_attempts_user
        ON practice_attempts(user_id);

        CREATE INDEX IF NOT EXISTS idx_practice_attempts_scored
        ON practice_attempts(user_id, is_correct);
        ",
    )?;

    Ok(())
}

fn apply_migration_v20(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "ALTER TABLE topics ADD COLUMN for_students INTEGER NOT NULL DEFAULT 0;",
    )?;
    Ok(())
}

fn apply_migration_v21(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "ALTER TABLE variables ADD COLUMN paired_constants TEXT NOT NULL DEFAULT '';",
    )?;
    Ok(())
}

/// One row per question a student reported as broken, holding the frozen
/// snapshot of exactly what the student was served.
///
/// `question_reports` deliberately carries NO foreign keys: a report must
/// never block deleting the underlying template, topic, or user account.
fn apply_migration_v22(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        ALTER TABLE practice_attempts ADD COLUMN assigned_values TEXT;
        ALTER TABLE practice_attempts ADD COLUMN assigned_strings TEXT;
        ALTER TABLE practice_attempts ADD COLUMN numeric_options TEXT;

        CREATE TABLE IF NOT EXISTS question_reports (
            id BLOB PRIMARY KEY NOT NULL,
            attempt_id BLOB NOT NULL UNIQUE,
            user_id BLOB NOT NULL,
            topic_id BLOB NOT NULL,
            point_value INTEGER NOT NULL,
            message TEXT NOT NULL,
            snapshot TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

/// Drop the `CHECK (set_index BETWEEN 1 AND 4)` constraint from the `sets`
/// table so teachers can append additional sets beyond the initial four.
fn apply_migration_v23(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS sets_new (
            id BLOB PRIMARY KEY NOT NULL,
            category_id BLOB NOT NULL,
            set_index INTEGER NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('closed', 'open')),
            UNIQUE (category_id, set_index),
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
        );

        INSERT INTO sets_new (id, category_id, set_index, mode)
        SELECT id, category_id, set_index, mode FROM sets;

        DROP TABLE sets;
        ALTER TABLE sets_new RENAME TO sets;

        CREATE INDEX IF NOT EXISTS idx_sets_category ON sets(category_id);
        ",
    )?;
    Ok(())
}

fn apply_migration_v24(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("ALTER TABLE sets ADD COLUMN name TEXT;")?;
    Ok(())
}

fn apply_migration_v25(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("ALTER TABLE templates ADD COLUMN significant_digits INTEGER;")?;
    Ok(())
}

fn apply_migration_v26(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("ALTER TABLE variables ADD COLUMN significant_digits INTEGER;")?;
    Ok(())
}

fn apply_migration_v27(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("ALTER TABLE templates ADD COLUMN force_scientific INTEGER NOT NULL DEFAULT 0;")?;
    Ok(())
}

fn apply_migration_v28(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("ALTER TABLE templates ADD COLUMN decoy_formula TEXT;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reproduces exactly what happened on the already-deployed VM: a
    /// `users` table populated under migration v15 (no `protected` column
    /// yet), where the first teacher account was created before v16 existed.
    /// Applying v16 afterwards must retroactively protect that account
    /// without anyone having to intervene by hand.
    #[test]
    fn v16_retroactively_protects_the_earliest_teacher_on_an_existing_v15_database() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk on");

        // Bring the DB to exactly v15, matching the pre-v16 production
        // state. v15's users/sessions/invite_codes tables don't depend on
        // anything from v1-v14, so applying it alone reproduces the
        // users-table shape this test cares about.
        apply_migration_v15(&conn).expect("v15");
        conn.pragma_update(None, "user_version", "15").expect("set version");

        // `randomblob(16)` rather than a hand-written hex literal — a 16-byte
        // UUID blob literal is easy to get subtly the wrong length by hand,
        // and nothing in this test needs the ids to be predictable.
        conn.execute_batch(
            "
            INSERT INTO users (id, username, password_hash, role, created_at) VALUES
                (randomblob(16), 'first-teacher', 'h', 'teacher', '2026-01-01T00:00:00Z'),
                (randomblob(16), 'second-teacher', 'h', 'teacher', '2026-01-02T00:00:00Z'),
                (randomblob(16), 'a-student', 'h', 'student', '2025-12-31T00:00:00Z');
            ",
        )
        .expect("seed pre-v16 users");

        apply_migration_v16(&conn).expect("v16");

        let protected_usernames: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT username FROM users WHERE protected = 1")
                .expect("prepare");
            stmt.query_map([], |row| row.get(0))
                .expect("query")
                .collect::<rusqlite::Result<_>>()
                .expect("collect")
        };

        assert_eq!(protected_usernames, vec!["first-teacher".to_string()]);
    }

    /// Only the importer's blanket ±0.1 goes; deliberate constraints survive.
    #[test]
    fn v18_drops_only_the_blanket_importer_sd_constraint() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_migration_v1(&conn).expect("v1");
        // This test is about one table's cleanup rule, so drop the FK to
        // templates rather than seeding a full template per constraint.
        conn.execute_batch("PRAGMA foreign_keys = OFF;").expect("fk off");

        conn.execute_batch(
            "
            INSERT INTO result_constraints (id, template_id, min_result, max_result, sd_allowed, constraint_type) VALUES
                (randomblob(16), randomblob(16), NULL, NULL, 0.1,  'sd'),
                (randomblob(16), randomblob(16), NULL, NULL, 0.1,  'sd'),
                (randomblob(16), randomblob(16), NULL, NULL, 0.25, 'sd'),
                (randomblob(16), randomblob(16), 0.0,  99.0, 0.1,  'both'),
                (randomblob(16), randomblob(16), 1.0,  50.0, NULL, 'range');
            ",
        )
        .expect("seed constraints");

        apply_migration_v18(&conn).expect("v18");

        let remaining: Vec<(Option<f64>, String)> = {
            let mut stmt = conn
                .prepare("SELECT sd_allowed, constraint_type FROM result_constraints ORDER BY constraint_type")
                .expect("prepare");
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("query")
                .collect::<rusqlite::Result<_>>()
                .expect("collect")
        };

        assert_eq!(remaining.len(), 3, "only the blanket 0.1 sd rows should go");
        assert!(
            remaining.iter().any(|(sd, t)| *sd == Some(0.25) && t == "sd"),
            "a deliberately different SD must survive"
        );
        assert!(
            remaining.iter().any(|(_, t)| t == "both"),
            "a constraint carrying range bounds must survive"
        );
        assert!(
            remaining.iter().any(|(_, t)| t == "range"),
            "a plain range constraint must survive"
        );
    }

    /// Mirrors the live database at the time of the change: two codes already
    /// redeemed under the old single-use rule, plus four unused student codes
    /// created in quick succession.
    #[test]
    fn v17_keeps_one_active_code_per_role_and_never_revives_used_ones() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk on");
        apply_migration_v15(&conn).expect("v15");

        conn.execute_batch(
            "
            INSERT INTO invite_codes (code, role, created_by, created_at, used_by, used_at) VALUES
                ('USEDTEACH','teacher',NULL,'2026-08-05T09:38:37.200132297+00:00',NULL,'2026-08-05T09:40:42.066025641+00:00'),
                ('USEDSTUD','student',NULL,'2026-08-05T11:16:01.449451529+00:00',NULL,'2026-08-05T11:17:01.074570742+00:00'),
                ('STUD1','student',NULL,'2026-08-05T12:10:24.231538308+00:00',NULL,NULL),
                ('STUD2','student',NULL,'2026-08-05T12:10:25.520979480+00:00',NULL,NULL),
                ('STUD3','student',NULL,'2026-08-05T12:10:26.258201230+00:00',NULL,NULL),
                ('NEWEST','student',NULL,'2026-08-05T12:10:26.852137011+00:00',NULL,NULL);
            ",
        )
        .expect("seed pre-v17 codes");

        apply_migration_v17(&conn).expect("v17");

        let active: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT code FROM invite_codes WHERE revoked_at IS NULL ORDER BY code")
                .expect("prepare");
            stmt.query_map([], |row| row.get(0))
                .expect("query")
                .collect::<rusqlite::Result<_>>()
                .expect("collect")
        };
        // Only the newest unused student code survives; the redeemed ones stay
        // dead and the superseded duplicates are revoked.
        assert_eq!(active, vec!["NEWEST".to_string()]);

        // Every code carries a 7-day window measured from its own creation.
        let (created_at, expires_at): (String, String) = conn
            .query_row(
                "SELECT created_at, expires_at FROM invite_codes WHERE code = 'NEWEST'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query newest");
        let created = chrono::DateTime::parse_from_rfc3339(&created_at).expect("created");
        let expires = chrono::DateTime::parse_from_rfc3339(&expires_at).expect("expires");
        assert_eq!((expires - created).num_days(), 7);
    }

    /// A report inserts with uuid blobs and an RFC3339 timestamp — the same
    /// shapes `practice_repo` uses for `practice_attempts`.
    fn insert_report(conn: &Connection, attempt_id: uuid::Uuid) {
        conn.execute(
            "INSERT INTO question_reports (id, attempt_id, user_id, topic_id, point_value, message, snapshot, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                uuid::Uuid::new_v4(),
                attempt_id,
                uuid::Uuid::new_v4(),
                uuid::Uuid::new_v4(),
                3,
                "Špatná jednotka u výsledku.",
                r#"{"question_text":"Kolik molů?","assigned_values":{"n":2.0}}"#,
                "2026-08-07T12:00:00+00:00",
            ],
        )
        .expect("insert question_reports");
    }

    fn user_version(conn: &Connection) -> u32 {
        conn.pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("user_version")
    }

    #[test]
    fn v22_creates_question_reports_and_extends_practice_attempts() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run_migrations(&conn).expect("migrations");

        assert_eq!(user_version(&conn), 28);

        // The three variant columns must exist on practice_attempts.
        conn.execute_batch(
            "SELECT assigned_values, assigned_strings, numeric_options FROM practice_attempts LIMIT 1;",
        )
        .expect("new practice_attempts columns");

        let attempt_id = uuid::Uuid::new_v4();
        insert_report(&conn, attempt_id);
        // One report per served question: the second insert on the same
        // attempt must be rejected by UNIQUE(attempt_id).
        let duplicate = conn.execute(
            "INSERT INTO question_reports (id, attempt_id, user_id, topic_id, point_value, message, snapshot, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                uuid::Uuid::new_v4(),
                attempt_id,
                uuid::Uuid::new_v4(),
                uuid::Uuid::new_v4(),
                3,
                "duplicitní hlášení",
                r#"{"question_text":"?"}"#,
                "2026-08-07T12:01:00+00:00",
            ],
        );
        assert!(duplicate.is_err(), "UNIQUE(attempt_id) must reject a second report");
    }

    type MigrationFn = fn(&Connection) -> Result<(), rusqlite::Error>;

    /// A database that last saw v21 must pick up exactly the v22 block:
    /// replay the ladder by hand up to v21 (mirroring how run_migrations
    /// builds a fresh database), seed an old-shape attempt row, then let
    /// run_migrations finish the job.
    #[test]
    fn v22_applies_cleanly_on_a_pre_v22_database() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        let migrations: [MigrationFn; 21] = [
            apply_migration_v1,
            apply_migration_v2,
            apply_migration_v3,
            apply_migration_v4,
            apply_migration_v5,
            apply_migration_v6,
            apply_migration_v7,
            apply_migration_v8,
            apply_migration_v9,
            apply_migration_v10,
            apply_migration_v11,
            apply_migration_v12,
            apply_migration_v13,
            apply_migration_v14,
            apply_migration_v15,
            apply_migration_v16,
            apply_migration_v17,
            apply_migration_v18,
            apply_migration_v19,
            apply_migration_v20,
            apply_migration_v21,
        ];
        for (index, apply) in migrations.iter().enumerate() {
            apply(&conn).unwrap_or_else(|e| panic!("v{}: {e}", index + 1));
            conn.pragma_update(None, "user_version", format!("{}", index + 1))
                .expect("set version");
        }
        assert_eq!(user_version(&conn), 21);

        // Seed an attempt in the v19 shape (no variant columns yet). No FK
        // targets exist, so drop enforcement like the v18 test does rather
        // than seeding a full template/user graph.
        conn.execute_batch("PRAGMA foreign_keys = OFF;").expect("fk off");
        conn.execute_batch(
            "
            INSERT INTO practice_attempts (
                id, user_id, template_id, topic_id, point_value, mode,
                correct_answer, correct_option, interval_lo, interval_hi,
                answers_data, is_correct, created_at, answered_at
            ) VALUES (
                randomblob(16), randomblob(16), randomblob(16), randomblob(16), 2, 'open',
                42.0, NULL, 41.0, 43.0,
                NULL, NULL, '2026-08-06T10:00:00+00:00', NULL
            );
            ",
        )
        .expect("seed pre-v22 attempt");

        run_migrations(&conn).expect("migrate v21 -> latest");

        assert_eq!(user_version(&conn), 28);
        // The pre-existing row survives, with NULLs in the new columns.
        let (assigned_values, assigned_strings, numeric_options): (
            Option<String>,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT assigned_values, assigned_strings, numeric_options FROM practice_attempts",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read migrated attempt");
        assert_eq!(assigned_values, None);
        assert_eq!(assigned_strings, None);
        assert_eq!(numeric_options, None);

        insert_report(&conn, uuid::Uuid::new_v4());
    }

    #[test]
    fn v28_adds_nullable_decoy_formula_column() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run_migrations(&conn).expect("migrations");

        assert_eq!(user_version(&conn), 28);

        conn.execute_batch("SELECT decoy_formula FROM templates LIMIT 1;")
            .expect("new decoy_formula column");
    }
}
