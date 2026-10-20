#!/usr/bin/env bash
# One-time ROOT setup giving one developer read-only access to the cleaned
# snapshot (see DEPLOY.md, "Read-only snapshot for other developers"). Creates
# an account that can do exactly one thing: read files under /srv/dbpull over
# SFTP. No shell, no port forwarding, no password, no view of anything else on
# the machine. Run it once per developer, each with their own account name.
#
# Usage: sudo bash deploy/dbpull-setup.sh <account> "<ssh public key>" [service-user]
#   e.g. sudo bash deploy/dbpull-setup.sh david "ssh-ed25519 AAAA… david@laptop"
# Re-running it for the same account replaces the key (rotate or revoke).
set -euo pipefail

ACCOUNT="${1:?usage: sudo bash $0 <account> \"<ssh public key>\" [service-user]}"
KEY="${2:?usage: sudo bash $0 <account> \"<ssh public key>\" [service-user]}"
OWNER="${3:-kowalski}"
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
[[ "$ACCOUNT" =~ ^[a-z][a-z0-9_-]{1,30}$ ]] || { echo "invalid account name: $ACCOUNT" >&2; exit 1; }
[ "$ACCOUNT" != "$OWNER" ] || { echo "the account must differ from $OWNER" >&2; exit 1; }
id "$OWNER" >/dev/null
printf '%s\n' "$KEY" | ssh-keygen -l -f - >/dev/null || { echo "not an ssh public key" >&2; exit 1; }

if id "$ACCOUNT" >/dev/null 2>&1; then
  # Only ever reuse an account this script made — never lock down a real login.
  if [ "$(getent passwd "$ACCOUNT" | cut -d: -f7)" != "/usr/sbin/nologin" ]; then
    echo "$ACCOUNT already exists as a normal account — pick another name" >&2
    exit 1
  fi
else
  useradd --system --create-home --home-dir "/home/$ACCOUNT" --shell /usr/sbin/nologin "$ACCOUNT"
fi
passwd -l "$ACCOUNT" >/dev/null

# sshd requires the chroot (and its parents) to be root-owned and not
# group/world-writable; the snapshot dir inside belongs to the service user,
# whose timer writes it.
install -d -o root -g root -m 755 /srv/dbpull
install -d -o "$OWNER" -g "$OWNER" -m 755 /srv/dbpull/snapshot

install -d -o "$ACCOUNT" -g "$ACCOUNT" -m 700 "/home/$ACCOUNT/.ssh"
printf 'restrict %s\n' "$KEY" >"/home/$ACCOUNT/.ssh/authorized_keys"
chown "$ACCOUNT:$ACCOUNT" "/home/$ACCOUNT/.ssh/authorized_keys"
chmod 600 "/home/$ACCOUNT/.ssh/authorized_keys"

cat >"/etc/ssh/sshd_config.d/60-dbpull-$ACCOUNT.conf" <<CONF
# Read-only snapshot pulls for BioCal developer $ACCOUNT (deploy/dbpull-setup.sh).
Match User $ACCOUNT
    ChrootDirectory /srv/dbpull
    ForceCommand internal-sftp -R
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding no
    AllowAgentForwarding no
    AllowStreamLocalForwarding no
    X11Forwarding no
    PermitTunnel no
    PermitTTY no
CONF
chmod 644 "/etc/ssh/sshd_config.d/60-dbpull-$ACCOUNT.conf"

# A bad config is removed again before anything reloads, so ssh access to the
# machine can't be broken by this script.
if ! sshd -t; then
  rm -f "/etc/ssh/sshd_config.d/60-dbpull-$ACCOUNT.conf"
  echo "sshd rejected the config — nothing was reloaded" >&2
  exit 1
fi
if systemctl is-active --quiet ssh; then systemctl reload ssh; fi

# First snapshot now, then hourly via the service user's timer.
sudo -u "$OWNER" -H "/home/$OWNER/biochemcalc-web/dbpull-snapshot.sh"
systemctl --user -M "$OWNER@" enable --now biochemcalc-dbpull.timer
echo "ready: $ACCOUNT pulls /snapshot/biochemcalc.sqlite from $(hostname -I | cut -d' ' -f1)"
