use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Answer mode for a template.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TemplateMode {
    /// Multiple choice (a–e) with one correct answer and five distractors,
    /// plus a "Žádná možnost není správná." option.
    Closed,
    /// Free-writing answer with a numeric tolerance interval.
    Open,
}

impl TemplateMode {
    /// The stored spelling — matches the `CHECK (mode IN ('closed', 'open'))`
    /// constraint every table carrying a mode column declares, and the
    /// lowercase serde representation above.
    pub fn as_str(&self) -> &'static str {
        match self {
            TemplateMode::Closed => "closed",
            TemplateMode::Open => "open",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "closed" => Some(TemplateMode::Closed),
            "open" => Some(TemplateMode::Open),
            _ => None,
        }
    }
}

/// Which kind of constraint applies to a result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConstraintType {
    /// Keep the computed result inside [min_result, max_result].
    Range,
    /// Keep the computed result within ±sd_allowed of the target answer.
    Sd,
    /// Both range and SD constraints must hold.
    Both,
}

/// A question blueprint: text with [[X]] placeholders, a formula, and constraints.
/// Answer mode lives on the Set, not here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: Uuid,
    pub question_text: String,
    pub formula: String,
    pub equation_text: String,
    pub numeric_answer: Option<f64>,
    pub result_unit: String,
    pub point_value: u8,
    pub created_at: DateTime<Utc>,
}

impl Template {
    pub fn new(
        question_text: String,
        formula: String,
        equation_text: String,
        numeric_answer: Option<f64>,
        result_unit: String,
        point_value: u8,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            question_text,
            formula,
            equation_text,
            numeric_answer,
            result_unit,
            point_value,
            created_at: Utc::now(),
        }
    }
}

/// Links a template to a variable and the placeholder name used in the text/formula.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVariable {
    pub template_id: Uuid,
    pub variable_id: Uuid,
    pub placeholder: String,
    pub greater_than_variable_id: Option<Uuid>,
    pub less_than_variable_id: Option<Uuid>,
}

/// Links a template to a constant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateConstant {
    pub template_id: Uuid,
    pub constant_id: Uuid,
}

/// Constraints placed on the computed result of a template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultConstraint {
    pub id: Uuid,
    pub template_id: Uuid,
    pub min_result: Option<f64>,
    pub max_result: Option<f64>,
    pub sd_allowed: Option<f64>,
    pub constraint_type: ConstraintType,
}

impl ResultConstraint {
    pub fn new(
        template_id: Uuid,
        min_result: Option<f64>,
        max_result: Option<f64>,
        sd_allowed: Option<f64>,
        constraint_type: ConstraintType,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            template_id,
            min_result,
            max_result,
            sd_allowed,
            constraint_type,
        }
    }
}
