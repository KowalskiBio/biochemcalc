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
    /// The "Skupina" (group) this topic is organized under on the topics
    /// list page, if any — unrelated to `Category`/"Kategorie" (the fixed
    /// 2/3/4-point-value bucket nested under a topic).
    #[serde(default)]
    pub group_id: Option<Uuid>,
    /// Ordering within its group (or within the "unsorted" bucket when
    /// `group_id` is `None`). Managed exclusively by `TopicRepo::move_to_group`
    /// / `reorder_within_group` — `TopicRepo::update` never touches it.
    #[serde(default)]
    pub position: i32,
}

impl Topic {
    pub fn new(name: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            name,
            created_at: Utc::now(),
            for_students: false,
            group_id: None,
            position: 0,
        }
    }
}
