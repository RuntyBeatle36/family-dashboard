#!/usr/bin/env bash
# Switches the kiosk between the original X11/Openbox session and a
# Wayland/labwc session. On a Pi 4/5, Chromium under labwc composites
# straight to the screen through the GPU instead of through the X server —
# typically smoother glass/weather effects at lower CPU. Same app, same
# Chromium; only the display stack underneath changes.
#
#   bash scripts/kiosk-display.sh wayland   # switch to labwc
#   bash scripts/kiosk-display.sh x11       # switch back to Openbox
#   bash scripts/kiosk-display.sh status
#
# Then reboot. Run by hand only — like provision-pi.sh, never by the in-app
# updater, since it changes how the Pi starts its graphical session.
#
# How the session starts: tty1 autologin runs a one-shot `startx` from the
# login profile. Wayland mode disables that line (tagged, so x11 mode
# restores it exactly) and appends an equivalent one-shot `labwc` block.
# The profile is backed up before the first change.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Prefixing with ':' (a no-op) rather than just '#' keeps the profile valid
# when startx is the only line inside an if/then block.
TAG=': #family-dashboard-wayland# '
BLOCK_START='# >>> family-dashboard wayland kiosk >>>'
BLOCK_END='# <<< family-dashboard wayland kiosk <<<'

# bash reads the first of these that exists, so the startx line could be in
# any of them — use whichever actually has it (or our block, if switched).
PROFILE=""
for f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [ -f "$f" ] && grep -qE "startx|^$BLOCK_START\$" "$f"; then PROFILE="$f"; break; fi
done

is_wayland() { [ -n "$PROFILE" ] && grep -qxF "$BLOCK_START" "$PROFILE"; }

case "${1:-}" in
  status)
    if [ -z "$PROFILE" ]; then echo "Couldn't find the session startup line (startx) in ~/.bash_profile, ~/.bash_login or ~/.profile."
    elif is_wayland; then echo "Wayland (labwc) — configured in $PROFILE"
    else echo "X11 (Openbox) — configured in $PROFILE"
    fi
    ;;

  wayland)
    if [ -z "$PROFILE" ]; then
      echo "!! Couldn't find a startx line in ~/.bash_profile, ~/.bash_login or ~/.profile."
      echo "!! This script expects the tty1-autologin + startx setup; nothing was changed."
      exit 1
    fi
    if is_wayland; then echo "Already on Wayland ($PROFILE). Nothing to do."; exit 0; fi

    MODEL="$(tr -d '\0' 2>/dev/null < /proc/device-tree/model || echo unknown)"
    case "$MODEL" in
      *"Pi 4"*|*"Pi 400"*|*"Pi 5"*|*"Pi 500"*|*"Compute Module 4"*|*"Compute Module 5"*) ;;
      *) echo "-- Note: $MODEL — Wayland mainly helps Pi 4/5-class hardware; on older boards Openbox may be lighter." ;;
    esac

    echo "-- Installing labwc + wlr-randr --"
    sudo apt-get install -y labwc wlr-randr

    echo "-- Installing ~/.config/labwc/autostart --"
    mkdir -p "$HOME/.config/labwc"
    cp "$REPO_DIR/system/labwc-autostart" "$HOME/.config/labwc/autostart"

    [ -f "$PROFILE.dashboard-bak" ] || cp "$PROFILE" "$PROFILE.dashboard-bak"
    echo "-- Updating $PROFILE (backup: $PROFILE.dashboard-bak) --"
    sed -i "/^[^#]*startx/ s|^|$TAG|" "$PROFILE"
    cat >> "$PROFILE" <<EOF
$BLOCK_START
# One-shot, like the startx line it replaces: Exit to Terminal (which
# stops labwc) drops back to this shell instead of relaunching it.
if [ -z "\${WAYLAND_DISPLAY:-}" ] && [ -z "\${DISPLAY:-}" ] && [ "\$(tty)" = /dev/tty1 ]; then
  labwc
fi
$BLOCK_END
EOF
    echo "== Switched to Wayland. Reboot to apply: sudo reboot =="
    echo "   (To undo: bash scripts/kiosk-display.sh x11)"
    ;;

  x11)
    if ! is_wayland; then echo "Already on X11/Openbox. Nothing to do."; exit 0; fi
    sed -i "/^$BLOCK_START\$/,/^$BLOCK_END\$/d; s|^$TAG||" "$PROFILE"
    # Also what scripts/system-update.sh checks to decide whether to keep it in sync
    rm -f "$HOME/.config/labwc/autostart"
    echo "== Switched back to X11/Openbox ($PROFILE). Reboot to apply: sudo reboot =="
    ;;

  *)
    echo "Usage: bash scripts/kiosk-display.sh wayland|x11|status"
    exit 1
    ;;
esac
