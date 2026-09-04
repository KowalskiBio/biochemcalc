//! Outbound mail for password-reset links. SMTP via `lettre`, configured
//! entirely from `BIOCHEMCALC_SMTP_*` env vars (see `src/bin/server.rs`) —
//! matches this codebase's env-var-only config idiom. If unconfigured, the
//! server still boots (same "optional, no-op if unset" pattern as
//! `BIOCHEMCALC_ADMIN_USERNAME`) and reset links are logged instead of
//! emailed — this is also what local development relies on, with no SMTP
//! server needed at all to exercise the flow end-to-end.

use lettre::message::{Mailbox, MultiPart};
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

                let plain = format!(
                    "Dobrý den, {to_name},\n\n\
                     obdrželi jsme žádost o obnovení hesla k vašemu účtu BioCal.\n\
                     Pro nastavení nového hesla klikněte na odkaz níže (platný 1 hodinu):\n\n\
                     {reset_link}\n\n\
                     Pokud jste o obnovení hesla nežádali, můžete tento e-mail bez obav ignorovat.\n\n\
                     --\n\
                     BioCal - generátor biochemických výpočtových úloh"
                );
                let html = RESET_EMAIL_HTML
                    .replace("{{TO_NAME}}", &html_escape(to_name))
                    .replace("{{RESET_LINK}}", reset_link);

                let message = match Message::builder()
                    .from(from.clone())
                    .to(to)
                    .subject("BioCal: obnovení hesla")
                    .multipart(MultiPart::alternative_plain_html(plain, html))
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

/// `to_name` is a user-chosen username with no charset restriction, so it
/// must be escaped before substitution into the HTML part; a `<` or `&` in
/// a name would otherwise inject markup into the email.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Placeholder-based (`{{TO_NAME}}`, `{{RESET_LINK}}`) rather than `format!`
/// because the CSS braces in inline styles would all need doubling.
/// Table layout, inline styles only, no external resources: renders in
/// Gmail, Outlook, and Seznam webmail.
const RESET_EMAIL_HTML: &str = r#"<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>BioCal: obnovení hesla</title>
</head>
<body style="margin:0; padding:0; background-color:#f5f5f5; font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#FBFBF7;">
  <tr>
    <td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px; width:100%;">
        <tr>
          <td style="background-color:#155E46; padding:24px 0; text-align:center;">
            <span style="font-size:28px; font-weight:700; color:#FBFBF7; text-decoration:none;">BioCal</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 24px 24px;">
            <p style="font-size:18px; line-height:1.5; margin:0 0 24px 0; color:#111;">Dobrý den, {{TO_NAME}},</p>
            <p style="font-size:16px; line-height:1.5; margin:0 0 16px 0; color:#333;">Obdrželi jsme žádost o obnovení hesla k vašemu účtu BioCal.</p>
            <p style="font-size:16px; line-height:1.5; margin:0 0 24px 0; color:#333;">Pro nastavení nového hesla klikněte na tlačítko níže. Odkaz je platný 1 hodinu.</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td align="center">
                  <a href="{{RESET_LINK}}" style="display:inline-block; background-color:#2E8565; color:#FBFBF7; text-decoration:none; font-size:16px; font-weight:600; padding:14px 28px; border-radius:6px; line-height:1.1;">Obnovit heslo</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 24px;">
            <p style="font-size:14px; line-height:1.5; margin:0 0 8px 0; color:#555;">Pokud tlačítko nefunguje, zkopírujte do prohlížeče tento odkaz:</p>
            <p style="font-size:14px; line-height:1.5; margin:0; color:#155E46; word-break:break-all;">{{RESET_LINK}}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 24px;">
            <p style="font-size:14px; line-height:1.5; margin:0; color:#555;">Pokud jste o obnovení hesla nežádali, můžete tento e-mail bez obav ignorovat.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px 24px; border-top:1px solid #e0e0e0;">
            <p style="font-size:12px; line-height:1.4; margin:0; color:#5A7569;">BioCal - generátor biochemických výpočtových úloh</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>"#;

#[cfg(test)]
mod tests {
    use super::html_escape;

    #[test]
    fn html_escape_neutralizes_markup_characters() {
        assert_eq!(
            html_escape(r#"<b>&"quoted"</b>"#),
            "&lt;b&gt;&amp;&quot;quoted&quot;&lt;/b&gt;"
        );
    }

    #[test]
    fn html_escape_leaves_plain_names_alone() {
        assert_eq!(html_escape("novakj"), "novakj");
    }
}
