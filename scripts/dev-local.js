// Cross-platform launcher for `npm run dev:local`: PowerShell port on Windows,
// the original bash script elsewhere.
import { spawn } from "node:child_process"

const target =
  process.platform === "win32"
    ? { cmd: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/dev-local.ps1"] }
    : { cmd: "bash", args: ["scripts/dev-local.sh"] }

const child = spawn(target.cmd, target.args, { stdio: "inherit" })
child.on("exit", (code) => process.exit(code ?? 0))
child.on("error", (err) => {
  console.error(`[dev-local] failed to start: ${err.message}`)
  process.exit(1)
})
