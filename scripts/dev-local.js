// Cross-platform launcher for `npm run dev:local`.
// Runs the bash script everywhere; on Windows a MINGW/MSYS bash (Git Bash)
// is required — the PowerShell port was retired, there is no fallback.
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

const GIT_BASH = "C:/Program Files/Git/bin/bash.exe"

function findBash() {
  // Resolve a MINGW/MSYS bash (Git Bash) — not a bare WSL stub on PATH.
  const candidates = []
  if (process.platform === "win32" && existsSync(GIT_BASH)) candidates.push(GIT_BASH)
  candidates.push("bash")
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ["-lc", "uname"], { encoding: "utf8" })
    if (probe.status === 0 && /MINGW|MSYS|Linux/.test(probe.stdout ?? "")) {
      return cmd
    }
  }
  return null
}

function pickTarget() {
  if (process.platform !== "win32") return { cmd: "bash", args: ["scripts/dev-local.sh"] }
  const bash = findBash()
  if (bash) return { cmd: bash, args: ["scripts/dev-local.sh"] }
  console.error(
    "[dev-local] Git Bash not found — install Git for Windows: https://git-scm.com/download/win",
  )
  process.exit(1)
}

const target = pickTarget()
console.log(`[dev-local] using ${target.cmd}`)
const child = spawn(target.cmd, target.args, { stdio: "inherit" })
child.on("exit", (code) => process.exit(code ?? 0))
child.on("error", (err) => {
  console.error(`[dev-local] failed to start: ${err.message}`)
  process.exit(1)
})
