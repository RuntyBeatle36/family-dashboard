const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

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

// ── Todo ──────────────────────────────────────────────────────
app.get('/api/todo', (req, res) => {
  res.json(db.prepare('SELECT * FROM todo_items ORDER BY done ASC, created_at DESC').all());
});

// Specific routes before parameterized to avoid /:id conflicts
app.delete('/api/todo/done/all', (req, res) => {
  db.prepare('DELETE FROM todo_items WHERE done = 1').run();
  res.json({ ok: true });
});

app.post('/api/todo', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
  const info = db.prepare('INSERT INTO todo_items (text) VALUES (?)').run(text.trim().slice(0, 200));
  res.json(db.prepare('SELECT * FROM todo_items WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/todo/:id', (req, res) => {
  const { done } = req.body;
  db.prepare('UPDATE todo_items SET done = ? WHERE id = ?').run(done ? 1 : 0, req.params.id);
  const item = db.prepare('SELECT * FROM todo_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.delete('/api/todo/:id', (req, res) => {
  const info = db.prepare('DELETE FROM todo_items WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── Bulletin ──────────────────────────────────────────────────
app.get('/api/bulletin', (req, res) => {
  res.json(db.prepare('SELECT * FROM bulletin_posts ORDER BY created_at DESC LIMIT 20').all());
});

app.post('/api/bulletin', (req, res) => {
  const { author, message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  const info = db.prepare('INSERT INTO bulletin_posts (author, message) VALUES (?, ?)').run(
    (author || 'Anonymous').trim().slice(0, 40),
    message.trim().slice(0, 300)
  );
  res.json(db.prepare('SELECT * FROM bulletin_posts WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/bulletin/:id', (req, res) => {
  const info = db.prepare('DELETE FROM bulletin_posts WHERE id = ?').run(req.params.id);
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

  const rows = db.prepare(`
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
  `).all(start, end, end, start);

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

  const info = db.prepare(`
    INSERT INTO calendar_events
      (title, description, person, color, event_date, start_time, end_time, all_day,
       recurrence, recurrence_interval, recurrence_until, is_private)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
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

  res.json(db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(info.lastInsertRowid));
});

// PATCH /api/calendar/:id — edit an event. Always applies to the whole
// series for a recurring event (no per-occurrence edit, unlike delete);
// existing excluded_dates are left as-is.
app.patch('/api/calendar/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
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

  db.prepare(`
    UPDATE calendar_events SET
      title = ?, description = ?, person = ?, color = ?, event_date = ?,
      start_time = ?, end_time = ?, all_day = ?,
      recurrence = ?, recurrence_interval = ?, recurrence_until = ?, is_private = ?
    WHERE id = ?
  `).run(
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

  res.json(db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id));
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

    const ev = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
    if (!ev) return res.status(404).json({ error: 'Not found' });

    if (ev.recurrence === 'none') {
      db.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
      return res.json({ ok: true });
    }

    const excluded = new Set((ev.excluded_dates || '').split(',').filter(Boolean));
    excluded.add(date);
    db.prepare('UPDATE calendar_events SET excluded_dates = ? WHERE id = ?')
      .run([...excluded].join(','), req.params.id);
    return res.json({ ok: true });
  }

  const info = db.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
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
// wiring, both of which are inconsistent across builds). Synthesizing with
// espeak-ng directly on the server and handing back a plain WAV file
// sidesteps that entire fragile chain — the browser just plays audio,
// which is far more universally supported than Web Speech API on Linux.
app.post('/api/tts', (req, res) => {
  const text = (req.body?.text || '').toString().trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    // Defaults (en male, ~175wpm) read as flat/robotic and run words together.
    // en-us+f3 is a noticeably less harsh voice; slower speed (150wpm) and a
    // touch of extra word-gap both trade a little naturalness for clarity.
    const wav = execFileSync('espeak-ng',
      ['-v', 'en-us+f3', '-s', '150', '-p', '48', '-g', '3', '--stdout', text],
      { maxBuffer: 10 * 1024 * 1024, timeout: 10000 }
    );
    res.set('Content-Type', 'audio/wav');
    res.send(wav);
  } catch (err) {
    res.status(500).json({
      error: 'espeak-ng unavailable or failed',
      detail: err.message,
    });
  }
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
