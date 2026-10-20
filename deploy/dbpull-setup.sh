#!/usr/bin/env bash
# One-time ROOT setup for the read-only snapshot (see DEPLOY.md, "Read-only
# snapshot for other developers"). Creates the `dbpull` user, which can do
# exactly one thing: read files under /srv/dbpull over SFTP. No shell, no
# port forwarding, no password, no view of anything else on the machine.
#
# Usage: sudo bash deploy/dbpull-setup.sh "<developer's ssh public key>" [service-user]
# Re-running it replaces the authorized key (e.g. to rotate or revoke).
set -euo pipefail

KEY="${1:?usage: sudo bash $0 \"<ssh public key>\" [service-user]}"
OWNER="${2:-kowalski}"
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
id "$OWNER" >/dev/null
printf '%s\n' "$KEY" | ssh-keygen -l -f - >/dev/null || { echo "not an ssh public key" >&2; exit 1; }

if ! id dbpull >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/dbpull --shell /usr/sbin/nologin dbpull
fi
passwd -l dbpull >/dev/null

# sshd requires the chroot (and its parents) to be root-owned and not
# group/world-writable; the snapshot dir inside belongs to the service user,
# whose timer writes it.
install -d -o root -g root -m 755 /srv/dbpull
install -d -o "$OWNER" -g "$OWNER" -m 755 /srv/dbpull/snapshot

install -d -o dbpull -g dbpull -m 700 /home/dbpull/.ssh
printf 'restrict %s\n' "$KEY" >/home/dbpull/.ssh/authorized_keys
chown dbpull:dbpull /home/dbpull/.ssh/authorized_keys
chmod 600 /home/dbpull/.ssh/authorized_keys

cat >/etc/ssh/sshd_config.d/60-dbpull.conf <<'CONF'
# Read-only snapshot pulls for other BioCal developers (deploy/dbpull-setup.sh).
Match User dbpull
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
chmod 644 /etc/ssh/sshd_config.d/60-dbpull.conf

sshd -t   # aborts here (set -e) on a bad config, before anything reloads
if systemctl is-active --quiet ssh; then systemctl reload ssh; fi

# First snapshot now, then hourly via the service user's timer.
sudo -u "$OWNER" -H "/home/$OWNER/biochemcalc-web/dbpull-snapshot.sh"
systemctl --user -M "$OWNER@" enable --now biochemcalc-dbpull.timer
echo "dbpull ready: developers pull /snapshot/biochemcalc.sqlite as dbpull@$(hostname -I | cut -d' ' -f1)"
