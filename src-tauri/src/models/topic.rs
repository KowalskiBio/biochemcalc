use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A topic groups categories (point-value groups) under a common heading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    /// When true the topic is visible to students in the practice generator.
    /// When false it is teacher-only (not shown to students).
    pub for_students: bool,
}

impl Topic {
    pub fn new(name: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            name,
            created_at: Utc::now(),
            for_students: false,
        }
    }
}
