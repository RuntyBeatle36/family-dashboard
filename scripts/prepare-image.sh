#!/usr/bin/env bash
# Turns a fully set-up "master" Pi into a clean template for a plug-and-play
# SD card image. Run it on the Pi as the very last step, then copy the card
# (see README ▸ Making a plug-and-play SD card image).
#
#   bash scripts/prepare-image.sh
#
# Every card made from the image then boots straight into the first-run
# setup guide (Wi-Fi first), as its own unique device. This script:
#   - erases the dashboard's data (events, to-dos, bulletin, settings,
#     remote-access code) and turns first-run setup back on
#   - removes this Pi's Tailscale identity (otherwise every copy would
#     share one Tailscale device)
#   - forgets saved Wi-Fi networks
#   - removes SSH host keys and the machine ID, and installs a one-time
#     boot step that regenerates them and sets a random login password, so
#     each copy is its own device (no shared password across units)
#   - optionally removes authorized SSH keys and turns SSH off
#   - clears logs, shell history and backups, then powers off
#
# DESTRUCTIVE for this Pi's data, by design. Run by hand only.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Prepare this Pi as a plug-and-play image template =="
echo "This ERASES all dashboard data, Wi-Fi networks and the Tailscale"
echo "connection on this Pi, then shuts it down."
read -r -p "Type ERASE to continue: " answer
[ "$answer" = "ERASE" ] || { echo "Cancelled."; exit 1; }

read -r -p "Also remove SSH keys and turn SSH off in the image? (recommended before giving units away) [y/N]: " ssh_off

echo "-- Stopping the dashboard --"
sudo systemctl stop dashboard.service

echo "-- Erasing dashboard data, turning first-run setup on --"
rm -f "$REPO_DIR"/db/dashboard.db "$REPO_DIR"/db/dashboard.db-*
rm -rf "$REPO_DIR"/db/backups
mkdir -p "$REPO_DIR/db"
date -u +%FT%TZ > "$REPO_DIR/db/first-run"
rm -f "$HOME"/dashboard-backup-*.db "$HOME"/dashboard-reset-backup-*.db

echo "-- Removing this Pi's Tailscale identity --"
rm -rf "$REPO_DIR/tailscale/state" "$REPO_DIR/tailscale/tailscaled.sock"

echo "-- Clearing the kiosk browser's saved settings --"
# Close it first, or it writes its settings back out while shutting down
pkill -x chromium 2>/dev/null || true
sleep 2
rm -rf "$HOME/.config/chromium/Default/Local Storage" \
       "$HOME/.config/chromium/Default/Session Storage" \
       "$HOME/.config/chromium/Default/Sessions"

echo "-- Forgetting Wi-Fi networks --"
nmcli -t -f NAME,TYPE connection show | while IFS=: read -r name type; do
  [ "$type" = "802-11-wireless" ] && sudo nmcli connection delete id "$name" >/dev/null || true
done

echo "-- Making each copy unique on first boot --"
# family-dashboard-firstboot: new SSH host keys + a random per-device login
# password (shown on that unit's screen in Debug Options ▸ Device Login)
sudo install -o root -g root -m 755 "$REPO_DIR/system/family-dashboard-firstboot" /usr/local/sbin/family-dashboard-firstboot
sudo tee /etc/systemd/system/family-dashboard-firstboot.service >/dev/null <<'UNIT'
[Unit]
Description=Family Dashboard: make this copy its own device (SSH keys, password)
Before=ssh.service dashboard.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/family-dashboard-firstboot

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl enable family-dashboard-firstboot.service >/dev/null
sudo rm -f /etc/ssh/ssh_host_*
rm -f "$HOME/.device-password"
# An empty machine-id makes systemd generate a fresh one on next boot
sudo truncate -s 0 /etc/machine-id
sudo rm -f /var/lib/dbus/machine-id

if [[ "$ssh_off" =~ ^[Yy] ]]; then
  echo "-- Removing authorized SSH keys and turning SSH off --"
  rm -f "$HOME/.ssh/authorized_keys"
  sudo systemctl disable ssh.service >/dev/null 2>&1 || true
fi

echo "-- Clearing logs, history and caches --"
sudo journalctl --rotate >/dev/null 2>&1 || true
sudo journalctl --vacuum-time=1s >/dev/null 2>&1 || true
sudo apt-get clean
rm -f "$HOME/.bash_history"
history -c 2>/dev/null || true

echo
echo "== Done. Powering off. =="
echo "Next: copy this SD card to an image file (README ▸ Making a"
echo "plug-and-play SD card image). Don't boot this card again before"
echo "copying it, or it will start setting itself up."
sleep 3
sudo poweroff
