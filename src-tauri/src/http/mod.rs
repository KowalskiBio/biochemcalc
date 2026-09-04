//! HTTP server for the web deployment — the same functionality as the Tauri
//! desktop app's IPC commands, reachable over plain HTTP instead. See
//! `src/bin/server.rs` for the process entrypoint and env-var configuration.

pub mod error;
pub mod middleware;
pub mod routes;

use crate::db::repos::ConstantRepo;
use crate::db::{open_and_migrate, AppState};
use crate::email::{Mailer, SmtpConfig};
use axum::http::StatusCode;
use axum::middleware::{from_fn, from_fn_with_state, map_response};
use axum::response::Response;
use axum::Router;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower_http::services::{ServeDir, ServeFile};

pub struct ServerConfig {
    pub bind_addr: SocketAddr,
    pub data_dir: PathBuf,
    pub dist_dir: PathBuf,
    /// First-run only: if the `users` table is empty, seed one teacher
    /// account from these so invite-code issuance has somewhere to start.
    pub admin_username: Option<String>,
    pub admin_password: Option<String>,
    /// SMTP config for password-reset emails; `None` means reset links are
    /// logged instead of sent (see `src/email.rs`).
    pub smtp: Option<SmtpConfig>,
    /// Externally-reachable origin used to build password-reset links, e.g.
    /// `http://147.251.22.180:8080`. Wrong the moment this sits behind a
    /// reverse proxy or gets a real domain — see deploy notes.
    pub public_base_url: String,
}

pub async fn run_server(config: ServerConfig) -> Result<(), Box<dyn std::error::Error>> {
    let conn = open_and_migrate(&config.data_dir)?;

    // Same first-launch seeding the Tauri desktop build does in `lib.rs`.
    ConstantRepo::seed_builtins_if_empty(&conn)?;
    ConstantRepo::seed_atomic_weights_if_missing(&conn)?;

    if let (Some(username), Some(password)) = (&config.admin_username, &config.admin_password) {
        match crate::commands::auth::do_bootstrap_admin_if_empty(&conn, username, password) {
            Ok(Some(user)) => {
                log::info!("bootstrapped initial teacher account: {}", user.username)
            }
            Ok(None) => {}
            Err(e) => log::error!("admin bootstrap failed: {e}"),
        }
    }

    let mailer = Mailer::from_config(config.smtp);
    let state = Arc::new(AppState {
        db: Mutex::new(conn),
        data_dir: config.data_dir.clone(),
        mailer,
        public_base_url: config.public_base_url.clone(),
    });

    let auth_router = routes::auth::public_router()
        .merge(
            routes::auth::authenticated_router()
                .layer(from_fn_with_state(state.clone(), middleware::require_auth)),
        )
        .merge(
            routes::auth::teacher_router()
                .layer(from_fn(middleware::require_teacher))
                .layer(from_fn_with_state(state.clone(), middleware::require_auth)),
        );

    let cmd_router = routes::cmd::router()
        .layer(from_fn(middleware::require_teacher))
        .layer(from_fn_with_state(state.clone(), middleware::require_auth));

    // Any logged-in account — this is the surface a student has, and a
    // teacher may equally want to try their own questions.
    let student_router = routes::student::router()
        .layer(from_fn_with_state(state.clone(), middleware::require_auth));

    let api_router = Router::new()
        .nest("/auth", auth_router)
        .nest("/cmd", cmd_router)
        .nest("/student", student_router);

    // SPA fallback: any path that isn't a real static asset (i.e. every
    // client-side route like /topics/:id) serves index.html and
    // react-router-dom takes over. `ServeDir::not_found_service` is
    // documented to always answer `404` regardless of what its fallback
    // service returns — correct for "asset truly missing", wrong for "this
    // is a valid client-side route" — so the `map_response` layer below
    // rewrites that 404 back to 200 for exactly this fallback branch (it
    // never touches `/api/*`, which isn't part of this service at all).
    let static_service = Router::new()
        .fallback_service(
            ServeDir::new(&config.dist_dir)
                .not_found_service(ServeFile::new(config.dist_dir.join("index.html"))),
        )
        .layer(map_response(spa_fallback_ok));

    let app = Router::new()
        .nest("/api", api_router)
        .fallback_service(static_service)
        .with_state(state);

    log::info!("biochemcalc-server listening on {}", config.bind_addr);
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn spa_fallback_ok(mut response: Response) -> Response {
    if response.status() == StatusCode::NOT_FOUND {
        *response.status_mut() = StatusCode::OK;
    }
    response
}
