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

### 1. Install Node.js (v22.5+ required — v24 LTS recommended)

`node:sqlite` (used by `server.js`) doesn't exist before Node 22.5. Node 20
will fail to start the server entirely.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Clone and install

```bash
mkdir -p ~/git-projects
cd ~/git-projects
git clone <your-repo-url> family-dashboard
cd family-dashboard
npm install --omit=dev
```

### 3. Find your Pi's local IP

```bash
hostname -I
```

Access the dashboard from any phone on your WiFi at `http://<PI_IP>:3000`.

---

## Systemd service (auto-start on boot)

Create the service file:

```bash
sudo nano /etc/systemd/system/family-dashboard.service
```

Paste:

```ini
[Unit]
Description=Family Dashboard
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/git-projects/family-dashboard
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production PORT=3000

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable family-dashboard
sudo systemctl start family-dashboard
sudo systemctl status family-dashboard
```

---

## Chromium kiosk mode on Pi startup

### GPU acceleration (do this first — Pi 4/5, 2GB+)

The dashboard leans on `backdrop-filter: blur()` (glass panels) and a full-screen
animated canvas. Both are cheap *if* Chromium is actually GPU-compositing them,
and very expensive if it silently falls back to software rendering — same look
either way, very different performance. Before tuning anything else:

1. Confirm `/boot/firmware/config.txt` has the full KMS driver:
   ```
   dtoverlay=vc4-kms-v3d
   ```
2. Give the GPU more memory than the default split (2GB Pi 4 defaults too low
   for a compositing-heavy page like this):
   ```
   gpu_mem=128
   ```
3. Add these flags to whichever `chromium-browser` launch line you use below:
   `--enable-gpu-rasterization --enable-zero-copy --use-gl=egl --ignore-gpu-blocklist --autoplay-policy=no-user-gesture-required`
4. After it's running, open `chromium-browser --kiosk chrome://gpu` once and
   check that rasterization/compositing say "Hardware accelerated" — if they
   say "Software only", fix that before assuming the app itself is slow.

The `--autoplay-policy=no-user-gesture-required` flag above isn't about
performance — without it, Chromium blocks all audio (the startup chime,
alert beeps, TTS) until the very first tap, since kiosk mode never gets an
initial user gesture the way a normal browser tab would.

### Option A — autostart (Raspberry Pi OS with desktop)

```bash
mkdir -p ~/.config/autostart
nano ~/.config/autostart/kiosk.desktop
```

Paste:

```ini
[Desktop Entry]
Type=Application
Name=Family Dashboard Kiosk
Exec=chromium-browser --noerrdialogs --disable-infobars --kiosk --enable-gpu-rasterization --enable-zero-copy --use-gl=egl --ignore-gpu-blocklist --autoplay-policy=no-user-gesture-required http://localhost:3000
```

### Option B — via `/etc/rc.local` (lite / headless)

Add before `exit 0`:

```bash
su pi -c 'DISPLAY=:0 chromium-browser --noerrdialogs --disable-infobars --kiosk --enable-gpu-rasterization --enable-zero-copy --use-gl=egl --ignore-gpu-blocklist --autoplay-policy=no-user-gesture-required http://localhost:3000 &'
```

### Disable screen blanking

```bash
sudo nano /etc/lightdm/lightdm.conf
```

Under `[Seat:*]` add:

```
xserver-command=X -s 0 -dpms
```

Or add to `~/.config/autostart/nodpms.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Disable DPMS
Exec=xset s off -dpms
```

---

## Text-to-speech (Piper)

Alert Read-Aloud uses [Piper](https://github.com/rhasspy/piper) for local,
offline TTS — installed manually on the Pi (not via `packages.txt`, since
it's a standalone binary + voice model rather than an apt package):

- `PIPER_BIN` (env var, default `piper`) — path to the binary, if not on `PATH`
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

```bash
cd ~/git-projects/family-dashboard
git pull
npm install --omit=dev
sudo systemctl restart family-dashboard
```
