//! Registration, login, and invite-code issuance for the web deployment.
//!
//! These are plain functions (not `#[tauri::command]`s) because the desktop
//! Tauri build has no concept of accounts — it's a single trusted local user.
//! Only the HTTP server (`src/http`) calls into this module; its middleware
//! resolves sessions and attaches the current user before a handler ever
//! needs to look anything up here.

use crate::db::repos::{InviteCodeRepo, PasswordResetTokenRepo, SessionRepo, UserRecord, UserRepo};
use crate::db::DbError;
use crate::models::{InviteCode, Role, User};
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;
use serde::Deserialize;
use uuid::Uuid;

/// Sessions slide forward on each authenticated request; this is the window
/// of inactivity after which a session is treated as expired.
const SESSION_TTL_DAYS: i64 = 30;

/// Much shorter than a session: a reset link is meant to work exactly once,
/// right away, not to be a standing credential.
const RESET_TOKEN_TTL_HOURS: i64 = 1;

/// Deliberately loose — this only needs to catch obvious typos before a
/// wasted SMTP round trip and to keep garbage out of the `email` column. A
/// real deliverability check happens implicitly: if it's wrong, the reset
/// email just never arrives, which is self-correcting from the user's side.
fn is_plausible_email(s: &str) -> bool {
    let re = regex::Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").expect("valid email regex");
    re.is_match(s)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPayload {
    pub username: String,
    pub password: String,
    pub invite_code: String,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginPayload {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInviteCodePayload {
    pub role: String,
}

/// A successful register/login: the public user plus a fresh opaque session
/// token. Deliberately not `Serialize` — the token must only ever leave this
/// process in a `Set-Cookie` header, never in a JSON response body.
pub struct AuthSession {
    pub user: User,
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

pub fn hash_password(password: &str) -> Result<String, DbError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| DbError::Internal(format!("password hashing failed: {e}")))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// A 64-character hex token from two concatenated v4 UUIDs — opaque, and
/// drawn from the same CSPRNG-backed source already used for every other ID
/// in this codebase, so no new randomness dependency is introduced.
fn generate_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// Shorter, easier-to-type-out-loud code for a teacher to hand a student.
fn generate_invite_code() -> String {
    Uuid::new_v4().simple().to_string()[..10].to_ascii_uppercase()
}

fn create_session(conn: &Connection, user: User) -> Result<AuthSession, DbError> {
    let token = generate_token();
    let expires_at = Utc::now() + Duration::days(SESSION_TTL_DAYS);
    SessionRepo::create(conn, &token, &user.id, expires_at)?;
    Ok(AuthSession {
        user,
        token,
        expires_at,
    })
}

pub fn do_register(conn: &Connection, payload: RegisterPayload) -> Result<AuthSession, DbError> {
    let username = payload.username.trim();
    if username.is_empty() {
        return Err(DbError::Validation("Username is required".into()));
    }
    if payload.password.len() < 8 {
        return Err(DbError::Validation(
            "Password must be at least 8 characters".into(),
        ));
    }

    let code = payload.invite_code.trim();
    let invite = InviteCodeRepo::find_valid(conn, code)?
        .ok_or_else(|| DbError::Validation("Invite code is invalid or expired".into()))?;

    let email = match payload.email.as_deref().map(str::trim) {
        Some("") | None => None,
        Some(e) if !is_plausible_email(e) => {
            return Err(DbError::Validation("Enter a valid email address".into()));
        }
        Some(e) => Some(e.to_string()),
    };

    let password_hash = hash_password(&payload.password)?;
    let record = UserRecord {
        id: Uuid::new_v4(),
        username: username.to_string(),
        password_hash,
        role: invite.role,
        created_at: Utc::now(),
        protected: false,
        email,
    };
    UserRepo::insert(conn, &record)?;
    InviteCodeRepo::record_use(conn, &invite.code)?;

    create_session(conn, record.into_public())
}

pub fn do_login(conn: &Connection, payload: LoginPayload) -> Result<AuthSession, DbError> {
    SessionRepo::delete_expired(conn)?;

    let invalid_credentials = || DbError::Unauthorized("Invalid username or password".into());

    let record = UserRepo::find_by_username(conn, payload.username.trim())?
        .ok_or_else(invalid_credentials)?;
    if !verify_password(&payload.password, &record.password_hash) {
        return Err(invalid_credentials());
    }

    create_session(conn, record.into_public())
}

pub fn do_logout(conn: &Connection, token: &str) -> Result<(), DbError> {
    SessionRepo::delete(conn, token)
}

pub fn do_create_invite_code(
    conn: &Connection,
    created_by: &Uuid,
    payload: CreateInviteCodePayload,
) -> Result<InviteCode, DbError> {
    let role = Role::parse(&payload.role)
        .ok_or_else(|| DbError::Validation(format!("Invalid role: {}", payload.role)))?;
    let code = generate_invite_code();
    InviteCodeRepo::create(conn, &code, role, Some(*created_by))?;
    InviteCodeRepo::find_valid(conn, &code)?
        .ok_or_else(|| DbError::Internal("invite code vanished immediately after creation".into()))
}

pub fn do_list_invite_codes(conn: &Connection) -> Result<Vec<InviteCode>, DbError> {
    InviteCodeRepo::list_active(conn)
}

pub fn do_revoke_invite_code(conn: &Connection, code: &str) -> Result<(), DbError> {
    InviteCodeRepo::revoke(conn, code.trim())
}

pub fn do_list_users(conn: &Connection) -> Result<Vec<User>, DbError> {
    Ok(UserRepo::list_all(conn)?
        .into_iter()
        .map(UserRecord::into_public)
        .collect())
}

/// A teacher can delete any account except their own (self-deletion would
/// let the last teacher lock themselves out with no invite-code issuer left
/// to recover from) and except the protected bootstrap admin (see migration
/// v16) — otherwise any second teacher account could delete the original
/// admin outright, which is the surprising behavior this guards against.
pub fn do_delete_user(conn: &Connection, requesting_user_id: &Uuid, target_id: &Uuid) -> Result<(), DbError> {
    if requesting_user_id == target_id {
        return Err(DbError::Validation(
            "You cannot delete your own account".into(),
        ));
    }
    let target = UserRepo::get_by_id(conn, target_id)?;
    if target.protected {
        return Err(DbError::Validation(
            "This account is protected and cannot be deleted".into(),
        ));
    }
    UserRepo::delete(conn, target_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordPayload {
    pub current_password: String,
    pub new_password: String,
}

/// Either role — any logged-in user can change their own password. Requires
/// the current password so a hijacked-but-still-open browser session can't
/// silently lock the real owner out.
pub fn do_change_password(
    conn: &Connection,
    user_id: &Uuid,
    payload: ChangePasswordPayload,
) -> Result<(), DbError> {
    if payload.new_password.len() < 8 {
        return Err(DbError::Validation(
            "Password must be at least 8 characters".into(),
        ));
    }

    let record = UserRepo::get_by_id(conn, user_id)?;
    if !verify_password(&payload.current_password, &record.password_hash) {
        return Err(DbError::Unauthorized("Current password is incorrect".into()));
    }

    let new_hash = hash_password(&payload.new_password)?;
    UserRepo::update_password(conn, user_id, &new_hash)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgotPasswordPayload {
    pub email: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetPasswordPayload {
    pub token: String,
    pub new_password: String,
}

/// The user plus a freshly issued reset token, handed back to the HTTP layer
/// so *it* can send the email. Deliberately not done here — every other
/// `do_*` function touches only `conn`, and email delivery is network I/O
/// with its own failure mode that must never turn into a 500 on this
/// endpoint (that would leak "this email exists but sending failed" vs.
/// "this email doesn't exist").
pub struct PasswordResetIssued {
    pub user: User,
    pub token: String,
}

/// Always `Ok` unless the DB itself fails — a nonexistent email is `Ok(None)`,
/// never an error, so the HTTP handler can return an identical response
/// either way and never leak whether an account exists.
pub fn do_forgot_password(
    conn: &Connection,
    payload: ForgotPasswordPayload,
) -> Result<Option<PasswordResetIssued>, DbError> {
    let email = payload.email.trim();
    let Some(record) = UserRepo::find_by_email(conn, email)? else {
        return Ok(None);
    };

    PasswordResetTokenRepo::invalidate_all_for_user(conn, &record.id)?;
    let token = generate_token();
    let expires_at = Utc::now() + Duration::hours(RESET_TOKEN_TTL_HOURS);
    PasswordResetTokenRepo::create(conn, &token, &record.id, expires_at)?;

    Ok(Some(PasswordResetIssued {
        user: record.into_public(),
        token,
    }))
}

/// A reset is a strong signal the old session(s) may be compromised (or just
/// that the owner has forgotten enough to need this) — killing them means
/// whoever just proved control of the mailbox is the only one left logged in.
pub fn do_reset_password(conn: &Connection, payload: ResetPasswordPayload) -> Result<(), DbError> {
    if payload.new_password.len() < 8 {
        return Err(DbError::Validation(
            "Password must be at least 8 characters".into(),
        ));
    }

    let token = payload.token.trim();
    let record = PasswordResetTokenRepo::find_valid(conn, token)?
        .ok_or_else(|| DbError::Validation("Reset link is invalid or expired".into()))?;

    let new_hash = hash_password(&payload.new_password)?;
    UserRepo::update_password(conn, &record.user_id, &new_hash)?;
    PasswordResetTokenRepo::mark_used(conn, token)?;
    SessionRepo::delete_all_for_user(conn, &record.user_id)?;
    Ok(())
}

/// First-run only: if the `users` table is empty and admin credentials were
/// provided via env vars, seed the one teacher account needed to bootstrap
/// invite-code issuance (nothing can invite the first account into
/// existence). Mirrors the existing "seed if empty" pattern used for
/// built-in constants at app startup.
pub fn do_bootstrap_admin_if_empty(
    conn: &Connection,
    username: &str,
    password: &str,
) -> Result<Option<User>, DbError> {
    if UserRepo::count_all(conn)? > 0 {
        return Ok(None);
    }
    let password_hash = hash_password(password)?;
    let record = UserRecord {
        id: Uuid::new_v4(),
        username: username.trim().to_string(),
        password_hash,
        role: Role::Teacher,
        created_at: Utc::now(),
        protected: true,
        email: None,
    };
    UserRepo::insert(conn, &record)?;
    Ok(Some(record.into_public()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    #[test]
    fn hash_and_verify_round_trip() {
        let hash = hash_password("correct horse battery staple").expect("hash");
        assert!(verify_password("correct horse battery staple", &hash));
        assert!(!verify_password("wrong password", &hash));
    }

    #[test]
    fn register_consumes_invite_code_and_creates_session() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "STUDENT1", Role::Student, None).expect("create invite");

        let session = do_register(
            &conn,
            RegisterPayload {
                username: "alice".into(),
                password: "password123".into(),
                invite_code: "STUDENT1".into(),
                email: None,
            },
        )
        .expect("register");

        assert_eq!(session.user.role, Role::Student);
        // The code stays usable — it is meant to onboard a whole class — but
        // now records that one person has redeemed it.
        let invite = InviteCodeRepo::find_valid(&conn, "STUDENT1")
            .expect("find")
            .expect("code still valid");
        assert_eq!(invite.use_count, 1);

        let found = SessionRepo::find_valid(&conn, &session.token)
            .expect("find session")
            .expect("session present");
        assert_eq!(found.user_id, session.user.id);
    }

    /// One code onboards a whole class, so a second person may reuse it.
    #[test]
    fn register_accepts_a_reused_invite_code() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "SHARED", Role::Student, None).expect("create invite");
        for username in ["bob", "carol"] {
            do_register(
                &conn,
                RegisterPayload {
                    username: username.into(),
                    password: "password123".into(),
                    invite_code: "SHARED".into(),
                    email: None,
                },
            )
            .unwrap_or_else(|e| panic!("{username} should be able to register: {e}"));
        }

        let invite = InviteCodeRepo::find_valid(&conn, "SHARED")
            .expect("find")
            .expect("still valid");
        assert_eq!(invite.use_count, 2);
    }

    /// Superseding a code must lock out anyone still holding the old one.
    #[test]
    fn register_rejects_a_superseded_invite_code() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "OLDCODE", Role::Student, None).expect("create old");
        InviteCodeRepo::create(&conn, "NEWCODE", Role::Student, None).expect("create new");

        let result = do_register(
            &conn,
            RegisterPayload {
                username: "late".into(),
                password: "password123".into(),
                invite_code: "OLDCODE".into(),
                email: None,
            },
        );
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[test]
    fn register_rejects_an_expired_invite_code() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "EXPIRED", Role::Student, None).expect("create");
        conn.execute(
            "UPDATE invite_codes SET expires_at = ?2 WHERE code = ?1",
            rusqlite::params!["EXPIRED", (Utc::now() - Duration::days(1)).to_rfc3339()],
        )
        .expect("backdate expiry");

        let result = do_register(
            &conn,
            RegisterPayload {
                username: "toolate".into(),
                password: "password123".into(),
                invite_code: "EXPIRED".into(),
                email: None,
            },
        );
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[test]
    fn register_with_valid_email_succeeds_and_stores_it() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "EMAILED", Role::Student, None).expect("create invite");

        let session = do_register(
            &conn,
            RegisterPayload {
                username: "hasemail".into(),
                password: "password123".into(),
                invite_code: "EMAILED".into(),
                email: Some("Student@Example.com".into()),
            },
        )
        .expect("register");

        assert_eq!(session.user.email.as_deref(), Some("Student@Example.com"));
    }

    #[test]
    fn register_without_email_still_succeeds() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "NOEMAIL", Role::Student, None).expect("create invite");

        let session = do_register(
            &conn,
            RegisterPayload {
                username: "noemail".into(),
                password: "password123".into(),
                invite_code: "NOEMAIL".into(),
                email: None,
            },
        )
        .expect("register");

        assert_eq!(session.user.email, None);
    }

    #[test]
    fn register_rejects_malformed_email() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "BADEMAIL", Role::Student, None).expect("create invite");

        let result = do_register(
            &conn,
            RegisterPayload {
                username: "bademail".into(),
                password: "password123".into(),
                invite_code: "BADEMAIL".into(),
                email: Some("not-an-email".into()),
            },
        );
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[test]
    fn register_rejects_duplicate_email_case_insensitively() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "DUPEMAIL", Role::Student, None).expect("create invite");
        do_register(
            &conn,
            RegisterPayload {
                username: "first".into(),
                password: "password123".into(),
                invite_code: "DUPEMAIL".into(),
                email: Some("dup@example.com".into()),
            },
        )
        .expect("register first");

        let result = do_register(
            &conn,
            RegisterPayload {
                username: "second".into(),
                password: "password123".into(),
                invite_code: "DUPEMAIL".into(),
                email: Some("DUP@Example.com".into()),
            },
        );
        assert!(matches!(result, Err(DbError::Conflict(_))));
    }

    #[test]
    fn login_with_correct_password_succeeds() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "T1", Role::Teacher, None).expect("create invite");
        do_register(
            &conn,
            RegisterPayload {
                username: "dave".into(),
                password: "hunter2sword".into(),
                invite_code: "T1".into(),
                email: None,
            },
        )
        .expect("register");

        let session = do_login(
            &conn,
            LoginPayload {
                username: "dave".into(),
                password: "hunter2sword".into(),
            },
        )
        .expect("login");
        assert_eq!(session.user.username, "dave");
    }

    #[test]
    fn login_with_wrong_password_is_unauthorized() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "T2", Role::Teacher, None).expect("create invite");
        do_register(
            &conn,
            RegisterPayload {
                username: "erin".into(),
                password: "correcthorse1".into(),
                invite_code: "T2".into(),
                email: None,
            },
        )
        .expect("register");

        let result = do_login(
            &conn,
            LoginPayload {
                username: "erin".into(),
                password: "wrongpassword".into(),
            },
        );
        assert!(matches!(result, Err(DbError::Unauthorized(_))));
    }

    #[test]
    fn login_with_unknown_username_is_unauthorized() {
        let conn = setup_conn();
        let result = do_login(
            &conn,
            LoginPayload {
                username: "ghost".into(),
                password: "whatever1".into(),
            },
        );
        assert!(matches!(result, Err(DbError::Unauthorized(_))));
    }

    #[test]
    fn logout_deletes_session() {
        let conn = setup_conn();
        InviteCodeRepo::create(&conn, "T3", Role::Teacher, None).expect("create invite");
        let session = do_register(
            &conn,
            RegisterPayload {
                username: "frank".into(),
                password: "password123".into(),
                invite_code: "T3".into(),
                email: None,
            },
        )
        .expect("register");

        do_logout(&conn, &session.token).expect("logout");
        assert!(SessionRepo::find_valid(&conn, &session.token)
            .expect("find")
            .is_none());
    }

    #[test]
    fn bootstrap_admin_only_seeds_when_empty() {
        let conn = setup_conn();
        let first = do_bootstrap_admin_if_empty(&conn, "admin", "adminpassword1")
            .expect("bootstrap")
            .expect("created");
        assert_eq!(first.role, Role::Teacher);

        let second = do_bootstrap_admin_if_empty(&conn, "someone-else", "irrelevant1")
            .expect("bootstrap noop");
        assert!(second.is_none());
        assert_eq!(UserRepo::count_all(&conn).expect("count"), 1);
    }

    #[test]
    fn create_invite_code_is_usable_for_registration() {
        let conn = setup_conn();
        let teacher = do_bootstrap_admin_if_empty(&conn, "teacher", "teacherpassword1")
            .expect("bootstrap")
            .expect("created");

        let invite = do_create_invite_code(
            &conn,
            &teacher.id,
            CreateInviteCodePayload {
                role: "student".into(),
            },
        )
        .expect("create invite code");
        assert_eq!(invite.role, Role::Student);

        let session = do_register(
            &conn,
            RegisterPayload {
                username: "student1".into(),
                password: "studentpassword1".into(),
                invite_code: invite.code,
                email: None,
            },
        )
        .expect("register with fresh invite");
        assert_eq!(session.user.role, Role::Student);
    }

    #[test]
    fn list_users_returns_everyone_without_password_hashes() {
        let conn = setup_conn();
        do_bootstrap_admin_if_empty(&conn, "teacher", "teacherpassword1")
            .expect("bootstrap")
            .expect("created");
        InviteCodeRepo::create(&conn, "LISTME", Role::Student, None).expect("create invite");
        do_register(
            &conn,
            RegisterPayload {
                username: "pupil".into(),
                password: "pupilpassword1".into(),
                invite_code: "LISTME".into(),
                email: None,
            },
        )
        .expect("register");

        let users = do_list_users(&conn).expect("list users");
        assert_eq!(users.len(), 2);
        assert!(users.iter().any(|u| u.username == "teacher"));
        assert!(users.iter().any(|u| u.username == "pupil"));
    }

    #[test]
    fn teacher_cannot_delete_own_account() {
        let conn = setup_conn();
        let teacher = do_bootstrap_admin_if_empty(&conn, "solo-teacher", "teacherpassword1")
            .expect("bootstrap")
            .expect("created");

        let result = do_delete_user(&conn, &teacher.id, &teacher.id);
        assert!(matches!(result, Err(DbError::Validation(_))));
        assert_eq!(UserRepo::count_all(&conn).expect("count"), 1);
    }

    #[test]
    fn teacher_can_delete_another_account() {
        let conn = setup_conn();
        let teacher = do_bootstrap_admin_if_empty(&conn, "admin2", "teacherpassword1")
            .expect("bootstrap")
            .expect("created");
        InviteCodeRepo::create(&conn, "REMOVEME", Role::Student, None).expect("create invite");
        let session = do_register(
            &conn,
            RegisterPayload {
                username: "temp-student".into(),
                password: "temppassword1".into(),
                invite_code: "REMOVEME".into(),
                email: None,
            },
        )
        .expect("register");

        do_delete_user(&conn, &teacher.id, &session.user.id).expect("delete");

        let users = do_list_users(&conn).expect("list users");
        assert_eq!(users.len(), 1);
        assert_eq!(users[0].username, "admin2");
    }

    #[test]
    fn second_teacher_cannot_delete_the_protected_bootstrap_admin() {
        let conn = setup_conn();
        let bootstrap_admin = do_bootstrap_admin_if_empty(&conn, "original-admin", "teacherpassword1")
            .expect("bootstrap")
            .expect("created");
        assert!(bootstrap_admin.protected);

        InviteCodeRepo::create(&conn, "MAKEME2ND", Role::Teacher, Some(bootstrap_admin.id))
            .expect("create invite");
        let second_teacher = do_register(
            &conn,
            RegisterPayload {
                username: "second-teacher".into(),
                password: "secondpassword1".into(),
                invite_code: "MAKEME2ND".into(),
                email: None,
            },
        )
        .expect("register")
        .user;
        assert!(!second_teacher.protected);

        // The second teacher must not be able to delete the original admin —
        // this is exactly the surprising behavior a bare self-delete check
        // didn't catch.
        let result = do_delete_user(&conn, &second_teacher.id, &bootstrap_admin.id);
        assert!(matches!(result, Err(DbError::Validation(_))));
        assert_eq!(UserRepo::count_all(&conn).expect("count"), 2);

        // But the original admin can still delete the second teacher.
        do_delete_user(&conn, &bootstrap_admin.id, &second_teacher.id).expect("delete");
        assert_eq!(UserRepo::count_all(&conn).expect("count"), 1);
    }

    #[test]
    fn change_password_with_correct_current_password_succeeds() {
        let conn = setup_conn();
        let teacher = do_bootstrap_admin_if_empty(&conn, "changer", "originalpassword1")
            .expect("bootstrap")
            .expect("created");

        do_change_password(
            &conn,
            &teacher.id,
            ChangePasswordPayload {
                current_password: "originalpassword1".into(),
                new_password: "newpassword123".into(),
            },
        )
        .expect("change password");

        // Old password no longer works, new one does.
        let old_login = do_login(
            &conn,
            LoginPayload {
                username: "changer".into(),
                password: "originalpassword1".into(),
            },
        );
        assert!(matches!(old_login, Err(DbError::Unauthorized(_))));

        let new_login = do_login(
            &conn,
            LoginPayload {
                username: "changer".into(),
                password: "newpassword123".into(),
            },
        );
        assert!(new_login.is_ok());
    }

    #[test]
    fn change_password_with_wrong_current_password_is_unauthorized() {
        let conn = setup_conn();
        let teacher = do_bootstrap_admin_if_empty(&conn, "changer2", "originalpassword1")
            .expect("bootstrap")
            .expect("created");

        let result = do_change_password(
            &conn,
            &teacher.id,
            ChangePasswordPayload {
                current_password: "wrongpassword".into(),
                new_password: "newpassword123".into(),
            },
        );
        assert!(matches!(result, Err(DbError::Unauthorized(_))));
    }

    #[test]
    fn change_password_rejects_short_new_password() {
        let conn = setup_conn();
        let teacher = do_bootstrap_admin_if_empty(&conn, "changer3", "originalpassword1")
            .expect("bootstrap")
            .expect("created");

        let result = do_change_password(
            &conn,
            &teacher.id,
            ChangePasswordPayload {
                current_password: "originalpassword1".into(),
                new_password: "short".into(),
            },
        );
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    fn register_with_email(conn: &Connection, username: &str, code: &str, email: &str) -> AuthSession {
        InviteCodeRepo::create(conn, code, Role::Student, None).expect("create invite");
        do_register(
            conn,
            RegisterPayload {
                username: username.into(),
                password: "originalpassword1".into(),
                invite_code: code.into(),
                email: Some(email.into()),
            },
        )
        .expect("register")
    }

    #[test]
    fn forgot_password_for_existing_email_issues_a_token() {
        let conn = setup_conn();
        let session = register_with_email(&conn, "forgetful", "FORGOT1", "forgetful@example.com");

        let issued = do_forgot_password(
            &conn,
            ForgotPasswordPayload {
                email: "Forgetful@Example.com".into(),
            },
        )
        .expect("forgot password")
        .expect("email exists");

        assert_eq!(issued.user.id, session.user.id);
        assert!(PasswordResetTokenRepo::find_valid(&conn, &issued.token)
            .expect("find")
            .is_some());
    }

    #[test]
    fn forgot_password_for_unknown_email_returns_none_not_error() {
        let conn = setup_conn();
        let result = do_forgot_password(
            &conn,
            ForgotPasswordPayload {
                email: "nobody@example.com".into(),
            },
        )
        .expect("forgot password must not error for an unknown email");
        assert!(result.is_none());
    }

    #[test]
    fn requesting_a_new_reset_token_supersedes_the_previous_one() {
        let conn = setup_conn();
        register_with_email(&conn, "resupersede", "SUPERSEDE1", "resupersede@example.com");

        let first = do_forgot_password(
            &conn,
            ForgotPasswordPayload {
                email: "resupersede@example.com".into(),
            },
        )
        .expect("forgot password")
        .expect("email exists");

        let second = do_forgot_password(
            &conn,
            ForgotPasswordPayload {
                email: "resupersede@example.com".into(),
            },
        )
        .expect("forgot password")
        .expect("email exists");

        assert!(PasswordResetTokenRepo::find_valid(&conn, &first.token)
            .expect("find")
            .is_none());
        assert!(PasswordResetTokenRepo::find_valid(&conn, &second.token)
            .expect("find")
            .is_some());
    }

    #[test]
    fn reset_password_with_valid_token_updates_password_and_consumes_token() {
        let conn = setup_conn();
        register_with_email(&conn, "resetter", "RESET1", "resetter@example.com");
        let issued = do_forgot_password(
            &conn,
            ForgotPasswordPayload {
                email: "resetter@example.com".into(),
            },
        )
        .expect("forgot password")
        .expect("email exists");

        do_reset_password(
            &conn,
            ResetPasswordPayload {
                token: issued.token.clone(),
                new_password: "brandnewpassword1".into(),
            },
        )
        .expect("reset password");

        let old_login = do_login(
            &conn,
            LoginPayload {
                username: "resetter".into(),
                password: "originalpassword1".into(),
            },
        );
        assert!(matches!(old_login, Err(DbError::Unauthorized(_))));

        let new_login = do_login(
            &conn,
            LoginPayload {
                username: "resetter".into(),
                password: "brandnewpassword1".into(),
            },
        );
        assert!(new_login.is_ok());

        assert!(PasswordResetTokenRepo::find_valid(&conn, &issued.token)
            .expect("find")
            .is_none());
    }

    #[test]
    fn reset_password_with_expired_token_is_rejected() {
        let conn = setup_conn();
        register_with_email(&conn, "expiredreset", "EXPRESET1", "expiredreset@example.com");
        let issued = do_forgot_password(
            &conn,
            ForgotPasswordPayload {
                email: "expiredreset@example.com".into(),
            },
        )
        .expect("forgot password")
        .expect("email exists");
        conn.execute(
            "UPDATE password_reset_tokens SET expires_at = ?2 WHERE token = ?1",
            rusqlite::params![issued.token, (Utc::now() - Duration::seconds(1)).to_rfc3339()],
        )
        .expect("backdate expiry");

        let result = do_reset_password(
            &conn,
            ResetPasswordPayload {
                token: issued.token,
                new_password: "brandnewpassword1".into(),
            },
        );
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[test]
    fn reset_password_with_already_used_token_is_rejected() {
        let conn = setup_conn();
        register_with_email(&conn, "reused", "REUSED1", "reused@example.com");
        let issued = do_forgot_password(
            &conn,
            ForgotPasswordPayload {
                email: "reused@example.com".into(),
            },
        )
        .expect("forgot password")
        .expect("email exists");
        do_reset_password(
            &conn,
            ResetPasswordPayload {
                token: issued.token.clone(),
                new_password: "brandnewpassword1".into(),
            },
        )
        .expect("first reset");

        let result = do_reset_password(
            &conn,
            ResetPasswordPayload {
                token: issued.token,
                new_password: "anotherpassword1".into(),
            },
        );
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[test]
    fn reset_password_rejects_short_new_password() {
        let conn = setup_conn();
        register_with_email(&conn, "shortreset", "SHORTRESET1", "shortreset@example.com");
        let issued = do_forgot_password(
            &conn,
            ForgotPasswordPayload {
                email: "shortreset@example.com".into(),
            },
        )
        .expect("forgot password")
        .expect("email exists");

        let result = do_reset_password(
            &conn,
            ResetPasswordPayload {
                token: issued.token,
                new_password: "short".into(),
            },
        );
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[test]
    fn reset_password_invalidates_existing_sessions() {
        let conn = setup_conn();
        let session = register_with_email(&conn, "killsessions", "KILLSESS1", "killsessions@example.com");
        assert!(SessionRepo::find_valid(&conn, &session.token)
            .expect("find")
            .is_some());

        let issued = do_forgot_password(
            &conn,
            ForgotPasswordPayload {
                email: "killsessions@example.com".into(),
            },
        )
        .expect("forgot password")
        .expect("email exists");
        do_reset_password(
            &conn,
            ResetPasswordPayload {
                token: issued.token,
                new_password: "brandnewpassword1".into(),
            },
        )
        .expect("reset password");

        assert!(SessionRepo::find_valid(&conn, &session.token)
            .expect("find")
            .is_none());
    }
}
