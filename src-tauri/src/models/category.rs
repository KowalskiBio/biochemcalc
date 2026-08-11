use super::template::TemplateMode;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A point-value category within a topic: 2, 3, or 4 points.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub point_value: u8,
    pub created_at: DateTime<Utc>,
}

impl Category {
    pub fn new(topic_id: Uuid, point_value: u8) -> Self {
        Self {
            id: Uuid::new_v4(),
            topic_id,
            point_value,
            created_at: Utc::now(),
        }
    }
}

/// A set inside a category. Each category has exactly four sets (3 closed, 1 open).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Set {
    pub id: Uuid,
    pub category_id: Uuid,
    pub set_index: u8,
    pub mode: TemplateMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Set {
    pub fn new(category_id: Uuid, set_index: u8, mode: TemplateMode) -> Self {
        Self {
            id: Uuid::new_v4(),
            category_id,
            set_index,
            mode,
            name: None,
        }
    }
}

/// Links a template into a set, with ordering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTemplate {
    pub set_id: Uuid,
    pub template_id: Uuid,
    pub sort_order: u32,
}

impl SetTemplate {
    pub fn new(set_id: Uuid, template_id: Uuid, sort_order: u32) -> Self {
        Self {
            set_id,
            template_id,
            sort_order,
        }
    }
}
