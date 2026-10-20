#!/usr/bin/env bash
# Pull the latest question snapshot from the VM (ssh alias `proxmox1`) into
# .local-dev/biochemcalc.sqlite. Strictly read-only on the VM: only `scp` of
# the SQLite file out — nothing is written, changed or deleted there.
#
# Also keeps an untouched copy as .local-dev/biochemcalc.base.sqlite — the
# reference `npm run db:push-biomolecules` diffs your local edits against.
# Refuses to overwrite Biomolekuly edits you haven't pushed yet; --force
# pulls anyway (the old DB is still backed up).
#
# Usage: npm run db:pull                 (or: bash scripts/db-pull.sh)
#        npm run db:pull -- --force
# Env:   VM_HOST (ssh alias, default proxmox1), VM_DB (snapshot path on the VM,
#        relative to the ssh user's home or absolute). Other developers pull
#        the cleaned snapshot (all passwords: devpassword1) with
#        VM_HOST=<account>@147.251.22.180 VM_DB=/snapshot/biochemcalc.sqlite —
#        see DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")/.."

VM_HOST="${VM_HOST:-proxmox1}"
VM_DB="${VM_DB:-.local/share/com.kowalski.biochemcalc/biochemcalc.sqlite}" # relative to VM home
DATA_DIR="$PWD/.local-dev"
DB="$DATA_DIR/biochemcalc.sqlite"
PID_FILE="$DATA_DIR/server.pid"
TMP="$DATA_DIR/biochemcalc.sqlite.pull"
BASE="$DATA_DIR/biochemcalc.base.sqlite"
PUSHED="$DATA_DIR/biochemcalc.pushed" # written by db:push-biomolecules
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

mkdir -p "$DATA_DIR"

# Unpushed Biomolekuly edits would vanish with the old DB — check first.
if [ "$FORCE" = "0" ] && [ -f "$DB" ] && [ -f "$BASE" ]; then
  echo "[db-pull] Checking for unpushed Biomolekuly edits..."
  cargo build --bin export_biomolecules --manifest-path src-tauri/Cargo.toml -q
  EXPORTER=src-tauri/target/debug/export_biomolecules
  sha256() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; }
  LOCAL_LIB="$("$EXPORTER" "$DB")"
  LOCAL_SUM="$(printf '%s' "$LOCAL_LIB" | sha256 | cut -d' ' -f1)"
  if [ "$LOCAL_LIB" != "$("$EXPORTER" "$BASE")" ] &&
    [ "$LOCAL_SUM" != "$(cat "$PUSHED" 2>/dev/null || true)" ]; then
    echo "[db-pull] ERROR: your local Biomolekuly library differs from the last pull." >&2
    echo "[db-pull] Push it first (npm run db:push-biomolecules), or pull anyway and" >&2
    echo "[db-pull] lose those edits locally (a backup is kept): npm run db:pull -- --force" >&2
    exit 1
  fi
fi

# Never swap the DB out from under a running backend: stop ours first — by PID
# file, or by port if it was started outside the scripts.
stop_local_backend() {
  local p comm
  if [ -f "$PID_FILE" ] && p="$(cat "$PID_FILE" 2>/dev/null)" && kill -0 "$p" 2>/dev/null; then
    echo "[db-pull] Stopping local backend (pid $p)"
    kill "$p" 2>/dev/null || true
    sleep 1
    rm -f "$PID_FILE"
  fi
  for p in $(lsof -nP -iTCP:8080 -sTCP:LISTEN -t 2>/dev/null || true); do
    comm="$(ps -p "$p" -o comm= 2>/dev/null || true)"
    case "$comm" in
    *biochemca*) # ps(1) may truncate the comm name (e.g. "biochemca")
      echo "[db-pull] Stopping backend on :8080 (pid $p)"
      kill "$p" 2>/dev/null || true
      sleep 1
      ;;
    esac
  done
}
stop_local_backend

echo "[db-pull] Fetching snapshot from $VM_HOST (read-only on the VM)..."
rm -f "$TMP"
scp -o BatchMode=yes "$VM_HOST:$VM_DB" "$TMP"

echo "[db-pull] Verifying integrity..."
if [ "$(sqlite3 "file:$TMP?immutable=1" 'PRAGMA integrity_check;')" != "ok" ]; then
  echo "[db-pull] ERROR: downloaded DB failed integrity_check (VM busy or copy corrupt)." >&2
  echo "[db-pull] Local data was NOT changed — try again in a moment." >&2
  rm -f "$TMP"
  exit 1
fi

if [ -f "$DB" ]; then
  BAK="$DATA_DIR/biochemcalc.sqlite.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$DB" "$BAK"
  echo "[db-pull] Previous local DB backed up to: $BAK"
fi
cp "$TMP" "$BASE"
mv "$TMP" "$DB"
rm -f "$PUSHED"

sqlite3 "file:$DB?immutable=1" \
  "SELECT '[db-pull] Snapshot OK: ' || (SELECT COUNT(*) FROM topics) || ' topics / ' || (SELECT COUNT(*) FROM sets) || ' sets / ' || (SELECT COUNT(*) FROM templates) || ' questions / ' || (SELECT COUNT(*) FROM users) || ' users';"
echo "[db-pull] Done. Run the app with: npm run dev:local"
