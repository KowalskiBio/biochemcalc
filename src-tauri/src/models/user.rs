use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Account role. Gates access at the HTTP layer (see `src/http/middleware.rs`)
/// and, on the frontend, which routes/nav items are shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Teacher,
    Student,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Teacher => "teacher",
            Role::Student => "student",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "teacher" => Some(Role::Teacher),
            "student" => Some(Role::Student),
            _ => None,
        }
    }
}

/// A registered account, as returned to the frontend. Deliberately carries no
/// password hash — see `UserRecord` in `db::repos::user_repo` for the
/// internal, hash-carrying shape used only during login verification.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub role: Role,
    pub created_at: DateTime<Utc>,
    /// The bootstrap admin account (or, on already-deployed installs, the
    /// earliest-created teacher — see migration v16) — cannot be deleted by
    /// anyone, including other teachers, so invite-code issuance can never
    /// be locked out entirely. See `do_delete_user`.
    pub protected: bool,
}

/// An invite code a teacher mints for a given role. There is no open
/// self-signup — registration always requires a code.
///
/// At most one code per role is active at a time: minting a new one revokes
/// its predecessor. A code stays usable by any number of people until it
/// expires or a teacher revokes it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteCode {
    pub code: String,
    pub role: Role,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    /// How many accounts have registered with this code so far.
    pub use_count: i64,
}
