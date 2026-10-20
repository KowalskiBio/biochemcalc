//! Prints the Biomolekuly library of one SQLite file as JSON (read-only).
//! Usage: export_biomolecules <path/to/biochemcalc.sqlite>

use std::path::PathBuf;

fn main() {
    let Some(db_path) = std::env::args().nth(1).map(PathBuf::from) else {
        eprintln!("usage: export_biomolecules <path/to/biochemcalc.sqlite>");
        std::process::exit(2);
    };
    match biochemcalc_lib::export_biomolecule_data_json(&db_path) {
        Ok(json) => println!("{json}"),
        Err(e) => {
            eprintln!("export_biomolecules: {}: {e}", db_path.display());
            std::process::exit(1);
        }
    }
}
