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
- SQLite via `better-sqlite3`
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

### 1. Install Node.js (v20 LTS recommended)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
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
Exec=chromium-browser --noerrdialogs --disable-infobars --kiosk http://localhost:3000
```

### Option B — via `/etc/rc.local` (lite / headless)

Add before `exit 0`:

```bash
su pi -c 'DISPLAY=:0 chromium-browser --noerrdialogs --disable-infobars --kiosk http://localhost:3000 &'
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
