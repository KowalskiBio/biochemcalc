use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A teacher-defined group ("Skupina") used to organize topics on the
/// topics list page — e.g. by year or semester. Deliberately unrelated to
/// `Category` ("Kategorie"), which is the fixed 2/3/4-point-value bucket
/// nested under a single topic.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicGroup {
    pub id: Uuid,
    pub name: String,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

impl TopicGroup {
    pub fn new(name: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            name,
            position: 0,
            created_at: Utc::now(),
        }
    }
}
