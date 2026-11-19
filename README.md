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
`/etc/sudoers.d/dashboard-system-update`. Grants passwordless access to just
two commands: `/usr/local/sbin/family-dashboard-apt` (a root-owned helper
that installs Debian packages **by name only**, refusing apt options, paths
and `.deb` files, which a bare `apt-get install -y *` rule would allow and
which would amount to root) and killing the X session for Exit to Terminal.
`dashboard.service` is deliberately not installable by the app (the repo is
user-writable); `provision-pi.sh` installs it, so service-file changes need
that script re-run by hand. **Pis provisioned before this change keep the
old, broader rule until `bash scripts/provision-pi.sh` (or `sudo bash
scripts/harden-pi.sh`) is run once.**

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

### Optional: Wayland kiosk (recommended on Pi 4/5)

By default the kiosk runs Chromium on X11 + Openbox. On a Pi 4/5 it can
instead run on Wayland under `labwc` (the compositor Raspberry Pi OS itself
now defaults to), where Chromium composites straight to the screen through
the GPU rather than through the X server — usually smoother glass blur and
weather animation at lower CPU. Same app and same Chromium flags; only the
display stack underneath changes. Run by hand on the Pi:

```bash
bash scripts/kiosk-display.sh wayland   # then: sudo reboot
bash scripts/kiosk-display.sh status
bash scripts/kiosk-display.sh x11       # switch back, then reboot
```

It installs `labwc` + `wlr-randr`, installs `system/labwc-autostart` to
`~/.config/labwc/autostart` (the Wayland counterpart of the Openbox
autostart; kept in sync by the self-updater from then on), and swaps the
one-shot `startx` in your login profile for an equivalent one-shot `labwc`
(backing the profile up to `*.dashboard-bak` first). Exit to Terminal works
in both modes. Compare before/after with Settings ▸ Debug Tools ▸
Graphics Benchmark. If the screen stays black after switching, SSH in and run
`bash scripts/kiosk-display.sh x11 && sudo reboot`.

---

## First-run setup guide

A brand-new dashboard opens a full-screen, touch-friendly setup guide
instead of the dashboard: **Wi-Fi** (pick a network, type the password on the
on-screen keyboard) → **ZIP code** (sets weather, alerts and the Pi's time
zone) and clock style → **screen tuning** (runs the graphics benchmark and
applies the best settings, or skip) → done, with an offer to set up phone
access. Everything stays changeable in Settings, including **📶 Wi-Fi**.

It only appears in first-run mode (`db/first-run`), which is turned on by a
fresh `provision-pi.sh` install, `prepare-image.sh`, or **Settings ▸ Reset**
(an Advanced setting; tap the version number at the bottom of Settings 7
times to show it). Reset erases events, to-dos, bulletin, settings, the family code and
the Tailscale connection (optionally saved Wi-Fi too), keeping a backup copy
in the home folder. Updating an existing dashboard never triggers it.

Wi-Fi and time-zone changes use NetworkManager / timedatectl, allowed for
the dashboard's user by `system/50-family-dashboard.rules` (polkit), which
`provision-pi.sh` installs. A Pi provisioned before this existed needs
`bash scripts/provision-pi.sh` run once for Settings ▸ Wi-Fi to work.

## Making a plug-and-play SD card image

Build one "master" Pi, strip it of anything personal, and copy its card.
Every card written from that image boots straight into the setup guide as
its own unique device. No keyboard, SSH or network setup needed.

1. **Build the master.** Flash Raspberry Pi OS (64-bit, with desktop) with
   Raspberry Pi Imager: username `user`, your own Wi-Fi, SSH on. Boot it,
   run the provisioning script (see *Deploy on Raspberry Pi*), reboot, and
   check the dashboard works. On a Pi 4/5, optionally switch to Wayland.
2. **Prepare it** (on the Pi, last thing you do):
   `bash scripts/prepare-image.sh`. It erases dashboard data, this Pi's
   Tailscale identity, saved Wi-Fi, SSH host keys and the machine ID (each
   copy regenerates its own), optionally your SSH keys + SSH itself, then
   powers off. **Don't boot this card again before copying it.**
   Each copy also gets its **own random login password** on first boot (no
   shared password across units). It's shown only on that unit's screen, in
   Settings ▸ Debug Tools ▸ Device Login, and saved in `~/.device-password`.
