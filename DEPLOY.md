# Deploying BiochemCalc

The app runs on a VM (`ssh proxmox1`, 147.251.22.180:8080) as a plain HTTP
server (Rust/Axum + SQLite), separate from the desktop Tauri build. The VM
holds real teacher accounts, questions, and datasets — treat its database as
irreplaceable. This doc is the safe procedure for shipping a change to it.

## Before you start

- **Commit and push local changes first.** The VM deploy pulls from
  `origin/main`; nothing you haven't pushed can reach it.
- **Check for stray Syncthing conflict files.** Syncthing runs on this
  machine and has previously duplicated source files as
  `*.sync-conflict-<timestamp>-<id>.*`. These are untracked but can still
  break `tsc`/`cargo build` if a stale one sits next to a file it duplicates.
  Check and remove any before building:
  ```
  find . -iname '*sync-conflict*' -not -path './.git/*' -not -path './node_modules/*'
  ```
  Only delete ones that are clearly stale duplicates of tracked files — never
  touch the DB or anything under `~/.local/share/com.kowalski.biochemcalc/`.

## 1. Verify the build locally

Catch compile errors before they hit the VM:

```
npm run build
cargo build --release --manifest-path src-tauri/Cargo.toml
```

Both must succeed cleanly.

## 2. Back up the live database on the VM — always, even for "safe" changes

The live DB is at:

```
~/.local/share/com.kowalski.biochemcalc/biochemcalc.sqlite
```

Back it up **before** touching the binary, the service, or pulling code that
changes the schema:

```bash
ssh proxmox1 "cp ~/.local/share/com.kowalski.biochemcalc/biochemcalc.sqlite \
  ~/biochemcalc-backups/biochemcalc-pre-<short-description>-\$(date +%Y%m%d-%H%M%S).sqlite"
```

Use a short description of *why* (e.g. `pre-v32-notation`, `pre-topic-groups`)
so old backups stay identifiable. Existing backups live in two places:
`~/biochemcalc-backups/` and `~/backups/biochemcalc/` — new ones go in
`~/biochemcalc-backups/` to match the current convention.

Also snapshot the current binary and `dist/` so a bad deploy can be rolled
back without rebuilding:

```bash
ssh proxmox1 'TS=$(date +%Y%m%d-%H%M%S); \
  cp ~/biochemcalc-web/biochemcalc-server ~/biochemcalc-backups/biochemcalc-server-pre-<desc>-$TS.bin && \
  cp -r ~/biochemcalc-web/dist ~/biochemcalc-backups/dist-pre-<desc>-$TS'
```

**Never delete or overwrite existing backups, and never truncate/reset the
live `.sqlite` file.** If a migration is additive (new column/table), it's
safe to let the server apply it on startup — the row counts below confirm
nothing was lost.

## 3. Pull and build on the VM

```bash
ssh proxmox1 "cd ~/biochemcalc && git pull"
ssh proxmox1 "cd ~/biochemcalc && npm install && npm run build"
ssh proxmox1 "source ~/.cargo/env && cd ~/biochemcalc/src-tauri && cargo build --release"
```

If `git pull` reports local modifications blocking the merge (e.g. a stray
`package-lock.json` diff from a previous `npm install`), inspect the diff
before discarding — don't blindly `git checkout --` or `git reset --hard` on
the VM.

## 4. Swap in the new binary and restart

The binary can't be overwritten while running ("text file busy"), so stop the
service first:

```bash
ssh proxmox1 "systemctl --user stop biochemcalc && \
  cp ~/biochemcalc/src-tauri/target/release/biochemcalc-server ~/biochemcalc-web/biochemcalc-server && \
  rm -rf ~/biochemcalc-web/dist && \
  cp -r ~/biochemcalc/dist ~/biochemcalc-web/ && \
  systemctl --user start biochemcalc"
```

This only touches the binary and static `dist/` — it never touches
`~/.local/share/com.kowalski.biochemcalc/` (the DB) or any backup directory.

