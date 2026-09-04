/**
 * Loose, inline-UX-only checks — good enough to catch an obvious typo before
 * submit. The server (`is_plausible_email` in `src-tauri/src/commands/auth.rs`)
 * is authoritative and re-validates regardless.
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
