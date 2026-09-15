#!/usr/bin/env bash
# Security check-up for a running dashboard Pi — audits and tightens the
# handful of things that actually matter for a box that sits on your home
# network with SSH and a NOPASSWD sudoers rule: the firewall, SSH itself,
# the sudoers rule, file permissions, and automatic security patching.
#
# Run by hand, whenever you want a check-up (initial setup, or periodically):
#   sudo bash scripts/harden-pi.sh
#
# NOT part of the automatic self-update flow (scripts/system-update.sh, run
# by /api/update-apply after every git pull) — touching SSH/firewall config
# is exactly the kind of change that should never happen silently in the
# background where nobody's watching for something to go wrong. Run this
# one yourself, read its output.
#
# Two things it will never do, no matter what else it tightens:
#   - Block or disable SSH access. It only ever narrows *how* you log in
#     (see PasswordAuthentication below), never locks the door entirely.
#   - Restrict outbound traffic. GitHub (self-update), apt (packages), and
#     the Piper voice-model download all still work — only *inbound*
#     connections get restricted.
#
# Idempotent — every check looks at current state before changing anything,
# and prints [ok]/[fix]/[warn] either way. Safe to re-run any time.

set -uo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo bash $0" >&2
  exit 1
fi

# SUDO_USER is who ran `sudo` — the actual dashboard account, not root.
# Falls back to "user" (what every other file in system/ assumes) if this
# is somehow run as a root login shell directly instead of via sudo.
REAL_USER="${SUDO_USER:-user}"
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTH_KEYS="$REAL_HOME/.ssh/authorized_keys"

pass() { echo "  [ok]   $1"; }
act()  { echo "  [fix]  $1"; }
warn() { echo "  [warn] $1"; }

echo "== Family Dashboard: Pi security check-up =="
echo "Account: $REAL_USER  Home: $REAL_HOME  Repo: $REPO_DIR"
echo

# ── 1. Firewall (ufw) ─────────────────────────────────────────────
# SSH and the dashboard port are opened BEFORE the firewall is ever
# switched on, so turning it on can never be the thing that cuts off the
# access we're trying to protect.
echo "-- Firewall (ufw) --"
if ! command -v ufw >/dev/null 2>&1; then
  act "Installing ufw"
  apt-get install -y ufw >/dev/null
fi
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1
ufw allow 3000/tcp comment 'Family Dashboard' >/dev/null 2>&1
if ufw status | grep -q "Status: active"; then
  pass "ufw already active"
else
  act "Enabling ufw (deny incoming by default, allow outgoing; SSH + 3000/tcp already allowed above)"
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable >/dev/null
fi
ufw status verbose | sed 's/^/  /'
echo

# ── 2. SSH server: installed, enabled, and hardened ────────────────
echo "-- SSH --"
if ! dpkg -s openssh-server >/dev/null 2>&1; then
  act "Installing openssh-server"
  apt-get install -y openssh-server >/dev/null
fi
systemctl enable --now ssh >/dev/null 2>&1 || systemctl enable --now sshd >/dev/null 2>&1

SSHD_CONFIG=/etc/ssh/sshd_config
if [ -f "$SSHD_CONFIG" ]; then
  # -n: never clobber a backup from an earlier run of this script — that
  # first backup is the one worth keeping (closest to "before we touched it").
  cp -n "$SSHD_CONFIG" "$SSHD_CONFIG.pre-harden.bak"

  set_sshd_opt() { # $1=directive $2=value — replaces an existing (even commented-out) line, else appends
    if grep -qE "^[#[:space:]]*$1[[:space:]]" "$SSHD_CONFIG"; then
      sed -i -E "s|^[#[:space:]]*$1[[:space:]].*|$1 $2|" "$SSHD_CONFIG"
    else
      echo "$1 $2" >> "$SSHD_CONFIG"
    fi
  }

  set_sshd_opt PermitRootLogin no
  set_sshd_opt PermitEmptyPasswords no
  set_sshd_opt X11Forwarding no
  set_sshd_opt MaxAuthTries 4
  set_sshd_opt LoginGraceTime 30

  # Password login only gets turned off once a key is actually in place —
  # flipping it blind would be how you lock yourself out of a headless Pi.
  if [ -s "$AUTH_KEYS" ]; then
    set_sshd_opt PasswordAuthentication no
    pass "SSH key on file for $REAL_USER — password login disabled, key-based login still works"
  else
    set_sshd_opt PasswordAuthentication yes
    warn "No SSH key at $AUTH_KEYS — leaving password login ON so you can't get locked out."
    warn "Set one up from another machine: ssh-copy-id $REAL_USER@<pi-ip>  — then re-run this script."
  fi

  CHECK_ERR="$(mktemp)"
  if sshd -t 2>"$CHECK_ERR"; then
    systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null 2>&1
    pass "sshd_config updated and reloaded"
  else
    warn "New sshd_config failed validation — reverting to the pre-harden backup:"
    sed 's/^/    /' "$CHECK_ERR"
    cp "$SSHD_CONFIG.pre-harden.bak" "$SSHD_CONFIG"
  fi
  rm -f "$CHECK_ERR"
else
  warn "No $SSHD_CONFIG found — openssh-server install may have failed"
fi
echo

# ── 3. fail2ban — bans SSH brute-forcers without touching legitimate access ──
echo "-- fail2ban --"
if ! command -v fail2ban-client >/dev/null 2>&1; then
  act "Installing fail2ban"
  apt-get install -y fail2ban >/dev/null
fi
F2B_LOCAL=/etc/fail2ban/jail.local
if [ ! -f "$F2B_LOCAL" ] || ! grep -q '^\[sshd\]' "$F2B_LOCAL" 2>/dev/null; then
  act "Enabling the sshd jail (5 failures -> 1 hour ban)"
  cat >> "$F2B_LOCAL" <<'EOF'

