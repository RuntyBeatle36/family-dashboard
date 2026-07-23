/* ═══════════════════════════════════════════════════════════
   Family Dashboard — app.js
   ═══════════════════════════════════════════════════════════ */

/* ── Calendar constants ───────────────────────────────────── */
const CAL_START  = 0;       // midnight — full 24-hour view
const CAL_END    = 24;      // 24 rows (hours 0–23)
const HOUR_PX    = 64;      // pixels per hour
const REFRESH_MS = 15000;

/* ── Weather location ─────────────────────────────────────── */
// Corpus Christi neighborhood zips get a fast, no-network lookup (this app
// was built for a Corpus Christi household); any other US zip or a
// geolocation fix is resolved on demand via geocodeZip()/detectGeolocation()
// + resolveNwsStation() below. Coordinates are the approximate geographic
// center of each ZIP.
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

// All Corpus Christi zips share one station (KCRP, the local airport) —
// hardcoded here so the common case (nobody ever opens Weather Location
// settings) resolves instantly with zero network round-trip, matching the
// app's original behavior exactly.
const DEFAULT_LOCATION = (() => {
  const z = ZIP_CODES.find(z => z.zip === '78414');
  return { lat: z.lat, lon: z.lon, zip: z.zip, city: 'Corpus Christi', detail: `${z.name} · ${z.zip}`, stationId: 'KCRP' };
})();

function getActiveLocation() {
  const saved = localStorage.getItem('wx_location');
  if (saved) {
    try {
      const loc = JSON.parse(saved);
      if (loc && typeof loc.lat === 'number' && typeof loc.lon === 'number') return loc;
    } catch { /* fall through to defaults below */ }
  }
  // Back-compat: earlier versions only stored a Corpus Christi zip.
  const oldZip = localStorage.getItem('wx_zip');
  const z = oldZip && ZIP_CODES.find(z => z.zip === oldZip);
  if (z) return { lat: z.lat, lon: z.lon, zip: z.zip, city: 'Corpus Christi', detail: `${z.name} · ${z.zip}`, stationId: 'KCRP' };
  return DEFAULT_LOCATION;
}

function setActiveLocation(loc) {
  localStorage.setItem('wx_location', JSON.stringify(loc));
  localStorage.removeItem('wx_zip'); // superseded by wx_location
}

// Resolves any US lat/lon to its nearest NWS observation station plus a
// human-readable "City, ST" label — this is what lets current-conditions
// data work anywhere in the US, not just at the hardcoded KCRP station this
// app originally shipped with.
async function resolveNwsStation(lat, lon) {
  const pr = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: { 'User-Agent': 'FamilyDashboard/1.0' }, signal: AbortSignal.timeout(8000),
  });
  if (!pr.ok) throw new Error('Location not recognized by the National Weather Service');
  const pd  = await pr.json();
  const rel = pd.properties?.relativeLocation?.properties;
  const label = rel?.city && rel?.state ? `${rel.city}, ${rel.state}` : null;

  const sr = await fetch(pd.properties.observationStations, {
    headers: { 'User-Agent': 'FamilyDashboard/1.0' }, signal: AbortSignal.timeout(8000),
  });
  if (!sr.ok) throw new Error('Could not find a nearby weather station');
  const sd = await sr.json();
  const stationId = sd.features?.[0]?.properties?.stationIdentifier || null;

  return { stationId, label };
}

// Zip → {lat, lon, city, detail}. Corpus Christi zips resolve locally
// (no network); anything else goes through Zippopotam.us (free, no API key).
async function geocodeZip(zip) {
  const local = ZIP_CODES.find(z => z.zip === zip);
  if (local) return { lat: local.lat, lon: local.lon, zip: local.zip, city: 'Corpus Christi', detail: `${local.name} · ${local.zip}` };

  const r = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Zip code not found');
  const d = await r.json();
  const place = d.places?.[0];
  if (!place) throw new Error('Zip code not found');
  return {
    lat: parseFloat(place.latitude),
    lon: parseFloat(place.longitude),
    zip,
    city: `${place['place name']}, ${place['state abbreviation']}`,
    detail: zip,
  };
}

function detectGeolocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation is not supported by this browser')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(new Error(err.message || 'Location access denied')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  });
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
// Week/Month need room for 7 columns; on a phone-width screen there simply
// isn't any, so default to Day view there instead of an unreadably squeezed
// week grid. (Only affects the initial view — tapping Week/Month still works.)
let calView = window.matchMedia('(max-width: 700px)').matches ? 'day' : 'month';
let viewOffset    = 0;      // days / weeks / months from today, depending on calView
let calEvents     = [];
let detailEventId   = null;
let detailEventDate = null; // display_date of the occurrence currently shown
let detailEventFull = null; // full event object currently shown, for Edit
let editingEventId  = null; // set while the Add Event form is reused for editing
let selectedColor = COLORS[0].hex;

/* ══════════════════════════════════════════════════════════
   EVENT PRIVACY + LOCK SCREEN
   Private events only ever read as "Private event" on the Lock Screen's
   agenda — once you've tapped through to the actual dashboard, events show
   normally there (you deliberately opened it; no need to keep masking).
   Tapping ANYWHERE opens the full dashboard for a configurable while, then
   automatically returns to the Lock Screen. Deliberately no per-event
   reveal target: a family member who won't remember "which thing do I tap"
   just needs "tap the screen".
   ══════════════════════════════════════════════════════════ */
const getLockScreenEnabled = () => localStorage.getItem('lockScreenEnabled') === 'true';
const getLockRevealSecs    = () => parseInt(localStorage.getItem('lockRevealSecs'), 10) || 60;
const getLockAgendaEnabled = () => localStorage.getItem('lockAgendaEnabled') !== 'false'; // default on

let privacyRevealed    = false;
let privacyRevealTimer = null;

function updateLockUI() {
  const locked = getLockScreenEnabled() && !privacyRevealed;
  document.getElementById('lock-screen').hidden     = !locked;
  document.querySelector('.top-bar').style.display  = locked ? 'none' : '';
  document.querySelector('.app-body').style.display = locked ? 'none' : '';
  if (locked) renderLockScreen();
}

function revealPrivacy() {
  const wasHidden = !privacyRevealed;
  privacyRevealed = true;
  if (wasHidden) {
    // Only chime on a genuine Lock Screen -> dashboard transition, not on
    // every first tap of the day when Lock Screen is off (or already open).
    const wasLocked = getLockScreenEnabled() && !document.getElementById('lock-screen').hidden;
    updateLockUI();
    if (wasLocked && getBootSoundEnabled()) playBootChime();
  }
  clearTimeout(privacyRevealTimer);
  privacyRevealTimer = setTimeout(() => {
    privacyRevealed = false;
    updateLockUI();
  }, getLockRevealSecs() * 1000);
}
document.addEventListener('pointerdown', revealPrivacy, true);

/* ── Lock Screen agenda ("Today you have" / "Tomorrow you have") ───── */
let lockAgendaEvents = { today: [], tomorrow: [] };

async function loadLockAgenda() {
  const todayD    = new Date();
  todayD.setHours(0, 0, 0, 0);
  const tomorrowD = addDays(todayD, 1);
  const todayStr  = toYMD(todayD);
  const tomorrowStr = toYMD(tomorrowD);
  try {
    const events = await api('GET', `/api/calendar?start=${todayStr}&end=${tomorrowStr}`);
    lockAgendaEvents = {
      today:    events.filter(e => e.display_date === todayStr),
      tomorrow: events.filter(e => e.display_date === tomorrowStr),
    };
  } catch { lockAgendaEvents = { today: [], tomorrow: [] }; }
  if (!document.getElementById('lock-screen').hidden) renderLockAgenda();
}

function renderLockAgenda() {
  const listFor = events => {
    if (!events.length) return '<div class="lock-agenda-empty">Nothing scheduled</div>';
    return events.map(ev => {
      // Private events already hide the title — giving them their real
      // color too would leak identity (color = person/category) through
      // the lock screen, defeating the point of marking them private.
      const label = ev.is_private ? '🔒 Private event' : escHtml(ev.title);
      const bg    = ev.is_private ? 'rgba(255,255,255,0.14)' : ev.color;
      return `<div class="lock-agenda-item" style="background:${bg}">${label}</div>`;
    }).join('');
  };
  document.getElementById('lock-agenda-today').innerHTML    = listFor(lockAgendaEvents.today);
  document.getElementById('lock-agenda-tomorrow').innerHTML = listFor(lockAgendaEvents.tomorrow);
}

function renderLockScreen() {
  document.getElementById('lock-agenda').hidden = !getLockAgendaEnabled();
  if (getLockAgendaEnabled()) renderLockAgenda();
}

loadLockAgenda();
setInterval(loadLockAgenda, REFRESH_MS);

// Sunrise/sunset from Open-Meteo (updated each weather fetch)
let sunriseMins = null; // minutes since midnight
let sunsetMins  = null;

// Last time any internet-dependent fetch (weather/alerts) actually
// succeeded — calendar/todo/bulletin only need the local Pi, so they
// aren't a useful "are we online" signal. Starts at boot time so a
// genuinely offline Pi shows stale immediately rather than staying
// silent until the first check interval passes.
let lastOnlineAt = Date.now();

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
      const isDaytime = nowM >= sunriseMins && nowM < sunsetMins;
      // No actual ambient light sensor on this hardware — current weather
      // condition (already tracked for the animated sky) is the closest
      // available proxy for "it's dim outside," and switches to dark mode
      // even during nominal daylight hours under genuinely dark conditions.
      // Rain/snow only count at heavy intensity — light rain/light snow
      // can absolutely still be bright out, and shouldn't force dark mode
      // just because there's some precipitation. Extreme heat/cold and
      // windy are excluded on purpose: none of those inherently mean dim
      // light (arctic air and desert wind are often the opposite — bright).
      const ALWAYS_DARK_MODES = [
        'overcast', 'storm', 'storm-severe', 'hurricane', 'tornado',
        'thundersnow', 'dust', 'smoke', 'eclipse', 'sleet', 'hail', 'blizzard',
      ];
      const heavyCloudCover = ALWAYS_DARK_MODES.includes(wxMode) ||
        ((wxMode === 'rain' || wxMode === 'snow') && wxIntensity === 'heavy');
      mode = (isDaytime && !heavyCloudCover) ? 'light' : 'dark';
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
  const now  = new Date();
  const nowM = now.getHours() * 60 + now.getMinutes();
  const isDaytime = nowM >= sunriseMins && nowM < sunsetMins;
  const cloudNote = (activeMode === 'dark' && isDaytime) ? ` (${wxMode.replace('-', ' ')})` : '';
  el.textContent = `Now ${activeMode}${cloudNote} · Sunrise ${fmt12hHM(riseH, riseM)} · Sunset ${fmt12hHM(setH, setM)}`;
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
function showToast(msg, kind = 'error') {
  const el = document.getElementById('error-toast');
  el.textContent = msg;
  el.classList.toggle('toast-success', kind === 'success');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}
function showError(msg) { showToast(msg, 'error'); }

/* ══════════════════════════════════════════════════════════
   CLOCK & DATE
   ══════════════════════════════════════════════════════════ */
// Elements + weekday/month names cached once instead of re-fetched/rebuilt
// on every tick — this runs once a second for the lifetime of the page.
const clockEl     = document.getElementById('clock');
const dateStrEl   = document.getElementById('date-str');
const lockClockEl = document.getElementById('lock-clock');
const lockDateEl  = document.getElementById('lock-date');
const CLOCK_DAYS  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const CLOCK_MONS  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

