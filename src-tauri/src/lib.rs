mod commands;
mod db;
pub mod engine;
mod models;

use commands::importer::{do_import_bulk_templates, BulkImportTemplatesPayload};
use db::schema::run_migrations;
use std::path::Path;

/// Import templates in bulk from a JSON payload file into the database at `db_path`.
/// Intended for one-off CLI imports; the Tauri app uses `import_bulk_templates` instead.
pub fn import_bulk_templates_from_json(
    db_path: &Path,
    json_path: &Path,
) -> Result<models::Topic, db::DbError> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| db::DbError::Io(e.to_string()))?;
    run_migrations(&conn).map_err(|e| db::DbError::Io(e.to_string()))?;
    let raw = std::fs::read_to_string(json_path).map_err(|e| db::DbError::Io(e.to_string()))?;
    let payload: BulkImportTemplatesPayload =
        serde_json::from_str(&raw).map_err(db::DbError::Serde)?;
    do_import_bulk_templates(&conn, payload)
}

use db::{initialize_db, AppState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = initialize_db(app)
                .expect("Failed to initialize the database. The application cannot start.");
            app.manage(AppState {
                db: std::sync::Mutex::new(conn),
            });

            // Seed built-in constants and editable atomic weights on first launch.
            {
                let state = app.state::<AppState>();
                let db = state.db.lock().expect("db lock");
                db::repos::ConstantRepo::seed_builtins_if_empty(&db)
                    .expect("Failed to seed built-in constants");
                db::repos::ConstantRepo::seed_atomic_weights_if_missing(&db)
                    .expect("Failed to seed atomic weights");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_topic,
            commands::list_topics,
            commands::get_topic,
            commands::update_topic,
            commands::delete_topic,
            commands::create_variable,
            commands::list_variables,
            commands::get_variable,
            commands::update_variable,
            commands::delete_variable,
            commands::create_constant,
            commands::list_constants,
            commands::get_constant,
            commands::update_constant,
            commands::delete_constant,
            commands::create_template,
            commands::list_templates,
            commands::get_template,
            commands::get_template_with_details,
            commands::get_template_location,
            commands::update_template,
            commands::update_template_with_variables,
            commands::update_templates_by_equation,
            commands::delete_template,
            commands::create_category,
            commands::list_categories,
            commands::list_categories_by_topic,
            commands::get_category,
            commands::get_category_with_sets,
            commands::delete_category,
            commands::update_set_mode,
            commands::add_template_to_set,
            commands::remove_template_from_set,
            commands::reorder_templates_in_set,
            commands::get_set_with_templates,
            commands::generate_for_templates,
            commands::export_to_txt,
            commands::list_output_files,
            commands::read_output_file,
            commands::delete_output_file,
            commands::regenerate_variant,
            commands::save_projekt,
            commands::load_projekt,
            commands::list_projekty,
            commands::update_projekt,
            commands::delete_projekt,
            commands::export_projekt_to_txt,
            commands::list_variable_history_by_template,
            commands::list_all_variable_history,
            commands::list_template_history_by_template,
            commands::list_all_template_history,
            commands::clear_template_history,
            commands::clear_all_history,
            commands::import_test1,
            commands::import_reparse_test1,
            commands::import_bulk_templates,
            commands::get_victor_settings,
            commands::set_victor_settings,
            commands::chat_with_victor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
