#!/usr/bin/env bash
# Applies system-level configuration (not just app code) — run by
# /api/update-apply after a successful git pull, if this file exists.
# Idempotent: always safe to re-run even when nothing in it actually
# changed, same as npm install already being run on every update
# regardless of whether package.json changed.
#
# Needs the sudoers rules in /etc/sudoers.d/dashboard-system-update:
# apt-get install, systemctl daemon-reload, and installing
# system/dashboard.service into place. See README for the exact rules.
set -uo pipefail  # not -e: one failed step (e.g. a flaky apt mirror)
                  # shouldn't abort the whole script and skip the rest

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── System packages ──────────────────────────────────────────
PACKAGES_FILE="$REPO_DIR/system/packages.txt"
if [ -f "$PACKAGES_FILE" ]; then
  PACKAGES=$(grep -vE '^\s*(#|$)' "$PACKAGES_FILE" || true)
  if [ -n "$PACKAGES" ]; then
    echo "system-update: installing packages: $PACKAGES"
    sudo /usr/bin/apt-get install -y $PACKAGES || echo "system-update: apt-get install failed, continuing"
  fi
fi

# ── systemd service file ─────────────────────────────────────
if [ -f "$REPO_DIR/system/dashboard.service" ]; then
  if ! cmp -s "$REPO_DIR/system/dashboard.service" /etc/systemd/system/dashboard.service 2>/dev/null; then
    echo "system-update: dashboard.service changed, installing"
    sudo /usr/bin/install -o root -g root -m 644 \
      "$REPO_DIR/system/dashboard.service" /etc/systemd/system/dashboard.service \
      && sudo /usr/bin/systemctl daemon-reload \
      || echo "system-update: failed to install dashboard.service, continuing"
  fi
fi

# ── Openbox kiosk autostart ──────────────────────────────────
if [ -f "$REPO_DIR/system/openbox-autostart" ]; then
  DEST="$HOME/.config/openbox/autostart"
  if ! cmp -s "$REPO_DIR/system/openbox-autostart" "$DEST" 2>/dev/null; then
    echo "system-update: openbox autostart changed, installing"
    mkdir -p "$HOME/.config/openbox"
    cp "$REPO_DIR/system/openbox-autostart" "$DEST" || echo "system-update: failed to install openbox autostart, continuing"
  fi
fi

echo "system-update: done"