3. **Copy the card to an image file** on Windows with
   [Win32 Disk Imager](https://sourceforge.net/projects/win32diskimager/):
   choose a file name like `family-dashboard.img`, then **Read**.
4. **Shrink it** (and make it fill any card size on first boot) with
   [PiShrink](https://github.com/Drewsif/PiShrink) in WSL Ubuntu:
   ```bash
   wget https://raw.githubusercontent.com/Drewsif/PiShrink/master/pishrink.sh
   sudo bash pishrink.sh -z /mnt/c/path/to/family-dashboard.img
   ```
5. **Write new cards** with Raspberry Pi Imager: *Choose OS ▸ Use custom* ▸
   the `.img.gz`. **Skip** Imager's "OS customisation" (it would overwrite
   the prepared setup). First boot expands the card and restarts once, then
   the setup guide appears.

## Remote access

Family members can view, add and edit **calendar events only** from
anywhere: they scan a QR code or open a link, with no app or account. You
get SSH to the Pi from anywhere too.

Setup is a guided, step-by-step screen written for non-technical owners:
**Settings ▸ Family Link ▸ Set Up Family Link**. It works
on the wall screen itself; every link is shown as a QR code to scan with a
phone, and each step advances by itself once it's done on the phone:

1. **Connect this dashboard.** Scan, then sign in to Tailscale with a
   Google, Apple or Microsoft account (creates a free account; one time).
2. **Turn on the family link.** Creates the family code and the public link.
   The first time, Tailscale asks once to allow public links.
3. *(Optional, shown afterwards)* **Never sign in again.** Turn off
   Tailscale's key expiry for the Pi. If skipped, Tailscale signs the Pi out
   about every 6 months; an amber badge on the main screen appears two weeks
   before (and if the link is ever paused), and tapping it walks through the
   two-tap re-sign-in.

Then the screen shows a QR code family members scan (it signs them straight
in), the link to copy/share, and the code (e.g. `K7QM-4XPD`). *Make a new
code* signs everyone out; *Turn off family link* takes it down.

**On phones:** the Family Link page is installable (app icon + web app
manifest). After the first sign-in it offers, once, to be added to the home
screen, with short steps for iPhone and a one-tap **Install** where Android
Chrome supports it (a footer button brings the steps back). On the
dashboard, **Settings ▸ Family Link ▸ Show me how** shows illustrated
step-by-step pictures for iPhone and Android. iPhone home-screen apps keep
their own storage, so the icon asks for the family code once.

How it works:

- **Tailscale is installed by the normal self-update.** `scripts/system-update.sh`
  downloads the official, checksum-verified static binaries into `tailscale/`
  (gitignored) and keeps them current. The dashboard server runs `tailscaled`
  itself, unprivileged, in userspace-networking mode (`tailscale.js`). No
  root, no extra system service.
- **The public link only reaches the calendar.** Funnel points at a second,
  localhost-only server (`remote.js`, port 3001) that serves just the calendar
  page and `/api/calendar`, behind the family code. The main dashboard (port
  3000: settings, updates, Exit to Terminal) is never reachable from the
  internet. Wrong codes are throttled (5 per device, 30 overall, per 15 minutes).
- **SSH from anywhere:** install Tailscale on your laptop/phone, sign in to the
  same account, then `ssh user@family-dashboard`. Your existing SSH keys
  work as on the LAN, and Tailscale SSH is also enabled. The dashboard is
  also at `http://family-dashboard:3000` from your Tailscale devices.
- Turning Family Link off (Settings ▸ Family Link) deletes the code, signs everyone out,
  and takes the public link down.

---

## Security check-up

```bash
sudo bash scripts/harden-pi.sh
```

Audits and tightens the things that matter for a box sitting on your home
network with SSH and a NOPASSWD sudoers rule: enables the `ufw` firewall
(allowing SSH + port 3000, denying everything else inbound), installs
`fail2ban` against SSH brute-forcing, turns on daily unattended security
updates, hardens `sshd_config` (no root login, no empty passwords, and disables
SSH password login — but *only* once it finds a key already in
`~/.ssh/authorized_keys`, so it can never lock you out), re-validates the
`dashboard-system-update` sudoers rule against the repo's copy, and fixes a
few file permissions. Idempotent, safe to re-run any time.

It never restricts outbound traffic (GitHub/apt/Piper keep working) and
never blocks or disables SSH — deliberately **not** wired into the automatic
self-update flow, since changes like these are exactly the kind you want to
watch happen, not have run silently in the background.

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
- `PIPER_LENGTH_SCALE` (env var, default `1.15`) — server-wide default speech rate; higher is slower/clearer, lower is faster. Overridden per-request by the **Speech Rate** slider in Settings ▸ Weather & Alerts (**Reading speed**), which lets you A/B test on the Pi's actual speaker via the **Test Reading Speed** button — no redeploy needed.

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

## Backups

Every time the dashboard starts (each update, restart and reboot) it saves a
copy of all its data to `db/backups/dashboard-YYYYMMDD-HHMMSS.db`, keeping
the newest 14. To restore one: stop the service, copy the backup over
`db/dashboard.db` (delete any `dashboard.db-wal`/`-shm` next to it), and
start the service again. **Reset for a New Owner** and `prepare-image.sh`
delete these backups, since they hold the family's data.

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
