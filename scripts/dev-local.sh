#!/usr/bin/env bash
# One-command local dev against the VM question snapshot:
#   - builds the backend (incremental),
#   - (re)starts it on 127.0.0.1:8080 with .local-dev/ as the data dir
#     (topics + logins downloaded by scripts/db-pull.sh; the VM is untouched),
#   - starts vite on :1420 (reuses an already-running one).
#
# Usage: npm run dev:local     (or: bash scripts/dev-local.sh)
# Stop:  Ctrl-C (stops vite AND the backend).
set -euo pipefail
cd "$(dirname "$0")/.."

DATA_DIR="$PWD/.local-dev"
DB="$DATA_DIR/biochemcalc.sqlite"
PID_FILE="$DATA_DIR/server.pid"
LOG="$DATA_DIR/server-stdout.log"

# --- 1. Data snapshot -------------------------------------------------------
if [ ! -f "$DB" ]; then
  echo "[dev-local] No local snapshot found — pulling from proxmox1 first..."
  bash scripts/db-pull.sh
fi

# --- 2. Backend build --------------------------------------------------------
echo "[dev-local] Building backend (incremental)..."
cargo build --bin biochemcalc-server --manifest-path src-tauri/Cargo.toml -q

# --- 3. (Re)start backend on :8080 -------------------------------------------
for p in $(lsof -nP -iTCP:8080 -sTCP:LISTEN -t 2>/dev/null || true); do
  comm="$(ps -p "$p" -o comm= 2>/dev/null || true)"
  case "$comm" in
  *biochemca*) # ps(1) may truncate the comm name (e.g. "biochemca")
    echo "[dev-local] Restarting backend (old pid $p)"
    kill "$p" 2>/dev/null || true
    ;;
  *)
    echo "[dev-local] ERROR: :8080 is held by '$comm' (pid $p), not biochemcalc-server." >&2
    exit 1
    ;;
  esac
done
sleep 1

BIOCHEMCALC_DATA_DIR="$DATA_DIR" \
BIOCHEMCALC_BIND_ADDR="127.0.0.1:8080" \
BIOCHEMCALC_DIST_DIR="$PWD/dist" \
  nohup src-tauri/target/debug/biochemcalc-server >"$LOG" 2>&1 &
echo $! >"$PID_FILE"

# Wait until the HTTP layer answers (401 = up, just not logged in — expected).
up=""
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8080/api/cmd/list_topics -H 'Content-Type: application/json' -d '{}' || true)"
  [ "$code" = "401" ] && up=1 && break
  sleep 0.3
done
if [ -z "$up" ]; then
  echo "[dev-local] ERROR: backend did not come up — see $LOG" >&2
  exit 1
fi
echo "[dev-local] Backend up on 127.0.0.1:8080 (pid $(cat "$PID_FILE")) — data: $DATA_DIR"

# --- 4. Frontend on :1420 ----------------------------------------------------
stop_backend() {
  local p
  p="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
    echo "[dev-local] Stopping backend (pid $p)"
    kill "$p" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}

if curl -sf -o /dev/null http://localhost:1420 2>/dev/null; then
  echo "[dev-local] vite is already running on :1420 — reusing it."
  echo "[dev-local] Open http://localhost:1420 and log in with a VM account (e.g. 'kowalski')."
  echo "[dev-local] Backend is still running in the background; Ctrl-C vite and re-run this script to stop everything."
  exit 0
fi

echo "[dev-local] Starting vite on http://localhost:1420 — log in with a VM account (e.g. 'kowalski')."
trap stop_backend EXIT
trap 'exit 130' INT TERM
npm run dev
