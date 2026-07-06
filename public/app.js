/* ═══════════════════════════════════════════════════════════
   Family Dashboard — app.js
   ═══════════════════════════════════════════════════════════ */

/* ── Calendar constants ───────────────────────────────────── */
const CAL_START  = 0;       // midnight — full 24-hour view
const CAL_END    = 24;      // 24 rows (hours 0–23)
const HOUR_PX    = 64;      // pixels per hour
const REFRESH_MS = 15000;

/* ── Corpus Christi zip code directory ────────────────────── */
// Coordinates are the approximate geographic center of each ZIP.
// Weather differences within Corpus Christi metro are minimal,
// but this gives the most locally accurate reading per neighborhood.
const ZIP_CODES = [
  { zip: '78401', name: 'Downtown',              lat: 27.8006, lon: -97.3964 },
  { zip: '78404', name: 'Uptown / Central',      lat: 27.8014, lon: -97.4162 },
  { zip: '78405', name: 'North Side',            lat: 27.8302, lon: -97.4044 },
  { zip: '78408', name: 'North Corpus',          lat: 27.8358, lon: -97.3836 },
  { zip: '78410', name: 'Calallen',              lat: 27.8636, lon: -97.5094 },
  { zip: '78411', name: 'South Side',            lat: 27.7607, lon: -97.4008 },
  { zip: '78412', name: 'Southside / Everhart',  lat: 27.7228, lon: -97.3742 },
  { zip: '78413', name: 'Flour Bluff',           lat: 27.7063, lon: -97.3449 },
  { zip: '78414', name: 'SPID / Saratoga',       lat: 27.7207, lon: -97.3903 },
  { zip: '78415', name: 'Westside / Del Mar',    lat: 27.7897, lon: -97.4397 },
  { zip: '78416', name: 'Molina',                lat: 27.7731, lon: -97.4253 },
  { zip: '78417', name: 'Airport Area',          lat: 27.7494, lon: -97.4453 },
  { zip: '78418', name: 'North Padre Island',    lat: 27.6284, lon: -97.2117 },
  { zip: '78419', name: 'NAS Corpus Christi',    lat: 27.6908, lon: -97.2906 },
];

function getActiveZip() {
  const saved = localStorage.getItem('wx_zip') || '78414';
  return ZIP_CODES.find(z => z.zip === saved) || ZIP_CODES.find(z => z.zip === '78414');
}

/* ── Event colors ─────────────────────────────────────────── */
const COLORS = [
  { hex: '#4f8ef7', name: 'Blue'   },
  { hex: '#e05555', name: 'Red'    },
  { hex: '#4caf7d', name: 'Green'  },
  { hex: '#f7a04f', name: 'Orange' },
  { hex: '#a855f7', name: 'Purple' },
  { hex: '#ec4899', name: 'Pink'   },
  { hex: '#14b8a6', name: 'Teal'   },
  { hex: '#eab308', name: 'Yellow' },
];

/* ── App state ────────────────────────────────────────────── */
let calView       = 'week'; // 'day' | 'week' | 'month'
let viewOffset    = 0;      // days / weeks / months from today, depending on calView
let calEvents     = [];
let detailEventId = null;
let selectedColor = COLORS[0].hex;

// Sunrise/sunset from Open-Meteo (updated each weather fetch)
let sunriseMins = null; // minutes since midnight
let sunsetMins  = null;

/* ══════════════════════════════════════════════════════════
   THEME
   ══════════════════════════════════════════════════════════ */
let _lastThemeKey = null; // tracks "pref|mode" to skip identical re-applies

function applyTheme() {
  const pref = localStorage.getItem('dashboard_theme') || 'auto';
  let mode = pref;

  if (pref === 'auto') {
    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    if (sunriseMins !== null && sunsetMins !== null) {
      mode = (nowM >= sunriseMins && nowM < sunsetMins) ? 'light' : 'dark';
    } else {
      // Fallback to system preference before first weather fetch
      mode = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    updateThemeStatus(mode);
  } else {
    document.getElementById('theme-status').textContent = '';
  }

  const key = `${pref}|${mode}`;
  if (key === _lastThemeKey) return; // nothing changed — skip DOM writes
  _lastThemeKey = key;

  document.documentElement.setAttribute('data-theme', mode);
  // Keep buttons in sync when settings panel is open
  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === pref);
  });
}

function updateThemeStatus(activeMode) {
  const el = document.getElementById('theme-status');
  if (!el) return;
  if (sunriseMins === null) { el.textContent = 'Using system preference'; return; }
  const fmt = m => fmt12h(Math.floor(m / 60) * 100 + (m % 60)); // hack-free fmt
  const riseH = Math.floor(sunriseMins / 60), riseM = sunriseMins % 60;
  const setH  = Math.floor(sunsetMins  / 60), setM  = sunsetMins  % 60;
  el.textContent = `Now ${activeMode} · Sunrise ${fmt12hHM(riseH, riseM)} · Sunset ${fmt12hHM(setH, setM)}`;
}

// Theme button clicks
document.getElementById('theme-options').addEventListener('click', e => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  localStorage.setItem('dashboard_theme', btn.dataset.val);
  applyTheme();
});

applyTheme(); // initial apply before any data

/* ══════════════════════════════════════════════════════════
   UTILITIES
   ══════════════════════════════════════════════════════════ */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) {
    const txt = await r.text().catch(() => `HTTP ${r.status}`);
    throw new Error(txt);
  }
  return r.json();
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function timeAgo(unixSec) {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmt12h(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    const h = val, m = 0;
    return fmt12hHM(h, m);
  }
  const [h, m] = String(val).split(':').map(Number);
  return fmt12hHM(h, m || 0);
}

function fmt12hHM(h, m) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2,'0')} ${ampm}` : `${h12} ${ampm}`;
}

function timeToMins(str) {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + (m || 0);
}

function addOneHour(str) {
  const [h, m] = (str || '00:00').split(':').map(Number);
  return `${String(Math.min(h + 1, 23)).padStart(2,'0')}:${String(m || 0).padStart(2,'0')}`;
}

let toastTimer;
function showError(msg) {
  const el = document.getElementById('error-toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

/* ══════════════════════════════════════════════════════════
   CLOCK & DATE
   ══════════════════════════════════════════════════════════ */
function updateClock() {
  const now  = new Date();
  const h    = now.getHours();
  const m    = String(now.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  document.getElementById('clock').textContent = `${h % 12 || 12}:${m} ${ampm}`;

  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  document.getElementById('date-str').textContent =
    `${DAYS[now.getDay()]}, ${MONS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  // Re-evaluate auto theme every minute
  if (now.getSeconds() === 0) applyTheme();
}
updateClock();
setInterval(updateClock, 1000);

/* ══════════════════════════════════════════════════════════
   WEATHER CANVAS ANIMATION
   Modes: none | clear-day | clear-night |
          cloudy-day | cloudy-night | overcast | rain | storm | snow

   Performance notes (Raspberry Pi):
   - Clouds pre-rendered to OffscreenCanvas; each frame = drawImage() call
   - Bolt pre-rendered to OffscreenCanvas; blitted at varying globalAlpha
   - Stars/rain/snow use direct globalAlpha instead of save/restore per particle
   - Canvas promoted to dedicated GPU compositing layer via CSS transform
   ══════════════════════════════════════════════════════════ */
const wxCanvas = document.getElementById('wx-canvas');
const wxCtx    = wxCanvas.getContext('2d');
let wxDrops  = [];
let wxStars  = [];
let wxClouds = [];
let wxFlakes = [];
let wxAnimId = null;
let wxMode   = 'none';
let daySkyOC = null;  // OffscreenCanvas for pre-rendered day sky, invalidated on resize
let skyGrads = {};    // cached per-mode gradient objects, keyed by name, invalidated on resize

function resizeWxCanvas() {
  wxCanvas.width  = window.innerWidth;
  wxCanvas.height = window.innerHeight;
}

/* ── Rain drops ───────────────────────────────────────────── */
const LEAN = 0.22;

function mkDrop() {
  return {
    x:     Math.random() * wxCanvas.width * 1.3 - wxCanvas.width * 0.15,
    y:     Math.random() * wxCanvas.height - wxCanvas.height,
    len:   12 + Math.random() * 20,
    speed:  8 + Math.random() * 14,
    opac:  0.12 + Math.random() * 0.26,
  };
}

function initDrops() {
  wxDrops = Array.from({ length: wxMode === 'storm' ? 170 : 100 }, mkDrop);
}

function resetDrop(d) {
  d.len   = 12 + Math.random() * 20;
  d.x     = Math.random() * wxCanvas.width * 1.3 - wxCanvas.width * 0.15;
  d.speed = 8 + Math.random() * 14;
  d.opac  = 0.12 + Math.random() * 0.26;
  d.y     = -d.len;
}

