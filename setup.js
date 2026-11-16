// ── First-run setup & device management ───────────────────────────
// Backs the full-screen setup guide a brand-new (or reset) dashboard shows
// before anything else — Wi-Fi first, so a plug-and-play SD image works with
// no keyboard, SSH or prior network config — plus Settings ▸ Wi-Fi and
// "Reset for a new owner".
//
// First-run mode is an explicit marker file (db/first-run), created only by
// scripts/provision-pi.sh on a fresh install, scripts/prepare-image.sh when
// building an image, and the reset below. Existing installs never have it,
// so updating one never drops it into the setup guide.
//
// Wi-Fi and time zone changes go through NetworkManager (nmcli) and
// systemd-timedated (timedatectl), authorized for this service's user by the
// polkit rule in system/50-family-dashboard.rules — no sudo involved.

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs   = require('fs');
const path = require('path');

const execFileP = promisify(execFile);

const FIRST_RUN = path.join(__dirname, 'db', 'first-run');

const isFirstRun    = () => fs.existsSync(FIRST_RUN);
const markFirstRun  = () => fs.writeFileSync(FIRST_RUN, `${new Date().toISOString()}\n`);
const clearFirstRun = () => fs.rmSync(FIRST_RUN, { force: true });

async function nmcli(args, timeout = 20000) {
  return (await execFileP('nmcli', args, { timeout })).stdout;
}

// nmcli -t separates fields with ':' and escapes literal ':' and '\' in
// values (SSIDs can contain either) with a backslash.
function splitTerse(line) {
  const out = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) cur += line[++i];
    else if (line[i] === ':') { out.push(cur); cur = ''; }
    else cur += line[i];
  }
  out.push(cur);
  return out;
}

async function wifiStatus() {
  let devices = [];
  try {
    devices = (await nmcli(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device'])).trim().split('\n')
      .filter(Boolean).map(l => { const [device, type, state, connection] = splitTerse(l); return { device, type, state, connection }; });
  } catch {
    return { available: false, online: false }; // no NetworkManager (dev machine, etc.)
  }
  const wifi  = devices.find(d => d.type === 'wifi');
  const wired = devices.find(d => d.type === 'ethernet' && d.state === 'connected');
  let online = false;
  try { online = (await nmcli(['networking', 'connectivity', 'check'], 10000)).trim() === 'full'; } catch { /* unknown */ }
  return {
    available: !!wifi,
    online,
    wired:     !!wired,
    ssid:      wifi?.state === 'connected' ? wifi.connection : null,
  };
}

async function wifiScan() {
  const out = await nmcli(['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes'], 30000);
  const best = new Map(); // one entry per network name, strongest access point
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [inUse, ssid, signal, security] = splitTerse(line);
    if (!ssid) continue; // hidden networks don't broadcast a name
    const net = { ssid, signal: parseInt(signal, 10) || 0, secure: !!security && security !== '--', connected: inUse === '*' };
    const prev = best.get(ssid);
    if (!prev || net.signal > prev.signal || net.connected) best.set(ssid, { ...net, connected: net.connected || !!prev?.connected });
  }
  return [...best.values()].sort((a, b) => (b.connected - a.connected) || (b.signal - a.signal));
}

async function wifiConnect({ ssid, password, hidden }) {
  if (typeof ssid !== 'string' || !ssid || ssid.length > 32) throw new Error('Pick a network first.');
  const args = ['device', 'wifi', 'connect', ssid];
  if (password) args.push('password', String(password));
  if (hidden) args.push('hidden', 'yes');
  try {
    await nmcli(args, 45000);
  } catch (err) {
    const msg = `${err.stderr || err.message}`;
    if (/Secrets were required|802-1x|psk|password/i.test(msg)) throw new Error('That password didn\'t work. Check it and try again.');
    if (/No network with SSID/i.test(msg)) throw new Error('Couldn\'t find that network. Move closer to the router or check the name.');
    if (/Not authorized/i.test(msg)) throw new Error('This dashboard isn\'t allowed to change Wi-Fi yet (run scripts/provision-pi.sh once).');
    throw new Error('Couldn\'t connect to that network. Try again.');
  }
}

// Forgets every saved Wi-Fi network (for "Reset for a new owner" and image
// prep). Wired connections are left alone.
async function wifiForgetAll() {
  const out = await nmcli(['-t', '-f', 'NAME,TYPE', 'connection', 'show']);
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [name, type] = splitTerse(line);
    if (type === '802-11-wireless') await nmcli(['connection', 'delete', 'id', name]).catch(() => {});
  }
}

async function setTimezone(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) throw new Error('Invalid time zone');
  const zones = (await execFileP('timedatectl', ['list-timezones'], { timeout: 10000 })).stdout.split('\n');
  if (!zones.includes(tz)) throw new Error('Unknown time zone');
  await execFileP('timedatectl', ['set-timezone', tz], { timeout: 10000 });
}

module.exports = {
  isFirstRun, markFirstRun, clearFirstRun,
  wifiStatus, wifiScan, wifiConnect, wifiForgetAll,
  setTimezone,
};
