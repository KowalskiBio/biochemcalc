#!/usr/bin/env bash
# Pull the latest question snapshot from the VM (ssh alias `proxmox1`) into
# .local-dev/biochemcalc.sqlite. Strictly read-only on the VM: only `scp` of
# the SQLite file out — nothing is written, changed or deleted there.
#
# Usage: npm run db:pull        (or: bash scripts/db-pull.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

VM_HOST="${VM_HOST:-proxmox1}"
VM_DB=".local/share/com.kowalski.biochemcalc/biochemcalc.sqlite" # relative to VM home
DATA_DIR="$PWD/.local-dev"
DB="$DATA_DIR/biochemcalc.sqlite"
PID_FILE="$DATA_DIR/server.pid"
TMP="$DATA_DIR/biochemcalc.sqlite.pull"

mkdir -p "$DATA_DIR"

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
mv "$TMP" "$DB"

sqlite3 "file:$DB?immutable=1" \
  "SELECT '[db-pull] Snapshot OK: ' || (SELECT COUNT(*) FROM topics) || ' topics / ' || (SELECT COUNT(*) FROM sets) || ' sets / ' || (SELECT COUNT(*) FROM templates) || ' questions / ' || (SELECT COUNT(*) FROM users) || ' users';"
echo "[db-pull] Done. Run the app with: npm run dev:local"
