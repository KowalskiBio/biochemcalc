# Windows port of scripts/dev-local.sh - one-command local dev:
#   - builds the backend (incremental),
#   - (re)starts it on 127.0.0.1:8080 with .local-dev/ as the data dir,
#   - starts vite on :1420 (reuses an already-running one).
#
# Unlike the bash original there is no VM pull here: without a snapshot the
# script starts with a FRESH database and the bootstrap teacher account
# printed below (BIOCHEMCALC_ADMIN_USERNAME/PASSWORD, first run only).
# To use a VM snapshot on Windows, place biochemcalc.sqlite into .local-dev
# before the first run.
#
# Usage: npm run dev:local     Stop: Ctrl-C (stops vite AND the backend).
# NOTE: keep this file ASCII-only - PS 5.1 reads BOM-less files as ANSI and
#       UTF-8 chars like em-dashes can break string parsing.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$DataDir = Join-Path $PWD ".local-dev"
$Db      = Join-Path $DataDir "biochemcalc.sqlite"
$PidFile = Join-Path $DataDir "server.pid"
$LogOut  = Join-Path $DataDir "server-stdout.log"
$LogErr  = Join-Path $DataDir "server-stderr.log"

if (-not $env:BIOCHEMCALC_ADMIN_USERNAME) { $env:BIOCHEMCALC_ADMIN_USERNAME = "admin" }
if (-not $env:BIOCHEMCALC_ADMIN_PASSWORD) { $env:BIOCHEMCALC_ADMIN_PASSWORD = "adminpassword1" }

$FreshDb = -not (Test-Path $Db)
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

if ($FreshDb) {
  Write-Host "[dev-local] No local snapshot - starting with a FRESH database."
  Write-Host "[dev-local] Teacher account will be bootstrapped: $($env:BIOCHEMCALC_ADMIN_USERNAME) / $($env:BIOCHEMCALC_ADMIN_PASSWORD)"
  Write-Host "[dev-local] (To seed from the VM instead, drop biochemcalc.sqlite into .local-dev before first run.)"
}

# --- Build backend (incremental) ---
Write-Host "[dev-local] Building backend (incremental)..."
cargo build --bin biochemcalc-server --manifest-path src-tauri/Cargo.toml -q
if ($LASTEXITCODE -ne 0) { throw "[dev-local] cargo build failed" }

# --- (Re)start backend on :8080 ---
$listeners = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)
foreach ($conn in $listeners) {
  $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -like "*biochemcalc*") {
    Write-Host "[dev-local] Restarting backend (old pid $($proc.Id))"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  } else {
    $name = if ($proc) { $proc.ProcessName } else { "unknown" }
    throw "[dev-local] ERROR: :8080 is held by '$name' (pid $($conn.OwningProcess)), not biochemcalc-server."
  }
}
if ($listeners.Count -gt 0) { Start-Sleep -Seconds 1 }

$env:BIOCHEMCALC_DATA_DIR  = $DataDir
$env:BIOCHEMCALC_BIND_ADDR = "127.0.0.1:8080"
$env:BIOCHEMCALC_DIST_DIR  = "$PWD\dist"

$server = Start-Process -FilePath "src-tauri/target/debug/biochemcalc-server.exe" `
  -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $LogOut -RedirectStandardError $LogErr
Set-Content -Path $PidFile -Value $server.Id

# Wait until the HTTP layer answers (401 = up, just not logged in - expected).
$up = $false
foreach ($i in 1..30) {
  try {
    Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8080/api/cmd/list_topics" `
      -ContentType "application/json" -Body "{}" -UseBasicParsing | Out-Null
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 401) {
      $up = $true
      break
    }
  }
  Start-Sleep -Milliseconds 300
}
if (-not $up) { throw "[dev-local] ERROR: backend did not come up - see $LogErr" }
Write-Host "[dev-local] Backend up on 127.0.0.1:8080 (pid $($server.Id)) - data: $DataDir"

# --- Frontend on :1420 ---
$viteUp = $false
try {
  Invoke-WebRequest -Uri "http://localhost:1420" -UseBasicParsing | Out-Null
  $viteUp = $true
} catch {}

if ($viteUp) {
  Write-Host "[dev-local] vite is already running on :1420 - reusing it. Open http://localhost:1420"
  Write-Host "[dev-local] Backend keeps running (pid $($server.Id)); re-run this script to restart everything."
  exit 0
}

Write-Host "[dev-local] Starting vite on http://localhost:1420 - log in: $($env:BIOCHEMCALC_ADMIN_USERNAME) / $($env:BIOCHEMCALC_ADMIN_PASSWORD)"
try {
  npm run dev
} finally {
  Write-Host "[dev-local] Stopping backend (pid $($server.Id))"
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}
