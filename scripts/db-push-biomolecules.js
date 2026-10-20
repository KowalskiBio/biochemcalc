// Push local Biomolekuly edits (topics, categories, molecules) to the live
// site — and nothing else. Compares .local-dev/biochemcalc.sqlite with the
// snapshot the last `npm run db:pull` downloaded (.local-dev/biochemcalc.base.sqlite)
// and replays the difference through the site's own API, logged in as you.
// The server only lets your account change what it may change; calculations,
// users and quiz results are never touched.
//
// Before every write the live row is compared with the pulled snapshot: if
// someone edited it on the site since your pull, that change is reported and
// left alone instead of being overwritten. Each write also carries the row
// version it was based on, so the server refuses one that loses a race.
//
// Usage: npm run db:push-biomolecules              (preview only)
//        npm run db:push-biomolecules -- --apply   (send it)
// Env:   BIOCAL_URL (default https://biocal.ubch.sci.muni.cz),
//        BIOCAL_USERNAME / BIOCAL_PASSWORD (prompted for when unset).
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"
import {
  createSlugMaps,
  decide,
  describe,
  planPush,
  recordCreated,
  recordFailed,
  recordPlanned,
  request,
} from "./lib/biomolecule-sync.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DATA_DIR = path.join(ROOT, ".local-dev")
const LOCAL_DB = path.join(DATA_DIR, "biochemcalc.sqlite")
const BASE_DB = path.join(DATA_DIR, "biochemcalc.base.sqlite")
// Fingerprint of a fully pushed local library — lets db:pull replace it.
const PUSHED_MARK = path.join(DATA_DIR, "biochemcalc.pushed")
const EXPORTER = path.join(ROOT, "src-tauri/target/debug/export_biomolecules")
const SITE = (process.env.BIOCAL_URL ?? "https://biocal.ubch.sci.muni.cz").replace(/\/+$/, "")
const APPLY = process.argv.includes("--apply")

const log = (message) => console.log(`[db-push] ${message}`)
function fail(message) {
  console.error(`[db-push] ERROR: ${message}`)
  process.exit(1)
}

function exportLibrary(dbPath) {
  return execFileSync(EXPORTER, [dbPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  if (hidden) {
    // Echo nothing while the password is typed.
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) rl.output.write(question)
    }
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      if (hidden) process.stdout.write("\n")
      resolve(answer)
    })
  })
}

class Site {
  constructor(url) {
    this.url = url
    this.cookie = null
  }

