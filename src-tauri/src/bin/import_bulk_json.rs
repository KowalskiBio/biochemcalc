use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let json_path = args
        .get(1)
        .cloned()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("bulk_import_payload.json"));

    let home = std::env::var("HOME").expect("HOME env var not set");
    let db_path = PathBuf::from(home)
        .join("Library/Application Support/com.kowalski.biochemcalc/biochemcalc.sqlite");

    let topic = biochemcalc_lib::import_bulk_templates_from_json(&db_path, &json_path)
        .unwrap_or_else(|e| panic!("Import failed: {}", e));

    println!("Imported topic: {} (id: {})", topic.name, topic.id);
}
