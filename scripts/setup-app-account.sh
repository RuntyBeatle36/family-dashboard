#!/usr/bin/env bash
# Runs the dashboard server under its own account (`fdash`) instead of the
# desktop login (`user`), and installs the system pieces it needs. Run by
# hand, as the desktop user (it asks for your password for sudo):
#
#   bash ~/family-dashboard/scripts/setup-app-account.sh
#
# Why: the server needs a few passwordless system permissions (install
# listed packages, Wi-Fi and time zone, Exit to Terminal). Granted to
# `user`, they'd also apply to everything else running as `user`, like the
# kiosk browser. Granted to a dedicated account that nothing else runs as,
# they don't.
#
# What it does (each step is skipped if already done, so re-running is safe):
#   1. creates the `fdash` system account (no password; can't log in with one)
#   2. moves the app from ~/family-dashboard to /opt/family-dashboard, owned
#      by fdash, leaving ~/family-dashboard as a link to it
#   3. moves the per-device password (plug-and-play units) to
#      /etc/family-dashboard/device-password, readable by fdash only
#   4. installs the package helper, sudoers rule, polkit rule and service
#      file, all scoped to fdash
#   5. starts the dashboard and checks it answers. If it doesn't within a
#      minute, everything above is undone and the old setup is restarted.
#
# Afterwards, Tailscale SSH logs in as the app account:
#   ssh fdash@family-dashboard
# (Tailscale runs inside the dashboard, so it can only sign in as the account
# the dashboard runs as.) Normal SSH as `user` on the home network is unchanged.

set -euo pipefail

APP_USER=fdash
APP_DIR=/opt/family-dashboard
APP_HOME=/var/lib/family-dashboard
ETC_DIR=/etc/family-dashboard
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DESKTOP_USER="$(id -un)"
DESKTOP_HOME="$HOME"
LINK="$DESKTOP_HOME/family-dashboard"
ROLLBACK="$(mktemp -d)"

die() { echo "!! $*" >&2; exit 1; }
[ "$DESKTOP_USER" != root ] || die "Run this as the desktop user (not with sudo); it asks for the password itself."
[ "$DESKTOP_USER" != "$APP_USER" ] || die "Run this as the desktop user, not as $APP_USER."

echo "== Family Dashboard: run the app under its own account =="
echo "Desktop account: $DESKTOP_USER   App account: $APP_USER   App folder: $APP_DIR"
echo
sudo -v || die "This needs your password for sudo."

render() { # system file from the repo, with the app account / folder filled in
  sed -e "s#@APP_USER@#$APP_USER#g" -e "s#@APP_DIR@#$APP_DIR#g" -e "s#@DESKTOP_USER@#$DESKTOP_USER#g" "$1"
}

# Keep copies of what's installed now, to put back if this fails
for f in /etc/systemd/system/dashboard.service /etc/sudoers.d/dashboard-system-update \
         /etc/polkit-1/rules.d/50-family-dashboard.rules /usr/local/sbin/family-dashboard-apt; do
  if sudo test -f "$f"; then sudo cp -a "$f" "$ROLLBACK/$(basename "$f")"; fi
done
MOVED=0

rollback() {
  echo
  echo "!! The dashboard didn't come back. Putting the previous setup back."
  sudo systemctl stop dashboard.service 2>/dev/null || true
  for f in /etc/systemd/system/dashboard.service /etc/sudoers.d/dashboard-system-update \
           /etc/polkit-1/rules.d/50-family-dashboard.rules /usr/local/sbin/family-dashboard-apt; do
    if [ -f "$ROLLBACK/$(basename "$f")" ]; then sudo cp -a "$ROLLBACK/$(basename "$f")" "$f"; fi
  done
  if [ "$MOVED" = 1 ]; then
    if [ -d "$LINK.pre-move" ]; then
      rm -f "$LINK"
      mv "$LINK.pre-move" "$LINK"
    fi
    sudo rm -rf "$APP_DIR" # a copy; the original was never changed
  fi
  sudo systemctl daemon-reload
  sudo systemctl start dashboard.service || true
  echo "!! Back to the previous setup. Nothing was lost. Check: journalctl -u dashboard -n 50"
  exit 1
}