function updateClock() {
  const now  = new Date();
  const h    = now.getHours();
  const m    = String(now.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const clockText = `${h % 12 || 12}:${m} ${ampm}`;
  const dateText  = `${CLOCK_DAYS[now.getDay()]}, ${CLOCK_MONS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  clockEl.textContent   = clockText;
  dateStrEl.textContent = dateText;
  // Mirror into the Lock Screen too, so it stays live without its own timer
  lockClockEl.textContent = clockText;
  lockDateEl.textContent  = dateText;

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
let wxDrops   = [];
let wxStars   = [];
let wxClouds  = [];
let wxFlakes  = [];
let wxSleet   = [];
let wxHail    = [];
let wxStreaks = []; // wind-blown motion lines (windy/hurricane)
let wxAnimId  = null;
let wxMode    = 'none';
// 'light' | 'moderate' | 'heavy' — applies to rain/snow (drizzle is just
// rain at 'light'). Independent of wxMode so the same drawRain()/drawSnow()
// scale by however hard it's actually coming down.
let wxIntensity = 'moderate';
let daySkyOC  = null;  // OffscreenCanvas for pre-rendered day sky, invalidated on resize
let skyGrads  = {};    // cached per-mode gradient objects, keyed by name, invalidated on resize

// Multiplies particle count/speed/opacity for rain and snow. 'moderate' is
// 1.0 across the board — the original tuning — light/heavy scale from there.
const INTENSITY_SCALE = {
  light:    { count: 0.45, speed: 0.65, opac: 0.65 },
  moderate: { count: 1,    speed: 1,    opac: 1    },
  heavy:    { count: 1.7,  speed: 1.4,  opac: 1.25 },
};

// Graphics setting (Settings > Graphics > Weather Animation): 'off' | 'reduced' | 'full'
// Defaults to the lowest tier — this runs on a wide range of Pi hardware
// (including much weaker boards than whatever it was originally tuned on),
// so out-of-the-box it should never risk a choppy first impression. Anyone
// whose hardware can handle more can opt up via Settings > Graphics.
const getWxQuality = () => localStorage.getItem('gfxWxQuality') || 'off';
// Scales a particle count by the current quality setting; 'off' is handled
// separately in applyWxMode (skips animation entirely), not via a 0-count here.
function qCount(base) {
  return getWxQuality() === 'reduced' ? Math.round(base / 2) : base;
}

function resizeWxCanvas() {
  wxCanvas.width  = window.innerWidth;
  wxCanvas.height = window.innerHeight;
}

/* ── Rain drops ───────────────────────────────────────────── */
// Wind-driven horizontal lean — steeper for hurricane's near-sideways rain
// than a normal rain/storm's gentle slant.
function currentLean() {
  return wxMode === 'hurricane' ? 0.55 : 0.22;
}

function mkDrop() {
  const s = INTENSITY_SCALE[wxIntensity];
  return {
    x:     Math.random() * wxCanvas.width * 1.3 - wxCanvas.width * 0.15,
    y:     Math.random() * wxCanvas.height - wxCanvas.height,
    len:   (12 + Math.random() * 20) * (0.85 + s.speed * 0.15),
    speed: (8 + Math.random() * 14) * s.speed,
    opac:  (0.12 + Math.random() * 0.26) * s.opac,
  };
}

function initDrops() {
  const base =
    wxMode === 'hurricane' ? 240 :
    wxMode === 'storm' || wxMode === 'storm-severe' || wxMode === 'thundersnow' ? 170 : 100;
  wxDrops = Array.from({ length: qCount(Math.round(base * INTENSITY_SCALE[wxIntensity].count)) }, mkDrop);
}

function resetDrop(d) {
  const s = INTENSITY_SCALE[wxIntensity];
  d.len   = (12 + Math.random() * 20) * (0.85 + s.speed * 0.15);
  d.x     = Math.random() * wxCanvas.width * 1.3 - wxCanvas.width * 0.15;
  d.speed = (8 + Math.random() * 14) * s.speed;
  d.opac  = (0.12 + Math.random() * 0.26) * s.opac;
  d.y     = -d.len;
}

/* ── Stars ────────────────────────────────────────────────── */
function initStars() {
  wxStars = Array.from({ length: qCount(120) }, () => ({
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
  const n = qCount(wxMode === 'overcast' ? 8 : 4);
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
    // Stops deepened + bumped in opacity from the original (was as low as
    // 0.35 at the bottom) — on the TN panel this app runs on, pale/low-
    // opacity color washes out further still at anything but a dead-on
    // viewing angle, so the whole gradient reads punchier/more saturated
    // than a "normal monitor" design would need.
    const g = dc.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0,    'rgba(8,   55, 155, 0.95)');
    g.addColorStop(0.45, 'rgba(15, 100, 205, 0.85)');
    g.addColorStop(0.80, 'rgba(40, 140, 225, 0.68)');
    g.addColorStop(1,    'rgba(70, 170, 235, 0.48)');
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

// Storm-severe/hurricane — darker and flatter than regular storm's rain
// sky, since neither has much sunlight getting through at all.
function drawStormDarkSky() {
  wxCtx.fillStyle = getSkyGrad('storm-dark', [
    [0, 'rgba(8,  11, 28, 0.92)'],
    [1, 'rgba(16, 22, 40, 0.68)'],
  ]);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
}

// Tornado sky — the real-world greenish-gray "hail green" cast, distinct
// from a plain storm so it reads as its own (rarer, scarier) thing.
function drawTornadoSky() {
  wxCtx.fillStyle = getSkyGrad('tornado', [
    [0, 'rgba(24, 32, 26, 0.90)'],
    [1, 'rgba(46, 58, 44, 0.62)'],
  ]);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
}

// Shared "uniform haze" look for fog/dust/smoke — same structure (flat
// tinted fill + a couple of very slow, very soft drifting highlights),
// just different coloring, since all three are fundamentally "reduced
// visibility, hazy air" rather than distinct cloud shapes or precipitation.
function drawHazeSky(key, baseStops, highlightRgba) {
  wxCtx.fillStyle = getSkyGrad(key, baseStops);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
  const W = wxCanvas.width, H = wxCanvas.height;
  const t = performance.now() * 0.00004;
  [[0.25, 0.4], [0.7, 0.55]].forEach(([cfx, cfy], i) => {
    const x = W * (cfx + Math.sin(t + i * 2) * 0.08);
    const y = H * cfy;
    const g = wxCtx.createRadialGradient(x, y, 0, x, y, W * 0.32);
    g.addColorStop(0, highlightRgba);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    wxCtx.fillStyle = g;
    wxCtx.fillRect(0, 0, W, H);
  });
}
function drawFogSky()   { drawHazeSky('fog',   [[0,'rgba(150,158,168,0.72)'],[1,'rgba(170,178,186,0.55)']], 'rgba(255,255,255,0.10)'); }
function drawDustSky()  { drawHazeSky('dust',  [[0,'rgba(150,110, 62,0.68)'],[1,'rgba(178,140, 88,0.50)']], 'rgba(255,214,150,0.12)'); }
function drawSmokeSky() { drawHazeSky('smoke', [[0,'rgba(90,  86, 82,0.74)'],[1,'rgba(120,114,108,0.55)']], 'rgba(200,196,190,0.10)'); }

// Extreme heat — day sky pushed warmer/more saturated, with a brighter
// "haze shimmer" band near the ground implying rising heat.
function drawHeatSky() {
  wxCtx.fillStyle = getSkyGrad('heat', [
    [0,    'rgba(20, 90, 170, 0.90)'],
    [0.55, 'rgba(235, 150, 40, 0.35)'],
    [1,    'rgba(255, 190, 90, 0.30)'],
  ]);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
}
function drawHeatShimmer(ts) {
  const W = wxCanvas.width, H = wxCanvas.height;
  const bandY = H * 0.86, bandH = H * 0.14;
  wxCtx.save();
  wxCtx.globalAlpha = 0.10;
  wxCtx.fillStyle = '#fff3d6';
  for (let i = 0; i < 5; i++) {
    const yy = bandY + (bandH / 5) * i + Math.sin(ts * 0.003 + i) * 3;
    wxCtx.fillRect(0, yy, W, 2);
  }
  wxCtx.restore();
}

// Extreme cold — cold white-blue cast, with sparse twinkling frost
// specks across the whole sky (reuses the star-twinkle math, not just the
// upper band, and whiter/tighter than night stars).
function drawColdSky() {
  wxCtx.fillStyle = getSkyGrad('cold', [
    [0, 'rgba(150, 185, 220, 0.55)'],
    [1, 'rgba(190, 210, 230, 0.40)'],
  ]);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
}
function drawFrostSparkle(ts) {
  wxCtx.fillStyle = '#ffffff';
  for (const s of wxStars) {
    wxCtx.globalAlpha = (s.base * 0.6) * (0.4 + 0.6 * Math.sin(ts * s.freq + s.phi));
    wxCtx.beginPath();
    wxCtx.arc(s.x, s.y, s.r * 0.8, 0, Math.PI * 2);
    wxCtx.fill();
  }
  wxCtx.globalAlpha = 1;
}

// Eclipse — day sky darkened toward twilight, sun mostly occluded by a
// dark disc with a glowing corona ring; stars peek through like totality.
function drawEclipseSky(ts) {
  wxCtx.fillStyle = getSkyGrad('eclipse', [
    [0, 'rgba(6,  8, 22, 0.94)'],
    [1, 'rgba(18, 22, 44, 0.75)'],
  ]);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
  drawStars(ts);
  const W = wxCanvas.width, H = wxCanvas.height;
  // Off-center, like a sun/moon actually sitting in the sky — dead-center
  // read as an artificial, staged logo rather than a natural sky position.
  const cx = W * 0.7, cy = H * 0.2, r = Math.min(W, H) * 0.07;
  const corona = wxCtx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 2.6);
  corona.addColorStop(0,   'rgba(255,244,214,0.85)');
  corona.addColorStop(0.4, 'rgba(255,230,180,0.30)');
  corona.addColorStop(1,   'rgba(255,230,180,0)');
  wxCtx.fillStyle = corona;
  wxCtx.beginPath();
  wxCtx.arc(cx, cy, r * 2.6, 0, Math.PI * 2);
  wxCtx.fill();
  wxCtx.fillStyle = '#050608'; // the moon, fully occluding the disc
  wxCtx.beginPath();
  wxCtx.arc(cx, cy, r, 0, Math.PI * 2);
  wxCtx.fill();
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
  const lean = currentLean();
  wxCtx.strokeStyle = '#a8d8ff';
  wxCtx.lineWidth = 1;
  for (const d of wxDrops) {
    wxCtx.globalAlpha = d.opac;
    wxCtx.beginPath();
    wxCtx.moveTo(d.x, d.y);
    wxCtx.lineTo(d.x + lean * d.len, d.y + d.len);
    wxCtx.stroke();
    d.y += d.speed * dt;
    d.x += lean * d.speed * 0.28 * dt;
    if (d.y > H + d.len) resetDrop(d);
  }
  wxCtx.globalAlpha = 1;
}

/* ── Snowflakes ───────────────────────────────────────────── */
function mkFlake() {
  const s = INTENSITY_SCALE[wxIntensity];
  return {
    x:         Math.random() * wxCanvas.width,
    y:         Math.random() * wxCanvas.height,
    r:         1.5 + Math.random() * 3.2,
    speed:     (1.4 + Math.random() * 2.8) * s.speed,
    swayPhase: Math.random() * Math.PI * 2,
    swayFreq:  0.0008 + Math.random() * 0.0012,
    // Heavy snow blows more sideways (less lazy drift, more wind-driven);
    // light snow sways gently.
    swayAmp:   (18 + Math.random() * 28) * (wxIntensity === 'heavy' ? 0.5 : 1),
    opac:      (0.55 + Math.random() * 0.40) * s.opac,
  };
}

function initFlakes() {
  wxFlakes = Array.from({ length: qCount(Math.round(120 * INTENSITY_SCALE[wxIntensity].count)) }, mkFlake);
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

// Blizzard — reuses the snowflake pool (always at heavy intensity, forced
// in applyWxMode) but drives it with a strong constant wind lean instead of
// the gentle sway used for plain snow, plus wind streaks and a washed-out,
// low-contrast sky standing in for near-zero whiteout visibility.
function drawBlizzardSky() {
  wxCtx.fillStyle = getSkyGrad('blizzard', [
    [0,   'rgba(150, 160, 172, 0.85)'],
    [0.5, 'rgba(196, 204, 212, 0.72)'],
    [1,   'rgba(224, 228, 232, 0.55)'],
  ]);
  wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
}
function drawBlizzard(dt = 1) {
  const W = wxCanvas.width, H = wxCanvas.height;
  const lean = 1.1; // near-horizontal — wind-driven snow, not falling snow
  wxCtx.fillStyle = '#ffffff';
  for (const f of wxFlakes) {
    wxCtx.globalAlpha = f.opac;
    wxCtx.beginPath();
    wxCtx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    wxCtx.fill();
    f.y += f.speed * dt;
    f.x += f.speed * lean * dt;
    if (f.y > H + f.r || f.x > W + f.r) {
      f.x = -f.r - Math.random() * W * 0.3;
      f.y = Math.random() * H - H * 0.3;
    }
  }
  wxCtx.globalAlpha = 1;
}

/* ── Sleet / freezing rain / ice pellets ──────────────────────
   Small, hard, fast, near-vertical — visually between rain (streaked) and
   snow (soft), which is exactly the point: ice, not water or fluff. */
function mkSleet() {
  return {
    x: Math.random() * wxCanvas.width,
    y: Math.random() * wxCanvas.height - wxCanvas.height,
    len: 5 + Math.random() * 5,
    speed: 14 + Math.random() * 8,
    opac: 0.35 + Math.random() * 0.35,
  };
}
function initSleet() {
  wxSleet = Array.from({ length: qCount(90) }, mkSleet);
}
function drawSleet(dt = 1) {
  const H = wxCanvas.height;
  wxCtx.strokeStyle = '#dceeff';
  wxCtx.lineWidth = 1.4;
  for (const p of wxSleet) {
    wxCtx.globalAlpha = p.opac;
    wxCtx.beginPath();
    wxCtx.moveTo(p.x, p.y);
    wxCtx.lineTo(p.x + 0.06 * p.len, p.y + p.len);
    wxCtx.stroke();
    p.y += p.speed * dt;
    if (p.y > H + p.len) { p.x = Math.random() * wxCanvas.width; p.y = -p.len; }
  }
  wxCtx.globalAlpha = 1;
}

/* ── Hail ──────────────────────────────────────────────────────
   Round, fast-falling, with a slight horizontal jitter to suggest bounce/
   scatter rather than rain's clean streak. */
function mkHail() {
  return {
    x: Math.random() * wxCanvas.width,
    y: Math.random() * wxCanvas.height - wxCanvas.height,
    r: 1.5 + Math.random() * 2.2,
    speed: 16 + Math.random() * 9,
    jitterPhase: Math.random() * Math.PI * 2,
    opac: 0.55 + Math.random() * 0.35,
  };
}
function initHail() {
  wxHail = Array.from({ length: qCount(70) }, mkHail);
}
function drawHail(ts, dt = 1) {
  const H = wxCanvas.height;
  wxCtx.fillStyle = '#eef6ff';
  for (const p of wxHail) {
    const jitter = Math.sin(ts * 0.02 + p.jitterPhase) * 2;
    wxCtx.globalAlpha = p.opac;
    wxCtx.beginPath();
    wxCtx.arc(p.x + jitter, p.y, p.r, 0, Math.PI * 2);
    wxCtx.fill();
    p.y += p.speed * dt;
    if (p.y > H + p.r) { p.x = Math.random() * wxCanvas.width; p.y = -p.r; }
  }
  wxCtx.globalAlpha = 1;
}

/* ── Wind streaks (windy / hurricane) ─────────────────────────
   Sparse, fast, near-horizontal motion lines — a cheap but legible way to
   show "wind" specifically, distinct from any form of precipitation. */
function mkStreak() {
  return {
    x: Math.random() * wxCanvas.width * 1.4 - wxCanvas.width * 0.2,
    y: Math.random() * wxCanvas.height,
    len: 40 + Math.random() * 70,
    speed: 9 + Math.random() * 10,
    opac: 0.08 + Math.random() * 0.14,
  };
}
function initStreaks(count = 26) {
  wxStreaks = Array.from({ length: qCount(count) }, mkStreak);
}
function drawStreaks(dt = 1) {
  const W = wxCanvas.width;
  wxCtx.strokeStyle = '#ffffff';
  wxCtx.lineWidth = 1;
  for (const s of wxStreaks) {
    wxCtx.globalAlpha = s.opac;
    wxCtx.beginPath();
    wxCtx.moveTo(s.x, s.y);
    wxCtx.lineTo(s.x + s.len, s.y + s.len * 0.10);
    wxCtx.stroke();
    s.x += s.speed * dt;
    if (s.x > W + s.len) { s.x = -s.len; s.y = Math.random() * wxCanvas.height; }
  }
  wxCtx.globalAlpha = 1;
}

/* ── Funnel cloud (tornado) ───────────────────────────────────
   Redrawn procedurally every frame (not pre-rendered — the whole point is
   that it writhes and never holds a fixed silhouette like a real funnel).
   Each height band gets its own sway phase/amplitude, layered from two
   sine waves at different frequencies, so the funnel curves and twists
   independently top-to-bottom instead of swinging as one rigid triangle.
   Wide where it meets the storm cloud at top, tapering to a narrow point
   at the ground — and the whole thing drifts slowly across the screen
   like a tracking storm, not just wobbling in place.
   A jittering debris cloud at the ground-contact point sells the touchdown. */
function funnelWobble(t, ts) {
  return Math.sin(ts * 0.0011 + t * 3.2) * (4 + t * 22) +
         Math.sin(ts * 0.0023 + t * 6.1 + 1.7) * (2 + t * 8);
}

// Continuous horizontal drift, wrapping around once fully off-screen —
// same "exit one side, re-enter the other" convention as clouds/streaks.
function funnelDriftX(ts, W, margin) {
  const span = W + margin * 2;
  return ((ts * 0.018) % span) - margin;
}

function drawFunnel(ts) {
  const W = wxCanvas.width, H = wxCanvas.height;
  const topY = H * 0.03, botY = H * 0.97; // stretches nearly the full canvas height
  const topHalf = Math.min(95, W * 0.12), botHalf = 4; // wide at the cloud base, narrow at the ground
  const N = 22;
  const driftX = funnelDriftX(ts, W, topHalf + 60);

  wxCtx.save();
  wxCtx.globalAlpha = 0.86;

  const edge = (t, widthMul) => {
    const y    = topY + (botY - topY) * t;
    const half = (topHalf + (botHalf - topHalf) * Math.pow(t, 1.6)) * widthMul;
    const x    = driftX + funnelWobble(t, ts);
    return [x, y, half];
  };

  // Outer funnel body
  wxCtx.fillStyle = 'rgba(68,72,84,0.88)';
  wxCtx.beginPath();
  for (let i = 0; i <= N; i++) {
    const [x, y, half] = edge(i / N, 1);
    i === 0 ? wxCtx.moveTo(x - half, y) : wxCtx.lineTo(x - half, y);
  }
  for (let i = N; i >= 0; i--) {
    const [x, y, half] = edge(i / N, 1);
    wxCtx.lineTo(x + half, y);
  }
  wxCtx.closePath();
  wxCtx.fill();

  // Darker inner core strip, for a sense of rotation/volume rather than a flat wedge
  wxCtx.fillStyle = 'rgba(28,30,38,0.28)';
  wxCtx.beginPath();
  for (let i = 0; i <= N; i++) {
    const [x, y, half] = edge(i / N, 0.28);
    i === 0 ? wxCtx.moveTo(x - half, y) : wxCtx.lineTo(x - half, y);
  }
  for (let i = N; i >= 0; i--) {
    const [x, y, half] = edge(i / N, 0.28);
    wxCtx.lineTo(x + half, y);
  }
  wxCtx.closePath();
  wxCtx.fill();

  // Debris cloud kicked up at the ground-contact point
  const baseX = driftX + funnelWobble(1, ts);
  const debrisSpread = 34;
  wxCtx.fillStyle = 'rgba(94,84,66,0.30)';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + ts * 0.0015;
    const r = debrisSpread * (0.5 + 0.5 * Math.sin(ts * 0.002 + i * 1.7));
    const dx = Math.cos(a) * r * 1.1;
    const dy = Math.sin(a) * r * 0.28;
    wxCtx.beginPath();
    wxCtx.ellipse(baseX + dx, botY + dy, 14 + (i % 3) * 6, 8 + (i % 3) * 3, 0, 0, Math.PI * 2);
    wxCtx.fill();
  }

  wxCtx.restore();
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

    case 'fog':
      drawFogSky();
      break;

    case 'dust':
      drawDustSky();
      break;

    case 'smoke':
      drawSmokeSky();
      break;

    case 'windy-day':
      drawDaySky();
      drawClouds(dt);
      drawStreaks(dt);
      break;

    case 'windy-night':
      drawNightSky();
      drawStars(ts);
      drawClouds(dt);
      drawStreaks(dt);
      break;

    case 'rain':
    case 'storm':
      drawRainSky();
      drawRain(dt);
      break;

    case 'storm-severe':
      drawStormDarkSky();
      drawRain(dt);
      break;

    case 'hurricane':
      drawStormDarkSky();
      drawRain(dt);
      drawStreaks(dt);
      break;

    case 'tornado':
      drawTornadoSky();
      drawRain(dt);
      drawFunnel(ts);
      break;

    case 'sleet':
      drawSnowSky();
      drawSleet(dt);
      break;

    case 'hail':
      drawStormDarkSky();
      drawHail(ts, dt);
      break;

    case 'snow':
      drawSnowSky();
      drawSnow(ts, dt);
      break;

    case 'thundersnow':
      drawSnowSky();
      drawSnow(ts, dt);
      break;

    case 'blizzard':
      drawBlizzardSky();
      drawStreaks(dt);
      drawBlizzard(dt);
      break;

    case 'extreme-heat':
      drawHeatSky();
      drawHeatShimmer(ts);
      break;

    case 'extreme-cold':
      drawColdSky();
      drawFrostSparkle(ts);
      break;

    case 'eclipse':
      drawEclipseSky(ts);
      break;

    default:
      wxAnimId = null;
      return;
  }

  // Bolt overlays everything (any mode with lightning scheduled — storm,
  // storm-severe, thundersnow, hurricane); JS controls boltAlpha
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

const getLightningEnabled = () => localStorage.getItem('gfxLightning') !== 'false';

// Per-mode strike interval [min, span] in ms — how "active" the lightning
// feels varies by severity, not just on/off.
const LIGHTNING_INTERVALS = {
  storm:         [5000, 13000],
  'storm-severe':[2500,  7000], // most frequent — this is the "severe" part
  hurricane:     [6000, 14000],
  thundersnow:   [8000, 15000], // rarer phenomenon in reality, kept sparser
  tornado:       [3500,  9000],
};

function scheduleLightning() {
  clearTimeout(lightTimer);
  const range = LIGHTNING_INTERVALS[wxMode];
  if (!range || !getLightningEnabled()) return;
  lightTimer = setTimeout(() => { triggerStrike(); scheduleLightning(); }, range[0] + Math.random() * range[1]);
}

/* ── Apply mode ───────────────────────────────────────────── */
function applyWxMode(mode) {
  stopAnim();
  clearTimeout(lightTimer);
  clearStrike();
  wxMode = mode;
  document.body.dataset.wx = mode;
  applyTheme(); // auto theme also reacts to cloud cover, not just sunrise/sunset — react promptly to a condition change rather than waiting for the next per-minute check

  // Graphics setting: Weather Animation = Off — skip the canvas entirely
  // (biggest possible saving: no RAF loop, no particle init, ever).
  if (getWxQuality() === 'off') {
    wxCanvas.style.opacity = '0';
    return;
  }

  wxCanvas.style.opacity =
    mode === 'clear-day'    ? '1.00' :
    mode === 'clear-night'  ? '0.90' :
    mode === 'cloudy-day'   ? '1.00' :
    mode === 'cloudy-night' ? '0.90' :
    mode === 'windy-day'    ? '1.00' :
    mode === 'windy-night'  ? '0.90' :
    mode === 'overcast'     ? '0.82' :
    mode === 'fog'          ? '0.85' :
    mode === 'dust'         ? '0.80' :
    mode === 'smoke'        ? '0.80' :
    mode === 'snow'         ? '0.88' :
    mode === 'sleet'        ? '0.85' :
    mode === 'thundersnow'  ? '0.88' :
    mode === 'blizzard'     ? '0.90' :
    mode === 'hail'         ? '0.78' :
    mode === 'storm-severe' ? '0.78' :
    mode === 'hurricane'    ? '0.85' :
    mode === 'tornado'      ? '0.85' :
    mode === 'extreme-heat' ? '1.00' :
    mode === 'extreme-cold' ? '0.85' :
    mode === 'eclipse'      ? '0.90' : '0.72';

  if (mode === 'none') return;

  // Blizzard is an NWS threshold event (sustained wind + near-zero
  // visibility), not a matter of degree like rain/snow — always the max.
  if (mode === 'blizzard') wxIntensity = 'heavy';

  if (['clear-night', 'cloudy-night', 'windy-night', 'extreme-cold', 'eclipse'].includes(mode)) initStars();
  if (['cloudy-day', 'cloudy-night', 'overcast', 'windy-day', 'windy-night'].includes(mode)) initClouds();
  if (['rain', 'storm', 'storm-severe', 'hurricane', 'tornado'].includes(mode)) initDrops();
  if (['snow', 'thundersnow', 'blizzard'].includes(mode)) initFlakes();
  if (mode === 'sleet') initSleet();
  if (mode === 'hail') initHail();
  if (mode === 'windy-day' || mode === 'windy-night') initStreaks(26);
  if (mode === 'hurricane') initStreaks(55);
  if (mode === 'blizzard') initStreaks(40);

  startAnim();
  scheduleLightning(); // no-ops for modes not in LIGHTNING_INTERVALS
}

/* ── Map NWS description → canvas mode ───────────────────── */
// \blight\b (word boundary), not .includes('light') — "Lightning" contains
// "light" as a substring and would otherwise false-match as an intensity.
function detectIntensity(d) {
  if (/\blight\b|slight|flurr/.test(d)) return 'light';
  if (/\bheavy\b|excessive|violent/.test(d)) return 'heavy';
  return 'moderate';
}

function setWxMode(desc) {
  const day = isCurrentlyDay();
  if (!desc) return applyWxMode(day ? 'clear-day' : 'clear-night');
  const d = desc.toLowerCase();

  // Most specific/severe conditions first — thundersnow before either
  // "thunder" or "snow" alone would claim it; tornado/hurricane before
  // the generic thunderstorm check; hail before generic storm.
  if (d.includes('thundersnow') || (d.includes('thunder') && d.includes('snow'))) {
    wxIntensity = 'heavy';
    return applyWxMode('thundersnow');
  }
  if (d.includes('tornado') || d.includes('funnel') || d.includes('waterspout'))
    return applyWxMode('tornado');
  if (d.includes('hurricane') || d.includes('typhoon') || d.includes('tropical storm') ||
      d.includes('tropical depression'))
    return applyWxMode('hurricane');
  if (d.includes('small hail') || d.includes('hail'))
    return applyWxMode('hail');
  if (d.includes('severe thunderstorm') || d.includes('violent thunderstorm'))
    return applyWxMode('storm-severe');
  if (d.includes('thunder'))
    return applyWxMode('storm');

  if (d.includes('eclipse'))
    return applyWxMode('eclipse');

  if (d.includes('extreme heat') || d.includes('excessive heat') || d.includes('heat warning'))
    return applyWxMode('extreme-heat');
  if (d.includes('extreme cold') || d.includes('bitter cold') || d.includes('arctic') ||
      d.includes('wind chill warning') || d.includes('dangerous cold'))
    return applyWxMode('extreme-cold');

  // Ice — sleet/freezing rain/ice pellets are their own hard-particle look,
  // distinct from fluffy snow, checked before the generic snow match below.
  if (d.includes('sleet') || d.includes('ice pellet') || d.includes('freezing rain') ||
      d.includes('freezing drizzle') || d.includes('ice storm') || d.includes('ice crystal'))
    return applyWxMode('sleet');

  // Blizzard is its own look (wind-driven whiteout), checked before the
  // generic snow match below so it doesn't get absorbed into plain snow.
  if (d.includes('blizzard'))
    return applyWxMode('blizzard');

  // Snow before rain — "Snow Showers" contains "shower" and would
  // false-match rain otherwise.
  if (d.includes('snow') || d.includes('flurr') || d.includes('wintry')) {
    wxIntensity = detectIntensity(d);
    return applyWxMode('snow');
  }
  if (d.includes('rain') || d.includes('shower') || d.includes('drizzle')) {
    wxIntensity = detectIntensity(d);
    return applyWxMode('rain');
  }

  if (d.includes('fog') || d.includes('mist'))
    return applyWxMode('fog');
  if (d.includes('dust') || d.includes('sand'))
    return applyWxMode('dust');
  if (d.includes('smoke') || d.includes('haze') || d.includes('ash') || d.includes('spray'))
    return applyWxMode('smoke');
  if (d.includes('overcast') || d.includes('mostly cloudy') || d.includes('considerable'))
    return applyWxMode('overcast');

  if (d.includes('windy') || d.includes('breezy') || d.includes('blustery') || d.includes('gusty'))
    return applyWxMode(day ? 'windy-day' : 'windy-night');

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
const getBootSoundEnabled = () => localStorage.getItem('bootSound') !== 'false'; // default on

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// 6 beeps, louder — was 3 beeps at 0.22 gain, which turned out to be too
// few and too quiet to notice from across a room. ALERT_BEEP_TOTAL_MS is
// derived from these so the "beeps, then speech" delay in renderAlerts()
// below never has to be kept in sync by hand.
const ALERT_BEEP_COUNT = 6;
const ALERT_BEEP_FREQ  = 960;
const ALERT_BEEP_DUR   = 0.18;  // seconds
const ALERT_BEEP_GAP   = 0.22;  // seconds between beep starts
const ALERT_BEEP_GAIN  = 0.75;  // 0-1; square wave, pushed close to clipping on purpose
const ALERT_BEEP_TOTAL_MS = Math.round(((ALERT_BEEP_COUNT - 1) * ALERT_BEEP_GAP + ALERT_BEEP_DUR) * 1000);

function playBeepSequence(ctx) {
  const beep = (freq, start, dur) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(ALERT_BEEP_GAIN, start + 0.01);
    gain.gain.setValueAtTime(ALERT_BEEP_GAIN, start + dur - 0.02);
    gain.gain.linearRampToValueAtTime(0, start + dur);
    osc.start(start);
    osc.stop(start + dur);
  };
  const t = ctx.currentTime;
  for (let i = 0; i < ALERT_BEEP_COUNT; i++) beep(ALERT_BEEP_FREQ, t + i * ALERT_BEEP_GAP, ALERT_BEEP_DUR);
}

function playAlertSound() {
  if (!getSoundEnabled()) return;
  try { playBeepSequence(getAudioCtx()); }
  catch { /* AudioContext unavailable */ }
}

// Soft ascending sine chime (C5-E5-G5-C6) — deliberately the opposite
// character of the alert beeps (sine vs. square, gentle vs. urgent).
function playBootChime() {
  try {
    const ctx   = getAudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.50];
    const dur   = 0.5;
    const gap   = 0.14;
    const peak  = 0.28;
    const t0    = ctx.currentTime;
    notes.forEach((freq, i) => {
      const start = t0 + i * gap;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.start(start);
      osc.stop(start + dur + 0.05);
    });
  } catch { /* AudioContext unavailable */ }
}

// Server-side TTS (/api/tts, Piper) instead of the browser's own
// speechSynthesis — Chromium's Linux TTS platform support has proven
// unreliable across builds/distros, whereas running a real engine directly
// on the server is deterministic. The browser's job shrinks to "play this
// audio", which is far more universally supported than the Web Speech API.
//
// Played through the same AudioContext the alert beeps use (decoded via
// decodeAudioData, not a separate <audio> element) rather than two
// independent audio pathways — on Pi audio setups without a software mixer
// (no PulseAudio/PipeWire), a Web Audio API stream and an HTML5 <audio>
// stream compete for exclusive access to the device, and whichever opens
// second fails silently. One shared AudioContext means one stream.
let ttsQueue         = [];
let ttsPlaying       = false;
let currentTtsSource = null;

function cancelTts() {
  ttsQueue = [];
  if (currentTtsSource) { try { currentTtsSource.stop(); } catch { /* already stopped */ } currentTtsSource = null; }
  ttsPlaying = false;
}

// Speed/clarity is tuned server-side via Piper's own settings now (see
// /api/tts) — deliberately no client-side playbackRate here. Time-stretching
// an already-synthesized voice via playbackRate reintroduces warble on top
// of whatever the engine already produced.
const TTS_GAP_MS = 300; // brief pause between queued utterances, for clarity

function processTtsQueue() {
  if (ttsPlaying || ttsQueue.length === 0) return;
  ttsPlaying = true;
  const { arrayBuffer, onerror, onsuccess } = ttsQueue.shift();
  const ctx = getAudioCtx();
  const done = () => {
    currentTtsSource = null;
    ttsPlaying = false;
    setTimeout(processTtsQueue, TTS_GAP_MS);
  };
  ctx.decodeAudioData(arrayBuffer)
    .then(buffer => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = done;
      currentTtsSource = source;
      source.start();
      onsuccess?.();
    })
    .catch(err => { onerror?.('Audio decoding failed: ' + err.message); done(); });
}

async function speakText(text, onerror, onsuccess) {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('TTS request failed:', body.detail || res.status);
      onerror?.('Text-to-speech engine unavailable on this device.');
      return;
    }
    const arrayBuffer = await res.arrayBuffer();
    ttsQueue.push({ arrayBuffer, onerror, onsuccess });
    processTtsQueue();
  } catch (err) {
    onerror?.('Could not reach the dashboard server for text-to-speech.');
  }
}

function speakAlerts(sorted) {
  if (!getTtsEnabled()) return;
  cancelTts();
  speakText(
    'The National Weather Service has issued the following alert' +
    (sorted.length > 1 ? 's' : '') + '.'
  );
  for (const f of sorted) {
    const p     = f.properties;
    const areas = p.areaDesc
      ? p.areaDesc.split(';').map(s => s.trim()).filter(Boolean).join(', ')
      : '';
    const text  = areas
      ? `${p.event} for ${areas}. ${p.headline || ''}`
      : `${p.event}. ${p.headline || ''}`;
    speakText(text);
  }
}

/* ── Debug: test audio (bypasses the enabled toggles above — this is for
   checking the Pi's actual audio output, not alert settings) ──────── */
document.getElementById('debug-test-beep').addEventListener('click', () => {
  try { playBeepSequence(getAudioCtx()); }
  catch (err) { showError('Audio test failed: ' + err.message); }
});

document.getElementById('debug-test-tts').addEventListener('click', () => {
  cancelTts();
  speakText(
    'This is a test of the alert text to speech system.',
    showError,
    () => showToast('Speaking now via server-side text to speech.', 'success')
  );
});

// Two taps required (arms on the first, fires on the second within 4s) —
// this closes the entire graphical session, not just the dashboard, so a
// stray tap shouldn't be able to trigger it by accident.
let exitKioskArmed = false;
let exitKioskArmTimer = null;
document.getElementById('exit-kiosk-btn').addEventListener('click', async () => {
  const btn = document.getElementById('exit-kiosk-btn');
  if (!exitKioskArmed) {
    exitKioskArmed = true;
    btn.textContent = 'Tap again to confirm. This closes everything.';
    exitKioskArmTimer = setTimeout(() => {
      exitKioskArmed = false;
      btn.textContent = 'Exit to Terminal';
    }, 4000);
    return;
  }
  clearTimeout(exitKioskArmTimer);
  btn.textContent = 'Exiting...';
  try { await api('POST', '/api/exit-kiosk'); }
  catch (err) { showError('Exit failed: ' + err.message); btn.textContent = 'Exit to Terminal'; exitKioskArmed = false; }
  // On success there's nothing further to do client-side — the X session
  // (and this page along with it) is about to disappear.
});

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
    setTimeout(() => speakAlerts(sorted), ALERT_BEEP_TOTAL_MS + 500); // beeps first, then voice
  }
}

async function fetchAlerts() {
  const loc = getActiveLocation();
  try {
    const r = await fetch(
      `https://api.weather.gov/alerts/active?point=${loc.lat},${loc.lon}`,
      { headers: { 'User-Agent': 'FamilyDashboard/1.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return;
    renderAlerts((await r.json()).features || []);
    lastOnlineAt = Date.now();
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

function cToF(c) {
  return (c != null && isFinite(c)) ? Math.round(c * 9 / 5 + 32) : null;
}

// Map NWS free-text descriptions to emoji, accounting for day vs. night
function nwsIcon(desc, isDay) {
  if (!desc) return '🌡️';
  const d = desc.toLowerCase();
  if (d.includes('eclipse'))                                    return '🌑';
  if (d.includes('tornado') || d.includes('funnel') || d.includes('waterspout')) return '🌪️';
  if (d.includes('hurricane') || d.includes('typhoon') || d.includes('tropical')) return '🌀';
  if (d.includes('hail'))                                       return '🧊';
  if (d.includes('thunder'))                                    return '⛈️';
  if (d.includes('freezing rain') || d.includes('ice pellet') || d.includes('sleet')) return '🌨️';
  if (d.includes('extreme heat') || d.includes('excessive heat')) return '🥵';
  if (d.includes('extreme cold') || d.includes('arctic') || d.includes('bitter cold')) return '🥶';
  if (d.includes('blizzard'))                                   return '🌬️❄️';
  if (d.includes('rain') || d.includes('shower') || d.includes('drizzle')) return '🌧️';
  if (d.includes('snow'))                                       return '❄️';
  if (d.includes('dust') || d.includes('sand'))                 return '💨';
  if (d.includes('fog') || d.includes('mist') || d.includes('haze') ||
      d.includes('smoke') || d.includes('ash'))                 return '🌫️';
  if (d.includes('overcast') || d.includes('mostly cloudy'))   return '☁️';
  if (d.includes('windy') || d.includes('breezy') || d.includes('blustery') || d.includes('gusty')) return '💨';
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
  // Fallback before the first successful sunrise/sunset fetch (or after one
  // fails). Was 7am-7pm, which is wrong for a good chunk of the year here —
  // Corpus Christi's sunset runs past 8:30pm in summer, so anyone loading
  // the page in the evening saw an incorrect "Night" flash before the real
  // data arrived a few seconds later, and on repeated reloads, repeated
  // flicker between the two. Widened generously to the realistic year-round
  // sunrise/sunset range for this latitude — false "day" at the very edges
  // of dawn/dusk is a much smaller error than false "night" in broad daylight.
  return nowM >= 6 * 60 && nowM < 20 * 60 + 45;
}

async function fetchWeather() {
  const loc = getActiveLocation();
  document.getElementById('wx-city').textContent = loc.city;
  document.getElementById('wx-neighborhood').textContent = loc.detail;

  // Run both requests in parallel.
  // NWS = real sensor at the nearest resolved station; OM = model forecast for rain + hi/lo + sun times.
  const [nwsResult, omResult] = await Promise.allSettled([
    loc.stationId
      ? fetch(`https://api.weather.gov/stations/${loc.stationId}/observations/latest`, {
          headers: { 'User-Agent': 'FamilyDashboard/1.0' },
          signal: AbortSignal.timeout(10000),
        }).then(r => r.ok ? r.json() : Promise.reject(new Error('NWS ' + r.status)))
      : Promise.reject(new Error('No weather station resolved for this location')),

    fetch(makeWxUrl(loc.lat, loc.lon), {
      signal: AbortSignal.timeout(10000),
    }).then(r => r.ok ? r.json() : Promise.reject(new Error('OM ' + r.status))),
  ]);

  if (nwsResult.status === 'fulfilled' || omResult.status === 'fulfilled') lastOnlineAt = Date.now();

  // Parse sunrise/sunset FIRST, before deciding the icon/canvas mode below —
  // these used to update after, so every fetch cycle briefly judged day/night
  // using the *previous* cycle's (up to 10min stale) sunrise/sunset instead
  // of the values just fetched in this same cycle.
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
  }

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
    // NWS sometimes reports a station observation with every numeric field
    // present but textDescription as "" (not missing — genuinely blank).
    // Falling back to the literal word "Unknown" there reads like an error;
    // leaving it blank is more honest. The icon similarly shouldn't fall to
    // the thermometer (that's reserved for "no station data at all" below) —
    // a plain day/night icon reads better when we just lack a text label.
    const desc = p.textDescription || '';

    document.getElementById('wx-icon').textContent  =
      desc ? nwsIcon(desc, isCurrentlyDay()) : (isCurrentlyDay() ? '☀️' : '🌙');
    document.getElementById('wx-temp').textContent  = (tempF != null ? tempF : '--') + '°';
    document.getElementById('wx-feels').textContent = feelsF != null ? `Feels ${feelsF}°` : '';
    document.getElementById('wx-desc').textContent  = desc;
    setWxMode(desc); // trigger rain / storm canvas animation

    // NWS timestamp is UTC; JS Date auto-converts to local (CDT)
    if (p.timestamp) {
      const t = new Date(p.timestamp).toLocaleTimeString('en-US',
        { hour: 'numeric', minute: '2-digit' });
      document.getElementById('wx-updated').textContent = `obs. ${t} · ${loc.stationId}`;
    }
  } else {
    document.getElementById('wx-icon').textContent   = '🌡️';
    document.getElementById('wx-desc').textContent   = 'Station unavailable';
    document.getElementById('wx-updated').textContent = '';
  }

  // Mirror into the Lock Screen too, so it stays live without its own fetch
  document.getElementById('lock-wx-icon').textContent = document.getElementById('wx-icon').textContent;
  document.getElementById('lock-wx-temp').textContent = document.getElementById('wx-temp').textContent;
  document.getElementById('lock-wx-desc').textContent = document.getElementById('wx-desc').textContent;

  // ── Forecast from Open-Meteo (hi/lo, rain chart) ──
  if (omResult.status === 'fulfilled') {
    const d = omResult.value;

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
   CONNECTIVITY / STALENESS INDICATOR
   Weather polls every 10min and alerts every 5min — 20min with zero
   successful sync is a generous margin over either interval before
   flagging real trouble rather than one transient failure.
   ══════════════════════════════════════════════════════════ */
const OFFLINE_THRESHOLD_MS = 20 * 60 * 1000;

function updateConnectivityBadge() {
  const offlineMs = Date.now() - lastOnlineAt;
  const stale = offlineMs > OFFLINE_THRESHOLD_MS;
  const label = stale
    ? `📡 Offline · last synced ${Math.round(offlineMs / 60000)}m ago`
    : '';
  for (const id of ['connectivity-badge', 'lock-connectivity-badge']) {
    const el = document.getElementById(id);
    el.textContent = label;
    el.hidden = !stale;
  }
}
updateConnectivityBadge();
setInterval(updateConnectivityBadge, 60000);

/* ══════════════════════════════════════════════════════════
   TEXT SIZE
   Scales the root font-size — nearly everything in the app is sized in
   rem/em, so this one variable scales essentially the whole UI.
   ══════════════════════════════════════════════════════════ */
const getTextScalePct = () => parseInt(localStorage.getItem('textScalePct'), 10) || 100;

function applyTextScale() {
  document.documentElement.style.setProperty('--text-scale', getTextScalePct() / 100);
}
applyTextScale();

/* ══════════════════════════════════════════════════════════
   DISPLAY BRIGHTNESS
   Pure CSS overlay dimming — works on any display regardless of whether
   the monitor supports real hardware brightness (DDC/CI), but unlike real
   hardware control it doesn't reduce actual backlight power draw or wear.
   ══════════════════════════════════════════════════════════ */
const MAX_DIM_OPACITY = 0.75; // overlay opacity at the dimmest slider setting

const getBrightnessPct      = () => parseInt(localStorage.getItem('brightnessPct'), 10) || 100;
const getNightDimEnabled    = () => localStorage.getItem('nightDimEnabled') === 'true';
const getNightDimStart      = () => localStorage.getItem('nightDimStart') || '21:00';
const getNightDimEnd        = () => localStorage.getItem('nightDimEnd')   || '07:00';
const getNightBrightnessPct = () => parseInt(localStorage.getItem('nightBrightnessPct'), 10) || 30;

function isWithinNightWindow(startStr, endStr) {
  const now     = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins   = eh * 60 + em;
  if (startMins === endMins) return false;
  return startMins < endMins
    ? (nowMins >= startMins && nowMins < endMins)   // e.g. 09:00-17:00, same day
    : (nowMins >= startMins || nowMins < endMins);  // e.g. 21:00-07:00, wraps midnight
}

function applyBrightness() {
  const usingNight = getNightDimEnabled() && isWithinNightWindow(getNightDimStart(), getNightDimEnd());
  const pct = usingNight ? getNightBrightnessPct() : getBrightnessPct();
  document.getElementById('brightness-overlay').style.opacity = (1 - pct / 100) * MAX_DIM_OPACITY;
}

applyBrightness();
setInterval(applyBrightness, 60000); // re-check the night window every minute

/* ══════════════════════════════════════════════════════════
   SETTINGS PANEL
   ══════════════════════════════════════════════════════════ */
const settingsModal  = document.getElementById('settings-modal');
const wxUseLocBtn    = document.getElementById('wx-use-location-btn');
const wxZipInput     = document.getElementById('wx-zip-input');
const wxZipSubmitBtn = document.getElementById('wx-zip-submit-btn');
const wxLocStatus    = document.getElementById('wx-location-status');

function renderActiveLocation() {
  const loc = getActiveLocation();
  document.getElementById('zip-coords').textContent = loc.stationId
    ? `Currently: ${loc.city} (${loc.detail}) · station ${loc.stationId}`
    : `Currently: ${loc.city} (${loc.detail})`;
}
renderActiveLocation();

// Shared by both "Use My Location" and manual zip entry — resolves the
// nearest NWS station for the given coordinates, persists the result, and
// re-fetches weather/alerts against it.
async function applyNewLocation(partial) {
  wxLocStatus.textContent = 'Looking up weather station…';
  wxLocStatus.className = 'wx-location-status';
  wxUseLocBtn.disabled = true;
  wxZipSubmitBtn.disabled = true;
  try {
    const station = await resolveNwsStation(partial.lat, partial.lon);
    const loc = {
      lat: partial.lat,
      lon: partial.lon,
      zip: partial.zip ?? null,
      city: partial.city || station.label || 'Unknown location',
      detail: partial.detail || 'Detected location',
      stationId: station.stationId,
    };
    setActiveLocation(loc);
    renderActiveLocation();
    wxLocStatus.textContent = `Location set to ${loc.city}.`;
    wxLocStatus.className = 'wx-location-status success';
    fetchWeather();
    fetchAlerts();
  } catch (err) {
    wxLocStatus.textContent = err.message || 'Could not set that location.';
    wxLocStatus.className = 'wx-location-status error';
  } finally {
    wxUseLocBtn.disabled = false;
    wxZipSubmitBtn.disabled = false;
  }
}

wxUseLocBtn.addEventListener('click', async () => {
  wxLocStatus.textContent = 'Detecting your location…';
  wxLocStatus.className = 'wx-location-status';
  try {
    const { lat, lon } = await detectGeolocation();
    await applyNewLocation({ lat, lon });
  } catch (err) {
    wxLocStatus.textContent = err.message || 'Could not detect your location.';
    wxLocStatus.className = 'wx-location-status error';
  }
});

async function submitZip() {
  const zip = wxZipInput.value.trim();
  if (!/^\d{5}$/.test(zip)) {
    wxLocStatus.textContent = 'Enter a valid 5-digit zip code.';
    wxLocStatus.className = 'wx-location-status error';
    return;
  }
  wxLocStatus.textContent = 'Looking up zip code…';
  wxLocStatus.className = 'wx-location-status';
  try {
    const g = await geocodeZip(zip);
    await applyNewLocation(g);
  } catch (err) {
    wxLocStatus.textContent = err.message || 'Could not find that zip code.';
    wxLocStatus.className = 'wx-location-status error';
  }
}
document.getElementById('wx-zip-form').addEventListener('submit', e => {
  e.preventDefault();
  submitZip();
});

const nightDimFields = document.getElementById('night-dim-fields');

/* ══════════════════════════════════════════════════════════
   ON-SCREEN KEYBOARD (Settings > On-Screen Keyboard)
   For the Pi's own touchscreen, which has no physical keyboard and no OS-
   level virtual keyboard in kiosk Chromium. Off by default — every setting
   in this app is already per-device via localStorage, so a phone/tablet
   loading the same dashboard over the LAN keeps its own native keyboard
   and never sees this one; it only has to be turned on once, on the Pi.
   ══════════════════════════════════════════════════════════ */
const getOskEnabled = () => localStorage.getItem('oskEnabled') === 'true';

// Two modes — letters, and everything else in one page (iOS splits digits/
// punctuation across two separate screens, 123 then #+=, but that nested
// second tap was the one that was misbehaving; one flat symbols page removes
// that step entirely while still covering the same full character set).
const OSK_LAYOUTS = {
  letters: [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['⇧','z','x','c','v','b','n','m','⌫'],
    ['123',',','␣','.','⏎'],
  ],
  symbols: [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['-','/',':',';','(',')','$','&','@','"'],
    ['[',']','{','}','#','%','^','*','+','='],
    ['_','\\','|','~','<','>','.',',','⌫'],
    ['ABC','?','␣','!','\'','⏎'],
  ],
};

const osk = document.getElementById('osk');
let oskTarget = null;
let oskShift  = false;
let oskMode   = 'letters'; // 'letters' | 'symbols'

function oskIsTextField(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return ['text', 'search', 'email', 'number'].includes(el.type);
}

// Key labels double as both the visible glyph and the data-char attribute
// value below — this covers both spots against the punctuation keys that
// are themselves HTML-significant (" < & etc.).
const oskEsc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function buildOsk() {
  const MODE_KEYS = { '123': 'mode-symbols', 'ABC': 'mode-letters' };
  // A dedicated dismiss key, not just Enter — Enter on a textarea inserts a
  // newline rather than closing anything, so without this, the keyboard
  // could sit over a modal's Save/Cancel row with no way to reach it.
  osk.innerHTML =
    '<div class="osk-row osk-dismiss-row"><button type="button" class="osk-key osk-dismiss" data-key="dismiss">⌄ Hide keyboard</button></div>' +
    OSK_LAYOUTS[oskMode].map(row => '<div class="osk-row">' + row.map(k => {
    if (k === '⇧') return `<button type="button" class="osk-key osk-shift${oskShift ? ' active' : ''}" data-key="shift">⇧</button>`;
    if (k === '⌫') return `<button type="button" class="osk-key osk-backspace" data-key="backspace">⌫</button>`;
    if (k === '⏎') return `<button type="button" class="osk-key osk-enter" data-key="enter">⏎</button>`;
    if (k === '␣') return `<button type="button" class="osk-key osk-space" data-key="space"> </button>`;
    if (MODE_KEYS[k]) return `<button type="button" class="osk-key osk-mode" data-key="${MODE_KEYS[k]}">${k}</button>`;
    const raw   = /[a-z]/.test(k) && oskShift && oskMode === 'letters' ? k.toUpperCase() : k;
    const label = oskEsc(raw);
    return `<button type="button" class="osk-key" data-key="char" data-char="${label}">${label}</button>`;
  }).join('') + '</div>').join('');
}
buildOsk();

function oskInsert(text) {
  if (!oskTarget) return;
  const start  = oskTarget.selectionStart ?? oskTarget.value.length;
  const end    = oskTarget.selectionEnd   ?? oskTarget.value.length;
  const val    = oskTarget.value;
  const maxLen = oskTarget.maxLength; // -1 when unset
  if (maxLen >= 0 && val.length - (end - start) + text.length > maxLen) return;
  oskTarget.value = val.slice(0, start) + text + val.slice(end);
  const pos = start + text.length;
  oskTarget.setSelectionRange(pos, pos);
  oskTarget.dispatchEvent(new Event('input', { bubbles: true }));
}

function oskBackspace() {
  if (!oskTarget) return;
  const start = oskTarget.selectionStart ?? oskTarget.value.length;
  const end   = oskTarget.selectionEnd   ?? oskTarget.value.length;
  const val   = oskTarget.value;
  if (start === end) {
    if (start === 0) return;
    oskTarget.value = val.slice(0, start - 1) + val.slice(end);
    oskTarget.setSelectionRange(start - 1, start - 1);
  } else {
    oskTarget.value = val.slice(0, start) + val.slice(end);
    oskTarget.setSelectionRange(start, start);
  }
  oskTarget.dispatchEvent(new Event('input', { bubbles: true }));
}

function oskEnter() {
  if (!oskTarget) return;
  if (oskTarget.tagName === 'TEXTAREA') {
    oskInsert('\n');
    return;
  }
  // Matches native behavior: Enter in a single-line input submits its form.
  oskTarget.form?.requestSubmit();
  oskTarget.blur();
}

osk.addEventListener('pointerdown', e => {
  // Any tap inside the keyboard panel, not just one that lands on an actual
  // key — a tap in the gap between keys otherwise falls through to the
  // browser's default behavior (clicking anything that isn't the focused
  // input blurs it, even a plain non-interactive gap), closing the whole
  // keyboard on what should've been a harmless near-miss.
  e.preventDefault();
  const btn = e.target.closest('.osk-key');
  if (!btn) return;
  const key = btn.dataset.key;
  if (key === 'dismiss') { oskTarget?.blur(); hideOsk(); return; }
  if (key === 'char') { oskInsert(btn.dataset.char); if (oskShift) { oskShift = false; buildOsk(); } }
  else if (key === 'space') oskInsert(' ');
  else if (key === 'backspace') oskBackspace();
  else if (key === 'enter') oskEnter();
  else if (key === 'shift') { oskShift = !oskShift; buildOsk(); }
  else if (key === 'mode-symbols') { oskMode = 'symbols'; buildOsk(); }
  else if (key === 'mode-letters') { oskMode = 'letters'; oskShift = false; buildOsk(); }
  document.documentElement.style.setProperty('--osk-h', osk.offsetHeight + 'px'); // row count changes between modes
});

function showOsk(target) {
  oskTarget = target;
  // Reset each time a field is focused, same as iOS — except a field that's
  // declared itself numeric-only (inputmode="numeric", e.g. the zip code
  // input) opens straight to the digits page instead of making the user
  // hunt for "123" first.
  oskMode  = target?.inputMode === 'numeric' ? 'symbols' : 'letters';
  oskShift = false;
  buildOsk();
  osk.hidden = false;
  const oskHeight = osk.offsetHeight;
  document.documentElement.style.setProperty('--osk-h', oskHeight + 'px');
  document.body.classList.add('osk-open');

  // scrollIntoView({block:'center'}) centers the target in the *whole*
  // viewport — it has no idea a fixed-position panel is now covering the
  // bottom of it, so a field near the bottom of the sidebar (todo/bulletin,
  // which isn't inside a modal and gets no shrink-to-fit treatment) can
  // still end up scrolled to right behind the keyboard. Measure after the
  // fact and nudge the actual scroll container further if it's still
  // covered, rather than trusting the browser got it right.
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  const rect = target.getBoundingClientRect();
  const visibleBottom = window.innerHeight - oskHeight;
  if (rect.bottom > visibleBottom) {
    const scrollParent = target.closest('.sidebar, .modal') || document.scrollingElement;
    scrollParent.scrollTop += (rect.bottom - visibleBottom) + 16; // +16px breathing room
  }
}

function hideOsk() {
  oskTarget = null;
  osk.hidden = true;
  document.body.classList.remove('osk-open');
}

document.addEventListener('focusin', e => {
  if (!getOskEnabled()) return;
  if (oskIsTextField(e.target)) showOsk(e.target);
});
document.addEventListener('focusout', e => {
  if (!getOskEnabled()) return;
  // A key tap prevents the default blur (see pointerdown above), so if
  // focus is actually leaving, it's genuinely moving elsewhere — hide.
  setTimeout(() => {
    if (!oskIsTextField(document.activeElement)) hideOsk();
  }, 0);
});

/* ══════════════════════════════════════════════════════════
   APP VERSION (Settings footer)
   Build number is the commit count (see server.js) rather than
   package.json's version field, so it actually changes with every update
   instead of sitting frozen. Fetched once — neither value changes while
   the server process is running, so no reason to re-fetch per open.
   ══════════════════════════════════════════════════════════ */
fetch('/api/version').then(r => r.json()).then(({ build, commit }) => {
  document.getElementById('app-version').textContent =
    (build ? `Build ${build}` : '') + (commit ? ` · ${commit}` : '');
}).catch(() => {});

// Debug Options AND Graphics are both hidden by default — Debug so kids/
// guests don't stumble into weather/alert simulation tools, Graphics
// because the higher quality tiers can make weaker Pi hardware choppy and
// shouldn't be a casual accidental change. Tapping the version text 7
// times in a row reveals both, same "developer options" convention
// Android uses. Stored in localStorage so it stays unlocked across
// reloads once found; taps more than 2s apart don't count toward the streak.
const ADVANCED_SECTION_IDS = ['debug-section', 'graphics-section'];
let debugTapCount = 0;
let debugTapTimer = null;
if (localStorage.getItem('debugUnlocked') === 'true') {
  ADVANCED_SECTION_IDS.forEach(id => { document.getElementById(id).hidden = false; });
}
document.getElementById('app-version').addEventListener('click', () => {
  clearTimeout(debugTapTimer);
  debugTapCount++;
  if (debugTapCount >= 7) {
    debugTapCount = 0;
    localStorage.setItem('debugUnlocked', 'true');
    ADVANCED_SECTION_IDS.forEach(id => { document.getElementById(id).hidden = false; });
    showToast('Debug Options and Graphics unlocked.', 'success');
  } else {
    debugTapTimer = setTimeout(() => { debugTapCount = 0; }, 2000);
  }
});
document.getElementById('debug-lock-btn').addEventListener('click', () => {
  localStorage.removeItem('debugUnlocked');
  ADVANCED_SECTION_IDS.forEach(id => { document.getElementById(id).hidden = true; });
});

/* ══════════════════════════════════════════════════════════
   SELF-UPDATE
   Checks GitHub once shortly after load and then every 12h, not more
   often than that, since it's a real network call to GitHub each time and
   updates to a family calendar app aren't remotely time-sensitive. Shows a
   small badge (top bar) rather than anything that interrupts; the actual
   update only happens if the badge is tapped and "Update Now" is pressed
   in Settings, never automatic.
   ══════════════════════════════════════════════════════════ */
// Commit subjects already read reasonably plainly (this repo's own
// convention) once the "feat:"/"fix:" etc. prefix is stripped — good
// enough for a friendly summary without needing real language processing.
function friendlyCommitSubject(subject) {
  const stripped = subject.replace(/^(feat|fix|perf|polish|revert|docs|chore|refactor)(\([^)]*\))?:\s*/i, '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

let lastUpdateCommits = [];

async function checkForUpdate() {
  try {
    const r = await api('GET', '/api/update-check');
    document.getElementById('update-badge').hidden = !r.updateAvailable;
    document.getElementById('update-section').hidden = !r.updateAvailable;
    if (r.updateAvailable) {
      lastUpdateCommits = r.commits;
      document.getElementById('update-list').innerHTML = r.commits
        .map(c => `<li>${escHtml(friendlyCommitSubject(c.subject))}</li>`).join('');
      document.getElementById('update-technical').hidden = true;
      document.getElementById('update-see-more-btn').textContent = 'See exactly what changed';
    }
  } catch { /* GitHub unreachable, etc. — stay quiet, try again next interval */ }
}
setTimeout(checkForUpdate, 30000); // let critical startup fetches (weather, calendar) go first
setInterval(checkForUpdate, 12 * 60 * 60 * 1000);

document.getElementById('update-badge').addEventListener('click', () => {
  document.getElementById('settings-btn').click();
});

document.getElementById('update-see-more-btn').addEventListener('click', () => {
  const el = document.getElementById('update-technical');
  const btn = document.getElementById('update-see-more-btn');
  el.hidden = !el.hidden;
  btn.textContent = el.hidden ? 'See exactly what changed' : 'Hide technical detail';
  if (!el.hidden) {
    el.textContent = lastUpdateCommits
      .map(c => `${c.hash}  ${c.subject}${c.body ? '\n' + c.body.split('\n').map(l => '  ' + l).join('\n') : ''}`)
      .join('\n\n');
  }
});

document.getElementById('update-now-btn').addEventListener('click', async () => {
  const btn = document.getElementById('update-now-btn');
  const progress = document.getElementById('update-progress');
  btn.disabled = true;
  progress.textContent = 'Pulling the latest version...';
  try {
    await api('POST', '/api/update-apply');
  } catch (err) {
    progress.textContent = 'Update failed: ' + err.message;
    btn.disabled = false;
    return;
  }
  // The server exits right after responding (systemd brings it back up on
  // the new code) — poll for it to come back rather than guessing how long
  // that takes, then reload to pick up the new client-side files too.
  progress.textContent = 'Restarting the dashboard...';
  const start = Date.now();
  const poll = setInterval(async () => {
    if (Date.now() - start > 60000) {
      clearInterval(poll);
      progress.textContent = 'Taking longer than expected. Refresh the page manually in a moment.';
      return;
    }
    try {
      const r = await fetch('/api/version');
      if (r.ok) {
        clearInterval(poll);
        progress.textContent = 'Update complete. Reloading...';
        setTimeout(() => location.reload(), 500); // let the message actually be readable for a beat
      }
    } catch { /* still restarting — keep polling */ }
  }, 2000);
});

document.getElementById('settings-btn').addEventListener('click', () => {
  renderActiveLocation();
  applyTheme();
  document.getElementById('toggle-boot-sound').checked  = getBootSoundEnabled();
  document.getElementById('toggle-alert-sound').checked = getSoundEnabled();
  document.getElementById('toggle-alert-tts').checked   = getTtsEnabled();
  document.getElementById('text-scale-slider').value       = getTextScalePct();
  document.getElementById('brightness-slider').value       = getBrightnessPct();
  document.getElementById('toggle-night-dim').checked      = getNightDimEnabled();
  document.getElementById('night-dim-start').value         = getNightDimStart();
  document.getElementById('night-dim-end').value           = getNightDimEnd();
  document.getElementById('night-brightness-slider').value = getNightBrightnessPct();
  nightDimFields.style.display = getNightDimEnabled() ? 'block' : 'none';
  document.getElementById('toggle-lock-screen').checked = getLockScreenEnabled();
  document.getElementById('lock-reveal-secs').value     = getLockRevealSecs();
  document.getElementById('toggle-lock-agenda').checked = getLockAgendaEnabled();
  document.getElementById('toggle-osk').checked = getOskEnabled();
  settingsModal.hidden = false;
});

document.getElementById('toggle-boot-sound').addEventListener('change', e => {
  localStorage.setItem('bootSound', e.target.checked);
});
document.getElementById('toggle-alert-sound').addEventListener('change', e => {
  localStorage.setItem('alertSound', e.target.checked);
});
document.getElementById('toggle-alert-tts').addEventListener('change', e => {
  localStorage.setItem('alertTts', e.target.checked);
});

document.getElementById('text-scale-slider').addEventListener('input', e => {
  localStorage.setItem('textScalePct', e.target.value);
  applyTextScale();
});

document.getElementById('brightness-slider').addEventListener('input', e => {
  localStorage.setItem('brightnessPct', e.target.value);
  applyBrightness();
});
document.getElementById('toggle-night-dim').addEventListener('change', e => {
  localStorage.setItem('nightDimEnabled', e.target.checked);
  nightDimFields.style.display = e.target.checked ? 'block' : 'none';
  applyBrightness();
});
document.getElementById('night-dim-start').addEventListener('change', e => {
  localStorage.setItem('nightDimStart', e.target.value);
  applyBrightness();
});
document.getElementById('night-dim-end').addEventListener('change', e => {
  localStorage.setItem('nightDimEnd', e.target.value);
  applyBrightness();
});
document.getElementById('night-brightness-slider').addEventListener('input', e => {
  localStorage.setItem('nightBrightnessPct', e.target.value);
  applyBrightness();
});

document.getElementById('toggle-lock-screen').addEventListener('change', e => {
  localStorage.setItem('lockScreenEnabled', e.target.checked);
  updateLockUI();
});
document.getElementById('lock-reveal-secs').addEventListener('change', e => {
  localStorage.setItem('lockRevealSecs', e.target.value);
});
document.getElementById('toggle-lock-agenda').addEventListener('change', e => {
  localStorage.setItem('lockAgendaEnabled', e.target.checked);
  if (!document.getElementById('lock-screen').hidden) renderLockScreen();
});
document.getElementById('toggle-osk').addEventListener('change', e => {
  localStorage.setItem('oskEnabled', e.target.checked);
  if (!e.target.checked) hideOsk();
});

// Representative NWS-style text per debug mode, fed through the same
// nwsIcon()/wx-desc path real weather uses — so previewing a mode also
// previews the icon + description a family member would actually see next
// to the temperature, not just the canvas animation.
const DEBUG_MODE_DESC = {
  'clear-day': 'Clear', 'clear-night': 'Clear',
  'cloudy-day': 'Partly Cloudy', 'cloudy-night': 'Mostly Cloudy',
  'overcast': 'Overcast', 'fog': 'Fog',
  'windy-day': 'Windy', 'windy-night': 'Windy',
  'rain': 'Rain', 'snow': 'Snow',
  'sleet': 'Freezing Rain', 'hail': 'Hail',
  'storm': 'Thunderstorm', 'storm-severe': 'Severe Thunderstorm',
  'thundersnow': 'Thundersnow', 'hurricane': 'Hurricane', 'tornado': 'Tornado',
  'blizzard': 'Blizzard',
  'dust': 'Dust', 'smoke': 'Smoke',
  'extreme-heat': 'Extreme Heat', 'extreme-cold': 'Extreme Cold',
  'eclipse': 'Eclipse',
};

document.getElementById('debug-wx-grid').addEventListener('click', e => {
  const btn = e.target.closest('.debug-wx-btn');
  if (!btn) return;
  if (btn.dataset.intensity) wxIntensity = btn.dataset.intensity;
  applyWxMode(btn.dataset.mode);

  if (btn.dataset.mode === 'none') {
    fetchWeather(); // restore real icon/desc/temp instead of leaving the last simulated ones
  } else {
    const desc  = DEBUG_MODE_DESC[btn.dataset.mode] || '';
    const isDay = btn.dataset.mode.includes('night') ? false
                : btn.dataset.mode.includes('day')   ? true
                : isCurrentlyDay();
    document.getElementById('wx-icon').textContent = nwsIcon(desc, isDay);
    document.getElementById('wx-desc').textContent = desc;
    document.getElementById('lock-wx-icon').textContent = document.getElementById('wx-icon').textContent;
    document.getElementById('lock-wx-desc').textContent = document.getElementById('wx-desc').textContent;
  }

  document.querySelectorAll('.debug-wx-btn').forEach(b =>
    b.classList.toggle('active', b === btn));
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

/* ── Graphics submenu (opened from Settings) ──────────────── */
const graphicsModal = document.getElementById('graphics-modal');
// Same reasoning as getWxQuality above — defaults to lowest, not full.
const getGlassMode = () => localStorage.getItem('gfxGlass') || 'off';

function applyGlassSetting() {
  document.documentElement.dataset.glass = getGlassMode();
}
applyGlassSetting();

document.getElementById('graphics-open-btn').addEventListener('click', () => {
  document.querySelectorAll('#gfx-glass .theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.val === getGlassMode()));
  document.getElementById('toggle-gfx-lightning').checked = getLightningEnabled();
  document.querySelectorAll('#gfx-wx-quality .theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.val === getWxQuality()));
  settingsModal.hidden = true;
  graphicsModal.hidden = false;
});

document.getElementById('graphics-close').addEventListener('click', () => {
  graphicsModal.hidden = true;
  settingsModal.hidden = false;
});
graphicsModal.addEventListener('click', e => {
  if (e.target !== graphicsModal) return;
  graphicsModal.hidden = true;
  settingsModal.hidden = false;
});

document.getElementById('gfx-glass').addEventListener('click', e => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  localStorage.setItem('gfxGlass', btn.dataset.val);
  document.querySelectorAll('#gfx-glass .theme-opt').forEach(b =>
    b.classList.toggle('active', b === btn));
  applyGlassSetting();
});

document.getElementById('gfx-wx-quality').addEventListener('click', e => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  localStorage.setItem('gfxWxQuality', btn.dataset.val);
  document.querySelectorAll('#gfx-wx-quality .theme-opt').forEach(b =>
    b.classList.toggle('active', b === btn));
  applyWxMode(wxMode); // re-init particle counts (or stop/start the loop) immediately
});

document.getElementById('toggle-gfx-lightning').addEventListener('change', e => {
  localStorage.setItem('gfxLightning', e.target.checked);
  if (e.target.checked) {
    if (wxMode === 'storm') scheduleLightning();
  } else {
    clearTimeout(lightTimer);
    clearStrike();
  }
});

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
// Was ID-only, which was safe back when events could only be added/removed
// (both change ID membership) — but editing an event in place keeps the
// same ID with different content, which an ID-only signature can't see,
// so an edited title/time/color would silently not appear until the view
// or date changed and forced a rebuild anyway. Stringify full content instead.
function eventsSig(events) {
  return JSON.stringify(events.slice().sort((a, b) => a.id - b.id));
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
const addModal    = document.getElementById('add-modal');
const addForm     = document.getElementById('add-event-form');
const recurSel    = document.getElementById('ev-recur');
const intervalRow = document.getElementById('ev-interval-row');
const untilRow    = document.getElementById('ev-until-row');
const allDayCbx   = document.getElementById('ev-allday');
const timeFields  = document.getElementById('ev-time-fields');

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

const RECUR_UNIT_LABELS = {
  daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)',
  monthly_weekday: 'month(s)', yearly: 'year(s)',
};

recurSel.addEventListener('change', () => {
  const repeats = recurSel.value !== 'none';
  untilRow.style.display    = repeats ? 'flex' : 'none';
  intervalRow.style.display = repeats ? 'flex' : 'none';
  document.getElementById('ev-interval-unit').textContent = RECUR_UNIT_LABELS[recurSel.value] || '';
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
  untilRow.style.display    = 'none';
  intervalRow.style.display = 'none';
  timeFields.style.display  = 'flex';
  swatchContainer.querySelectorAll('.color-swatch').forEach((el, i) =>
    el.classList.toggle('selected', i === 0));
  selectedColor = COLORS[0].hex;
  editingEventId = null;
  document.getElementById('add-modal-title').textContent  = 'Add Event';
  document.getElementById('add-modal-submit').textContent = 'Save Event';
  document.getElementById('edit-recur-hint').hidden = true;
}

// Reuses the Add Event form/modal for editing — populates every field from
// the existing event, then the submit handler below routes to PATCH instead
// of POST based on `editingEventId`. Always edits the whole series for a
// recurring event (there's no per-occurrence edit, unlike delete).
function openEditModal(ev) {
  editingEventId = ev.id;

  document.getElementById('ev-title').value  = ev.title;
  document.getElementById('ev-desc').value   = ev.description || '';
  document.getElementById('ev-person').value = ev.person || '';

  selectedColor = ev.color;
  swatchContainer.querySelectorAll('.color-swatch').forEach((el, i) =>
    el.classList.toggle('selected', COLORS[i].hex === ev.color));

  document.getElementById('ev-date').value = ev.event_date;

  allDayCbx.checked = !!ev.all_day;
  timeFields.style.display = allDayCbx.checked ? 'none' : 'flex';
  document.getElementById('ev-start').value = ev.start_time || '';
  document.getElementById('ev-end').value   = ev.end_time   || '';
  document.getElementById('ev-private').checked = !!ev.is_private;

  recurSel.value = ev.recurrence || 'none';
  const repeats = recurSel.value !== 'none';
  untilRow.style.display    = repeats ? 'flex' : 'none';
  intervalRow.style.display = repeats ? 'flex' : 'none';
  document.getElementById('ev-interval-unit').textContent = RECUR_UNIT_LABELS[recurSel.value] || '';
  document.getElementById('ev-recur-interval').value = ev.recurrence_interval || 1;
  document.getElementById('ev-until').value = ev.recurrence_until || '';

  document.getElementById('add-modal-title').textContent  = 'Edit Event';
  document.getElementById('add-modal-submit').textContent = 'Save Changes';
  document.getElementById('edit-recur-hint').hidden = !repeats;

  addModal.hidden = false;
  document.getElementById('ev-title').focus();
}

document.getElementById('add-modal-cancel').addEventListener('click', closeAddModal);
addModal.addEventListener('click', e => { if (e.target === addModal) closeAddModal(); });

addForm.addEventListener('submit', async e => {
  e.preventDefault();
  const submitBtn = addForm.querySelector('[type="submit"]');
  const isEdit = editingEventId !== null;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';
  try {
    const repeats = recurSel.value !== 'none';
    const payload = {
      title:                document.getElementById('ev-title').value.trim(),
      description:          document.getElementById('ev-desc').value.trim(),
      person:               document.getElementById('ev-person').value.trim(),
      color:                selectedColor,
      event_date:           document.getElementById('ev-date').value,
      start_time:           allDayCbx.checked ? null : (document.getElementById('ev-start').value || null),
      end_time:             allDayCbx.checked ? null : (document.getElementById('ev-end').value   || null),
      all_day:              allDayCbx.checked,
      is_private:           document.getElementById('ev-private').checked,
      recurrence:           recurSel.value,
      recurrence_interval:  repeats ? (parseInt(document.getElementById('ev-recur-interval').value, 10) || 1) : 1,
      recurrence_until:     repeats ? (document.getElementById('ev-until').value || null) : null,
    };
    if (isEdit) await api('PATCH', `/api/calendar/${editingEventId}`, payload);
    else        await api('POST', '/api/calendar', payload);
    closeAddModal();
    loadCalendar();
  } catch (err) {
    showError(`Could not ${isEdit ? 'save changes' : 'save event'}: ` + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingEventId !== null ? 'Save Changes' : 'Save Event';
  }
});

/* ══════════════════════════════════════════════════════════
   EVENT DETAIL MODAL
   ══════════════════════════════════════════════════════════ */
const detailModal = document.getElementById('detail-modal');

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];

function describeRecurrence(ev) {
  const n = Math.max(1, parseInt(ev.recurrence_interval, 10) || 1);
  switch (ev.recurrence) {
    case 'daily':   return n === 1 ? 'Repeats daily'  : `Repeats every ${n} days`;
    case 'weekly':  return n === 1 ? 'Repeats weekly' : `Repeats every ${n} weeks`;
    case 'monthly': return (n === 1 ? 'Repeats monthly' : `Repeats every ${n} months`) + ' (same date)';
    case 'monthly_weekday': {
      const [, m, d] = ev.event_date.split('-').map(Number);
      const base = new Date(2000, m - 1, d); // arbitrary year — only weekday/ordinal matter
      const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const nth  = ORDINALS[Math.ceil(d / 7) - 1] || `${Math.ceil(d / 7)}th`;
      return (n === 1 ? 'Repeats monthly' : `Repeats every ${n} months`) + ` (${nth} ${DAYS[base.getDay()]})`;
    }
    case 'yearly':  return n === 1 ? 'Repeats yearly' : `Repeats every ${n} years`;
    default:        return '';
  }
}

function showEventDetail(ev) {
  detailEventId   = ev.id;
  detailEventDate = ev.display_date;
  detailEventFull = ev;
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
  if (ev.is_private) info += `<strong>🔒 Private</strong> (shows as "Busy" until tapped)<br>`;

  const isRecurring = ev.recurrence && ev.recurrence !== 'none';
  const occBtn = document.getElementById('detail-delete-occurrence');
  if (isRecurring) {
    info += `<strong>Recurrence:</strong> ${describeRecurrence(ev)}<br>`;
    document.getElementById('detail-delete').textContent = 'Delete All Occurrences';
    occBtn.hidden = false;
  } else {
    document.getElementById('detail-delete').textContent = 'Delete Event';
    occBtn.hidden = true;
  }

  if (ev.description) info += `<div class="detail-desc">${escHtml(ev.description)}</div>`;

  if (ev.created_at) {
    const createdFmt = new Date(ev.created_at * 1000).toLocaleDateString('en-US',
      { month: 'long', day: 'numeric', year: 'numeric' });
    info += `<div class="detail-created">Created ${createdFmt}</div>`;
  }

  document.getElementById('detail-body').innerHTML = info;
  detailModal.hidden = false;
}

document.getElementById('detail-close').addEventListener('click', () => { detailModal.hidden = true; });
detailModal.addEventListener('click', e => { if (e.target === detailModal) detailModal.hidden = true; });

document.getElementById('detail-edit').addEventListener('click', () => {
  if (!detailEventFull) return;
  detailModal.hidden = true;
  openEditModal(detailEventFull);
});

document.getElementById('detail-delete').addEventListener('click', async () => {
  if (!detailEventId) return;
  try {
    await api('DELETE', `/api/calendar/${detailEventId}`);
    detailModal.hidden = true;
    loadCalendar();
  } catch (err) { showError('Delete failed: ' + err.message); }
});

document.getElementById('detail-delete-occurrence').addEventListener('click', async () => {
  if (!detailEventId || !detailEventDate) return;
  try {
    await api('DELETE', `/api/calendar/${detailEventId}?date=${detailEventDate}`);
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
    todoList.innerHTML = '<li class="empty">Nothing here yet. Add a task above</li>';
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
document.querySelectorAll('.cal-view-btn').forEach(b =>
  b.classList.toggle('active', b.dataset.view === calView));
loadCalendar();
updateLockUI(); // shows the Lock Screen immediately on load if it's enabled

// Chromium's autoplay policy can block audio before any user gesture, so
// this tries immediately and — only if that was actually blocked — falls
// back to the very first tap/click anywhere on the page.
if (getBootSoundEnabled()) {
  let bootSoundPlayed = false;
  const tryBootChime = () => {
    if (bootSoundPlayed) return;
    const ctx = getAudioCtx();
    playBootChime();
    if (ctx.state === 'running') bootSoundPlayed = true;
  };
  tryBootChime();
  document.addEventListener('pointerdown', tryBootChime, { once: true });
}
