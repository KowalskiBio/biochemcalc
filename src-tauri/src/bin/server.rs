//! Entrypoint for the web deployment: `biochemcalc-server`. Serves the same
//! functionality as the Tauri desktop app over plain HTTP instead of Tauri's
//! IPC bridge — see `biochemcalc_lib::http` for the router itself.
//!
//! Configuration is via environment variables (systemd `Environment=` lines
//! in `deploy/biochemcalc.service`), not flags, so the unit file stays the
//! single source of truth for how the process is configured:
//!
//! - `BIOCHEMCALC_BIND_ADDR` — address:port to listen on (default `0.0.0.0:8080`)
//! - `BIOCHEMCALC_DATA_DIR` — where `biochemcalc.sqlite`, `projekty/`, and
//!   exported `.txt` files live. Defaults to the exact path the Tauri
//!   desktop build already uses on Linux
//!   (`~/.local/share/com.kowalski.biochemcalc`), so pointing this at an
//!   existing install picks up its data unchanged.
//! - `BIOCHEMCALC_DIST_DIR` — the built frontend (`npm run build`'s `dist/`
//!   output) to serve as static files (default `../dist`, relative to the
//!   binary — matches `tauri.conf.json`'s `frontendDist`).
//! - `BIOCHEMCALC_ADMIN_USERNAME` / `BIOCHEMCALC_ADMIN_PASSWORD` — optional,
//!   first-run only: seeds one teacher account if the `users` table is
//!   empty, since nothing can issue an invite code before any account
//!   exists. Safe to leave set permanently — it's a no-op once any account
//!   exists.
//! - `BIOCHEMCALC_SMTP_HOST` / `_PORT` / `_USERNAME` / `_PASSWORD` /
//!   `_FROM_ADDRESS` / `_FROM_NAME` — optional. Password-reset emails are
//!   sent via SMTP if host/username/password/from-address are all set,
//!   otherwise reset links are logged instead (see `src/email.rs`).
//!   `_PORT` defaults to `587`, `_FROM_NAME` to `BioCal`.
//! - `BIOCHEMCALC_PUBLIC_URL` — the externally-reachable origin used to
//!   build password-reset links (e.g. `http://147.251.22.180:8080`).
//!   Defaults to `http://{BIOCHEMCALC_BIND_ADDR}`, which is only correct for
//!   direct access with no reverse proxy in front — see deploy notes.

use biochemcalc_lib::email::SmtpConfig;
use biochemcalc_lib::http::{run_server, ServerConfig};
use std::net::SocketAddr;
use std::path::PathBuf;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn default_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".local/share/com.kowalski.biochemcalc")
}

fn init_file_logger(data_dir: &std::path::Path) {
    let log_dir = data_dir.join("logs");
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!("Failed to create log dir {}: {e}", log_dir.display());
        return;
    }

    let log_path = log_dir.join("biochemcalc.log");
    let file = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Failed to open log file {}: {e}", log_path.display());
            return;
        }
    };

    if simplelog::WriteLogger::init(
        simplelog::LevelFilter::Info,
        simplelog::Config::default(),
        file,
    )
    .is_ok()
    {
        log::info!(
            "biochemcalc-server starting (log file: {})",
            log_path.display()
        );
    }
}

#[tokio::main]
async fn main() {
    let data_dir = std::env::var("BIOCHEMCALC_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_data_dir());

    init_file_logger(&data_dir);
    biochemcalc_lib::install_panic_hook();

    let bind_addr: SocketAddr = env_or("BIOCHEMCALC_BIND_ADDR", "0.0.0.0:8080")
        .parse()
        .expect("BIOCHEMCALC_BIND_ADDR must be a valid address:port");

    let dist_dir = std::env::var("BIOCHEMCALC_DIST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("../dist"));

    let smtp = match (
        std::env::var("BIOCHEMCALC_SMTP_HOST").ok(),
        std::env::var("BIOCHEMCALC_SMTP_USERNAME").ok(),
        std::env::var("BIOCHEMCALC_SMTP_PASSWORD").ok(),
        std::env::var("BIOCHEMCALC_SMTP_FROM_ADDRESS").ok(),
    ) {
        (Some(host), Some(username), Some(password), Some(from_address)) => Some(SmtpConfig {
            host,
            port: env_or("BIOCHEMCALC_SMTP_PORT", "587")
                .parse()
                .unwrap_or(587),
            username,
            password,
            from_address,
            from_name: env_or("BIOCHEMCALC_SMTP_FROM_NAME", "BioCal"),
        }),
        _ => None,
    };
    let public_base_url = env_or("BIOCHEMCALC_PUBLIC_URL", &format!("http://{bind_addr}"));

    let config = ServerConfig {
        bind_addr,
        data_dir,
        dist_dir,
        admin_username: std::env::var("BIOCHEMCALC_ADMIN_USERNAME").ok(),
        admin_password: std::env::var("BIOCHEMCALC_ADMIN_PASSWORD").ok(),
        smtp,
        public_base_url,
    };

    eprintln!(
        "biochemcalc-server: binding {}, data_dir={}, dist_dir={}",
        config.bind_addr,
        config.data_dir.display(),
        config.dist_dir.display()
    );

    if let Err(e) = run_server(config).await {
        log::error!("server exited with error: {e}");
        eprintln!("biochemcalc-server: fatal error: {e}");
        std::process::exit(1);
    }
}
