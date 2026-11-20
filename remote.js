// ── Remote access ─────────────────────────────────────────────────
// A second, login-protected HTTP server that exposes ONLY the calendar,
// for family members away from home. It binds to 127.0.0.1, so nothing on
// the LAN reaches it directly; the internet reaches it solely through
// Tailscale Funnel (see tailscale.js), which terminates HTTPS and proxies
// to this port. The main dashboard on port 3000 is never exposed this way.
//
// One shared family access code, no accounts — minimal setup for the people
// using it. The dashboard generates the code and shows it (plus a sign-in
// link with the code built in) in Settings ▸ Remote Access on the home
// network, where it can also be reset; resetting signs everyone out. A
// correct code gets a random session token in an HttpOnly cookie; only its
// SHA-256 is stored, so a leaked database doesn't leak live sessions.

const express = require('express');
const crypto  = require('crypto');
const path    = require('path');

const REMOTE_PORT  = parseInt(process.env.REMOTE_PORT, 10) || 3001;
const COOKIE       = 'fd_remote';
// Sliding: renewed whenever the page is opened with under half left, so
// anyone using it regularly never has to enter the code again.
const SESSION_DAYS = 90;

// 8 characters with look-alikes (0/O, 1/I/L, U/V) left out: 29^8 ≈ 5e11
// combinations — far beyond reach under the throttling below. Shown and
// typed as XXXX-XXXX; matching ignores case, spaces and dashes.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
const CODE_LEN = 8;

// Login throttling: per client IP, plus a global cap so a botnet spread
// across many IPs still can't grind through guesses quickly.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_IP     = 5;
const MAX_FAILS_GLOBAL = 30;

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

// Home-screen pass: an iPhone home-screen app doesn't share Safari's
// cookies, so it would otherwise ask for the family code again. A signed-in
// iPhone gets a one-time pass in its page address (which Add to Home Screen
// saves); the new icon's first launch trades it for its own session.
// Single use, 30 days, and a new family code cancels any outstanding.
const PASS_DAYS = 30;
const PASS_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

const normalizeCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const formatCode    = c => `${c.slice(0, 4)}-${c.slice(4)}`;

// Compares fixed-length digests, so timing reveals nothing about the code
function codeMatches(input, code) {
  return crypto.timingSafeEqual(
    Buffer.from(sha256(normalizeCode(input)), 'hex'),
    Buffer.from(sha256(code), 'hex'));
}

