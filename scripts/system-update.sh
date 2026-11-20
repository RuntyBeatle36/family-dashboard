#!/usr/bin/env bash
# Applies system-level configuration (not just app code) — run by
# /api/update-apply after a successful git pull, if this file exists.
# Idempotent: always safe to re-run even when nothing in it actually
# changed, same as npm install already being run on every update
# regardless of whether package.json changed.
#
# Needs the sudoers rule in /etc/sudoers.d/dashboard-system-update, which
# allows only /usr/local/sbin/family-dashboard-apt (install packages by
# name). See system/dashboard-system-update.sudoers.
set -uo pipefail  # not -e: one failed step (e.g. a flaky apt mirror)
                  # shouldn't abort the whole script and skip the rest

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── System packages ──────────────────────────────────────────
PACKAGES_FILE="$REPO_DIR/system/packages.txt"
if [ -f "$PACKAGES_FILE" ]; then
  PACKAGES=$(grep -vE '^\s*(#|$)' "$PACKAGES_FILE" || true)
  if [ -n "$PACKAGES" ]; then
    echo "system-update: installing packages: $PACKAGES"
    if [ -x /usr/local/sbin/family-dashboard-apt ]; then
      sudo -n /usr/local/sbin/family-dashboard-apt $PACKAGES || echo "system-update: package install failed, continuing"
    else
      # Pi provisioned before the helper existed (older, broader sudoers rule)
      sudo -n /usr/bin/apt-get install -y $PACKAGES || echo "system-update: apt-get install failed, continuing"
    fi
  fi
fi

# ── systemd service file ─────────────────────────────────────
# Not installed from here: the app folder is writable by the app, so a sudo
# rule letting it copy the file into /etc/systemd/system would let it define
# a root service. Just flag the change (comparing the filled-in template).
if [ -f "$REPO_DIR/system/dashboard.service" ] && [ -f /etc/systemd/system/dashboard.service ] && \
   [ "$(systemctl show -p User --value dashboard.service 2>/dev/null)" = fdash ] && \
   [ "$(sed -e 's#@APP_USER@#fdash#g' -e "s#@APP_DIR@#$REPO_DIR#g" "$REPO_DIR/system/dashboard.service")" != "$(cat /etc/systemd/system/dashboard.service)" ]; then
  echo "system-update: dashboard.service changed — run scripts/setup-app-account.sh once to apply it"
fi

# ── Kiosk autostart (in the desktop login's home) ────────────
# The app runs as its own account (scripts/setup-app-account.sh), which
# can't write into the desktop login's home; then these are skipped with a
# note, and re-running provision-pi.sh as the desktop user applies them.
DESKTOP_HOME="$HOME"
if [ -f /etc/family-dashboard/desktop-user ]; then
  DESKTOP_HOME="$(getent passwd "$(cat /etc/family-dashboard/desktop-user)" | cut -d: -f6)"
fi
can_write() { [ -w "$1" ] || { [ ! -e "$1" ] && [ -w "$(dirname "$1")" ]; }; }

# ── Openbox kiosk autostart ──────────────────────────────────
if [ -f "$REPO_DIR/system/openbox-autostart" ]; then
  DEST="$DESKTOP_HOME/.config/openbox/autostart"
  if ! cmp -s "$REPO_DIR/system/openbox-autostart" "$DEST" 2>/dev/null; then
    if can_write "$DEST" || [ "$DESKTOP_HOME" = "$HOME" ]; then
      echo "system-update: openbox autostart changed, installing"
      mkdir -p "$(dirname "$DEST")"
      cp "$REPO_DIR/system/openbox-autostart" "$DEST" || echo "system-update: failed to install openbox autostart, continuing"
    else
      echo "system-update: openbox autostart changed; run scripts/provision-pi.sh as the desktop user to apply it"
    fi
  fi
fi

# ── labwc (Wayland) kiosk autostart ──────────────────────────
# Only on a Pi switched to Wayland via scripts/kiosk-display.sh (which is
# what creates this file) — an X11/Openbox Pi never gets one.
if [ -f "$REPO_DIR/system/labwc-autostart" ] && [ -f "$DESKTOP_HOME/.config/labwc/autostart" ]; then
  if ! cmp -s "$REPO_DIR/system/labwc-autostart" "$DESKTOP_HOME/.config/labwc/autostart"; then
    if can_write "$DESKTOP_HOME/.config/labwc/autostart"; then
      echo "system-update: labwc autostart changed, installing"
      cp "$REPO_DIR/system/labwc-autostart" "$DESKTOP_HOME/.config/labwc/autostart" || echo "system-update: failed to install labwc autostart, continuing"
    else
      echo "system-update: labwc autostart changed; run scripts/provision-pi.sh as the desktop user to apply it"
    fi
  fi
fi

# ── Tailscale (remote access) ────────────────────────────────
# Official static binaries into tailscale/ (gitignored), run unprivileged by
# the dashboard server itself (see tailscale.js) — no root or system service
# needed, so it installs and stays current through self-update alone.
# Checksum-verified; replaced via rename so a running copy is never
# half-overwritten. The server restarts right after this script, picking up
# a new version.
install_tailscale() {
  local arch dir latest_file latest current tmp sum
  case "$(uname -m)" in
    aarch64) arch=arm64 ;;
    armv7l)  arch=arm ;;
    x86_64)  arch=amd64 ;;
    *) echo "system-update: no Tailscale build for $(uname -m), skipping"; return 0 ;;
  esac
  dir="$REPO_DIR/tailscale"
  latest_file="$(curl -fsSL --max-time 20 'https://pkgs.tailscale.com/stable/?mode=json' \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Tarballs[process.argv[1]]||"")}catch{}})' "$arch")" || return 1
  [ -n "$latest_file" ] || return 1
  latest="$(echo "$latest_file" | sed -E 's/^tailscale_([^_]+)_.*/\1/')"
  current="$("$dir/tailscale" version 2>/dev/null | head -1 || true)"
  [ "$current" = "$latest" ] && return 0

  echo "system-update: installing Tailscale $latest (was: ${current:-none})"
  tmp="$(mktemp -d)"
  curl -fsSL --max-time 300 -o "$tmp/ts.tgz" "https://pkgs.tailscale.com/stable/$latest_file" || { rm -rf "$tmp"; return 1; }
  sum="$(curl -fsSL --max-time 20 "https://pkgs.tailscale.com/stable/$latest_file.sha256" | cut -d' ' -f1)"
  if [ -z "$sum" ] || [ "$(sha256sum "$tmp/ts.tgz" | cut -d' ' -f1)" != "$sum" ]; then
    echo "system-update: Tailscale checksum mismatch, not installing"; rm -rf "$tmp"; return 1
  fi
  tar -xzf "$tmp/ts.tgz" -C "$tmp" --strip-components=1 || { rm -rf "$tmp"; return 1; }
  mkdir -p "$dir"
  for bin in tailscale tailscaled; do
    install -m 755 "$tmp/$bin" "$dir/.$bin.new" && mv -f "$dir/.$bin.new" "$dir/$bin"
  done
  rm -rf "$tmp"
}
install_tailscale || echo "system-update: Tailscale install/update failed, continuing"

# ── One-time database backup ─────────────────────────────────
# Deletes itself after a successful run, so this only fires once per Pi.
if [ -f "$REPO_DIR/scripts/backup-db.sh" ]; then
  bash "$REPO_DIR/scripts/backup-db.sh" || echo "system-update: database backup failed, continuing"
fi

echo "system-update: done"
