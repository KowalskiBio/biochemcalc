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

/// Which app sections an account (or the invite code it registered with) can
/// reach. For a teacher it is also the scope of what they manage: a
/// Biomolekuly-only teacher can't edit calculations, and vice versa.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SectionAccess {
    Calculations,
    Biomolecules,
    Both,
}

impl SectionAccess {
    pub fn as_str(&self) -> &'static str {
        match self {
            SectionAccess::Calculations => "calculations",
            SectionAccess::Biomolecules => "biomolecules",
            SectionAccess::Both => "both",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "calculations" => Some(SectionAccess::Calculations),
            "biomolecules" => Some(SectionAccess::Biomolecules),
            "both" => Some(SectionAccess::Both),
            _ => None,
        }
    }

    pub fn allows(&self, section: Section) -> bool {
        matches!(
            (self, section),
            (SectionAccess::Both, _)
                | (SectionAccess::Calculations, Section::Calculations)
                | (SectionAccess::Biomolecules, Section::Biomolecules)
        )
    }

    /// Whether every section `other` reaches is one this access reaches too.
    pub fn covers(&self, other: SectionAccess) -> bool {
        match other {
            SectionAccess::Both => *self == SectionAccess::Both,
            SectionAccess::Calculations => self.allows(Section::Calculations),
            SectionAccess::Biomolecules => self.allows(Section::Biomolecules),
        }
    }
}

/// One app section — what a user is currently learning in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Section {
    Calculations,
    Biomolecules,
}

impl Section {
    pub fn as_str(&self) -> &'static str {
        match self {
            Section::Calculations => "calculations",
            Section::Biomolecules => "biomolecules",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "calculations" => Some(Section::Calculations),
            "biomolecules" => Some(Section::Biomolecules),
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
    /// Optional, set only if the account registered with one — see migration
    /// v37. Enables self-service password recovery; an account without one
    /// has no recovery path.
    pub email: Option<String>,
    /// Sections this account can reach (and, for a teacher, manage).
    pub sections: SectionAccess,
    /// The section the user last chose, used as their landing section.
    /// `None` until a user with access to both picks one.
    pub preferred_section: Option<Section>,
    /// The protected bootstrap account doubles as the sole admin: the only
    /// account that may create, delete, or re-role users.
    pub is_admin: bool,
}

/// An invite code a teacher mints for students. There is no open
/// self-signup — registration always requires a code (or the admin creating
/// the account directly, which is the only way to add a teacher).
///
/// At most one code per (role, sections) is active at a time: minting a new
/// one revokes its predecessor with the same scope. A code stays usable by any number of people until it
/// expires or a teacher revokes it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteCode {
    pub code: String,
    pub role: Role,
    /// Which sections accounts registered with this code can reach.
    pub sections: SectionAccess,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    /// How many accounts have registered with this code so far.
    pub use_count: i64,
}