## 5. Verify

```bash
ssh proxmox1 "systemctl --user status biochemcalc --no-pager -l | head -15"
ssh proxmox1 "journalctl --user -u biochemcalc --no-pager -n 20 | grep -iE 'error|panic'"
ssh proxmox1 "sqlite3 ~/.local/share/com.kowalski.biochemcalc/biochemcalc.sqlite 'PRAGMA user_version;'"
ssh proxmox1 "curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:8080/"
```

Confirm `user_version` matches `CURRENT_USER_VERSION` in
`src-tauri/src/db/schema.rs`, no errors/panics in the log, and the service
returns HTTP 200.

**Sanity-check row counts against the backup taken in step 2** — this is the
real proof nothing was touched:

```bash
ssh proxmox1 "sqlite3 ~/.local/share/com.kowalski.biochemcalc/biochemcalc.sqlite \
  'select (select count(*) from users), (select count(*) from templates), (select count(*) from variables);'"
ssh proxmox1 "sqlite3 ~/biochemcalc-backups/<your-backup-file>.sqlite \
  'select (select count(*) from users), (select count(*) from templates), (select count(*) from variables);'"
```

The two rows should match exactly (schema migrations may add columns but
must not change row counts).

## Rolling back

If something's wrong after deploy:

```bash
ssh proxmox1 "systemctl --user stop biochemcalc && \
  cp ~/biochemcalc-backups/biochemcalc-server-pre-<desc>-<ts>.bin ~/biochemcalc-web/biochemcalc-server && \
  rm -rf ~/biochemcalc-web/dist && \
  cp -r ~/biochemcalc-backups/dist-pre-<desc>-<ts> ~/biochemcalc-web/dist && \
  systemctl --user start biochemcalc"
```

Only restore the DB backup from step 2 if the live DB was actually corrupted
or lost data — restoring it discards any real usage (attempts, edits) that
happened between the backup and now. Treat that as a last resort, not a
routine rollback step.

## Read-only snapshot for other developers

Other developers pull a **cleaned** copy of the live database, never the live
file, each through their own locked-down account (e.g. `zble`):

- `deploy/dbpull-snapshot.sh` (installed as `~/biochemcalc-web/dbpull-snapshot.sh`,
  run hourly by the `biochemcalc-dbpull.timer` user unit) copies the live DB with
  SQLite's online backup, deletes sessions, password-reset tokens and invite
  codes, sets every password to the public dev password `devpassword1`, removes
  emails, renames students to `student-0001`…, VACUUMs, verifies, and atomically
  replaces `/srv/dbpull/snapshot/biochemcalc.sqlite`. It only ever reads the
  live DB.
- Each such account is chrooted to `/srv/dbpull` with `ForceCommand internal-sftp -R`:
  it can read that snapshot and nothing else — no shell, no forwarding, no password.

One-time setup per developer (root), with their account name and SSH **public** key:

```bash
ssh proxmox1 "cd ~/biochemcalc && git pull"
ssh -t proxmox1 'sudo bash ~/biochemcalc/deploy/dbpull-setup.sh zble "ssh-ed25519 AAAA… zble@laptop"'
```

It creates the account, directories and `/etc/ssh/sshd_config.d/60-dbpull-<account>.conf`,
runs `sshd -t` before reloading ssh (and removes the file again if it fails),
publishes the first snapshot and enables the timer. It refuses to touch an
existing normal account of the same name. Re-running it replaces the key; to
revoke access, `sudo rm /home/<account>/.ssh/authorized_keys`.

The developer pulls with:

```bash
VM_HOST=zble@147.251.22.180 VM_DB=/snapshot/biochemcalc.sqlite npm run db:pull
```

Check the timer: `systemctl --user list-timers biochemcalc-dbpull.timer` and
`journalctl --user -u biochemcalc-dbpull -n 5`.