/* ── Stars ────────────────────────────────────────────────── */
function initStars() {
  wxStars = Array.from({ length: 120 }, () => ({
    x:    Math.random() * wxCanvas.width,
    y:    Math.random() * wxCanvas.height * 0.78,
    r:    0.5 + Math.random() * 1.6,
    base: 0.22 + Math.random() * 0.62,
    freq: 0.0006 + Math.random() * 0.0012,
    phi:  Math.random() * Math.PI * 2,
  }));
}

/* ── Clouds OffscreenCanvas ───────────────────────────────── */
function mkCloud(offscreen, colorRgba) {
  const W = wxCanvas.width, H = wxCanvas.height;
  const n = 3 + Math.floor(Math.random() * 3);
  const puffs = [];
  let cx = 0, maxR = 0;
  for (let i = 0; i < n; i++) {
    const r = 28 + Math.random() * 48;
    if (r > maxR) maxR = r;
    puffs.push({ dx: cx + r, dy: (Math.random() - 0.5) * r * 0.28, r });
    cx += r * (1.55 + Math.random() * 0.35);
  }
  const pad = 10;
  const ocW = Math.ceil(cx + maxR * 0.6 + pad * 2);
  const ocH = Math.ceil(maxR * 2.4 + pad * 2);
  const oc  = new OffscreenCanvas(ocW, ocH);
  const occ = oc.getContext('2d');
  for (const p of puffs) {
    occ.beginPath();
    occ.arc(p.dx + pad, maxR * 1.2 + pad + p.dy, p.r, 0, Math.PI * 2);
    occ.fillStyle = colorRgba;
    occ.fill();
  }
  const scaleX = 0.55 + Math.random() * 1.0;
  const scaleY = scaleX * (0.46 + Math.random() * 0.10);
  return {
    x:      offscreen ? -(ocW * scaleX * 0.5 + 100) : Math.random() * W * 1.2 - W * 0.1,
    y:      H * (0.03 + Math.random() * 0.40),
    scaleX, scaleY,
    speed:  0.15 + Math.random() * 0.28,
    opac:   0.32 + Math.random() * 0.40,
    oc, ocW, ocH, colorRgba,
  };
}

function initClouds() {
  const n = wxMode === 'overcast' ? 8 : 4;
  const colorRgba =
    wxMode === 'cloudy-day'   ? 'rgba(255,255,255,0.92)' :
    wxMode === 'cloudy-night' ? 'rgba(16,22,58,0.96)'    :
                                'rgba(82,92,118,0.92)';
  wxClouds = Array.from({ length: n }, () => mkCloud(false, colorRgba));
}

/* ── Drawing helpers ──────────────────────────────────────── */
// getSkyGrad: returns a cached LinearGradient for the given mode key.
// Invalidated (via skyGrads = {}) whenever the canvas is resized.
function getSkyGrad(key, stops) {
  const H = wxCanvas.height;
  if (!skyGrads[key] || skyGrads[key].h !== H) {
    const g = wxCtx.createLinearGradient(0, 0, 0, H);
    stops.forEach(([p, c]) => g.addColorStop(p, c));
    skyGrads[key] = { g, h: H };
  }
  return skyGrads[key].g;
}

// drawDaySky: blits a pre-rendered OffscreenCanvas (gradient + cloud-smear highlights).
// Re-rendered only on canvas resize, not every frame.
function drawDaySky() {
  const W = wxCanvas.width, H = wxCanvas.height;
  if (!daySkyOC || daySkyOC.width !== W || daySkyOC.height !== H) {
    daySkyOC = new OffscreenCanvas(W, H);
    const dc = daySkyOC.getContext('2d');
    const g = dc.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0,    'rgba(10,  60, 160, 0.92)');
    g.addColorStop(0.45, 'rgba(20, 110, 210, 0.80)');
    g.addColorStop(0.80, 'rgba(50, 155, 230, 0.60)');
    g.addColorStop(1,    'rgba(90, 190, 245, 0.35)');
    dc.fillStyle = g;
    dc.fillRect(0, 0, W, H);
    [[0.20,0.16],[0.54,0.09],[0.79,0.21],[0.37,0.29]].forEach(([cfx,cfy]) => {
      const g2 = dc.createRadialGradient(W*cfx,H*cfy,0, W*cfx,H*cfy,W*0.14);
      g2.addColorStop(0, 'rgba(255,255,255,0.11)');
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      dc.fillStyle = g2;
      dc.fillRect(0, 0, W, H);
    });
  }
  wxCtx.drawImage(daySkyOC, 0, 0);
}

function drawNightSky() {
  wxCtx.fillStyle = getSkyGrad('night', [
    [0, 'rgba(4,  7, 28, 0.94)'],
    [1, 'rgba(8, 16, 52, 0.72)'],
  ]);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
}

function drawOvercastSky() {
  wxCtx.fillStyle = getSkyGrad('overcast', [
    [0, 'rgba(38, 43, 62, 0.88)'],
    [1, 'rgba(58, 68, 90, 0.58)'],
  ]);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
}

function drawRainSky() {
  wxCtx.fillStyle = getSkyGrad('rain', [
    [0, 'rgba(14, 19, 46, 0.82)'],
    [1, 'rgba(26, 36, 62, 0.52)'],
  ]);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
}

function drawStars(ts) {
  wxCtx.fillStyle = '#ffffff';
  for (const s of wxStars) {
    wxCtx.globalAlpha = s.base * (0.4 + 0.6 * Math.sin(ts * s.freq + s.phi));
    wxCtx.beginPath();
    wxCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    wxCtx.fill();
  }
  wxCtx.globalAlpha = 1;
}

function drawClouds(dt = 1) {
  const W = wxCanvas.width;
  for (const c of wxClouds) {
    wxCtx.globalAlpha = c.opac;
    // setTransform replaces translate+scale without save/restore overhead
    wxCtx.setTransform(c.scaleX, 0, 0, c.scaleY, c.x, c.y);
    wxCtx.drawImage(c.oc, -c.ocW * 0.5, -c.ocH * 0.5);
    c.x += c.speed * dt;
    if (c.x - c.ocW * c.scaleX * 0.5 > W + 20) {
      Object.assign(c, mkCloud(true, c.colorRgba));
    }
  }
  wxCtx.setTransform(1, 0, 0, 1, 0, 0); // reset to identity
  wxCtx.globalAlpha = 1;
}

function drawRain(dt = 1) {
  const H = wxCanvas.height;
  wxCtx.strokeStyle = '#a8d8ff';
  wxCtx.lineWidth = 1;
  for (const d of wxDrops) {
    wxCtx.globalAlpha = d.opac;
    wxCtx.beginPath();
    wxCtx.moveTo(d.x, d.y);
    wxCtx.lineTo(d.x + LEAN * d.len, d.y + d.len);
    wxCtx.stroke();
    d.y += d.speed * dt;
    d.x += LEAN * d.speed * 0.28 * dt;
    if (d.y > H + d.len) resetDrop(d);
  }
  wxCtx.globalAlpha = 1;
}

/* ── Snowflakes ───────────────────────────────────────────── */
function mkFlake() {
  return {
    x:         Math.random() * wxCanvas.width,
    y:         Math.random() * wxCanvas.height,
    r:         1.5 + Math.random() * 3.2,
    speed:     1.4 + Math.random() * 2.8,
    swayPhase: Math.random() * Math.PI * 2,
    swayFreq:  0.0008 + Math.random() * 0.0012,
    swayAmp:   18 + Math.random() * 28,
    opac:      0.55 + Math.random() * 0.40,
  };
}

function initFlakes() {
  wxFlakes = Array.from({ length: 120 }, mkFlake);
}

function drawSnowSky() {
  wxCtx.fillStyle = getSkyGrad('snow', [
    [0,   'rgba(50, 62,  95, 0.90)'],
    [0.5, 'rgba(62, 76, 108, 0.75)'],
    [1,   'rgba(78, 92, 122, 0.55)'],
  ]);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
}

function drawSnow(ts, dt = 1) {
  const H = wxCanvas.height;
  wxCtx.fillStyle = '#ffffff';
  for (const f of wxFlakes) {
    const sway = Math.sin(ts * f.swayFreq + f.swayPhase) * f.swayAmp;
    wxCtx.globalAlpha = f.opac;
    wxCtx.beginPath();
    wxCtx.arc(f.x + sway, f.y, f.r, 0, Math.PI * 2);
    wxCtx.fill();
    f.y += f.speed * dt;
    if (f.y > H + f.r) {
      f.x = Math.random() * wxCanvas.width;
      f.y = -f.r * 2;
    }
  }
  wxCtx.globalAlpha = 1;
}

/* ── Bolt (jagged line via midpoint displacement) ─────────── */
let boltOC    = null; // reused OffscreenCanvas, invalidated on resize
let boltAlpha = 0;

