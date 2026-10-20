#!/usr/bin/env bash
# Publishes a CLEANED copy of the live database for read-only pulls by other
# developers (`npm run db:pull` with VM_HOST pointing at the `dbpull` user —
# see DEPLOY.md, "Read-only snapshot for other developers"). Runs as the
# service user from biochemcalc-dbpull.timer; never needs root.
#
# The live DB is only read (SQLite's online backup API, safe while the server
# writes). The copy is scrubbed before anyone else can read it:
#   - login sessions, password-reset tokens, invite codes: deleted
#   - every password: replaced by the public dev password `devpassword1`
#   - every email: removed
#   - student usernames: replaced by student-0001, student-0002, … (sign-up order)
# then VACUUMed, so deleted values don't survive in free pages of the file,
# and atomically swapped in.
#
# Usage: dbpull-snapshot.sh [output-dir]   (default /srv/dbpull/snapshot)
set -euo pipefail
umask 077

SRC="${BIOCHEMCALC_DB:-$HOME/.local/share/com.kowalski.biochemcalc/biochemcalc.sqlite}"
OUT_DIR="${1:-/srv/dbpull/snapshot}"
OUT="$OUT_DIR/biochemcalc.sqlite"
# Argon2id hash of "devpassword1" — a public dev password, not a secret.
DEV_HASH='$argon2id$v=19$m=19456,t=2,p=1$XetgyPKEsYqC2m7Ypkje5w$gqlu/Cns7Go6MM7pteGx7AsjI7tLLfEnZ/miUUqP84k'

[ -d "$OUT_DIR" ] || { echo "dbpull-snapshot: $OUT_DIR does not exist" >&2; exit 1; }

# Same directory as the result, so the final mv is an atomic rename; created
# 0600 (umask) so nobody can read it before it is clean.
TMP="$(mktemp -p "$OUT_DIR" .snapshot.XXXXXX)"
trap 'rm -f "$TMP" "$TMP-journal"' EXIT

sqlite3 "$SRC" ".backup '$TMP'"
sqlite3 "$TMP" <<SQL
PRAGMA foreign_keys = OFF;
DELETE FROM sessions;
DELETE FROM password_reset_tokens;
DELETE FROM invite_codes;
DELETE FROM wizard_sessions;
UPDATE users SET email = NULL, password_hash = '$DEV_HASH';
UPDATE users SET username = (
  SELECT printf('student-%04d', n) FROM (
    SELECT id, row_number() OVER (ORDER BY created_at, rowid) AS n
    FROM users WHERE role = 'student'
  ) AS numbered WHERE numbered.id = users.id
) WHERE role = 'student';
VACUUM;
SQL

check="$(sqlite3 "$TMP" 'PRAGMA integrity_check;')"
leftover="$(sqlite3 "$TMP" "SELECT
  (SELECT COUNT(*) FROM sessions) + (SELECT COUNT(*) FROM password_reset_tokens)
  + (SELECT COUNT(*) FROM invite_codes)
  + (SELECT COUNT(*) FROM users WHERE email IS NOT NULL OR password_hash != '$DEV_HASH');")"
if [ "$check" != "ok" ] || [ "$leftover" != "0" ]; then
  echo "dbpull-snapshot: refusing to publish (integrity=$check, unscrubbed rows=$leftover)" >&2
  exit 1
fi

chmod 0644 "$TMP"
mv -f "$TMP" "$OUT"
trap - EXIT
echo "dbpull-snapshot: published $OUT ($(stat -c %s "$OUT") bytes)"
