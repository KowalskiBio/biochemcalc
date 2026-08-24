use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// One answer field inside a multi-answer variant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerField {
    pub symbol: String,
    pub value: f64,
    pub unit: Option<String>,
    pub numeric_options: Option<Vec<f64>>,
    pub correct_option: Option<u8>,
    /// 1-based index of the "alternace" option, if the template has one and
    /// it evaluated to a value distinct enough from the correct answer to
    /// get its own option slot. A student picking either index is correct.
    #[serde(default)]
    pub alternate_option: Option<u8>,
    pub interval_lo: Option<f64>,
    pub interval_hi: Option<f64>,
}

/// One generated student instance of a template.
///
/// For closed mode the user-facing options are r1-r5 (numeric) and r6
/// ("Žádná možnost není správná."). `correct_option` stores the 1-based index
/// of the correct option (1-6).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    pub id: Uuid,
    pub template_id: Uuid,
    pub assigned_values: HashMap<String, f64>,
    pub assigned_strings: HashMap<String, String>,
    pub correct_answer: f64,
    /// Five numeric answer options shown as r1-r5. One of them equals
    /// `correct_answer` when `correct_option` is in 1..=5.
    pub numeric_options: Option<Vec<f64>>,
    /// 1-based index of the correct option among r1-r6.
    pub correct_option: Option<u8>,
    /// 1-based index of the "alternace" option, mirroring
    /// `AnswerField::alternate_option` for single-answer templates.
    #[serde(default)]
    pub alternate_option: Option<u8>,
    /// Interval bounds used in open mode.
    pub interval_lo: Option<f64>,
    pub interval_hi: Option<f64>,
    /// Deterministic seed used to generate this variant.
    pub seed: u64,
    pub created_at: DateTime<Utc>,
    /// Per-symbol answer data for templates with multiple answer fields
    /// (e.g. `[n mol][m g]`). `None` for legacy single-answer templates.
    pub answers_data: Option<Vec<AnswerField>>,
}

impl Variant {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        template_id: Uuid,
        assigned_values: HashMap<String, f64>,
        assigned_strings: HashMap<String, String>,
        correct_answer: f64,
        numeric_options: Option<Vec<f64>>,
        correct_option: Option<u8>,
        interval_lo: Option<f64>,
        interval_hi: Option<f64>,
        seed: u64,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            template_id,
            assigned_values,
            assigned_strings,
            correct_answer,
            numeric_options,
            correct_option,
            alternate_option: None,
            interval_lo,
            interval_hi,
            seed,
            created_at: Utc::now(),
            answers_data: None,
        }
    }
}
