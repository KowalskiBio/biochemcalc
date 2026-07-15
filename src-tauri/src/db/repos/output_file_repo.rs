use crate::db::DbError;
use crate::models::{OutputFile, OutputStatus};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct OutputFileRepo;

impl OutputFileRepo {
    pub fn insert(conn: &Connection, file: &OutputFile) -> Result<(), DbError> {
        let category_ids_json =
            serde_json::to_string(&file.category_package_ids).map_err(|e| DbError::Serde(e))?;
        conn.execute(
            "INSERT INTO output_files (id, filename, file_path, category_package_ids, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                file.id,
                file.filename,
                file.file_path,
                category_ids_json,
                status_to_str(&file.status),
                file.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_all(conn: &Connection) -> Result<Vec<OutputFile>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, filename, file_path, category_package_ids, status, created_at
             FROM output_files ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(OutputFile {
                id: row.get(0)?,
                filename: row.get(1)?,
                file_path: row.get(2)?,
                category_package_ids: parse_uuid_list(&row.get::<_, String>(3)?),
                status: str_to_status(&row.get::<_, String>(4)?),
                created_at: parse_dt(row.get::<_, String>(5)?),
            })
        })?;
        let mut files = Vec::new();
        for r in rows {
            files.push(r?);
        }
        Ok(files)
    }

    pub fn get_by_id(conn: &Connection, id: &Uuid) -> Result<OutputFile, DbError> {
        conn.query_row(
            "SELECT id, filename, file_path, category_package_ids, status, created_at
             FROM output_files WHERE id = ?1",
            params![id],
            |row| {
                Ok(OutputFile {
                    id: row.get(0)?,
                    filename: row.get(1)?,
                    file_path: row.get(2)?,
                    category_package_ids: parse_uuid_list(&row.get::<_, String>(3)?),
                    status: str_to_status(&row.get::<_, String>(4)?),
                    created_at: parse_dt(row.get::<_, String>(5)?),
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound(format!("Output file {id}")),
            other => DbError::Sqlite(other),
        })
    }

    pub fn delete(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let affected = conn.execute("DELETE FROM output_files WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Output file {id}")));
        }
        Ok(())
    }
}

fn parse_uuid_list(s: &str) -> Vec<Uuid> {
    serde_json::from_str::<Vec<Uuid>>(s).unwrap_or_default()
}

fn status_to_str(status: &OutputStatus) -> &'static str {
    match status {
        OutputStatus::Draft => "draft",
        OutputStatus::Generating => "generating",
        OutputStatus::Ready => "ready",
        OutputStatus::Exported => "exported",
        OutputStatus::Failed => "failed",
    }
}

fn str_to_status(s: &str) -> OutputStatus {
    match s {
        "draft" => OutputStatus::Draft,
        "generating" => OutputStatus::Generating,
        "ready" => OutputStatus::Ready,
        "exported" => OutputStatus::Exported,
        "failed" => OutputStatus::Failed,
        other => {
            eprintln!("Unexpected OutputStatus value in DB: {other}");
            OutputStatus::Failed
        }
    }
}

fn parse_dt(s: String) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(&s)
        .unwrap_or_else(|_| {
            chrono::DateTime::parse_from_rfc3339("1970-01-01T00:00:00Z").expect("hardcoded fallback")
        })
        .with_timezone(&chrono::Utc)
}
