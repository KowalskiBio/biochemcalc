use serde::{Deserialize, Serialize};

/// The two flavors of endless streak run (`commands::streak_run`): a run
/// that ends the instant the student answers one wrong. "Apprentice" stays
/// scoped to a topic/point value (and optionally one set/mode), same filters
/// as the ordinary practice generator; "master" draws from every topic
/// opted in for students, at any difficulty — the ultimate challenge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreakRunKind {
    Apprentice,
    Master,
}

impl StreakRunKind {
    /// The stored spelling — matches the `CHECK (kind IN ('apprentice', 'master'))`-
    /// shaped convention every mode-like column in this codebase uses, and the
    /// lowercase serde representation above.
    pub fn as_str(self) -> &'static str {
        match self {
            StreakRunKind::Apprentice => "apprentice",
            StreakRunKind::Master => "master",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "apprentice" => Some(StreakRunKind::Apprentice),
            "master" => Some(StreakRunKind::Master),
            _ => None,
        }
    }
}