function genBolt(x1, y1, x2, y2, depth) {
  if (depth === 0) return [[x1, y1], [x2, y2]];
  const disp = (Math.random() - 0.5) * Math.abs(y2 - y1) * 0.55;
  const mx = (x1 + x2) / 2 + disp;
  const my = (y1 + y2) / 2;
  const L = genBolt(x1, y1, mx, my, depth - 1);
  const R = genBolt(mx, my, x2, y2, depth - 1);
  return [...L, ...R.slice(1)];
}

function renderBolt(pts) {
  const W = wxCanvas.width, H = wxCanvas.height;
  if (!boltOC || boltOC.width !== W || boltOC.height !== H) {
    boltOC = new OffscreenCanvas(W, H);
  }
  const bc = boltOC.getContext('2d');
  bc.clearRect(0, 0, W, H);
  bc.lineCap = bc.lineJoin = 'round';
  const sp = (lw, rgba) => {
    bc.lineWidth = lw;
    bc.strokeStyle = rgba;
    bc.beginPath();
    pts.forEach(([x, y], i) => i ? bc.lineTo(x, y) : bc.moveTo(x, y));
    bc.stroke();
  };
  // Glow layers: outer → inner
  sp(22, 'rgba(100,170,255,0.04)');
  sp(12, 'rgba(140,200,255,0.09)');
  sp(6,  'rgba(190,222,255,0.22)');
  sp(3,  'rgba(222,238,255,0.58)');
  sp(1.5,'rgba(248,253,255,0.94)');
}

/* ── Main loop ────────────────────────────────────────────── */
// Capped to ~30fps (Pi-class hardware): halves canvas redraw + backdrop-filter
// recomposite work under the glass panels. `dt` scales per-frame motion deltas
// so drops/clouds still cover the same distance per second as at 60fps — only
// the redraw rate drops, not the apparent speed. Time-based motion (star/snow
// sway, which already keys off wall-clock `ts`) needs no change.
const WX_FRAME_MS = 1000 / 30;
let wxLastFrameTs  = 0;

function drawFrame(ts = 0) {
  const elapsed = wxLastFrameTs ? ts - wxLastFrameTs : WX_FRAME_MS;
  if (elapsed < WX_FRAME_MS - 1) {
    wxAnimId = requestAnimationFrame(drawFrame);
    return;
  }
  const dt = elapsed / WX_FRAME_MS;
  wxLastFrameTs = ts;

  wxCtx.clearRect(0, 0, wxCanvas.width, wxCanvas.height);

  switch (wxMode) {
    case 'clear-day':
      drawDaySky();
      wxAnimId = null;
      return;               // static — no RAF loop needed

    case 'clear-night':
      drawNightSky();
      drawStars(ts);
      break;

    case 'cloudy-day':
      drawDaySky();
      drawClouds(dt);
      break;

    case 'cloudy-night':
      drawNightSky();
      drawStars(ts);
      drawClouds(dt);       // dark puffs occlude stars beneath them
      break;

    case 'overcast':
      drawOvercastSky();
      drawClouds(dt);
      break;

    case 'rain':
    case 'storm':
      drawRainSky();
      drawRain(dt);
      break;

    case 'snow':
      drawSnowSky();
      drawSnow(ts, dt);
      break;

    default:
      wxAnimId = null;
      return;
  }

  // Bolt overlays everything (storm mode only); JS controls boltAlpha
  if (boltOC && boltAlpha > 0) {
    wxCtx.globalAlpha = boltAlpha;
    wxCtx.drawImage(boltOC, 0, 0);
    wxCtx.globalAlpha = 1;
  }

  wxAnimId = requestAnimationFrame(drawFrame);
}

function startAnim() {
  if (wxAnimId) return;
  wxLastFrameTs = 0; // avoid a huge dt spike from time spent paused/hidden
  wxAnimId = requestAnimationFrame(drawFrame);
}

function stopAnim() {
  if (wxAnimId) { cancelAnimationFrame(wxAnimId); wxAnimId = null; }
  wxCtx.clearRect(0, 0, wxCanvas.width, wxCanvas.height);
}

/* ── Lightning — realistic multi-flash sequence ───────────── */
let lightTimer  = null;
const lightEl   = document.getElementById('lightning-flash');
const strikeIds = []; // timeout IDs so we can cancel mid-sequence

function setFlash(o) { lightEl.style.opacity = String(o); }

function clearStrike() {
  strikeIds.forEach(clearTimeout);
  strikeIds.length = 0;
  boltAlpha = 0;
  setFlash(0);
}

function triggerStrike() {
  const W = wxCanvas.width, H = wxCanvas.height;
  const sx = W * (0.15 + Math.random() * 0.70);
  const ex = sx + (Math.random() - 0.5) * W * 0.20;
  const ey = H * (0.38 + Math.random() * 0.40);
  renderBolt(genBolt(sx, 0, ex, ey, 5));

  // Phase 1 — pre-flash: subtle glow, eyes perceive motion
  boltAlpha = 0.20; setFlash(0.05);
  // Phase 2 — dark gap: sudden absence makes main flash feel more shocking
  strikeIds.push(setTimeout(() => { boltAlpha = 0; setFlash(0); }, 30));
  // Phase 3 — MAIN: sudden full brightness
  strikeIds.push(setTimeout(() => { boltAlpha = 1.0; setFlash(0.30); }, 58));
  // Phase 4 — first decay
  strikeIds.push(setTimeout(() => { boltAlpha = 0.55; setFlash(0.14); }, 120));
  // Phase 5 — clear; maybe trigger return stroke
  strikeIds.push(setTimeout(() => {
    boltAlpha = 0; setFlash(0);
    // 38% chance: secondary return stroke (same channel, dimmer, faster)
    if (Math.random() < 0.38) {
      const echoDelay = 70 + Math.random() * 120;
      strikeIds.push(setTimeout(() => {
        renderBolt(genBolt(
          sx + (Math.random() - 0.5) * 18, 0,
          ex + (Math.random() - 0.5) * 18, ey * (0.85 + Math.random() * 0.20), 4
        ));
        boltAlpha = 0.65; setFlash(0.18);
        strikeIds.push(setTimeout(() => { boltAlpha = 0.28; setFlash(0.07); }, 50));
        strikeIds.push(setTimeout(() => { boltAlpha = 0;    setFlash(0);    }, 95));
      }, echoDelay));
    }
  }, 175));
}

function scheduleLightning() {
  clearTimeout(lightTimer);
  if (wxMode !== 'storm') return;
  lightTimer = setTimeout(() => { triggerStrike(); scheduleLightning(); }, 5000 + Math.random() * 13000);
}

/* ── Apply mode ───────────────────────────────────────────── */
function applyWxMode(mode) {
  stopAnim();
  clearTimeout(lightTimer);
  clearStrike();
  wxMode = mode;
  document.body.dataset.wx = mode;

  wxCanvas.style.opacity =
    mode === 'clear-day'    ? '1.00' :
    mode === 'clear-night'  ? '0.90' :
    mode === 'cloudy-day'   ? '1.00' :
    mode === 'cloudy-night' ? '0.90' :
    mode === 'overcast'     ? '0.82' :
    mode === 'snow'         ? '0.88' : '0.72';

  if (mode === 'none') return;

  if (mode === 'clear-night' || mode === 'cloudy-night') initStars();
  if (mode === 'cloudy-day'  || mode === 'cloudy-night' || mode === 'overcast') initClouds();
  if (mode === 'rain'        || mode === 'storm') initDrops();
  if (mode === 'snow') initFlakes();

  startAnim();
  if (mode === 'storm') scheduleLightning();
}

/* ── Map NWS description → canvas mode ───────────────────── */
function setWxMode(desc) {
  const day = isCurrentlyDay();
  if (!desc) return applyWxMode(day ? 'clear-day' : 'clear-night');
  const d = desc.toLowerCase();
  if (d.includes('thunder') || d.includes('funnel'))
    return applyWxMode('storm');
  // Snow check BEFORE rain — "Snow Showers" contains "shower" and would false-match rain
  if (d.includes('snow') || d.includes('flurr') || d.includes('sleet') ||
      d.includes('blizzard') || d.includes('wintry') || d.includes('ice pellet') ||
      d.includes('ice crystal') || d.includes('ice storm'))
    return applyWxMode('snow');
  if (d.includes('rain') || d.includes('shower') || d.includes('drizzle'))
    return applyWxMode('rain');
  if (d.includes('overcast') || d.includes('fog') || d.includes('mist') ||
      d.includes('smoke') || d.includes('haze') || d.includes('dust') ||
      d.includes('sand') || d.includes('ash') || d.includes('spray') ||
      d.includes('mostly cloudy') || d.includes('considerable'))
    return applyWxMode('overcast');
  if (d.includes('cloud') || d.includes('partly') || d.includes('few') || d.includes('scattered'))
    return applyWxMode(day ? 'cloudy-day' : 'cloudy-night');
  applyWxMode(day ? 'clear-day' : 'clear-night');
}

