// ── Tailscale (remote access) ─────────────────────────────────────
// Runs tailscaled UNPRIVILEGED, as a child of this server, in
// userspace-networking mode — no root, no system service, no TUN device.
// That's what lets scripts/system-update.sh install and update it through
// the normal self-update alone (the binaries live in tailscale/, gitignored).
//
// In userspace mode, connections arriving over Tailscale are delivered to
// this Pi's localhost — so from any of the owner's own Tailscale devices,
// SSH (port 22) and the dashboard (port 3000) work from anywhere. `--ssh`
// additionally enables Tailscale SSH (logs in as this same user only).
// Funnel publishes ONLY the remote calendar port (remote.js) to the public
// internet over HTTPS.
//
// systemd kills the whole service cgroup on restart, so tailscaled never
// outlives the server it belongs to.

const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs   = require('fs');

const execFileP = promisify(execFile);

const TS_DIR    = path.join(__dirname, 'tailscale');
const CLI       = path.join(TS_DIR, 'tailscale');
const DAEMON    = path.join(TS_DIR, 'tailscaled');
const SOCKET    = path.join(TS_DIR, 'tailscaled.sock');
const STATE_DIR = path.join(TS_DIR, 'state');
const HOSTNAME  = 'family-dashboard';
const URL_RE    = /https:\/\/login\.tailscale\.com\/\S+/;

const installed = () => fs.existsSync(CLI) && fs.existsSync(DAEMON);

let daemon = null;
let restartTimer = null;

function startDaemon() {
  if (daemon || !installed()) return;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  daemon = spawn(DAEMON, [
    '--tun=userspace-networking',
    `--statedir=${STATE_DIR}`,
    `--socket=${SOCKET}`,
  ], { stdio: 'ignore' });

  const retry = (why) => {
    daemon = null;
    if (restartTimer) return;
    console.error(`tailscaled ${why}, restarting in 10s`);
    restartTimer = setTimeout(() => { restartTimer = null; startDaemon(); }, 10000);
  };
  daemon.on('exit',  code => retry(`exited (${code})`));
  daemon.on('error', err  => retry(`failed to start (${err.message})`));
}

async function cli(args, timeout = 8000) {
  return execFileP(CLI, [`--socket=${SOCKET}`, ...args], { timeout });
}

// Runs a CLI command that may stop and print a login.tailscale.com link for
// the owner to visit (sign-in, enabling Funnel). Resolves with that link as
// soon as it appears, or { done } when the command finishes on its own. The
// process is left running while waiting on the link — it completes by itself
// once the owner approves, and is killed after 15 minutes otherwise.
function runInteractive(args) {
  return new Promise(resolve => {
    const child = spawn(CLI, [`--socket=${SOCKET}`, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;
    const finish = v => { if (!settled) { settled = true; resolve(v); } };
    const onData = d => {
      out += d;
      const m = out.match(URL_RE);
      if (m) finish({ url: m[0] });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => finish({ done: code === 0, output: out.trim() }));
    child.on('error', err => finish({ done: false, output: err.message }));
    setTimeout(() => finish({ done: false, output: out.trim() || 'Timed out' }), 20000);
    setTimeout(() => child.kill(), 15 * 60 * 1000).unref();
  });
}

async function status() {
  if (!installed()) return { installed: false };
  let st = null;
  try {
    st = JSON.parse((await cli(['status', '--json'])).stdout);
  } catch (err) {
    // `status` exits non-zero in some logged-out states but still prints JSON
    try { st = JSON.parse(err.stdout); } catch { return { installed: true, running: false }; }
  }
  let funnelOn = false;
  try {
    const serve = JSON.parse((await cli(['funnel', 'status', '--json'])).stdout || '{}');
    funnelOn = Object.values(serve.AllowFunnel || {}).some(Boolean);
  } catch { /* no serve config yet */ }

  const dnsName = st.Self?.DNSName ? st.Self.DNSName.replace(/\.$/, '') : null;
  return {
    installed: true,
    running:   true,
    state:     st.BackendState,              // NeedsLogin | Starting | Running | Stopped …
    authUrl:   st.AuthURL || null,
    ip:        st.Self?.TailscaleIPs?.[0] || null,
    dnsName,
    funnelOn,
    publicUrl: funnelOn && dnsName ? `https://${dnsName}/` : null,
  };
}

function login() {
  return runInteractive(['up', '--ssh', `--hostname=${HOSTNAME}`, '--accept-dns=false']);
}

function enableFunnel(port) {
  return runInteractive(['funnel', '--bg', String(port)]);
}

async function disableFunnel() {
  await cli(['serve', 'reset']);
}

module.exports = { installed, startDaemon, status, login, enableFunnel, disableFunnel };
