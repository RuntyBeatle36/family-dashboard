#!/usr/bin/env bash
# One-time bootstrap for a FRESH Raspberry Pi OS install — takes it from a
# blank OS to a fully working, auto-starting Family Dashboard kiosk.
#
# Run this by hand, once, when setting up a new Pi:
#   bash scripts/provision-pi.sh
# or, before the repo is even cloned yet:
#   curl -fsSL https://raw.githubusercontent.com/RuntyBeatle36/family-dashboard/main/scripts/provision-pi.sh | bash
#
# Idempotent — every step checks whether it's already done before acting,
# so it's safe to re-run (e.g. if it's interrupted, or to pick up new steps
# added here later).
#
# NOT wired into the app's automatic self-update flow (that's
# scripts/system-update.sh, run by /api/update-apply after every git pull)
# — this script is never invoked by the running app itself, only by a human
# setting up new hardware. Running it again on an already-provisioned Pi is
# safe (everything it does is check-before-act) but pointless.
#
# Assumes Raspberry Pi OS (Debian/apt-based) with the desktop + Openbox
# environment, matching how the currently-deployed Pi is actually set up
# (see system/dashboard.service, system/openbox-autostart) — not the older
# LightDM/chromium-browser instructions previously in the README.

set -uo pipefail

REPO_URL="https://github.com/RuntyBeatle36/family-dashboard.git"
REPO_DIR="$HOME/family-dashboard"
PIPER_RELEASE="2023.11.14-2"
PIPER_VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"

echo "== Family Dashboard: provisioning this Pi =="
echo

# ── 1. Node.js (v22.5+ required — node:sqlite doesn't exist before that) ──
NODE_MAJOR="$(command -v node >/dev/null 2>&1 && node -e 'console.log(process.versions.node.split(".")[0])' || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "-- Installing Node.js 24.x --"
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "-- Node.js already installed ($(node -v)), skipping --"
fi

# ── 2. Clone the repo (skip if already present) ─────────────────────
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "-- Cloning repo to $REPO_DIR --"
  git clone "$REPO_URL" "$REPO_DIR"
else
  echo "-- Repo already present at $REPO_DIR, skipping clone --"
fi
cd "$REPO_DIR"

# ── 3. App dependencies ──────────────────────────────────────────────
echo "-- npm install --"
npm install --omit=dev

# ── 4. Piper (TTS) — standalone binary + voice model, not an apt package ──
if [ ! -x "$REPO_DIR/piper/piper" ]; then
  echo "-- Installing Piper (TTS engine) --"
  ARCH="$(uname -m)"
  case "$ARCH" in
    aarch64) PIPER_ASSET="piper_linux_aarch64.tar.gz" ;;
    armv7l)  PIPER_ASSET="piper_linux_armv7l.tar.gz" ;;
    x86_64)  PIPER_ASSET="piper_linux_x86_64.tar.gz" ;;
    *)
      echo "!! Unrecognized architecture '$ARCH' — skipping Piper install."
      echo "!! Read Aloud won't work until it's installed manually (see README)."
      PIPER_ASSET=""
      ;;
  esac
  if [ -n "$PIPER_ASSET" ]; then
    curl -fsSL -o /tmp/piper.tar.gz \
      "https://github.com/rhasspy/piper/releases/download/$PIPER_RELEASE/$PIPER_ASSET"
    tar -xzf /tmp/piper.tar.gz -C "$REPO_DIR"
    rm -f /tmp/piper.tar.gz
    chmod +x "$REPO_DIR/piper/piper"
  fi
else
  echo "-- Piper binary already present, skipping --"
fi
if [ -x "$REPO_DIR/piper/piper" ] && [ ! -f "$REPO_DIR/piper/en_US-lessac-medium.onnx" ]; then
  echo "-- Downloading default voice model (en_US-lessac-medium) --"
  curl -fsSL -o "$REPO_DIR/piper/en_US-lessac-medium.onnx" "$PIPER_VOICE_BASE/en_US-lessac-medium.onnx"
  curl -fsSL -o "$REPO_DIR/piper/en_US-lessac-medium.onnx.json" "$PIPER_VOICE_BASE/en_US-lessac-medium.onnx.json"
else
  echo "-- Voice model already present (or Piper unavailable), skipping --"
fi

# ── 5. Sudoers rule for the self-update flow + Exit to Terminal ─────
SUDOERS_DEST="/etc/sudoers.d/dashboard-system-update"
if [ ! -f "$SUDOERS_DEST" ]; then
  echo "-- Installing sudoers rule --"
  sudo install -m 440 "$REPO_DIR/system/dashboard-system-update.sudoers" "$SUDOERS_DEST"
  if ! sudo visudo -c -f "$SUDOERS_DEST" >/dev/null 2>&1; then
    echo "!! sudoers file failed validation — removing it. Self-update and Exit"
    echo "!! to Terminal will prompt for a password until this is fixed."
    sudo rm -f "$SUDOERS_DEST"
  fi
else
  echo "-- Sudoers rule already installed, skipping --"
fi

# ── 6. System packages + systemd service + kiosk autostart ──────────
# Reuses the same script the in-app self-update flow runs, so there's one
# source of truth for "what a correctly-configured Pi looks like."
bash "$REPO_DIR/scripts/system-update.sh"

# system-update.sh only reinstalls/reloads the service definition (it
# assumes the service is already enabled and running, since normally it's
# that very process performing the update) — first-time setup needs an
# explicit enable + start.
echo "-- Enabling and starting the dashboard service --"
sudo systemctl enable dashboard.service
sudo systemctl restart dashboard.service

# ── 7. GPU acceleration (cheap glass/canvas effects only if Chromium is
#      actually hardware-compositing, not silently falling back to software) ──
CONFIG_TXT="/boot/firmware/config.txt"
[ -f "$CONFIG_TXT" ] || CONFIG_TXT="/boot/config.txt" # older Raspberry Pi OS
if [ -f "$CONFIG_TXT" ]; then
  echo "-- Checking GPU config in $CONFIG_TXT --"
  grep -q '^dtoverlay=vc4-kms-v3d' "$CONFIG_TXT" || echo "dtoverlay=vc4-kms-v3d" | sudo tee -a "$CONFIG_TXT" >/dev/null
  grep -q '^gpu_mem=' "$CONFIG_TXT" || echo "gpu_mem=128" | sudo tee -a "$CONFIG_TXT" >/dev/null
else
  echo "!! Couldn't find $CONFIG_TXT — set dtoverlay=vc4-kms-v3d and gpu_mem=128 manually."
fi

echo
echo "== Provisioning done. =="
echo "Dashboard should now be running at http://localhost:3000"
echo "A reboot is recommended so the GPU config and kiosk autostart take effect:"
echo "  sudo reboot"
