const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

// Computed once at startup (not per-request) — shelling out to git on every
// hit of a tiny corner-of-settings display would be wasteful, and neither
// value can change while this process is running.
//
// Build number is the commit count, not package.json's version field —
// that field was never bumped and always read "1.0.0" regardless of how
// many updates had actually been applied, which is exactly backwards for
// "does the version actually change." Commit count strictly increases
// with every real update, no manual bumping required.
let GIT_COMMIT = null;
let GIT_BUILD  = null;
try {
  GIT_COMMIT = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: __dirname, encoding: 'utf8', timeout: 1000,
  }).trim();
  GIT_BUILD = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
    cwd: __dirname, encoding: 'utf8', timeout: 1000,
  }).trim();
} catch { /* not a git checkout (e.g. archive deploy) — version-only display */ }

const dbDir = path.join(__dirname, 'db');
fs.mkdirSync(dbDir, { recursive: true });
const db = new DatabaseSync(path.join(dbDir, 'dashboard.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS todo_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS bulletin_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL DEFAULT 'Anonymous',
    message TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    person TEXT DEFAULT '',
    color TEXT DEFAULT '#4f8ef7',
    event_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    all_day INTEGER DEFAULT 0,
    recurrence TEXT DEFAULT 'none',
    recurrence_interval INTEGER DEFAULT 1,
    recurrence_until TEXT,
    excluded_dates TEXT DEFAULT '',
    is_private INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

// Lightweight migrations for DBs created before these columns existed.
for (const stmt of [
  `ALTER TABLE calendar_events ADD COLUMN excluded_dates TEXT DEFAULT ''`,
  `ALTER TABLE calendar_events ADD COLUMN description TEXT DEFAULT ''`,
  `ALTER TABLE calendar_events ADD COLUMN recurrence_interval INTEGER DEFAULT 1`,
  `ALTER TABLE calendar_events ADD COLUMN is_private INTEGER DEFAULT 0`,
]) {
  try { db.exec(stmt); } catch { /* column already exists */ }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Prepared statements ──────────────────────────────────────────
// node:sqlite's db.prepare() compiles the SQL text into a plan; doing that
// fresh on every request (as before) re-parses/re-plans identical SQL on
// every single API call. Statement objects are stateless w.r.t. bound
// values (params are passed per-call to .run()/.get()/.all()), so they're
// safe to prepare once here and reuse for the life of the process.
const stmt = {
  todoList:       db.prepare('SELECT * FROM todo_items ORDER BY done ASC, created_at DESC'),
  todoDeleteDone: db.prepare('DELETE FROM todo_items WHERE done = 1'),
  todoInsert:     db.prepare('INSERT INTO todo_items (text) VALUES (?)'),
  todoGet:        db.prepare('SELECT * FROM todo_items WHERE id = ?'),
  todoSetDone:    db.prepare('UPDATE todo_items SET done = ? WHERE id = ?'),
  todoDelete:     db.prepare('DELETE FROM todo_items WHERE id = ?'),

  bulletinList:   db.prepare('SELECT * FROM bulletin_posts ORDER BY created_at DESC LIMIT 20'),
  bulletinInsert: db.prepare('INSERT INTO bulletin_posts (author, message) VALUES (?, ?)'),
  bulletinGet:    db.prepare('SELECT * FROM bulletin_posts WHERE id = ?'),
  bulletinDelete: db.prepare('DELETE FROM bulletin_posts WHERE id = ?'),

  calendarRange:  db.prepare(`
    SELECT * FROM calendar_events
    WHERE (
      (recurrence = 'none' AND event_date >= ? AND event_date <= ?)
      OR
      (recurrence != 'none' AND event_date <= ?
        AND (recurrence_until IS NULL OR recurrence_until >= ?))
    )
    ORDER BY event_date ASC,
      CASE WHEN start_time IS NULL THEN 0 ELSE 1 END ASC,
      start_time ASC
  `),
  calendarInsert: db.prepare(`
    INSERT INTO calendar_events
      (title, description, person, color, event_date, start_time, end_time, all_day,
       recurrence, recurrence_interval, recurrence_until, is_private)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `),
  calendarGet: db.prepare('SELECT * FROM calendar_events WHERE id = ?'),
  calendarUpdate: db.prepare(`
    UPDATE calendar_events SET
      title = ?, description = ?, person = ?, color = ?, event_date = ?,
      start_time = ?, end_time = ?, all_day = ?,
      recurrence = ?, recurrence_interval = ?, recurrence_until = ?, is_private = ?
    WHERE id = ?
  `),
  calendarSetExcluded: db.prepare('UPDATE calendar_events SET excluded_dates = ? WHERE id = ?'),
  calendarDelete: db.prepare('DELETE FROM calendar_events WHERE id = ?'),
};

// ── Todo ──────────────────────────────────────────────────────
app.get('/api/todo', (req, res) => {
  res.json(stmt.todoList.all());
});

// Specific routes before parameterized to avoid /:id conflicts
app.delete('/api/todo/done/all', (req, res) => {
  stmt.todoDeleteDone.run();
  res.json({ ok: true });
});

app.post('/api/todo', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
  const info = stmt.todoInsert.run(text.trim().slice(0, 200));
  res.json(stmt.todoGet.get(info.lastInsertRowid));
});

app.patch('/api/todo/:id', (req, res) => {
  const { done } = req.body;
  stmt.todoSetDone.run(done ? 1 : 0, req.params.id);
  const item = stmt.todoGet.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.delete('/api/todo/:id', (req, res) => {
  const info = stmt.todoDelete.run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── Bulletin ──────────────────────────────────────────────────
app.get('/api/bulletin', (req, res) => {
  res.json(stmt.bulletinList.all());
});

app.post('/api/bulletin', (req, res) => {
  const { author, message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  const info = stmt.bulletinInsert.run(
    (author || 'Anonymous').trim().slice(0, 40),
    message.trim().slice(0, 300)
  );
  res.json(stmt.bulletinGet.get(info.lastInsertRowid));
});

app.delete('/api/bulletin/:id', (req, res) => {
  const info = stmt.bulletinDelete.run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── Calendar ──────────────────────────────────────────────────
// GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns all events (including expanded recurrences) for the date range
app.get('/api/calendar', (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  const weekStart = localDate(start);
  const weekEnd   = localDate(end);

  const rows = stmt.calendarRange.all(start, end, end, start);

  const out = [];
  for (const ev of rows) out.push(...expandEvent(ev, weekStart, weekEnd));
  res.json(out);
});

app.post('/api/calendar', (req, res) => {
  const {
    title, description, person, color, event_date, start_time, end_time, all_day,
    recurrence, recurrence_interval, recurrence_until, is_private,
  } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  if (!event_date)    return res.status(400).json({ error: 'Date required' });

  const safeColor    = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#4f8ef7';
  // monthly_weekday = "same nth weekday of the month as the start date" (e.g. 1st Monday)
  const safeRecur    = ['none','daily','weekly','monthly','monthly_weekday','yearly'].includes(recurrence)
    ? recurrence : 'none';
  const safeInterval = Math.min(99, Math.max(1, parseInt(recurrence_interval, 10) || 1));

  const info = stmt.calendarInsert.run(
    title.trim().slice(0, 120),
    (description || '').trim().slice(0, 500),
    (person || '').trim().slice(0, 40),
    safeColor,
    event_date,
    start_time  || null,
    end_time    || null,
    all_day ? 1 : 0,
    safeRecur,
    safeRecur === 'none' ? 1 : safeInterval,
    recurrence_until || null,
    is_private ? 1 : 0
  );

  res.json(stmt.calendarGet.get(info.lastInsertRowid));
});

// PATCH /api/calendar/:id — edit an event. Always applies to the whole
// series for a recurring event (no per-occurrence edit, unlike delete);
// existing excluded_dates are left as-is.
app.patch('/api/calendar/:id', (req, res) => {
  const existing = stmt.calendarGet.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const {
    title, description, person, color, event_date, start_time, end_time, all_day,
    recurrence, recurrence_interval, recurrence_until, is_private,
  } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  if (!event_date)    return res.status(400).json({ error: 'Date required' });

  const safeColor    = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#4f8ef7';
  const safeRecur    = ['none','daily','weekly','monthly','monthly_weekday','yearly'].includes(recurrence)
    ? recurrence : 'none';
  const safeInterval = Math.min(99, Math.max(1, parseInt(recurrence_interval, 10) || 1));

  stmt.calendarUpdate.run(
    title.trim().slice(0, 120),
    (description || '').trim().slice(0, 500),
    (person || '').trim().slice(0, 40),
    safeColor,
    event_date,
    start_time  || null,
    end_time    || null,
    all_day ? 1 : 0,
    safeRecur,
    safeRecur === 'none' ? 1 : safeInterval,
    recurrence_until || null,
    is_private ? 1 : 0,
    req.params.id
  );

  res.json(stmt.calendarGet.get(req.params.id));
});

// DELETE /api/calendar/:id            — delete the event (all occurrences, if recurring)
// DELETE /api/calendar/:id?date=YYYY-MM-DD — delete just that one occurrence of a
//   recurring event (recorded in excluded_dates, checked by expandEvent below).
//   For a non-recurring event, that single date IS the whole event, so it's
//   the same as an outright delete.
app.delete('/api/calendar/:id', (req, res) => {
  const { date } = req.query;

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });

    const ev = stmt.calendarGet.get(req.params.id);
    if (!ev) return res.status(404).json({ error: 'Not found' });

    if (ev.recurrence === 'none') {
      stmt.calendarDelete.run(req.params.id);
      return res.json({ ok: true });
    }

    const excluded = new Set((ev.excluded_dates || '').split(',').filter(Boolean));
    excluded.add(date);
    stmt.calendarSetExcluded.run([...excluded].join(','), req.params.id);
    return res.json({ ok: true });
  }

  const info = stmt.calendarDelete.run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── System stats (debug performance overlay) ───────────────────
// Raspberry Pi's VideoCore GPU has no load-percentage metric (unlike a
// discrete GPU) — we surface what `vcgencmd` actually exposes instead:
// memory split, core clock, and the throttled/undervoltage flag, which
// is the more actionable signal on this hardware anyway.
let prevCpuSample = os.cpus();

function cpuPercent() {
  const cur = os.cpus();
  let idleDelta = 0, totalDelta = 0;
  cur.forEach((c, i) => {
    const prev = prevCpuSample[i];
    if (!prev) return;
    const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
    const curTotal  = Object.values(c.times).reduce((a, b) => a + b, 0);
    totalDelta += curTotal - prevTotal;
    idleDelta  += c.times.idle - prev.times.idle;
  });
  prevCpuSample = cur;
  if (totalDelta <= 0) return null;
  return Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
}

function readVcgencmd(args) {
  try {
    return execFileSync('vcgencmd', args, { encoding: 'utf8', timeout: 1000 }).trim();
  } catch { return null; }
}

function getTempC() {
  const out = readVcgencmd(['measure_temp']); // "temp=53.8'C"
  const m   = out?.match(/([\d.]+)/);
  if (m) return parseFloat(m[1]);
  try { // non-Pi Linux fallback: same SoC thermal sensor, no vcgencmd needed
    return Math.round(parseInt(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8'), 10) / 100) / 10;
  } catch { return null; }
}

function getGpuInfo() {
  const memOut       = readVcgencmd(['get_mem', 'gpu']);       // "gpu=76M"
  const clockOut     = readVcgencmd(['measure_clock', 'core']); // "frequency(1)=500000000"
  const throttledOut = readVcgencmd(['get_throttled']);         // "throttled=0x0"
  if (memOut === null && clockOut === null && throttledOut === null) return null;

  const flags = throttledOut ? parseInt(throttledOut.split('=')[1], 16) : null;
  return {
    memMB:          memOut   ? parseInt(memOut.match(/(\d+)M/)?.[1] || '0', 10) : null,
    coreMHz:        clockOut ? Math.round(parseInt(clockOut.split('=')[1] || '0', 10) / 1e6) : null,
    throttled:      flags != null ? flags !== 0 : null,
    throttledFlags: flags != null ? '0x' + flags.toString(16) : null,
  };
}

// ── Server-side TTS ─────────────────────────────────────────────
// Chromium's built-in speechSynthesis has been unreliable on Raspberry Pi OS
// (depends on Chromium's Linux TTS platform support + speech-dispatcher
// wiring, both of which are inconsistent across builds). Synthesizing on the
// server and handing back a plain WAV file sidesteps that entire fragile
// chain — the browser's job shrinks to "play this audio", which is far more
// universally supported than the Web Speech API on Linux.
//
// Piper (not espeak-ng — swapped after espeak's voice proved too warbly to
// reliably understand): a neural TTS engine, still fully local/offline, but
// far more natural. Overridable via env vars since install location varies:
//   PIPER_BIN   — path to the piper binary (default: assumes it's on PATH)
//   PIPER_MODEL — path to the voice .onnx model file
// Piper takes text on stdin and writes a WAV file to --output_file; there's
// no documented way to have it stream to stdout, so we go through a temp
// file instead (unique per request, cleaned up after).
const PIPER_BIN   = process.env.PIPER_BIN   || 'piper';
const PIPER_MODEL = process.env.PIPER_MODEL || path.join(__dirname, 'piper', 'en_US-lessac-medium.onnx');
// Default length_scale (Piper's speed control — higher = slower/clearer,
// lower = faster). 1.0 is the model's natural pace; slowed slightly by
// default since a wall-mounted announcement needs to be parseable at a
// glance-away distance, not just "correct." Overridable per-request (see
// below) so it can be A/B tested live from Settings without a redeploy.
const PIPER_DEFAULT_LENGTH_SCALE = parseFloat(process.env.PIPER_LENGTH_SCALE) || 1.15;

app.post('/api/tts', (req, res) => {
  const text = (req.body?.text || '').toString().trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'text required' });

  // Clamped, not trusted blindly — this becomes a CLI arg to piper below.
  const rateIn = parseFloat(req.body?.rate);
  const lengthScale = Number.isFinite(rateIn)
    ? Math.min(2.0, Math.max(0.6, rateIn))
    : PIPER_DEFAULT_LENGTH_SCALE;

  const tmpFile = path.join(os.tmpdir(), `dashboard-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);

  // execFile (not execFileSync): synthesis can take a couple of seconds for
  // longer alert text, and this is a single-threaded server — a synchronous
  // call would freeze every other client's request (calendar/todo polling,
  // sysstats, etc.) for the whole duration. execFile lets the event loop
  // keep serving other requests while piper runs in its own process.
  const child = execFile(PIPER_BIN,
    ['--model', PIPER_MODEL, '--length_scale', String(lengthScale), '--output_file', tmpFile],
    { maxBuffer: 10 * 1024 * 1024, timeout: 10000 },
    (err) => {
      if (err) {
        fs.unlink(tmpFile, () => {});
        return res.status(500).json({
          error: 'piper unavailable or failed',
          detail: err.message,
        });
      }
      fs.readFile(tmpFile, (readErr, wav) => {
        fs.unlink(tmpFile, () => {});
        if (readErr) {
          return res.status(500).json({ error: 'piper produced no output file', detail: readErr.message });
        }
        res.set('Content-Type', 'audio/wav');
        res.send(wav);
      });
    }
  );
  child.stdin.write(text);
  child.stdin.end();
});

app.get('/api/version', (req, res) => {
  res.json({ build: GIT_BUILD, commit: GIT_COMMIT });
});

// ── Self-update ───────────────────────────────────────────────
// Requires the systemd unit to be Restart=always (not the default
// on-failure) — see dashboard.service. A clean process.exit(0) after a
// successful pull is not a "failure" as far as systemd is concerned, so
// on-failure would just leave the dashboard off until someone noticed.
const execFileP = require('util').promisify(execFile);
const GIT_OPTS = { cwd: __dirname, timeout: 15000 };

app.get('/api/update-check', async (req, res) => {
  if (!GIT_COMMIT) return res.json({ updateAvailable: false }); // not a git checkout

  try {
    await execFileP('git', ['fetch', 'origin', 'main'], GIT_OPTS);
    const { stdout: local }  = await execFileP('git', ['rev-parse', 'HEAD'], GIT_OPTS);
    const { stdout: remote } = await execFileP('git', ['rev-parse', 'origin/main'], GIT_OPTS);
    if (local.trim() === remote.trim()) return res.json({ updateAvailable: false });

    // Full subject + body per commit, not just the latest one-line summary
    // — the client builds a plain-language "what this adds" list from the
    // subjects, and the full text (with body) backs a "see more" for the
    // exact technical detail. %x1f/%x1e (unit/record separator control
    // characters) delimit fields safely since commit text can otherwise
    // contain almost anything.
    const { stdout: logOut } = await execFileP('git',
      ['log', '--format=%h%x1f%s%x1f%b%x1e', 'HEAD..origin/main'], GIT_OPTS);
    const commits = logOut.split('\x1e').filter(s => s.trim()).map(rec => {
      const [hash, subject, body] = rec.replace(/^\n/, '').split('\x1f');
      return { hash, subject: (subject || '').trim(), body: (body || '').trim() };
    });

    res.json({
      updateAvailable: true,
      behindBy: commits.length,
      latestCommit: remote.trim().slice(0, 7),
      commits,
    });
  } catch (err) {
    // Offline, GitHub unreachable, etc. — same "can't tell right now" shape
    // as no update, rather than surfacing a scary error for what's usually
    // just a transient network hiccup.
    res.json({ updateAvailable: false, checkFailed: true });
  }
});

app.post('/api/update-apply', async (req, res) => {
  try {
    await execFileP('git', ['pull', '--ff-only'], GIT_OPTS);
    await execFileP('npm', ['install', '--omit=dev'], GIT_OPTS); // in case a new commit added a dependency
  } catch (err) {
    return res.status(500).json({ error: 'update failed', detail: err.message });
  }

  // System-level changes (packages, the service file, kiosk autostart) —
  // optional and best-effort. A failure here shouldn't strand a family
  // without their dashboard just because e.g. an apt mirror hiccupped; the
  // app-level update above already succeeded and still gets applied. Output
  // goes to the systemd journal (journalctl -u dashboard) for later review,
  // not back to the client — nobody's watching this happen in real time.
  const systemUpdateScript = path.join(__dirname, 'scripts', 'system-update.sh');
  if (fs.existsSync(systemUpdateScript)) {
    try {
      const { stdout, stderr } = await execFileP('bash', [systemUpdateScript],
        { cwd: __dirname, timeout: 120000 });
      console.log(stdout);
      if (stderr) console.error(stderr);
    } catch (err) {
      console.error('system-update.sh failed:', err.message);
    }
  }

  res.json({ ok: true });
  res.on('finish', () => process.exit(0)); // wait for the response to actually go out before restarting
});

// ── Exit to terminal (debug) ─────────────────────────────────────
// Kills the X server (not just Chromium) so the Pi drops to the plain
// tty1 console — a personal safety net for "SSH isn't working" scenarios,
// not a normal-use feature. The autologin + startx chain in ~/.profile is
// a one-shot guarded check (not a loop), so this doesn't relaunch itself;
// a reboot brings the kiosk back the normal way.
app.post('/api/exit-kiosk', (req, res) => {
  execFile('sudo', ['/usr/bin/pkill', '-f', '/usr/lib/xorg/Xorg'], { timeout: 5000 }, (err) => {
    if (err) return res.status(500).json({ error: 'failed', detail: err.message });
    res.json({ ok: true });
  });
});

app.get('/api/sysstats', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();

  let disk = null;
  try {
    const s = fs.statfsSync(__dirname);
    disk = { totalBytes: s.blocks * s.bsize, usedBytes: (s.blocks - s.bfree) * s.bsize };
  } catch { /* statfs unsupported on this platform */ }

  res.json({
    cpuPercent: cpuPercent(),
    mem:        { totalBytes: totalMem, usedBytes: totalMem - freeMem },
    appMem:     { rssBytes: process.memoryUsage().rss }, // this Node process only, vs. `mem` (whole host)
    disk,
    tempC:      getTempC(),
    gpu:        getGpuInfo(),
    uptimeSec:  os.uptime(),
  });
});

// ── Recurrence expansion helpers ──────────────────────────────
function localDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateStr(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

function expandEvent(ev, weekStart, weekEnd) {
  const base     = localDate(ev.event_date);
  const until    = ev.recurrence_until ? localDate(ev.recurrence_until) : new Date(2099, 11, 31);
  const recur    = ev.recurrence || 'none';
  const interval = Math.max(1, parseInt(ev.recurrence_interval, 10) || 1);

  if (recur === 'none') {
    return (base >= weekStart && base <= weekEnd)
      ? [{ ...ev, display_date: ev.event_date }]
      : [];
  }

  const excluded = new Set((ev.excluded_dates || '').split(',').filter(Boolean));
  // "1st/2nd/3rd/4th/5th occurrence of this weekday in the month" — e.g. the
  // 6th of a month is always the 1st occurrence of whatever weekday it falls on.
  const baseNthWeekday = Math.ceil(base.getDate() / 7);

  const results = [];
  const cursor  = new Date(weekStart);
  while (cursor <= weekEnd) {
    if (cursor >= base && cursor <= until) {
      const daysDiff   = Math.round((cursor - base) / 86400000);
      const weeksDiff  = Math.round((cursor - base) / (7 * 86400000));
      const monthsDiff = (cursor.getFullYear() - base.getFullYear()) * 12 + (cursor.getMonth() - base.getMonth());
      const yearsDiff  = cursor.getFullYear() - base.getFullYear();

      const match =
        recur === 'daily'           ? daysDiff % interval === 0 :
        recur === 'weekly'          ? cursor.getDay() === base.getDay() && weeksDiff % interval === 0 :
        recur === 'monthly'         ? cursor.getDate() === base.getDate() && monthsDiff % interval === 0 :
        recur === 'monthly_weekday' ? cursor.getDay() === base.getDay() &&
                                       Math.ceil(cursor.getDate() / 7) === baseNthWeekday &&
                                       monthsDiff % interval === 0 :
        recur === 'yearly'          ? cursor.getMonth() === base.getMonth() && cursor.getDate() === base.getDate() &&
                                       yearsDiff % interval === 0 :
        false;

      const dateStr = toDateStr(cursor);
      if (match && !excluded.has(dateStr)) results.push({ ...ev, display_date: dateStr });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return results;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Family Dashboard running at http://0.0.0.0:${PORT}`);
});
