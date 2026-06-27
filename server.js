const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
const db = new Database(path.join(__dirname, 'db', 'dashboard.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS grocery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    checked INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS bulletin_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL DEFAULT 'Anonymous',
    message TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_time TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Grocery list ──────────────────────────────────────────────
app.get('/api/grocery', (req, res) => {
  const rows = db.prepare('SELECT * FROM grocery_items ORDER BY checked ASC, created_at DESC').all();
  res.json(rows);
});

app.post('/api/grocery', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const info = db.prepare('INSERT INTO grocery_items (name) VALUES (?)').run(name.trim());
  const item = db.prepare('SELECT * FROM grocery_items WHERE id = ?').get(info.lastInsertRowid);
  res.json(item);
});

app.patch('/api/grocery/:id', (req, res) => {
  const { checked } = req.body;
  db.prepare('UPDATE grocery_items SET checked = ? WHERE id = ?').run(checked ? 1 : 0, req.params.id);
  const item = db.prepare('SELECT * FROM grocery_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.delete('/api/grocery/:id', (req, res) => {
  const info = db.prepare('DELETE FROM grocery_items WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.delete('/api/grocery/checked/all', (req, res) => {
  db.prepare('DELETE FROM grocery_items WHERE checked = 1').run();
  res.json({ ok: true });
});

// ── Bulletin board ────────────────────────────────────────────
app.get('/api/bulletin', (req, res) => {
  const rows = db.prepare('SELECT * FROM bulletin_posts ORDER BY created_at DESC LIMIT 20').all();
  res.json(rows);
});

app.post('/api/bulletin', (req, res) => {
  const { author, message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
  const info = db.prepare('INSERT INTO bulletin_posts (author, message) VALUES (?, ?)').run(
    (author || 'Anonymous').trim().slice(0, 40),
    message.trim().slice(0, 300)
  );
  const post = db.prepare('SELECT * FROM bulletin_posts WHERE id = ?').get(info.lastInsertRowid);
  res.json(post);
});

app.delete('/api/bulletin/:id', (req, res) => {
  const info = db.prepare('DELETE FROM bulletin_posts WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── Events ────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM events
    WHERE event_date >= date('now', '-1 day')
    ORDER BY event_date ASC, event_time ASC
    LIMIT 20
  `).all();
  res.json(rows);
});

app.post('/api/events', (req, res) => {
  const { title, event_date, event_time } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });
  if (!event_date) return res.status(400).json({ error: 'Date required' });
  const info = db.prepare('INSERT INTO events (title, event_date, event_time) VALUES (?, ?, ?)').run(
    title.trim().slice(0, 120),
    event_date,
    event_time || null
  );
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  res.json(event);
});

app.delete('/api/events/:id', (req, res) => {
  const info = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Family Dashboard running at http://0.0.0.0:${PORT}`);
});
