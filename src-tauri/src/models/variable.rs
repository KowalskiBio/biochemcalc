use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// The kind of value a variable can hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VariableType {
    /// Numeric variable sampled from a range with a step.
    Numeric,
    /// String variable sampled from a list of values.
    String,
}

impl Default for VariableType {
    fn default() -> Self {
        VariableType::Numeric
    }
}

/// How a variable's numeric value is displayed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Notation {
    /// Switch to scientific notation automatically based on magnitude
    /// thresholds (below 0.1, at or above 1e6, or rounding to zero).
    Auto,
    /// Always render in scientific notation (e.g. 1,23×10⁴).
    Scientific,
    /// Always render as a plain decimal, falling back to scientific
    /// only when the value would otherwise round to zero.
    Normal,
}

impl Default for Notation {
    fn default() -> Self {
        Notation::Auto
    }
}

impl Notation {
    pub fn from_str(s: &str) -> Self {
        match s {
            "scientific" => Notation::Scientific,
            "normal" => Notation::Normal,
            _ => Notation::Auto,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Notation::Auto => "auto",
            Notation::Scientific => "scientific",
            Notation::Normal => "normal",
        }
    }
}

/// A variable placeholder such as X or Y with a numeric range or string values.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variable {
    pub id: Uuid,
    pub name: String,
    pub symbol: String,
    pub var_type: VariableType,
    pub min_value: f64,
    pub max_value: f64,
    pub step: f64,
    pub unit: String,
    pub precision: u8,
    pub string_values: Option<Vec<String>>,
    /// Per-value numeric constants paired with each string value.
    /// Index i holds the constants for `string_values[i]`.
    pub paired_constants: Option<Vec<HashMap<String, f64>>>,
    pub greater_than: Option<String>,
    pub less_than: Option<String>,
    /// When set, displayed values use this many significant figures instead
    /// of the fixed decimal-place `precision`.
    pub significant_digits: Option<u8>,
    /// Controls how the variable's value is displayed: auto (threshold-based),
    /// always scientific, or always plain decimal. `None` is treated as `Auto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notation: Option<Notation>,
    pub created_at: DateTime<Utc>,
}

impl Variable {
    pub fn new(
        name: String,
        symbol: String,
        min_value: f64,
        max_value: f64,
        step: f64,
        unit: String,
        precision: u8,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            name,
            symbol,
            var_type: VariableType::Numeric,
            min_value,
            max_value,
            step,
            unit,
            precision,
            string_values: None,
            paired_constants: None,
            greater_than: None,
            less_than: None,
            significant_digits: None,
            notation: None,
            created_at: Utc::now(),
        }
    }

    pub fn new_string(name: String, symbol: String, values: Vec<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            name,
            symbol,
            var_type: VariableType::String,
            min_value: 0.0,
            max_value: 0.0,
            step: 1.0,
            unit: String::new(),
            precision: 0,
            string_values: Some(values),
            paired_constants: None,
            greater_than: None,
            less_than: None,
            significant_digits: None,
            notation: None,
            created_at: Utc::now(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Name must not be empty".into());
        }
        if self.symbol.trim().is_empty() || self.symbol.len() > 50 {
            return Err("Symbol must be 1–50 word characters".into());
        }
        if !self.symbol.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err("Symbol must be letters, numbers or underscores".into());
        }

        match self.var_type {
            VariableType::Numeric => {
                if self.min_value >= self.max_value {
                    return Err("min_value must be less than max_value".into());
                }
                if self.step <= 0.0 {
                    return Err("Step must be positive".into());
                }
                if self.precision > 10 {
                    return Err("Precision must be ≤ 10".into());
                }
            }
            VariableType::String => {
                let values = self
                    .string_values
                    .as_ref()
                    .filter(|v| !v.is_empty())
                    .ok_or_else(|| "String variable must have at least one value".to_string())?;
                for value in values {
                    if value.trim().is_empty() {
                        return Err("String values must not be empty".into());
                    }
                }
            }
        }

        Ok(())
    }
}