window.addEventListener('resize', () => {
  resizeWxCanvas();
  boltOC   = null; // invalidate — wrong size
  daySkyOC = null; // invalidate pre-rendered day sky
  skyGrads = {};   // invalidate cached gradients
  applyWxMode(wxMode);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopAnim(); else if (wxMode !== 'none') startAnim();
});
resizeWxCanvas();

/* ══════════════════════════════════════════════════════════
   NWS WEATHER ALERTS
   ══════════════════════════════════════════════════════════ */
const ALERT_SEV  = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
const ALERT_CLS  = { Extreme: 'alert-extreme', Severe: 'alert-severe', Moderate: 'alert-moderate', Minor: 'alert-minor' };
const ALERT_ICON = { Extreme: '🚨', Severe: '🚨', Moderate: '⚠️', Minor: '💛' };

/* ── Alert sound & TTS ────────────────────────────────────── */
const getSoundEnabled = () => localStorage.getItem('alertSound') === 'true';
const getTtsEnabled   = () => localStorage.getItem('alertTts')   === 'true';

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playAlertSound() {
  if (!getSoundEnabled()) return;
  try {
    const ctx = getAudioCtx();
    const beep = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.01);
      gain.gain.setValueAtTime(0.22, start + dur - 0.02);
      gain.gain.linearRampToValueAtTime(0, start + dur);
      osc.start(start);
      osc.stop(start + dur);
    };
    const t = ctx.currentTime;
    beep(960, t,       0.18);
    beep(960, t + 0.25, 0.18);
    beep(960, t + 0.50, 0.18);
  } catch { /* AudioContext unavailable */ }
}