[sshd]
enabled = true
backend = systemd
maxretry = 5
bantime = 1h
EOF
fi
systemctl enable --now fail2ban >/dev/null 2>&1
if systemctl is-active --quiet fail2ban; then
  pass "fail2ban running"
else
  warn "fail2ban did not start — check: systemctl status fail2ban"
fi
echo

# ── 4. Unattended security upgrades ─────────────────────────────────
# Separate from scripts/system-update.sh's apt-get (that only ever installs
# the specific packages this app needs, from system/packages.txt) — this is
# general OS/security patching, on its own daily timer.
echo "-- Automatic security updates --"
if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  act "Installing unattended-upgrades"
  apt-get install -y unattended-upgrades >/dev/null
fi
UU_CONF=/etc/apt/apt.conf.d/20auto-upgrades
if [ ! -f "$UU_CONF" ] || ! grep -q 'Unattended-Upgrade "1"' "$UU_CONF"; then
  act "Enabling daily unattended security upgrades"
  cat > "$UU_CONF" <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
else
  pass "unattended-upgrades already enabled"
fi
echo

# ── 5. Sudoers rules ─────────────────────────────────────────────
# The dashboard app itself runs with a NOPASSWD sudoers rule (so the in-app
# self-update flow and "Exit to Terminal" don't need a password nobody's
# there to type) — the one thing worth policing here is that it stays
# exactly as narrow as system/dashboard-system-update.sudoers defines, and
# that no *other* sudoers drop-in has quietly granted something broader.
echo "-- Sudoers --"
for f in /etc/sudoers.d/*; do
  [ -f "$f" ] || continue
  if visudo -c -f "$f" >/dev/null 2>&1; then
    pass "$(basename "$f") is syntactically valid"
  else
    warn "$(basename "$f") FAILED validation — sudo may misbehave until this is fixed"
  fi
  if grep -qE 'NOPASSWD:\s*ALL\b' "$f"; then
    warn "$(basename "$f") grants passwordless ALL — much broader than this app needs, double-check it's intentional"
  fi
done

DASH_SUDOERS_SRC="$REPO_DIR/system/dashboard-system-update.sudoers"
DASH_SUDOERS_DEST=/etc/sudoers.d/dashboard-system-update
if [ -f "$DASH_SUDOERS_SRC" ]; then
  if [ -f "$DASH_SUDOERS_DEST" ] && cmp -s "$DASH_SUDOERS_SRC" "$DASH_SUDOERS_DEST"; then
    pass "dashboard sudoers rule matches the repo (still scoped to just apt-get install / the service file install / daemon-reload / pkill Xorg)"
  else
    act "Installing/repairing the dashboard sudoers rule from the repo"
    install -m 440 "$DASH_SUDOERS_SRC" "$DASH_SUDOERS_DEST"
    if ! visudo -c -f "$DASH_SUDOERS_DEST" >/dev/null 2>&1; then
      warn "That rule failed validation — removing it (self-update/Exit to Terminal will prompt for a password until this is fixed)"
      rm -f "$DASH_SUDOERS_DEST"
    fi
  fi
fi
echo

# ── 6. File permissions ─────────────────────────────────────────
echo "-- File permissions --"
check_perm() { # $1=path $2=wanted-mode $3=label
  [ -e "$1" ] || return 0
  have="$(stat -c '%a' "$1")"
  if [ "$have" = "$2" ]; then
    pass "$3 is $2"
  else
    act "$3 was $have, fixing to $2"
    chmod "$2" "$1"
  fi
}
check_perm "$DASH_SUDOERS_DEST"                       440 "dashboard sudoers rule"
check_perm /etc/systemd/system/dashboard.service      644 "dashboard.service"
check_perm "$REAL_HOME/.ssh"                          700 "~/.ssh"
check_perm "$AUTH_KEYS"                                600 "authorized_keys"

DB_DIR="$REPO_DIR/db"
if [ -d "$DB_DIR" ]; then
  WORLD_WRITABLE="$(find "$DB_DIR" -perm -o+w 2>/dev/null)"
  if [ -n "$WORLD_WRITABLE" ]; then
    act "Removing world-write permission from db/ files"
    find "$DB_DIR" -perm -o+w -exec chmod o-w {} \;
  else
    pass "db/ has no world-writable files"
  fi
fi
echo

# ── 7. Light network hardening (sysctl) ─────────────────────────
# Standard, low-risk defaults — none of this affects outbound git/apt/Piper
# traffic or inbound SSH.
echo "-- Kernel network hardening --"
SYSCTL_CONF=/etc/sysctl.d/60-dashboard-hardening.conf
if [ ! -f "$SYSCTL_CONF" ]; then
  act "Adding sysctl hardening drop-in"
  cat > "$SYSCTL_CONF" <<'EOF'
# Added by scripts/harden-pi.sh.
net.ipv4.conf.all.rp_filter=1
net.ipv4.conf.default.rp_filter=1
net.ipv4.icmp_echo_ignore_broadcasts=1
net.ipv4.conf.all.accept_source_route=0
net.ipv4.conf.all.send_redirects=0
net.ipv4.tcp_syncookies=1
EOF
  sysctl -p "$SYSCTL_CONF" >/dev/null 2>&1
else
  pass "sysctl hardening already in place"
fi
echo

# ── Summary ──────────────────────────────────────────────────────
echo "-- Listening ports (for your own review) --"
(ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null) | sed 's/^/  /'
echo
echo "== Done =="
echo "GitHub / apt / Piper downloads: unaffected — only inbound traffic was restricted."
echo "SSH: still reachable through the firewall; password login was only turned off"
echo "above if a key for $REAL_USER was already in place."
