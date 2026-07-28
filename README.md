# Family Dashboard

A locally-hosted, wall-mounted family dashboard for Raspberry Pi. Serves a touch-friendly web app to the attached screen and any phone on your home WiFi. No cloud account, no internet dependency except an optional weather fetch.

## Features

- **Clock & date** — large, readable from across the room
- **Weather** — Open-Meteo (free, no API key), hardcoded to Corpus Christi TX
- **Grocery list** — add, check off, bulk-clear; live-updates across devices
- **Bulletin board** — post short notes from any phone on WiFi
- **Events / reminders** — upcoming events with date & optional time

## Tech stack

- Node.js + Express backend
- Plain HTML/CSS/JS frontend (no frameworks)
- SQLite via Node's built-in `node:sqlite` (requires Node 22.5+)
- PWA (Add to Home Screen on iOS & Android)

---

## Development (on any machine)

```bash
cd ~/git-projects/family-dashboard
npm install
npm run dev      # uses node --watch for auto-restart
```

Open `http://localhost:3000` in your browser.

---

## Deploy on Raspberry Pi

### New hardware — one script

```bash
curl -fsSL https://raw.githubusercontent.com/RuntyBeatle36/family-dashboard/main/scripts/provision-pi.sh | bash
sudo reboot
```

Assumes a fresh Raspberry Pi OS install (desktop + Openbox) logged in as a
user named `user`, matching `system/dashboard.service`'s `User=`/
`WorkingDirectory=`. This installs Node.js, clones the repo to
`~/family-dashboard`, installs Piper (TTS) + a default voice, sets up the
`dashboard.service` systemd unit (auto-start on boot, auto-restart on
crash), installs the sudoers rule the in-app self-update flow needs (see
below), sets up the Openbox kiosk autostart, and configures the GPU/display
settings covered in the rest of this section. Idempotent — safe to re-run
on an already-provisioned Pi.

`scripts/provision-pi.sh` is **not** part of the automatic self-update flow
(that's `scripts/system-update.sh`, run after every `git pull` via the
in-app updater) — it's a one-time bootstrap you run by hand on new
hardware, and never runs itself.

Find the Pi's local IP to reach it from a phone (`http://<PI_IP>:3000`):

```bash
hostname -I
```

### What it sets up, in more detail

**Systemd service** (auto-start on boot) — `system/dashboard.service`,
installed to `/etc/systemd/system/`. Enabled + started once during
provisioning; every later `git pull` reinstalls it automatically only if
its content actually changed.

**Sudoers rule** — `system/dashboard-system-update.sudoers`, installed to
`/etc/sudoers.d/dashboard-system-update`. Grants passwordless access to
exactly the handful of system commands the self-update flow and "Exit to
Terminal" need (installing packages, reinstalling the service file,
`systemctl daemon-reload`, killing the X session) — nothing broader.
Without it, those actions prompt for a password that nobody's there to type.

**GPU acceleration** (Pi 4/5, 2GB+) — the dashboard leans on
`backdrop-filter: blur()` (glass panels) and a full-screen animated canvas.
Both are cheap *if* Chromium is actually GPU-compositing them, and very
expensive if it silently falls back to software rendering — same look
either way, very different performance.

- `dtoverlay=vc4-kms-v3d` in `/boot/firmware/config.txt` (full KMS driver)
- `gpu_mem=128` (2GB Pi 4 defaults too low for a compositing-heavy page)
- After it's running, open `chromium --kiosk chrome://gpu` once and check
  rasterization/compositing say "Hardware accelerated" — if they say
  "Software only", fix that before assuming the app itself is slow.

**Kiosk autostart + screen blanking** — `system/openbox-autostart`,
installed to `~/.config/openbox/autostart`. Launches Chromium in kiosk mode
with `--autoplay-policy=no-user-gesture-required` (without it, Chromium
blocks all audio — startup chime, alert beeps, TTS — until the very first
tap, since kiosk mode never gets an initial user gesture the way a normal
browser tab would), disables screen blanking/DPMS, hides the mouse cursor
via `unclutter`, and sets the display resolution.

---

## Text-to-speech (Piper)

Alert Read-Aloud uses [Piper](https://github.com/rhasspy/piper) for local,
offline TTS — installed by `scripts/provision-pi.sh` into `piper/` inside
the repo (not via `packages.txt`, since it's a standalone binary + voice
model rather than an apt package). `system/dashboard.service` points
`PIPER_BIN` at that exact path via `Environment=`, since a systemd
service's default `PATH` doesn't include it:

- `PIPER_BIN` (env var, default `piper` i.e. must be on `PATH` if unset — overridden to `piper/piper` by `dashboard.service`) — path to the binary
- `PIPER_MODEL` (env var, default `piper/en_US-lessac-medium.onnx`) — path to the voice model
- `PIPER_LENGTH_SCALE` (env var, default `1.15`) — server-wide default speech rate; higher is slower/clearer, lower is faster. Overridden per-request by the **Speech Rate** slider in Settings ▸ Alert Notifications, which lets you A/B test on the Pi's actual speaker via the **Test Speech Rate** button — no redeploy needed.

To try a different voice (clarity varies noticeably between voices, not
just quality tiers), browse
[huggingface.co/rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)
for other `en_US-*` models, download the `.onnx` + `.onnx.json` pair onto
the Pi, and point `PIPER_MODEL` at it.

---

## PWA — Add to Home Screen

1. Open `http://<PI_IP>:3000` in Chrome (Android) or Safari (iOS)
2. Android: tap the ⋮ menu → **Add to Home screen**
3. iOS: tap the Share button → **Add to Home Screen**

The app will launch fullscreen like a native app.

---

## Updating

Normally automatic: the dashboard checks for updates every 5 minutes and
shows an **Update available** badge — tap it, then **Update Now**, and it
pulls, reinstalls dependencies, reapplies `scripts/system-update.sh`, and
restarts itself.

To update manually from a terminal instead:

```bash
cd ~/family-dashboard
git pull
npm install --omit=dev
bash scripts/system-update.sh
sudo systemctl restart dashboard.service
```
