//! Outbound mail for password-reset links. SMTP via `lettre`, configured
//! entirely from `BIOCHEMCALC_SMTP_*` env vars (see `src/bin/server.rs`) —
//! matches this codebase's env-var-only config idiom. If unconfigured, the
//! server still boots (same "optional, no-op if unset" pattern as
//! `BIOCHEMCALC_ADMIN_USERNAME`) and reset links are logged instead of
//! emailed — this is also what local development relies on, with no SMTP
//! server needed at all to exercise the flow end-to-end.

use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

#[derive(Debug, Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from_address: String,
    pub from_name: String,
}

pub enum Mailer {
    Smtp {
        transport: AsyncSmtpTransport<Tokio1Executor>,
        from: Mailbox,
    },
    /// No SMTP config supplied — reset links are logged instead of emailed.
    Disabled,
}

impl Mailer {
    /// Builds an SMTP transport from `config`, or falls back to `Disabled`
    /// if `config` is `None` or malformed (a malformed config is logged and
    /// treated as absent rather than panicking the server at startup).
    pub fn from_config(config: Option<SmtpConfig>) -> Self {
        let Some(config) = config else {
            log::info!("SMTP not configured — password reset links will be logged, not emailed");
            return Mailer::Disabled;
        };

        let from = match format!("{} <{}>", config.from_name, config.from_address).parse() {
            Ok(mailbox) => mailbox,
            Err(e) => {
                log::error!("BIOCHEMCALC_SMTP_FROM_ADDRESS is not a valid mailbox: {e}");
                return Mailer::Disabled;
            }
        };

        let creds = Credentials::new(config.username, config.password);
        // starttls_relay, not relay: MUNI's smtp.muni.cz:587 greets in
        // plaintext and upgrades via STARTTLS. `relay` would speak implicit
        // TLS (SMTPS, port 465) from the first byte, so on 587 the server's
        // plaintext "220" greeting fails TLS parsing ("InvalidContentType")
        // and every send dies with a connection error.
        let transport = match AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host) {
            Ok(builder) => builder.port(config.port).credentials(creds).build(),
            Err(e) => {
                log::error!("failed to build SMTP transport for {}: {e}", config.host);
                return Mailer::Disabled;
            }
        };

        Mailer::Smtp { transport, from }
    }

    /// Never surfaces a hard error to the caller — a send failure is logged
    /// and swallowed by design (see `do_forgot_password`'s doc comment on
    /// why the HTTP layer must not distinguish "send failed" from "no such
    /// account").
    pub async fn send_reset_email(&self, to_email: &str, to_name: &str, reset_link: &str) {
        match self {
            Mailer::Disabled => {
                log::warn!("SMTP not configured — password reset link for {to_email}: {reset_link}");
            }
            Mailer::Smtp { transport, from } => {
                let Ok(to) = format!("{to_name} <{to_email}>").parse::<Mailbox>() else {
                    log::error!("cannot send reset email: {to_email} is not a valid address");
                    return;
                };

                let body = format!(
                    "Dobrý den,\n\n\
                     obdrželi jsme žádost o obnovení hesla k vašemu účtu BiochemCalc.\n\
                     Pro nastavení nového hesla klikněte na odkaz níže (platný 1 hodinu):\n\n\
                     {reset_link}\n\n\
                     Pokud jste o obnovení hesla nežádali, tento e-mail můžete ignorovat."
                );

                let message = match Message::builder()
                    .from(from.clone())
                    .to(to)
                    .subject("Obnovení hesla — BiochemCalc")
                    .body(body)
                {
                    Ok(m) => m,
                    Err(e) => {
                        log::error!("failed to build reset email for {to_email}: {e}");
                        return;
                    }
                };

                if let Err(e) = transport.send(message).await {
                    log::error!("failed to send reset email to {to_email}: {e}");
                }
            }
        }
    }
}
