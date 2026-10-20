pub mod auth;
pub mod biomolecule_reports;
pub mod biomolecules;
mod crud;
mod generation;
pub(crate) mod importer;
pub mod practice;
pub mod reports;
pub mod streak_run;
pub mod test_session;

pub use crud::*;
pub use generation::*;
pub use importer::*;

// Crate-internal helpers the HTTP layer (`src/http`) reuses directly instead
// of going through Tauri's `State<'_, AppState>` — see their doc comments in
// `crud.rs` for why they're `pub(crate)` rather than fully `pub`.
pub(crate) use crud::do_get_set_with_templates;
pub(crate) use crud::load_template_with_details;