# ── 1. Account ──────────────────────────────────────────────
if ! id "$APP_USER" >/dev/null 2>&1; then
  echo "-- Creating the $APP_USER account --"
  sudo useradd --system --create-home --home-dir "$APP_HOME" --shell /bin/bash \
    --comment "Family Dashboard app" "$APP_USER"
fi
sudo passwd -l "$APP_USER" >/dev/null # no password logins, ever

# ── 2. Move the app ─────────────────────────────────────────
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  [ ! -e "$APP_DIR" ] || die "$APP_DIR already exists but this copy isn't there. Remove it, then run this again."
  echo "-- Stopping the dashboard --"
  sudo systemctl stop dashboard.service 2>/dev/null || true
  echo "-- Moving the app to $APP_DIR --"
  sudo cp -a "$SRC_DIR" "$APP_DIR"
  sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  MOVED=1
  if [ "$SRC_DIR" = "$(readlink -f "$LINK")" ] && [ ! -L "$LINK" ]; then
    mv "$LINK" "$LINK.pre-move"
    ln -s "$APP_DIR" "$LINK"
  fi
else
  sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

# ── 3. Per-device password (plug-and-play units) ────────────
sudo install -d -o root -g "$APP_USER" -m 750 "$ETC_DIR"
if [ -f "$DESKTOP_HOME/.device-password" ] && ! sudo test -f "$ETC_DIR/device-password"; then
  echo "-- Moving the per-device password --"
  sudo install -o root -g "$APP_USER" -m 640 "$DESKTOP_HOME/.device-password" "$ETC_DIR/device-password"
  rm -f "$DESKTOP_HOME/.device-password"
fi
echo "$DESKTOP_USER" | sudo tee "$ETC_DIR/desktop-user" >/dev/null

# ── 4. System files, scoped to the app account ──────────────
echo "-- Installing the package helper, sudoers rule, polkit rule and service --"
sudo install -o root -g root -m 755 "$APP_DIR/system/family-dashboard-apt" /usr/local/sbin/family-dashboard-apt
render "$APP_DIR/system/dashboard-system-update.sudoers" > "$ROLLBACK/sudoers.new"
sudo visudo -c -f "$ROLLBACK/sudoers.new" >/dev/null || rollback
sudo install -o root -g root -m 440 "$ROLLBACK/sudoers.new" /etc/sudoers.d/dashboard-system-update
render "$APP_DIR/system/50-family-dashboard.rules" | sudo tee /etc/polkit-1/rules.d/50-family-dashboard.rules >/dev/null
render "$APP_DIR/system/dashboard.service" | sudo tee /etc/systemd/system/dashboard.service >/dev/null
sudo chmod 644 /etc/polkit-1/rules.d/50-family-dashboard.rules /etc/systemd/system/dashboard.service
sudo systemctl daemon-reload
sudo systemctl enable dashboard.service >/dev/null 2>&1

# ── 5. Start and check ──────────────────────────────────────
echo "-- Starting the dashboard --"
sudo systemctl restart dashboard.service || rollback
for _ in $(seq 1 30); do
  if curl -sf -m 3 http://localhost:3000/api/version >/dev/null; then
    running_as="$(ps -o user= -p "$(systemctl show -p MainPID --value dashboard.service)" | tr -d ' ')"
    [ "$running_as" = "$APP_USER" ] || rollback
    echo
    echo "== Done. The dashboard runs as $APP_USER from $APP_DIR. =="
    [ ! -d "$LINK.pre-move" ] || echo "The old copy is kept at $LINK.pre-move. Delete it once you're happy: rm -rf $LINK.pre-move"
    echo "Tailscale SSH now signs in as the app account: ssh $APP_USER@family-dashboard"
    echo "Next: sudo bash $APP_DIR/scripts/harden-pi.sh"
    rm -rf "$ROLLBACK"
    exit 0
  fi
  sleep 2
done
rollback