function createRemote({ db, calendarRouter }) {
  db.exec(`CREATE TABLE IF NOT EXISTS remote_passes (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`);
  const stmt = {
    getSetting:     db.prepare('SELECT value FROM app_settings WHERE key = ?'),
    setSetting:     db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    delSetting:     db.prepare('DELETE FROM app_settings WHERE key = ?'),
    sessionGet:     db.prepare('SELECT expires_at FROM remote_sessions WHERE token_hash = ?'),
    sessionInsert:  db.prepare('INSERT INTO remote_sessions (token_hash, expires_at) VALUES (?, ?)'),
    sessionDelete:  db.prepare('DELETE FROM remote_sessions WHERE token_hash = ?'),
    sessionsPurge:  db.prepare('DELETE FROM remote_sessions WHERE expires_at < ?'),
    sessionRenew:   db.prepare('UPDATE remote_sessions SET expires_at = ? WHERE token_hash = ?'),
    sessionsClear:  db.prepare('DELETE FROM remote_sessions'),
    passInsert:     db.prepare('INSERT INTO remote_passes (token_hash, expires_at) VALUES (?, ?)'),
    passTake:       db.prepare('DELETE FROM remote_passes WHERE token_hash = ? AND expires_at > ? RETURNING token_hash'),
    passesPurge:    db.prepare('DELETE FROM remote_passes WHERE expires_at < ?'),
    passesClear:    db.prepare('DELETE FROM remote_passes'),
  };

  // Stored as-is (not hashed): the dashboard has to be able to show it so
  // it can be shared, and the dashboard is already the trusted side.
  const getCode = () => stmt.getSetting.get('remote_code')?.value || null;

  // ── Code management (called from the main app's Settings API) ──
  function resetCode() {
    const code = generateCode();
    stmt.setSetting.run('remote_code', code);
    stmt.sessionsClear.run(); // a new code signs everyone out
    stmt.passesClear.run();
    return formatCode(code);
  }

  function clearCode() {
    stmt.delSetting.run('remote_code');
    stmt.sessionsClear.run();
    stmt.passesClear.run();
  }

  // ── Sessions ──────────────────────────────────────────────────
  function readToken(req) {
    const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return m ? m[1] : null;
  }

  // The valid session for this request (token, its hash, expiry), or null
  function session(req) {
    if (!getCode()) return null; // remote access disabled
    const token = readToken(req);
    if (!token) return null;
    const hash = sha256(token);
    const row  = stmt.sessionGet.get(hash);
    return row && row.expires_at > Date.now() ? { token, hash, expiresAt: row.expires_at } : null;
  }

  // Always Secure: the real path in is HTTPS via Funnel, and browsers
  // also accept Secure cookies on http://localhost for testing.
  function setCookie(res, token, maxAgeSec) {
    res.setHeader('Set-Cookie',
      `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`);
  }

  // ── Throttling ────────────────────────────────────────────────
  const fails = new Map(); // key -> [timestamps]
  function recentFails(key) {
    const now  = Date.now();
    const list = (fails.get(key) || []).filter(t => now - t < FAIL_WINDOW_MS);
    if (list.length) fails.set(key, list); else fails.delete(key);
    return list;
  }
  // Funnel connects from 127.0.0.1 and passes the real client in
  // X-Forwarded-For; this server only listens on localhost, so the header
  // can't come from an arbitrary internet client directly.
  const clientIp = req => (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress;

  // ── App ───────────────────────────────────────────────────────
  const remote = express();
  remote.disable('x-powered-by');

  remote.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options':  'nosniff',
      'Referrer-Policy':         'no-referrer',
      'X-Frame-Options':         'DENY',
      'Cache-Control':           'no-store',
    });
    next();
  });

  remote.use(express.json({ limit: '16kb' }));

  // Mutations must be JSON (or DELETE, which has no body). Cross-site pages
  // can't send either without a CORS preflight this server never grants —
  // CSRF protection on top of the SameSite=Strict cookie.
  remote.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'DELETE' || req.is('application/json')) return next();
    res.status(415).json({ error: 'JSON required' });
  });

  remote.get('/api/session', (req, res) => {
    const s = session(req);
    if (s && s.expiresAt - Date.now() < SESSION_DAYS * 86400000 / 2) {
      stmt.sessionRenew.run(Date.now() + SESSION_DAYS * 86400000, s.hash);
      setCookie(res, s.token, SESSION_DAYS * 86400);
    }
    res.json({ enabled: !!getCode(), authed: !!s });
  });

  remote.post('/api/login', (req, res) => {
    const code = getCode();
    if (!code) return res.status(503).json({ error: 'Remote access is turned off.' });

    const ip = clientIp(req);
    if (recentFails(ip).length >= MAX_FAILS_IP || recentFails('*').length >= MAX_FAILS_GLOBAL)
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

    if (!codeMatches(req.body?.code, code)) {
      const now = Date.now();
      fails.set(ip,  [...recentFails(ip),  now]);
      fails.set('*', [...recentFails('*'), now]);
      return res.status(401).json({ error: "That code didn't work. Ask for the current family code." });
    }

    fails.delete(ip);
    startSession(res);
    res.json({ ok: true });
  });

  function startSession(res) {
    stmt.sessionsPurge.run(Date.now());
    const token = crypto.randomBytes(32).toString('base64url');
    stmt.sessionInsert.run(sha256(token), Date.now() + SESSION_DAYS * 86400000);
    setCookie(res, token, SESSION_DAYS * 86400);
  }

  // A signed-in page asks for a home-screen pass
  remote.post('/api/pass', (req, res) => {
    if (!session(req)) return res.status(401).json({ error: 'Not signed in' });
    stmt.passesPurge.run(Date.now());
    const pass = crypto.randomBytes(32).toString('base64url');
    stmt.passInsert.run(sha256(pass), Date.now() + PASS_DAYS * 86400000);
    res.json({ pass });
  });

  // The home-screen app's first launch trades the pass for a session.
  // Wrong passes count toward the same throttling as wrong codes.
  remote.post('/api/pass/redeem', (req, res) => {
    if (!getCode()) return res.status(503).json({ error: 'Remote access is turned off.' });
    const ip = clientIp(req);
    if (recentFails(ip).length >= MAX_FAILS_IP || recentFails('*').length >= MAX_FAILS_GLOBAL)
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const pass = String(req.body?.pass || '');
    if (!PASS_RE.test(pass) || !stmt.passTake.get(sha256(pass), Date.now())) {
      const now = Date.now();
      fails.set(ip,  [...recentFails(ip),  now]);
      fails.set('*', [...recentFails('*'), now]);
      return res.status(401).json({ error: 'That sign-in link has expired. Enter the family code.' });
    }
    startSession(res);
    res.json({ ok: true });
  });

  remote.post('/api/logout', (req, res) => {
    const token = readToken(req);
    if (token) stmt.sessionDelete.run(sha256(token));
    setCookie(res, '', 0);
    res.json({ ok: true });
  });

  remote.use('/api/calendar', (req, res, next) => {
    if (session(req)) return next();
    res.status(401).json({ error: 'Not signed in' });
  }, calendarRouter);

  remote.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  const manifest = require('./public-remote/manifest.webmanifest.json');
  remote.get('/manifest.webmanifest', (req, res) => {
    const pass = String(req.query.pass || '');
    res.type('application/manifest+json').send(JSON.stringify({
      ...manifest,
      start_url: PASS_RE.test(pass) ? `/?pass=${pass}` : '/',
    }));
  });
  remote.use(express.static(path.join(__dirname, 'public-remote')));

  return {
    app: remote,
    port: REMOTE_PORT,
    code: () => { const c = getCode(); return c ? formatCode(c) : null; },
    resetCode,
    clearCode,
    listen() {
      remote.listen(REMOTE_PORT, '127.0.0.1', () => {
        console.log(`Remote calendar listening on http://127.0.0.1:${REMOTE_PORT} (reached via Tailscale Funnel)`);
      });
    },
  };
}

module.exports = { createRemote };
