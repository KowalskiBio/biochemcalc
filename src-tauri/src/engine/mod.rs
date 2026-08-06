pub mod answer_targets;
pub mod export_writer;
pub mod formula;
pub mod generator;
pub mod variable_extractor;

pub use answer_targets::{extract_target_symbols, strip_answer_targets, AnswerTarget};
pub use export_writer::{write_txt, ExportQuestion};
pub use formula::{evaluate, extract_molar_mass_constants, FormulaError};
pub use generator::{generate_variant, generate_variants, validate_result, GenerationError};
pub use variable_extractor::{extract_fixed_placeholders, extract_variables, ExtractedValue};
