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
    person TEXT DEFAULT '',
    color TEXT DEFAULT '#4f8ef7',
    event_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    all_day INTEGER DEFAULT 0,
    recurrence TEXT DEFAULT 'none',
    recurrence_until TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

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
  const { title, person, color, event_date, start_time, end_time, all_day, recurrence, recurrence_until } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  if (!event_date)    return res.status(400).json({ error: 'Date required' });

  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#4f8ef7';
  const safeRecur = ['none','daily','weekly','monthly','yearly'].includes(recurrence) ? recurrence : 'none';

  const info = db.prepare(`
    INSERT INTO calendar_events
      (title, person, color, event_date, start_time, end_time, all_day, recurrence, recurrence_until)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    title.trim().slice(0, 120),
    (person || '').trim().slice(0, 40),
    safeColor,
    event_date,
    start_time  || null,
    end_time    || null,
    all_day ? 1 : 0,
    safeRecur,
    recurrence_until || null
  );

  res.json(db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/calendar/:id', (req, res) => {
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
  const base  = localDate(ev.event_date);
  const until = ev.recurrence_until ? localDate(ev.recurrence_until) : new Date(2099, 11, 31);
  const recur = ev.recurrence || 'none';

  if (recur === 'none') {
    return (base >= weekStart && base <= weekEnd)
      ? [{ ...ev, display_date: ev.event_date }]
      : [];
  }

  const results = [];
  const cursor  = new Date(weekStart);
  while (cursor <= weekEnd) {
    if (cursor >= base && cursor <= until) {
      const match =
        recur === 'daily'   ? true :
        recur === 'weekly'  ? cursor.getDay()   === base.getDay() :
        recur === 'monthly' ? cursor.getDate()  === base.getDate() :
        recur === 'yearly'  ? cursor.getMonth() === base.getMonth() && cursor.getDate() === base.getDate() :
        false;
      if (match) results.push({ ...ev, display_date: toDateStr(cursor) });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return results;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Family Dashboard running at http://0.0.0.0:${PORT}`);
});
