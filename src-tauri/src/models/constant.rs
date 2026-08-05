use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A physical or mathematical constant usable in formulas.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Constant {
    pub id: Uuid,
    pub name: String,
    pub symbol: String,
    pub value: f64,
    pub unit: String,
    pub is_builtin: bool,
    pub formula: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl Constant {
    pub fn new(name: String, symbol: String, value: f64, unit: String, is_builtin: bool) -> Self {
        Self {
            id: Uuid::new_v4(),
            name,
            symbol,
            value,
            unit,
            is_builtin,
            formula: None,
            created_at: Utc::now(),
        }
    }

    /// Pre-seeded constants that ship with the application.
    pub fn builtin_constants() -> Vec<Self> {
        vec![
            Self::new(
                "Avogadro".into(),
                "N_A".into(),
                6.02214076e23,
                "mol⁻¹".into(),
                true,
            ),
            Self::new(
                "Pi".into(),
                "π".into(),
                std::f64::consts::PI,
                "".into(),
                true,
            ),
            Self::new(
                "Euler".into(),
                "e".into(),
                std::f64::consts::E,
                "".into(),
                true,
            ),
            Self::new(
                "Plynová konstanta".into(),
                "R".into(),
                8.314462618,
                "J·mol⁻¹·K⁻¹".into(),
                true,
            ),
            Self::new(
                "Faraday".into(),
                "Far".into(),
                96485.33212,
                "C·mol⁻¹".into(),
                true,
            ),
        ]
    }
}
