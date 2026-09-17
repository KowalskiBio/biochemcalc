use crate::models::TestOffer;
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
    /// When true the topic doubles as a timed test in the student test
    /// generator (12 questions: 4 at each of 2/3/4 points), regardless of
    /// `for_students`: a test-only topic is reachable in the test generator
    /// but not in the endless practice generator.
    #[serde(default)]
    pub is_test: bool,
    /// Which of the two tests this topic offers when `is_test` is set:
    /// úvodní (5 questions per band), průběžný (4), or both. Meaningless
    /// while `is_test` is false, and left alone then so unflagging and
    /// reflagging a topic does not lose the teacher's choice.
    #[serde(default)]
    pub test_kind: TestOffer,
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
            is_test: false,
            test_kind: TestOffer::Prubezny,
            group_id: None,
            position: 0,
        }
    }
}