function speakAlerts(sorted) {
  if (!getTtsEnabled() || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const preamble = new SpeechSynthesisUtterance(
    'The National Weather Service has issued the following alert' +
    (sorted.length > 1 ? 's' : '') + '.'
  );
  preamble.rate = 0.92;
  window.speechSynthesis.speak(preamble);
  for (const f of sorted) {
    const p     = f.properties;
    const areas = p.areaDesc
      ? p.areaDesc.split(';').map(s => s.trim()).filter(Boolean).join(', ')
      : '';
    const text  = areas
      ? `${p.event} for ${areas}. ${p.headline || ''}`
      : `${p.event}. ${p.headline || ''}`;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    window.speechSynthesis.speak(u);
  }
}

/* ── Render alert banner (scrolling ticker) ───────────────── */
let lastAlertKey = '';

function renderAlerts(features) {
  const banner = document.getElementById('alert-banner');
  if (!features.length) {
    banner.hidden = true;
    lastAlertKey = '';
    return;
  }

  const sorted = [...features].sort((a, b) =>
    (ALERT_SEV[a.properties.severity] ?? 4) - (ALERT_SEV[b.properties.severity] ?? 4));

  // Detect new/changed alerts so we only sound once per change
  const key = sorted.map(f => f.properties.id || f.properties.event).join('|');
  const isNew = key !== lastAlertKey;
  lastAlertKey = key;

  banner.innerHTML = sorted.map(f => {
    const p        = f.properties;
    const cls      = ALERT_CLS[p.severity]  || 'alert-minor';
    const ico      = ALERT_ICON[p.severity] || '⚠️';
    const headline = p.headline || p.event;
    const areas    = p.areaDesc
      ? p.areaDesc.split(';').map(s => s.trim()).filter(Boolean).join(', ')
      : '';

    // Build ticker text; double it for seamless loop
    const core   = [p.event, headline, areas ? `Counties: ${areas}` : ''].filter(Boolean).join('  •  ');
    const doubled = `${core}     •     ${core}`;
    // ~0.085s per character gives a readable scroll pace
    const dur    = Math.max(14, core.length * 0.085).toFixed(1);

    return `<div class="alert-item ${cls}">
      <span class="alert-ico">${ico}</span>
      <div class="alert-ticker-wrap">
        <div class="alert-ticker-inner" style="animation-duration:${dur}s">${escHtml(doubled)}</div>
      </div>
    </div>`;
  }).join('');
  banner.hidden = false;

  if (isNew) {
    playAlertSound();
    setTimeout(() => speakAlerts(sorted), 1200); // beeps first, then voice
  }
}

async function fetchAlerts() {
  const z = getActiveZip();
  try {
    const r = await fetch(
      `https://api.weather.gov/alerts/active?point=${z.lat},${z.lon}`,
      { headers: { 'User-Agent': 'FamilyDashboard/1.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return;
    renderAlerts((await r.json()).features || []);
  } catch { /* best-effort, silent */ }
}

fetchAlerts();
setInterval(fetchAlerts, 5 * 60 * 1000);

/* ══════════════════════════════════════════════════════════
   WEATHER
   ══════════════════════════════════════════════════════════ */
// Open-Meteo: forecast only (rain chart + hi/lo + sunrise/sunset).
// Current conditions come from the NWS station instead (real sensor data).
function makeWxUrl(lat, lon) {
  return (
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=precipitation_probability` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&temperature_unit=fahrenheit` +
    `&timezone=America%2FChicago&forecast_days=1`
  );
}

// NWS KCRP = Corpus Christi International Airport weather station.
// This is actual sensor data — temperature, humidity, sky conditions — not a model.
const NWS_OBS_URL = 'https://api.weather.gov/stations/KCRP/observations/latest';

function cToF(c) {
  return (c != null && isFinite(c)) ? Math.round(c * 9 / 5 + 32) : null;
}

// Map NWS free-text descriptions to emoji, accounting for day vs. night
function nwsIcon(desc, isDay) {
  if (!desc) return '🌡️';
  const d = desc.toLowerCase();
  if (d.includes('thunder'))                                    return '⛈️';
  if (d.includes('freezing rain') || d.includes('ice pellet')) return '🌨️';
  if (d.includes('rain') || d.includes('shower') || d.includes('drizzle')) return '🌧️';
  if (d.includes('snow') || d.includes('sleet'))               return '❄️';
  if (d.includes('fog') || d.includes('mist') || d.includes('haze')) return '🌫️';
  if (d.includes('overcast') || d.includes('mostly cloudy'))   return '☁️';
  if (d.includes('partly') || d.includes('partly sunny'))      return isDay ? '⛅' : '☁️';
  if (d.includes('mostly clear') || d.includes('mostly sunny'))return isDay ? '🌤️' : '🌙';
  if (d.includes('clear') || d.includes('sunny') || d.includes('fair')) return isDay ? '☀️' : '🌙';
  if (d.includes('cloud'))                                      return isDay ? '⛅' : '☁️';
  return '🌡️';
}

function isCurrentlyDay() {
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  if (sunriseMins !== null && sunsetMins !== null)
    return nowM >= sunriseMins && nowM < sunsetMins;
  return nowM >= 7 * 60 && nowM < 19 * 60; // rough fallback before first fetch
}

async function fetchWeather() {
  const zipData = getActiveZip();
  document.getElementById('wx-neighborhood').textContent = `${zipData.name} · ${zipData.zip}`;

  // Run both requests in parallel.
  // NWS = real sensor at Corpus Christi airport; OM = model forecast for rain + hi/lo + sun times.
  const [nwsResult, omResult] = await Promise.allSettled([
    fetch(NWS_OBS_URL, {
      headers: { 'User-Agent': 'FamilyDashboard/1.0' },
      signal: AbortSignal.timeout(10000),
    }).then(r => r.ok ? r.json() : Promise.reject(new Error('NWS ' + r.status))),

    fetch(makeWxUrl(zipData.lat, zipData.lon), {
      signal: AbortSignal.timeout(10000),
    }).then(r => r.ok ? r.json() : Promise.reject(new Error('OM ' + r.status))),
  ]);

  // ── Current conditions from NWS (actual measured data) ──
  if (nwsResult.status === 'fulfilled') {
    const p     = nwsResult.value.properties;
    const tempF = cToF(p.temperature?.value);
    const hiF   = cToF(p.heatIndex?.value);
    const chiF  = cToF(p.windChill?.value);
    // Show "Feels X°" only when it meaningfully differs from air temp
    const feelsF = (hiF != null && hiF !== tempF) ? hiF
                 : (chiF != null && chiF !== tempF) ? chiF
                 : null;
    const desc  = p.textDescription || 'Unknown';

    document.getElementById('wx-icon').textContent  = nwsIcon(desc, isCurrentlyDay());
    document.getElementById('wx-temp').textContent  = (tempF != null ? tempF : '--') + '°';
    document.getElementById('wx-feels').textContent = feelsF != null ? `Feels ${feelsF}°` : '';
    document.getElementById('wx-desc').textContent  = desc;
    setWxMode(desc); // trigger rain / storm canvas animation

    // NWS timestamp is UTC; JS Date auto-converts to local (CDT)
    if (p.timestamp) {
      const t = new Date(p.timestamp).toLocaleTimeString('en-US',
        { hour: 'numeric', minute: '2-digit' });
      document.getElementById('wx-updated').textContent = `obs. ${t} · KCRP`;
    }
  } else {
    document.getElementById('wx-icon').textContent   = '🌡️';
    document.getElementById('wx-desc').textContent   = 'Station unavailable';
    document.getElementById('wx-updated').textContent = '';
  }

  // ── Forecast from Open-Meteo (hi/lo, rain chart, sunrise/sunset) ──
  if (omResult.status === 'fulfilled') {
    const d = omResult.value;

    if (d.daily?.sunrise?.[0] && d.daily?.sunset?.[0]) {
      const parseISO = iso => {
        const [hh, mm] = iso.split('T')[1].split(':').map(Number);
        return hh * 60 + mm;
      };
      sunriseMins = parseISO(d.daily.sunrise[0]);
      sunsetMins  = parseISO(d.daily.sunset[0]);
      applyTheme();
    }

    if (d.daily) {
      document.getElementById('wx-hi-lo').textContent =
        `Hi ${Math.round(d.daily.temperature_2m_max[0])}° / Lo ${Math.round(d.daily.temperature_2m_min[0])}°`;
    }

    if (d.hourly) renderRain(d.hourly);
  } else if (nwsResult.status === 'rejected') {
    document.getElementById('wx-desc').textContent = 'Weather unavailable';
    document.getElementById('wx-rain').innerHTML   = '';
  }
}

document.getElementById('wx-refresh').addEventListener('click', () => {
  location.reload();
});

function renderRain(hourly) {
  const container = document.getElementById('wx-rain');
  const now       = new Date();
  const nowH      = now.getHours();
  const todayPfx  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const hours = [];
  hourly.time.forEach((t, i) => {
    if (!t.startsWith(todayPfx)) return;
    const h = parseInt(t.split('T')[1]);
    if (h < 6 || h >= 22) return;           // show 6 AM – 10 PM
    hours.push({ hour: h, prob: hourly.precipitation_probability[i] });
  });

  if (!hours.length) { container.innerHTML = ''; return; }

  const windows = findRainWindows(hours, 30);
  let headline;
  if (!windows.length) {
    const maxP = Math.max(...hours.map(h => h.prob));
    headline = maxP >= 10 ? `🌂 Slight chance (${maxP}%)` : `☀️ No rain today`;
  } else {
    headline = '🌧 Rain: ' + windows
      .map(w => `${fmt12hHM(w.start, 0)}–${fmt12hHM(w.end, 0)} (${w.peak}%)`)
      .join(' · ');
  }

  const bars = hours.map(h => {
    const px    = Math.max(2, Math.round(h.prob * 0.32));
    const isNow = h.hour === nowH;
    return `<div class="rain-bar${isNow ? ' rain-now' : ''}"
               style="height:${px}px;opacity:${0.35 + h.prob * 0.006}"
               title="${fmt12hHM(h.hour, 0)}: ${h.prob}%"></div>`;
  }).join('');

  const labelArr = hours.map(h =>
    h.hour % 3 === 0
      ? `<span>${fmt12hHM(h.hour,0).replace(' AM','a').replace(' PM','p')}</span>`
      : '<span></span>'
  ).join('');

  container.innerHTML = `
    <span class="rain-headline">${headline}</span>
    <div class="rain-chart">
      <div class="rain-bars">${bars}</div>
      <div class="rain-x-labels">${labelArr}</div>
    </div>`;
}

function findRainWindows(hours, threshold) {
  const windows = [];
  let start = null, peak = 0;
  for (const h of hours) {
    if (h.prob >= threshold) {
      if (start === null) start = h.hour;
      peak = Math.max(peak, h.prob);
    } else if (start !== null) {
      windows.push({ start, end: h.hour, peak });
      start = null; peak = 0;
    }
  }
  if (start !== null) windows.push({ start, end: hours[hours.length-1].hour + 1, peak });
  return windows;
}

fetchWeather();
setInterval(fetchWeather, 10 * 60 * 1000);

/* ══════════════════════════════════════════════════════════
   SETTINGS PANEL
   ══════════════════════════════════════════════════════════ */
const settingsModal = document.getElementById('settings-modal');
const zipSelect     = document.getElementById('zip-select');

ZIP_CODES.forEach(z => {
  const opt = document.createElement('option');
  opt.value = z.zip;
  opt.textContent = `${z.zip} — ${z.name}`;
  zipSelect.appendChild(opt);
});
zipSelect.value = getActiveZip().zip;
updateZipCoords();

function updateZipCoords() {
  const z = getActiveZip();
  document.getElementById('zip-coords').textContent =
    `${z.lat.toFixed(4)}°N · ${Math.abs(z.lon).toFixed(4)}°W`;
}

zipSelect.addEventListener('change', () => {
  localStorage.setItem('wx_zip', zipSelect.value);
  updateZipCoords();
  fetchWeather();
  fetchAlerts();
});

document.getElementById('settings-btn').addEventListener('click', () => {
  zipSelect.value = getActiveZip().zip;
  updateZipCoords();
  applyTheme();
  document.getElementById('toggle-alert-sound').checked = getSoundEnabled();
  document.getElementById('toggle-alert-tts').checked   = getTtsEnabled();
  settingsModal.hidden = false;
});

document.getElementById('toggle-alert-sound').addEventListener('change', e => {
  localStorage.setItem('alertSound', e.target.checked);
});
document.getElementById('toggle-alert-tts').addEventListener('change', e => {
  localStorage.setItem('alertTts', e.target.checked);
});

document.getElementById('debug-wx-grid').addEventListener('click', e => {
  const btn = e.target.closest('.debug-wx-btn');
  if (!btn) return;
  applyWxMode(btn.dataset.mode);
  document.querySelectorAll('.debug-wx-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === btn.dataset.mode));
});

document.getElementById('debug-alert-grid').addEventListener('click', e => {
  const btn = e.target.closest('.debug-alert-btn');
  if (!btn) return;
  const { sev, event, headline } = btn.dataset;
  const DEFAULT_AREA = 'Nueces; San Patricio; Kleberg; Aransas';

  if (sev === 'none') {
    renderAlerts([]);
  } else if (sev === 'multi') {
    renderAlerts([
      { properties: { severity: 'Severe',   event: 'Severe Thunderstorm Warning', headline: 'Severe Thunderstorm Warning in effect until 6:30 PM CDT. Quarter-size hail and 70 mph winds.', areaDesc: 'Nueces; San Patricio; Kleberg' } },
      { properties: { severity: 'Moderate', event: 'Flash Flood Watch',            headline: 'Flash Flood Watch in effect through tomorrow morning. Heavy rainfall may produce flash flooding.', areaDesc: 'Nueces; San Patricio; Bee; Kleberg; Aransas' } },
    ]);
  } else {
    renderAlerts([{ properties: { severity: sev, event, headline, areaDesc: DEFAULT_AREA } }]);
  }
  document.querySelectorAll('.debug-alert-btn').forEach(b =>
    b.classList.toggle('active', b === btn && sev !== 'none'));
});
document.getElementById('settings-close').addEventListener('click', () => { settingsModal.hidden = true; });
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.hidden = true; });

/* ── Debug submenu (opened from Settings) ─────────────────── */
const debugModal = document.getElementById('debug-modal');

document.getElementById('debug-open-btn').addEventListener('click', () => {
  document.querySelectorAll('.debug-wx-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === wxMode));
  document.getElementById('toggle-perf-overlay').checked = getPerfOverlayEnabled();
  settingsModal.hidden = true;
  debugModal.hidden = false;
});

document.getElementById('debug-close').addEventListener('click', () => {
  debugModal.hidden = true;
  settingsModal.hidden = false;
});
debugModal.addEventListener('click', e => {
  if (e.target !== debugModal) return;
  debugModal.hidden = true;
  settingsModal.hidden = false;
});

/* ══════════════════════════════════════════════════════════
   DEBUG: PERFORMANCE OVERLAY
   FPS is measured client-side (independent rAF tick, separate from the
   weather canvas's own throttled loop). CPU/MEM/disk/temp/GPU come from
   /api/sysstats, since browsers have no OS-level access to those.
   ══════════════════════════════════════════════════════════ */
const perfOverlay = document.getElementById('perf-overlay');
const getPerfOverlayEnabled = () => localStorage.getItem('debugPerfOverlay') === 'true';

let perfFrameCount = 0;
let perfFpsLastTs  = 0;
let perfFps        = 0;
let perfRafId      = null;
let perfPollId     = null;
let perfLastStats  = null;

function perfFrameTick(ts) {
  perfFrameCount++;
  if (!perfFpsLastTs) perfFpsLastTs = ts;
  const elapsed = ts - perfFpsLastTs;
  if (elapsed >= 1000) {
    perfFps = Math.round((perfFrameCount * 1000) / elapsed);
    perfFrameCount = 0;
    perfFpsLastTs  = ts;
    renderPerfOverlay();
  }
  perfRafId = requestAnimationFrame(perfFrameTick);
}

function fmtGB(bytes) {
  return bytes == null ? null : (bytes / (1024 ** 3)).toFixed(1);
}

function fmtMB(bytes) {
  return bytes == null ? null : Math.round(bytes / (1024 ** 2));
}

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function renderPerfOverlay() {
  const s = perfLastStats;

  const memPct  = s?.mem  ? Math.round(s.mem.usedBytes  / s.mem.totalBytes  * 100) : null;
  const diskPct = s?.disk ? Math.round(s.disk.usedBytes / s.disk.totalBytes * 100) : null;

  const lines = [
    `FPS:   ${perfFps}`,
    `CPU:   ${s?.cpuPercent != null ? s.cpuPercent.toFixed(1) + '%' : 'N/A'}`,
    `MEM:   ${s?.mem  ? `${fmtGB(s.mem.usedBytes)} / ${fmtGB(s.mem.totalBytes)} GB (${memPct}%) [whole device]` : 'N/A'}`,
    `APP:   ${s?.appMem?.rssBytes != null ? `${fmtMB(s.appMem.rssBytes)} MB [this server process]` : 'N/A'}`,
    `DISK:  ${s?.disk ? `${fmtGB(s.disk.usedBytes)} / ${fmtGB(s.disk.totalBytes)} GB (${diskPct}%)` : 'N/A'}`,
    `TEMP:  ${s?.tempC != null ? s.tempC.toFixed(1) + '°C' : 'N/A'}`,
    `GPU:   ${s?.gpu ? [
      s.gpu.memMB   != null ? `${s.gpu.memMB}MB mem` : null,
      s.gpu.coreMHz != null ? `${s.gpu.coreMHz}MHz`  : null,
    ].filter(Boolean).join(' · ') || 'N/A' : 'N/A (no vcgencmd)'}`,
  ];
  if (s?.gpu?.throttled != null) lines.push(`THROTTLED: ${s.gpu.throttled ? 'YES ⚠️' : 'No'}`);
  if (s?.uptimeSec != null)      lines.push(`UPTIME: ${fmtUptime(s.uptimeSec)}`);

  perfOverlay.textContent = lines.join('\n');
}

async function pollPerfStats() {
  try { perfLastStats = await api('GET', '/api/sysstats'); }
  catch { perfLastStats = null; }
  renderPerfOverlay();
}

// Anchored below the settings button rather than a fixed offset — that
// button stretches to the top bar's full height (flex align-items:stretch),
// so this reliably clears the whole header instead of covering the gear icon.
function positionPerfOverlay() {
  const r = document.getElementById('settings-btn').getBoundingClientRect();
  perfOverlay.style.top   = `${Math.round(r.bottom) + 8}px`;
  perfOverlay.style.right = '12px';
}
window.addEventListener('resize', () => { if (!perfOverlay.hidden) positionPerfOverlay(); });

function startPerfOverlay() {
  positionPerfOverlay();
  perfOverlay.hidden = false;
  perfFrameCount = 0;
  perfFpsLastTs  = 0;
  if (!perfRafId)  perfRafId  = requestAnimationFrame(perfFrameTick);
  if (!perfPollId) perfPollId = setInterval(pollPerfStats, 2000);
  pollPerfStats();
}

function stopPerfOverlay() {
  perfOverlay.hidden = true;
  if (perfRafId)  { cancelAnimationFrame(perfRafId); perfRafId = null; }
  if (perfPollId) { clearInterval(perfPollId); perfPollId = null; }
}

document.getElementById('toggle-perf-overlay').addEventListener('change', e => {
  localStorage.setItem('debugPerfOverlay', e.target.checked);
  if (e.target.checked) startPerfOverlay(); else stopPerfOverlay();
});

if (getPerfOverlayEnabled()) startPerfOverlay();

/* ══════════════════════════════════════════════════════════
   CALENDAR — helpers
   ══════════════════════════════════════════════════════════ */
function getWeekStart(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function todayYMD() { return toYMD(new Date()); }

/* ══════════════════════════════════════════════════════════
   CALENDAR — load (dispatches to day / week / month view)
   ══════════════════════════════════════════════════════════ */
function getDayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + viewOffset);
  return d;
}

// Identifies "what should be on screen" (view + offset + calendar day, so a
// midnight rollover still forces a rebuild even if view/offset are unchanged).
// Rebuilding the grid DOM (up to 168 elements) and re-placing event chips is
// real reflow cost on Pi-class hardware — skip both unless something that
// would actually change the rendered output has changed since last poll.
let _lastCalKey    = null;
let _lastEventsSig = null;
function eventsSig(events) {
  return events.map(e => e.id).sort((a, b) => a - b).join(',');
}

async function loadCalendar() {
  const isMonth = calView === 'month';
  document.getElementById('cal-month-grid').style.display   = isMonth ? 'grid' : 'none';
  document.getElementById('cal-allday-strip').style.display = isMonth ? 'none' : 'flex';
  document.getElementById('cal-body-scroll').style.display  = isMonth ? 'none' : 'flex';

  const calKey           = `${calView}|${viewOffset}|${todayYMD()}`;
  const structureChanged = calKey !== _lastCalKey;

  if (isMonth) { await loadMonthView(structureChanged, calKey); return; }

  const numDays = calView === 'day' ? 1 : 7;
  const start   = calView === 'day' ? getDayStart() : getWeekStart(viewOffset);
  const end     = addDays(start, numDays - 1);

  if (structureChanged) {
    setCalLabel(start, end);
    buildCalStructure(start, numDays);
    scrollToNow();
    _lastCalKey = calKey;
  }

  let events;
  try {
    events = await api('GET', `/api/calendar?start=${toYMD(start)}&end=${toYMD(end)}`);
  } catch { events = []; }

  const sig = eventsSig(events);
  if (structureChanged || sig !== _lastEventsSig) {
    calEvents = events;
    fillCalEvents(calEvents);
    _lastEventsSig = sig;
  }
}

function setCalLabel(start, end) {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MLONG = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
  let text;
  if (calView === 'day') {
    const DN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    text = `${DN[start.getDay()]}, ${M[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()}`;
  } else if (calView === 'month') {
    text = `${MLONG[start.getMonth()]} ${start.getFullYear()}`;
  } else {
    const sm = start.getMonth() === end.getMonth();
    text = sm
      ? `${M[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`
      : `${M[start.getMonth()]} ${start.getDate()} – ${M[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }
  document.getElementById('cal-week-label').textContent = text;
}

/* ── Build grid skeleton (no events) ─────────────────────── */
function buildCalStructure(weekStart, numDays = 7) {
  const today = todayYMD();
  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const days  = Array.from({ length: numDays }, (_, i) => addDays(weekStart, i));
  const totalHours = CAL_END - CAL_START; // 24

  // Day-name header row
  const hdr = document.getElementById('cal-header');
  hdr.innerHTML = '<div class="cal-gutter-hdr"></div>';
  days.forEach(d => {
    const ymd  = toYMD(d);
    const cell = document.createElement('div');
    cell.className = 'cal-day-hdr' + (ymd === today ? ' is-today' : '');
    cell.innerHTML = `<div class="hdr-name">${DAYS[d.getDay()]}</div>
                      <div class="hdr-num">${d.getDate()}</div>`;
    hdr.appendChild(cell);
  });

  // All-day strip (chips added by fillCalEvents)
  const strip = document.getElementById('cal-allday-strip');
  strip.innerHTML = '<div class="cal-gutter-allday"><span>all‑day</span></div>';
  days.forEach(d => {
    const col = document.createElement('div');
    col.className  = 'cal-allday-col';
    col.dataset.date = toYMD(d);
    strip.appendChild(col);
  });

  // Time gutter (24 labels, midnight–11 PM)
  const gutter = document.getElementById('cal-time-gutter');
  gutter.innerHTML = '';
  for (let h = CAL_START; h < CAL_END; h++) {
    const lbl = document.createElement('div');
    lbl.className   = 'cal-hour-label';
    lbl.textContent = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
    gutter.appendChild(lbl);
  }

  // Day columns — explicit height ensures vertical lines run the full grid
  const daysEl = document.getElementById('cal-days');
  daysEl.innerHTML = '';
  const colHeight = `${totalHours * HOUR_PX}px`;

  days.forEach(d => {
    const ymd = toYMD(d);
    const col = document.createElement('div');
    col.className    = 'cal-day-col' + (ymd === today ? ' is-today' : '');
    col.dataset.date = ymd;
    col.style.minHeight = colHeight; // guarantees border-left runs full height

    for (let h = CAL_START; h < CAL_END; h++) {
      const row = document.createElement('div');
      row.className = 'cal-hour-row';
      col.appendChild(row);
    }
    daysEl.appendChild(col);
  });
}

/* ── Place events into rendered columns ───────────────────── */
function fillCalEvents(events) {
  document.querySelectorAll('.cal-event').forEach(el => el.remove());
  document.querySelectorAll('.allday-chip').forEach(el => el.remove());

  // Sort into all-day vs timed, per day
  const byDate = {};
  events.forEach(ev => {
    const isAllDay = ev.all_day || !ev.start_time;
    const key = ev.display_date;
    if (!byDate[key]) byDate[key] = { allDay: [], timed: [] };
    if (isAllDay) byDate[key].allDay.push(ev);
    else          byDate[key].timed.push(ev);
  });

  Object.entries(byDate).forEach(([date, { allDay, timed }]) => {
    // All-day chips
    const adCol = document.querySelector(`.cal-allday-col[data-date="${date}"]`);
    if (adCol) {
      allDay.forEach(ev => {
        const chip = document.createElement('div');
        chip.className = 'allday-chip';
        chip.style.background = ev.color;
        chip.textContent = ev.title;
        chip.addEventListener('click', () => showEventDetail(ev));
        adCol.appendChild(chip);
      });
    }

    // Timed events with overlap layout
    const dayCol = document.querySelector(`.cal-day-col[data-date="${date}"]`);
    if (dayCol) layoutEvents(timed).forEach(ev => placeEventBlock(dayCol, ev));
  });

  updateNowLine();
}

function placeEventBlock(col, ev) {
  const startMins = timeToMins(ev.start_time);
  const endMins   = timeToMins(ev.end_time || addOneHour(ev.start_time));
  const gridStart = CAL_START * 60; // 0

  if (endMins <= gridStart || startMins >= CAL_END * 60) return;

  const topPx    = Math.max(0, (startMins - gridStart) / 60 * HOUR_PX);
  const heightPx = Math.max(22,
    (Math.min(endMins, CAL_END * 60) - Math.max(startMins, gridStart)) / 60 * HOUR_PX);

  const el = document.createElement('div');
  el.className = 'cal-event';
  el.style.cssText =
    `top:${topPx}px;height:${heightPx}px;` +
    `left:calc(${ev._left}% + 2px);width:calc(${ev._width}% - 4px);` +
    `background:${ev.color};`;

  const showTime   = heightPx >= 36;
  const showPerson = heightPx >= 50 && ev.person;
  el.innerHTML =
    `<div class="ev-title">${escHtml(ev.title)}</div>` +
    (showTime   ? `<div class="ev-time">${fmt12h(ev.start_time)}${ev.end_time ? ' – ' + fmt12h(ev.end_time) : ''}</div>` : '') +
    (showPerson ? `<div class="ev-person">${escHtml(ev.person)}</div>` : '');

  el.addEventListener('click', () => showEventDetail(ev));
  col.appendChild(el);
}

/* ── Overlap layout ───────────────────────────────────────── */
function layoutEvents(events) {
  if (!events.length) return [];
  const sorted = [...events].sort((a, b) =>
    (a.start_time || '00:00') < (b.start_time || '00:00') ? -1 : 1);
  const slots = [];
  const evCols = sorted.map(ev => {
    const s = ev.start_time || '00:00';
    const e = ev.end_time   || addOneHour(s);
    let col = 0;
    while (col < slots.length && slots[col] > s) col++;
    slots[col] = e;
    return { ev, col };
  });
  return evCols.map(({ ev, col }) => {
    const s = ev.start_time || '00:00';
    const e = ev.end_time   || addOneHour(s);
    const concurrent = evCols.filter(({ ev: ev2 }) => {
      const s2 = ev2.start_time || '00:00';
      const e2 = ev2.end_time   || addOneHour(s2);
      return s2 < e && e2 > s;
    });
    const numCols = Math.max(...concurrent.map(c => c.col)) + 1;
    return { ...ev, _left: (col / numCols) * 100, _width: (1 / numCols) * 100 };
  });
}

/* ── Month view ───────────────────────────────────────────── */
async function loadMonthView(structureChanged, calKey) {
  const pivot = new Date();
  pivot.setDate(1);
  pivot.setHours(0, 0, 0, 0);
  pivot.setMonth(pivot.getMonth() + viewOffset);
  const year    = pivot.getFullYear();
  const month   = pivot.getMonth();
  const lastDay = new Date(year, month + 1, 0);

  if (structureChanged) {
    setCalLabel(pivot, lastDay);
    buildMonthStructure(year, month);
    _lastCalKey = calKey;
  }

  let events;
  try {
    events = await api('GET', `/api/calendar?start=${toYMD(pivot)}&end=${toYMD(lastDay)}`);
  } catch { events = []; }

  const sig = eventsSig(events);
  if (structureChanged || sig !== _lastEventsSig) {
    calEvents = events;
    fillMonthEvents(calEvents);
    _lastEventsSig = sig;
  }
}

function buildMonthStructure(year, month) {
  const today = todayYMD();
  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Reuse cal-header for day-name row (no gutter in month view — grid starts at col 1)
  const hdr = document.getElementById('cal-header');
  hdr.innerHTML = '';
  DAYS.forEach(name => {
    const cell = document.createElement('div');
    cell.className = 'cal-day-hdr';
    cell.innerHTML = `<div class="hdr-name">${name}</div>`;
    hdr.appendChild(cell);
  });

  const firstDay  = new Date(year, month, 1);
  const startDow  = firstDay.getDay();
  const daysInMo  = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startDow + daysInMo) / 7) * 7;

  const grid = document.getElementById('cal-month-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateRows = `repeat(${totalCells / 7}, minmax(0, 1fr))`;

  for (let i = 0; i < totalCells; i++) {
    const d   = new Date(year, month, 1 + i - startDow);
    const ymd = toYMD(d);
    const thisMonth = d.getMonth() === month;
    const cell = document.createElement('div');
    cell.className = 'cal-month-cell' +
      (ymd === today   ? ' is-today'    : '') +
      (!thisMonth      ? ' other-month' : '');
    cell.dataset.date = ymd;
    cell.innerHTML = `<div class="cal-month-date">${d.getDate()}</div>
                      <div class="cal-month-events"></div>`;
    grid.appendChild(cell);
  }
}

function fillMonthEvents(events) {
  document.querySelectorAll('.cal-month-chip').forEach(el => el.remove());
  events.forEach(ev => {
    const cell = document.querySelector(`.cal-month-cell[data-date="${ev.display_date}"]`);
    if (!cell) return;
    const container = cell.querySelector('.cal-month-events');
    const chip = document.createElement('div');
    chip.className = 'cal-month-chip';
    chip.style.background = ev.color;
    chip.textContent = (ev.all_day || !ev.start_time)
      ? ev.title
      : `${fmt12h(ev.start_time)} ${ev.title}`;
    chip.addEventListener('click', () => showEventDetail(ev));
    container.appendChild(chip);
  });
}

/* ── Current time line ────────────────────────────────────── */
function updateNowLine() {
  document.querySelectorAll('.cal-now-line').forEach(el => el.remove());
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  // 24-hour grid: always visible
  const col = document.querySelector(`.cal-day-col[data-date="${todayYMD()}"]`);
  if (!col) return;
  const topPx = ((h - CAL_START) + m / 60) * HOUR_PX;
  const line  = document.createElement('div');
  line.className = 'cal-now-line';
  line.style.top = `${topPx}px`;
  col.appendChild(line);
}

function scrollToNow() {
  const scroll = document.getElementById('cal-body-scroll');
  const h = new Date().getHours();
  // Scroll so the previous hour is visible at the top
  scroll.scrollTop = Math.max(0, (h - CAL_START - 1) * HOUR_PX);
}

setInterval(updateNowLine, 60000);
setInterval(loadCalendar, REFRESH_MS);

document.getElementById('cal-prev').addEventListener('click',  () => { viewOffset--; loadCalendar(); });
document.getElementById('cal-next').addEventListener('click',  () => { viewOffset++; loadCalendar(); });
document.getElementById('cal-today').addEventListener('click', () => { viewOffset = 0; loadCalendar(); });

document.getElementById('cal-view-btns').addEventListener('click', e => {
  const btn = e.target.closest('.cal-view-btn');
  if (!btn || btn.dataset.view === calView) return;
  calView     = btn.dataset.view;
  viewOffset  = 0;
  document.querySelectorAll('.cal-view-btn').forEach(b =>
    b.classList.toggle('active', b === btn));
  loadCalendar();
});

/* ══════════════════════════════════════════════════════════
   ADD EVENT MODAL
   ══════════════════════════════════════════════════════════ */
const addModal   = document.getElementById('add-modal');
const addForm    = document.getElementById('add-event-form');
const recurSel   = document.getElementById('ev-recur');
const untilRow   = document.getElementById('ev-until-row');
const allDayCbx  = document.getElementById('ev-allday');
const timeFields = document.getElementById('ev-time-fields');

// Color swatches
const swatchContainer = document.getElementById('color-swatches');
COLORS.forEach((c, i) => {
  const s = document.createElement('div');
  s.className = 'color-swatch' + (i === 0 ? ' selected' : '');
  s.style.background = c.hex;
  s.title = c.name;
  s.addEventListener('click', () => {
    swatchContainer.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
    s.classList.add('selected');
    selectedColor = c.hex;
  });
  swatchContainer.appendChild(s);
});

recurSel.addEventListener('change', () => {
  untilRow.style.display = recurSel.value !== 'none' ? 'flex' : 'none';
});

allDayCbx.addEventListener('change', () => {
  timeFields.style.display = allDayCbx.checked ? 'none' : 'flex';
});

document.getElementById('cal-add-btn').addEventListener('click', () => {
  document.getElementById('ev-date').value = toYMD(new Date());
  addModal.hidden = false;
  document.getElementById('ev-title').focus();
});

function closeAddModal() {
  addModal.hidden = true;
  addForm.reset();
  untilRow.style.display   = 'none';
  timeFields.style.display = 'flex';
  swatchContainer.querySelectorAll('.color-swatch').forEach((el, i) =>
    el.classList.toggle('selected', i === 0));
  selectedColor = COLORS[0].hex;
}

document.getElementById('add-modal-cancel').addEventListener('click', closeAddModal);
addModal.addEventListener('click', e => { if (e.target === addModal) closeAddModal(); });

addForm.addEventListener('submit', async e => {
  e.preventDefault();
  const submitBtn = addForm.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';
  try {
    await api('POST', '/api/calendar', {
      title:            document.getElementById('ev-title').value.trim(),
      person:           document.getElementById('ev-person').value.trim(),
      color:            selectedColor,
      event_date:       document.getElementById('ev-date').value,
      start_time:       allDayCbx.checked ? null : (document.getElementById('ev-start').value || null),
      end_time:         allDayCbx.checked ? null : (document.getElementById('ev-end').value   || null),
      all_day:          allDayCbx.checked,
      recurrence:       recurSel.value,
      recurrence_until: recurSel.value !== 'none' ? (document.getElementById('ev-until').value || null) : null,
    });
    closeAddModal();
    loadCalendar();
  } catch (err) {
    showError('Could not save event: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Event';
  }
});

/* ══════════════════════════════════════════════════════════
   EVENT DETAIL MODAL
   ══════════════════════════════════════════════════════════ */
const detailModal = document.getElementById('detail-modal');

function showEventDetail(ev) {
  detailEventId = ev.id;
  document.getElementById('detail-color-bar').style.background = ev.color;
  document.getElementById('detail-title').textContent = ev.title;

  const [y, m, d] = ev.display_date.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dateFmt = dateObj.toLocaleDateString('en-US',
    { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  let info = `<strong>Date:</strong> ${dateFmt}<br>`;
  if (ev.start_time) {
    info += `<strong>Time:</strong> ${fmt12h(ev.start_time)}`;
    if (ev.end_time) info += ` – ${fmt12h(ev.end_time)}`;
    info += '<br>';
  } else {
    info += `<strong>Time:</strong> All day<br>`;
  }
  if (ev.person) info += `<strong>Person:</strong> ${escHtml(ev.person)}<br>`;

  const recurLabels = { daily:'Repeats daily', weekly:'Repeats weekly',
                        monthly:'Repeats monthly', yearly:'Repeats yearly' };
  if (ev.recurrence && ev.recurrence !== 'none') {
    info += `<strong>Recurrence:</strong> ${recurLabels[ev.recurrence]}<br>`;
    document.getElementById('detail-delete').textContent = 'Delete All Occurrences';
  } else {
    document.getElementById('detail-delete').textContent = 'Delete Event';
  }

  document.getElementById('detail-body').innerHTML = info;
  detailModal.hidden = false;
}

document.getElementById('detail-close').addEventListener('click', () => { detailModal.hidden = true; });
detailModal.addEventListener('click', e => { if (e.target === detailModal) detailModal.hidden = true; });
document.getElementById('detail-delete').addEventListener('click', async () => {
  if (!detailEventId) return;
  try {
    await api('DELETE', `/api/calendar/${detailEventId}`);
    detailModal.hidden = true;
    loadCalendar();
  } catch (err) { showError('Delete failed: ' + err.message); }
});

/* ══════════════════════════════════════════════════════════
   TODO LIST
   ══════════════════════════════════════════════════════════ */
const todoList     = document.getElementById('todo-list');
const clearDoneBtn = document.getElementById('clear-done');

function renderTodo(items) {
  todoList.innerHTML = '';
  clearDoneBtn.style.display = items.some(i => i.done) ? 'block' : 'none';
  if (!items.length) {
    todoList.innerHTML = '<li class="empty">Nothing here yet — add a task above</li>';
    return;
  }
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'todo-item' + (item.done ? ' done' : '');
    li.innerHTML = `<label><input type="checkbox" ${item.done ? 'checked' : ''} />
        <span>${escHtml(item.text)}</span></label>
      <button class="btn-delete" title="Delete">✕</button>`;
    li.querySelector('input').addEventListener('change', async e => {
      try { await api('PATCH', `/api/todo/${item.id}`, { done: e.target.checked }); loadTodo(); }
      catch (err) { showError('Update failed: ' + err.message); }
    });
    li.querySelector('.btn-delete').addEventListener('click', async () => {
      try { await api('DELETE', `/api/todo/${item.id}`); loadTodo(); }
      catch (err) { showError('Delete failed: ' + err.message); }
    });
    todoList.appendChild(li);
  });
}

async function loadTodo() {
  try { renderTodo(await api('GET', '/api/todo')); } catch { /* server briefly unavailable */ }
}

document.getElementById('todo-form').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('todo-input');
  const text  = input.value.trim();
  if (!text) return;
  const btn = e.target.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    await api('POST', '/api/todo', { text });
    input.value = '';
    loadTodo();
  } catch (err) {
    showError('Could not add task: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

clearDoneBtn.addEventListener('click', async () => {
  try { await api('DELETE', '/api/todo/done/all'); loadTodo(); }
  catch (err) { showError(err.message); }
});

loadTodo();
setTimeout(() => setInterval(loadTodo, REFRESH_MS), Math.floor(REFRESH_MS / 3));

/* ══════════════════════════════════════════════════════════
   BULLETIN BOARD
   ══════════════════════════════════════════════════════════ */
const bulletinList = document.getElementById('bulletin-list');

function renderBulletin(posts) {
  bulletinList.innerHTML = '';
  if (!posts.length) {
    bulletinList.innerHTML = '<li class="empty">No posts yet</li>';
    return;
  }
  posts.forEach(post => {
    const li = document.createElement('li');
    li.className = 'bulletin-item';
    li.innerHTML = `
      <div class="bul-header">
        <span class="bul-author">${escHtml(post.author)}</span>
        <span class="bul-time">${timeAgo(post.created_at)}</span>
      </div>
      <div class="bul-msg">${escHtml(post.message)}</div>
      <div class="bul-footer"><button class="btn-delete">✕</button></div>`;
    li.querySelector('.btn-delete').addEventListener('click', async () => {
      try { await api('DELETE', `/api/bulletin/${post.id}`); loadBulletin(); }
      catch (err) { showError(err.message); }
    });
    bulletinList.appendChild(li);
  });
}

async function loadBulletin() {
  try { renderBulletin(await api('GET', '/api/bulletin')); } catch { /* silent */ }
}

document.getElementById('bulletin-form').addEventListener('submit', async e => {
  e.preventDefault();
  const author  = document.getElementById('bulletin-author').value.trim() || 'Anonymous';
  const message = document.getElementById('bulletin-msg').value.trim();
  if (!message) return;
  const btn = e.target.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    await api('POST', '/api/bulletin', { author, message });
    document.getElementById('bulletin-msg').value = '';
    loadBulletin();
  } catch (err) {
    showError('Could not post: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

loadBulletin();
setTimeout(() => setInterval(loadBulletin, REFRESH_MS), Math.floor(2 * REFRESH_MS / 3));

/* ── Service worker ───────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* ── Boot ─────────────────────────────────────────────────── */
loadCalendar();
