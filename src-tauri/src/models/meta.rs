use super::template::TemplateMode;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---- CategoryPackage & sub-entities ----

/// A saved, fully generated category ready to be merged into an output file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CategoryPackage {
    pub id: Uuid,
    pub point_value: u8,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

/// A saved set inside a category package.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SetPackage {
    pub id: Uuid,
    pub category_package_id: Uuid,
    pub set_index: u8,
    pub mode: TemplateMode,
}

/// A saved variant inside a set package.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct VariantPackage {
    pub id: Uuid,
    pub set_package_id: Uuid,
    pub variant_id: Uuid,
    pub sort_order: u32,
}

// ---- WizardSession ----

/// A lightweight in-progress wizard session, persisted for crash recovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct WizardSession {
    pub id: Uuid,
    pub point_value: Option<u8>,
    pub student_count: u32,
    pub sets: Vec<WizardSessionSet>,
    pub dirty: bool,
    pub updated_at: DateTime<Utc>,
}

/// One set inside the current wizard session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct WizardSessionSet {
    pub set_index: u8,
    pub mode: TemplateMode,
    pub template_ids: Vec<Uuid>,
}

// ---- OutputFile ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputStatus {
    Draft,
    Generating,
    Ready,
    Exported,
    Failed,
}

/// Metadata about a generated output `.txt` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputFile {
    pub id: Uuid,
    pub filename: String,
    pub file_path: String,
    pub category_package_ids: Vec<Uuid>,
    pub status: OutputStatus,
    pub created_at: DateTime<Utc>,
}

// ---- AppSettings ----

/// Generic key-value store for app settings and preferences.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct AppSetting {
    pub key: String,
    pub value: serde_json::Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableHistoryEntry {
    pub id: Uuid,
    pub variable_id: Uuid,
    pub template_id: Uuid,
    pub field_name: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub changed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateHistoryEntry {
    pub id: Uuid,
    pub template_id: Uuid,
    pub field_name: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub changed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Projekt {
    pub id: Uuid,
    pub name: String,
    pub file_path: String,
    pub question_count: u32,
    pub mode: TemplateMode,
    pub topic_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjektQuestion {
    pub template_id: uuid::Uuid,
    pub question_text: String,
    pub result_unit: String,
    pub point_value: u8,
    pub correct_answer: Option<f64>,
    pub override_answer: Option<f64>,
    pub assigned_values: std::collections::HashMap<String, serde_json::Value>,
    pub assigned_strings: std::collections::HashMap<String, String>,
    pub variable_precisions: std::collections::HashMap<String, u8>,
    #[serde(default)]
    pub variable_significant_digits: std::collections::HashMap<String, u8>,
    pub result_precision: u8,
    #[serde(default)]
    pub significant_digits: Option<u8>,
    pub numeric_options: Option<Vec<f64>>,
    pub correct_option: Option<u8>,
    pub interval_lo: Option<f64>,
    pub interval_hi: Option<f64>,
    pub mode: TemplateMode,
    pub seed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjektContent {
    pub projekt_id: Uuid,
    pub questions: Vec<ProjektQuestion>,
}