  async post(endpoint, body) {
    const response = await fetch(`${this.url}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: JSON.stringify(body ?? {}),
    })
    if (!response.ok) {
      const text = await response.text()
      let message = text
      try {
        message = JSON.parse(text).message ?? text
      } catch {
        // not JSON — keep the raw body
      }
      const error = new Error(`${response.status} ${message}`.trim())
      error.status = response.status
      throw error
    }
    return response
  }

  async login(username, password) {
    const response = await this.post("/api/auth/login", { username, password })
    const session = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("session="))
    if (!session) throw new Error("the site did not return a session")
    this.cookie = session
    return response.json()
  }

  async logout() {
    if (this.cookie) await this.post("/api/auth/logout").catch(() => {})
  }

  async data() {
    return (await this.post("/api/biomolecules/data")).json()
  }

  async write(endpoint, body) {
    return (await this.post(`/api/biomolecules/${endpoint}`, body)).json()
  }
}

async function main() {
  if (!existsSync(LOCAL_DB)) fail(`no local database at ${LOCAL_DB} — run npm run db:pull first`)
  if (!existsSync(BASE_DB)) {
    fail(
      `no pulled snapshot at ${BASE_DB} to compare against — it is saved by npm run db:pull. ` +
        "Pull (your local edits are backed up, not merged), redo them, then push.",
    )
  }

  log("Building the exporter (incremental)...")
  execFileSync(
    "cargo",
    ["build", "--bin", "export_biomolecules", "--manifest-path", "src-tauri/Cargo.toml", "-q"],
    { cwd: ROOT, stdio: "inherit" },
  )

  const baseJson = exportLibrary(BASE_DB)
  // A snapshot older than a data migration gets fresh random ids on every
  // read, which would make every seeded row look new.
  if (exportLibrary(BASE_DB) !== baseJson) {
    fail("the pulled snapshot predates a data migration — run npm run db:pull and redo your edits")
  }
  const base = JSON.parse(baseJson)
  const localJson = exportLibrary(LOCAL_DB)
  const local = JSON.parse(localJson)

  const { ops } = planPush(base, local)
  if (ops.length === 0) {
    log("No Biomolekuly changes to push.")
    process.exit(0)
  }

  log(`Site: ${SITE}`)
  const username = process.env.BIOCAL_USERNAME ?? (await ask("Username: "))
  const password = process.env.BIOCAL_PASSWORD ?? (await ask("Password: ", { hidden: true }))
  const site = new Site(SITE)
  let user
  try {
    user = await site.login(username.trim(), password)
  } catch (error) {
    fail(`login failed: ${error.message}`)
  }
  if (user.role !== "teacher" || !["biomolecules", "both"].includes(user.sections)) {
    await site.logout()
    fail(`account ${user.username} can't edit Biomolekuly on the site`)
  }

  try {
    let prod = await site.data()
    const maps = createSlugMaps()
    const counts = { applied: 0, skipped: 0, conflict: 0, failed: 0 }

    log(APPLY ? `Pushing ${ops.length} change(s):` : `Preview — ${ops.length} change(s):`)
    for (const op of ops) {
      const verdict = decide(op, base, prod, maps)
      const line = describe(op)

      if (verdict.action === "skip") {
        recordCreated(op, prod, prod, maps)
        counts.skipped += 1
        log(`  skip      ${line} — ${verdict.reason}`)
        continue
      }
      if (verdict.action === "conflict") {
        recordFailed(op, maps)
        counts.conflict += 1
        log(`  CONFLICT  ${line} — ${verdict.reason}`)
        continue
      }
      if (!APPLY) {
        recordPlanned(op, base, maps)
        counts.applied += 1
        log(`  ready     ${line}`)
        continue
      }
      const [endpoint, body] = request(op, base, prod, maps)
      try {
        const after = await site.write(endpoint, body)
        recordCreated(op, prod, after, maps)
        prod = after
        counts.applied += 1
        log(`  done      ${line}`)
      } catch (error) {
        recordFailed(op, maps)
        // 409: the row changed between our check and the write — the server's call.
        if (error.status === 409) {
          counts.conflict += 1
          log(`  CONFLICT  ${line} — ${error.message.replace(/^409 /, "")}`)
        } else {
          counts.failed += 1
          log(`  FAILED    ${line} — ${error.message}`)
        }
        prod = await site.data()
      }
    }

    const verb = APPLY ? "pushed" : "ready to push"
    log(
      `${counts.applied} ${verb}, ${counts.skipped} already on the site, ` +
        `${counts.conflict} conflict(s)${APPLY ? `, ${counts.failed} failed` : ""}.`,
    )
    if (counts.conflict > 0) {
      log(
        "Conflicts were left alone: look at them on the site, then pull and redo what's still needed.",
      )
    }
    if (!APPLY && counts.applied > 0) log("Nothing was sent. Run again with --apply to push.")
    const complete = counts.conflict + counts.failed === 0
    if (APPLY && complete) {
      const fingerprint = createHash("sha256").update(localJson.trimEnd()).digest("hex")
      writeFileSync(PUSHED_MARK, `${fingerprint}\n`)
      log("Everything is on the site. Run npm run db:pull to sync your local copy with it.")
    }
    if (!complete) process.exitCode = 1
  } finally {
    await site.logout()
  }
}

main().catch((error) => fail(error.message))
