/* ═══════════════════════════════════════════════════════════
   Family Dashboard — app.js
   ═══════════════════════════════════════════════════════════ */

/* ── Kiosk flag ───────────────────────────────────────────── */
// The Wayland kiosk (system/labwc-autostart) opens /?kiosk — there's no
// unclutter on Wayland, so the page hides the cursor itself. Phones and
// other browsers never pass it, so their cursor is unaffected.
if (new URLSearchParams(location.search).has('kiosk')) document.documentElement.classList.add('kiosk');

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

  // IANA zone (e.g. "America/Chicago") — lets the setup guide set the Pi's
  // clock from the ZIP code alone
  return { stationId, label, timeZone: pd.properties?.timeZone || null };
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
let editingOccurrenceDate = null; // set when editing just one occurrence of a recurring series
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
const getLockScreenEnabled = () => localStorage.getItem('lockScreenEnabled') !== 'false'; // default on
const getLockRevealSecs    = () => parseInt(localStorage.getItem('lockRevealSecs'), 10) || 60;
const getLockAgendaEnabled = () => localStorage.getItem('lockAgendaEnabled') !== 'false'; // default on
const getLockAgendaStyle   = () => localStorage.getItem('lockAgendaStyle') || 'week'; // 'week' | 'days'

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

/* ── Lock Screen agenda ─────────────────────────────────────────────
   Two styles: a rolling 7-day "week preview" (today + the next six days),
   or the original "Today you have" / "Tomorrow you have" lists. Both get
   the same privacy treatment for private events. */
let lockAgendaEvents = { today: [], tomorrow: [] };
let lockWeekEvents   = []; // all events for the next 7 days, sorted

// All-day first, then by start time — same order a day column reads in
function sortAgendaEvents(events) {
  return events.slice().sort((a, b) => {
    const aAll = a.all_day || !a.start_time, bAll = b.all_day || !b.start_time;
    if (aAll !== bAll) return aAll ? -1 : 1;
    return (a.start_time || '').localeCompare(b.start_time || '');
  });
}

async function loadLockAgenda() {
  const todayD    = new Date();
  todayD.setHours(0, 0, 0, 0);
  const todayStr    = toYMD(todayD);
  const tomorrowStr = toYMD(addDays(todayD, 1));
  try {
    const events = sortAgendaEvents(
      await api('GET', `/api/calendar?start=${todayStr}&end=${toYMD(addDays(todayD, 6))}`));
    lockWeekEvents   = events;
    lockAgendaEvents = {
      today:    events.filter(e => e.display_date === todayStr),
      tomorrow: events.filter(e => e.display_date === tomorrowStr),
    };
  } catch {
    lockWeekEvents   = [];
    lockAgendaEvents = { today: [], tomorrow: [] };
  }
  if (!document.getElementById('lock-screen').hidden) renderLockScreen();
}

// Private events never show their title or color on the Lock Screen (color =
// person/category, so it would leak identity) — just a lock and the time.
function lockEventTime(ev) {
  return (!ev.all_day && ev.start_time)
    ? `${fmt12h(ev.start_time)}${ev.end_time ? '–' + fmt12h(ev.end_time) : ''}`
    : '';
}

const LOCK_WEEK_MAX_PER_DAY = 3;

function renderLockWeek() {
  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayD = new Date();
  todayD.setHours(0, 0, 0, 0);

  let html = '';
  for (let i = 0; i < 7; i++) {
    const d   = addDays(todayD, i);
    const ymd = toYMD(d);
    const dayEvents = lockWeekEvents.filter(e => e.display_date === ymd);
    const shown = dayEvents.slice(0, LOCK_WEEK_MAX_PER_DAY);
    const more  = dayEvents.length - shown.length;

    const chips = shown.map(ev => {
      // Week cells are narrow — start time only, the full range won't fit
      const shortTime = (!ev.all_day && ev.start_time)
        ? `<span class="lock-week-time">${fmt12h(ev.start_time)}</span>` : '';
      return ev.is_private
        ? `<div class="lock-week-chip is-private">${shortTime}${ICON.lock} Private</div>`
        : `<div class="lock-week-chip" style="background:${ev.color}">${shortTime}${escHtml(ev.title)}</div>`;
    }).join('');

    html += `<div class="lock-week-day${i === 0 ? ' is-today' : ''}">
      <div class="lock-week-hdr">
        <span class="lock-week-name">${i === 0 ? 'Today' : DAYS[d.getDay()]}</span>
        <span class="lock-week-num">${d.getDate()}</span>
      </div>
      <div class="lock-week-events">
        ${chips || '<div class="lock-week-empty">—</div>'}
        ${more > 0 ? `<div class="lock-week-more">+${more} more</div>` : ''}
      </div>
    </div>`;
  }
  document.getElementById('lock-week').innerHTML = html;
}

function renderLockAgenda() {
  const listFor = events => {
    if (!events.length) return '<div class="lock-agenda-empty">Nothing scheduled</div>';
    return events.map(ev => {
      // Private events already hide the title — giving them their real
      // color too would leak identity (color = person/category) through
      // the lock screen, defeating the point of marking them private.
      const label = ev.is_private ? `${ICON.lock} Private event` : escHtml(ev.title);
      // Time isn't identity-revealing the way title/color are, so it's
      // shown even for private events — just when, not what.
      const t    = lockEventTime(ev);
      const time = t ? `<span class="lock-agenda-time">${t}</span>` : '';
      return ev.is_private
        ? `<div class="lock-agenda-item is-private">${time}${label}</div>`
        : `<div class="lock-agenda-item" style="background:${ev.color}">${time}${label}</div>`;
    }).join('');
  };
  document.getElementById('lock-agenda-today').innerHTML    = listFor(lockAgendaEvents.today);
  document.getElementById('lock-agenda-tomorrow').innerHTML = listFor(lockAgendaEvents.tomorrow);
}

function renderLockScreen() {
  const on   = getLockAgendaEnabled();
  const week = getLockAgendaStyle() === 'week';
  document.getElementById('lock-week').hidden   = !(on && week);
  document.getElementById('lock-agenda').hidden = !(on && !week);
  if (on) week ? renderLockWeek() : renderLockAgenda();
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

// Date & Time Format button clicks — same scoped active-state pattern as
// the Graphics settings groups (gfx-glass/gfx-wx-quality), not the global
// theme buttons, since .theme-opt is reused across several independent
// groups on this page.
document.getElementById('date-format-options').addEventListener('click', e => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  localStorage.setItem('dateFormat', btn.dataset.val);
  document.querySelectorAll('#date-format-options .theme-opt').forEach(b =>
    b.classList.toggle('active', b === btn));
  refreshDateTimeDisplaysAppWide();
});
document.getElementById('time-format-options').addEventListener('click', e => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  localStorage.setItem('timeFormat', btn.dataset.val);
  document.querySelectorAll('#time-format-options .theme-opt').forEach(b =>
    b.classList.toggle('active', b === btn));
  refreshDateTimeDisplaysAppWide();
});

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

// Settings > Date & Time Format. Applied app-wide: every clock/calendar/
// event time funnels through fmt12hHM (kept the historical name — it now
// also handles 24h), and every spelled-out date through fmtLongDate below.
const getDateFormat = () => localStorage.getItem('dateFormat') || 'US'; // 'US' | 'EU'
const getTimeFormat = () => localStorage.getItem('timeFormat') || '12h'; // '12h' | '24h'

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
  if (getTimeFormat() === '24h') return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2,'0')} ${ampm}` : `${h12} ${ampm}`;
}

// Spelled-out date, e.g. "Thursday, July 23, 2026" (US) vs "Thursday, 23
// July 2026" (EU) — day-before-month for the EU order, matching how dates
// are actually spoken/written in most of the world outside the US, not
// just swapping the numeric MM/DD.
function fmtLongDate(dateObj, { weekday = null } = {}) {
  const mon  = CLOCK_MONS[dateObj.getMonth()];
  const day  = dateObj.getDate();
  const yr   = dateObj.getFullYear();
  const core = getDateFormat() === 'EU' ? `${day} ${mon} ${yr}` : `${mon} ${day}, ${yr}`;
  return weekday ? `${weekday}, ${core}` : core;
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

// api() throws the server's raw response text, which for this app's routes
// is a JSON {error} body — pull out the plain-language message for display.
function errText(err) {
  try { return JSON.parse(err.message).error || err.message; } catch { return err.message; }
}

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

// The live clock always shows minutes, unlike fmt12hHM's calendar/forecast
// use elsewhere (where a bare "2 PM" for a whole-hour event is the
// established, more compact convention) — a literal clock reading "2 PM"
// while the minute hand visibly isn't at :00 would look broken.
function fmtClockTime(h, m) {
  if (getTimeFormat() === '24h') return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

function updateClock() {
  const now  = new Date();
  const h    = now.getHours();
  const clockText = fmtClockTime(h, now.getMinutes());
  const dateText  = fmtLongDate(now, { weekday: CLOCK_DAYS[now.getDay()] });

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

// Graphics setting (Settings > Graphics > Animated Sky): 'off' | 'reduced' | 'full'
// Defaults to Full, the owner's chosen look (with Frosted Glass Off, which
// is what keeps a Pi 4 smooth at 1080p). A weaker board can be turned down
// in Settings > Graphics, or by the Graphics Benchmark.
const getWxQuality = () => localStorage.getItem('gfxWxQuality') || 'full';
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
  // Clouds pick up the sunrise/sunset color, like the real thing
  const w = skyState?.warm ?? 0;
  const tint = (from, to) => from.map((v, i) => Math.round(v + (to[i] - v) * w)).join(',');
  const colorRgba =
    wxMode === 'cloudy-day' || wxMode === 'windy-day'     ? `rgba(${tint([255,255,255], [255,190,160])},0.92)` :
    wxMode === 'cloudy-night' || wxMode === 'windy-night' ? `rgba(${tint([16,22,58], [96,70,112])},0.96)` :
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

/* ── Sky by time of day ───────────────────────────────────── */
// Clear, cloudy and windy skies follow the real sun: dawn glow, golden hour,
// sunset and dusk colors, a sun that tracks across the sky by day, and the
// moon (in its actual phase) by night. Colors blend between keyframes timed
// off today's sunrise/sunset. The blended sky is pre-rendered to an
// OffscreenCanvas and only redrawn when refreshSky() (once a minute) finds
// it has visibly changed, so per-frame cost is one blit, same as before.
const SKY_STOP_POS = [0, 0.45, 0.80, 1]; // top → horizon
const SKY_PALETTES = {
  night:    [[ 4,  7,  28, 0.94], [ 6,  11,  39, 0.84], [  7,  14,  47, 0.76], [  8,  16,  52, 0.72]],
  twilight: [[10, 18,  60, 0.94], [38,  44, 110, 0.86], [120,  80, 140, 0.74], [215, 120, 110, 0.66]],
  sunset:   [[22, 48, 120, 0.94], [96,  76, 150, 0.84], [232, 112,  82, 0.76], [255, 170,  80, 0.70]],
  golden:   [[14, 70, 165, 0.95], [50, 120, 200, 0.85], [225, 170, 110, 0.70], [255, 200, 120, 0.60]],
  day:      [[ 8, 55, 155, 0.95], [15, 100, 205, 0.85], [ 40, 140, 225, 0.68], [ 70, 170, 235, 0.48]],
};
// [minutes from sunrise, palette] and [minutes from sunset, palette]
const SKY_MORNING = [[-70, 'night'], [-30, 'twilight'], [5, 'sunset'], [45, 'golden'], [110, 'day']];
const SKY_EVENING = [[-110, 'day'], [-45, 'golden'], [0, 'sunset'], [30, 'twilight'], [70, 'night']];
const SYNODIC_DAYS = 29.530588853;
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14); // a known new moon

let skyClockOverride = null; // minutes since midnight; Debug ▸ Preview Sky Time
let skyState = null;
let moonOC = null, moonOCKey = '';

function skyNowMins() {
  if (skyClockOverride !== null) return skyClockOverride;
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
}

// Moon age in days: 0 = new, ~14.8 = full
function moonAgeDays() {
  return (((Date.now() - NEW_MOON_REF) / 86400000) % SYNODIC_DAYS + SYNODIC_DAYS) % SYNODIC_DAYS;
}

// Which two palettes to blend right now, and how far between them (0-1)
function skyBlend(nowM) {
  if (sunriseMins === null || sunsetMins === null) {
    const p = isCurrentlyDay() ? 'day' : 'night';
    return [p, p, 0];
  }
  const keys = [
    ...SKY_MORNING.map(([m, p]) => [sunriseMins + m, p]),
    ...SKY_EVENING.map(([m, p]) => [sunsetMins + m, p]),
  ].sort((a, b) => a[0] - b[0]);
  if (nowM <= keys[0][0] || nowM >= keys[keys.length - 1][0]) return ['night', 'night', 0];
  let i = 0;
  while (nowM >= keys[i + 1][0]) i++;
  const [a, pa] = keys[i], [b, pb] = keys[i + 1];
  // Quantized to tenths, so the sky re-renders a handful of times per transition
  return [pa, pb, Math.round((nowM - a) / (b - a) * 10) / 10];
}

// Screen position (as fractions) for a body "f" of the way through its time
// above the horizon, rising bottom-left and setting bottom-right; null when
// it's below the horizon
function skyArc(f) {
  if (f < -0.03 || f > 1.03) return null;
  const e = Math.sin(Math.PI * Math.min(1, Math.max(0, f))); // 0 at horizon, 1 overhead
  return { x: 0.08 + 0.84 * f, y: 0.95 - 0.8 * e, e: Math.round(e * 50) / 50 };
}

function refreshSky() {
  const nowM = skyNowMins();
  const [pa, pb, t] = skyBlend(nowM);
  const weight = name => (pa === name ? 1 - t : 0) + (pb === name ? t : 0);
  const stops = SKY_PALETTES[pa].map((ca, i) => ca.map((v, j) => {
    const mixed = v + (SKY_PALETTES[pb][i][j] - v) * t;
    return j === 3 ? +mixed.toFixed(2) : Math.round(mixed);
  }));

  let sun = null, moon = null;
  if (sunriseMins !== null && sunsetMins !== null) {
    const dayLen = sunsetMins - sunriseMins;
    sun = skyArc(Math.round((nowM - sunriseMins) / dayLen * 100) / 100);
    // The moon runs ~50 min a day behind the sun: it rises with the sun at
    // new moon and at sunset when full. Close enough to place it in the sky.
    const age = moonAgeDays();
    const moonM = ((nowM - age / SYNODIC_DAYS * 1440) % 1440 + 1440) % 1440;
    const pos = skyArc(Math.round((moonM - sunriseMins) / dayLen * 100) / 100);
    if (pos) moon = { ...pos, age: Math.round(age * 4) / 4 };
  }

  const prevKey = skyState?.key;
  skyState = {
    stops,
    sun,
    moon,
    day:   weight('day') + weight('golden') * 0.6,                                   // midday highlights
    stars: weight('night') + weight('twilight') * 0.35,                              // stars/moon visibility
    warm:  weight('sunset') + weight('golden') * 0.5 + weight('twilight') * 0.6,     // cloud tint
  };
  skyState.key = JSON.stringify([stops, sun, moon]);
  if (skyState.key !== prevKey) {
    daySkyOC = null;
    // Clear Day draws one static frame rather than looping, so redraw it here
    if (wxMode === 'clear-day' && getWxQuality() !== 'off' && !document.hidden) startAnim();
  }
}

// drawTimeSky: blits the pre-rendered sky (gradient, highlights, sun).
// Re-rendered only on resize or when refreshSky() changes it.
function drawTimeSky() {
  const W = wxCanvas.width, H = wxCanvas.height;
  if (!skyState) refreshSky();
  if (!daySkyOC || daySkyOC.width !== W || daySkyOC.height !== H || daySkyOC.mode !== wxMode) {
    daySkyOC = new OffscreenCanvas(W, H);
    const dc = daySkyOC.getContext('2d');
    // Stops are deep and fairly opaque on purpose: on the TN panel this app
    // runs on, pale/low-opacity color washes out at anything but a dead-on
    // viewing angle, so the gradient reads punchier than a normal monitor needs.
    const g = dc.createLinearGradient(0, 0, 0, H);
    skyState.stops.forEach(([r, gr, b, a], i) => g.addColorStop(SKY_STOP_POS[i], `rgba(${r},${gr},${b},${a})`));
    dc.fillStyle = g;
    dc.fillRect(0, 0, W, H);
    if (skyState.day > 0.05) {
      [[0.20,0.16],[0.54,0.09],[0.79,0.21],[0.37,0.29]].forEach(([cfx,cfy]) => {
        const g2 = dc.createRadialGradient(W*cfx,H*cfy,0, W*cfx,H*cfy,W*0.14);
        g2.addColorStop(0, `rgba(255,255,255,${(0.11 * skyState.day).toFixed(3)})`);
        g2.addColorStop(1, 'rgba(255,255,255,0)');
        dc.fillStyle = g2;
        dc.fillRect(0, 0, W, H);
      });
    }
    const sun = skyState.sun;
    if (sun) drawSun(dc, W * sun.x, H * sun.y, Math.min(W, H), sun.e, SUN_STRENGTH[wxMode] ?? 1);
    daySkyOC.mode = wxMode;
  }
  wxCtx.drawImage(daySkyOC, 0, 0);
}

// How much of the sun comes through each kind of sky (1 = clear)
const SUN_STRENGTH = { 'clear-day': 1, 'windy-day': 0.9, 'cloudy-day': 0.75 };

// The sun as light, not a shape: a bright center that fades out smoothly
// with no visible edge, inside a wide atmospheric glow. Low in the sky it
// turns deep orange and its glow spreads out along the horizon. `k` dims
// it for hazier skies.
function drawSun(dc, sx, sy, R, e, k = 1) {
  const gr = Math.round(140 + 105 * e), b = Math.round(50 + 160 * e); // orange → near-white
  const tint = a => `rgba(255,${gr},${b},${(a * k).toFixed(3)})`;

  const glowR = R * (0.62 - 0.22 * e);
  dc.save();
  dc.translate(sx, sy);
  dc.scale(1.8 - 0.8 * e, 1); // flattened along the horizon when low
  const glow = dc.createRadialGradient(0, 0, 0, 0, 0, glowR);
  glow.addColorStop(0,    tint(0.42));
  glow.addColorStop(0.18, tint(0.20));
  glow.addColorStop(0.50, tint(0.06));
  glow.addColorStop(1,    tint(0));
  dc.fillStyle = glow;
  dc.fillRect(-glowR, -glowR, glowR * 2, glowR * 2);
  dc.restore();

  // Center: white overhead, deep gold near the horizon. Many stops on a
  // bell-shaped falloff, so there's no flat disc and no ring.
  const low = 1 - e;
  const core = a => `rgba(255,${Math.round(252 - 80 * low)},${Math.round(240 - 170 * low)},${(a * k).toFixed(3)})`;
  const bloomR = R * (0.16 + 0.04 * low);
  const bloom = dc.createRadialGradient(sx, sy, 0, sx, sy, bloomR);
  [[0, 0.95], [0.05, 0.85], [0.10, 0.62], [0.17, 0.38], [0.27, 0.20], [0.42, 0.09], [0.65, 0.03], [1, 0]]
    .forEach(([p, a]) => bloom.addColorStop(p, core(a)));
  dc.fillStyle = bloom;
  dc.fillRect(sx - bloomR, sy - bloomR, bloomR * 2, bloomR * 2);
}

// Sun or moon behind weather that hides its shape (overcast, fog, rain,
// snow...): just a dim, diffuse bright patch, strength per kind of sky.
// Storms hide it completely.
const VEILED_LIGHT = {
  overcast: 0.45, fog: 0.6, smoke: 0.55, dust: 0.5, snow: 0.35, sleet: 0.25,
  rain: 0.3, 'extreme-cold': 0.6,
};
// How much the weather sky darkens at night (its colors are daytime ones)
const NIGHT_DIM = {
  overcast: 0.5, fog: 0.55, smoke: 0.5, dust: 0.5, snow: 0.45, sleet: 0.4,
  rain: 0.35, storm: 0.3, 'storm-severe': 0.25, hurricane: 0.25, tornado: 0.25,
  hail: 0.25, thundersnow: 0.35, blizzard: 0.4, 'extreme-cold': 0.5, 'extreme-heat': 0.55,
};

// Night darkening, sunrise/sunset warmth and the veiled sun/moon, painted
// over a weather sky
function paintSkyTimeOverlay(ctx) {
  const s = skyState;
  if (!s) return;
  const W = wxCanvas.width, H = wxCanvas.height;
  const heavyRain = wxMode === 'rain' && wxIntensity === 'heavy';
  const dim = (NIGHT_DIM[wxMode] ?? 0) * s.stars;
  const warm = s.warm * (heavyRain ? 0.3 : 1) * (VEILED_LIGHT[wxMode] ? 1 : 0.4);
  const body = s.sun ?? (s.stars > 0.5 ? s.moon : null);
  const light = body ? (VEILED_LIGHT[wxMode] ?? 0) * (heavyRain ? 0.4 : 1) : 0;
  if (dim >= 0.02) {
    ctx.fillStyle = `rgba(3,6,20,${dim.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (warm >= 0.05) {
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
    g.addColorStop(0, 'rgba(255,140,90,0)');
    g.addColorStop(1, `rgba(255,140,90,${(0.22 * Math.min(1, warm)).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.35, W, H * 0.65);
  }
  if (light >= 0.02) {
    const isSun = body === s.sun;
    const bx = W * body.x, by = H * body.y, R = Math.min(W, H) * (isSun ? 0.42 : 0.3);
    const c = isSun ? `255,${Math.round(200 + 50 * body.e)},${Math.round(150 + 90 * body.e)}` : '215,225,255';
    const a = light * (isSun ? 0.55 : 0.3) * (isSun ? 1 : s.moon.age > 7 && s.moon.age < 22 ? 1 : 0.5);
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, R);
    g.addColorStop(0,    `rgba(${c},${a.toFixed(3)})`);
    g.addColorStop(0.25, `rgba(${c},${(a * 0.45).toFixed(3)})`);
    g.addColorStop(1,    `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(bx - R, by - R, R * 2, R * 2);
  }
}

// Weather skies are fixed gradients, so the sky plus its time-of-day
// overlay is drawn once into an image and reused every frame: one
// full-screen draw per frame, same as a plain gradient fill. (Drawing the
// overlay separately each frame cost ~10-15 FPS on a Pi 4 at 1080p.)
// Rebuilt when the weather, size or sky (refreshSky, once a minute) changes.
let wxSkyOC = null, wxSkyKey = '';
function drawWeatherSky(drawBase) {
  const W = wxCanvas.width, H = wxCanvas.height;
  const key = [W, H, wxMode, wxIntensity, skyState?.key].join('|');
  if (wxSkyKey !== key) {
    wxSkyKey = key;
    wxSkyOC = new OffscreenCanvas(W, H);
    wxCtx.clearRect(0, 0, W, H);
    drawBase();
    paintSkyTimeOverlay(wxCtx);
    wxSkyOC.getContext('2d').drawImage(wxCanvas, 0, 0);
    return; // already on screen for this frame
  }
  wxCtx.drawImage(wxSkyOC, 0, 0);
}

// The moon's darker "seas" (maria) as seen from the Northern Hemisphere:
// [x, y, radius-x, radius-y] as fractions of the moon's radius
const MOON_MARIA = [
  [-0.52,  0.02, 0.30, 0.46],  // Oceanus Procellarum
  [-0.30, -0.38, 0.27, 0.22],  // Imbrium
  [ 0.15, -0.32, 0.17, 0.16],  // Serenitatis
  [ 0.32, -0.04, 0.22, 0.17],  // Tranquillitatis
  [ 0.64, -0.24, 0.11, 0.09],  // Crisium
  [ 0.50,  0.22, 0.12, 0.16],  // Fecunditatis
  [ 0.26,  0.34, 0.09, 0.08],  // Nectaris
  [-0.16,  0.40, 0.16, 0.12],  // Nubium
];

// Pre-renders the moon in its current phase (lit on the right while
// waxing, as seen from the Northern Hemisphere): limb-darkened surface,
// soft blurred maria, a soft terminator, faint earthshine on the dark side
// and a halo that grows with the moon's brightness. Cached until the phase
// or size changes, so this runs a few times a day at most.
function renderMoon(r, age) {
  const phase = age / SYNODIC_DAYS;          // 0 new, 0.5 full
  const k = Math.cos(phase * 2 * Math.PI);   // terminator: 1 new, 0 half, -1 full
  const lit = (1 - k) / 2;                   // fraction of the disc lit
  const pad = r * 3.2, S = Math.ceil((r + pad) * 2), c = S / 2;
  const oc = new OffscreenCanvas(S, S), m = oc.getContext('2d');

  // Halo: bright right at the moon, so it seems to glow rather than sit
  // on the sky as a cut-out circle
  const halo = m.createRadialGradient(c, c, r * 0.6, c, c, r + pad);
  halo.addColorStop(0,    `rgba(225,232,255,${(0.10 + 0.40 * lit).toFixed(3)})`);
  halo.addColorStop(0.10, `rgba(220,228,255,${(0.06 + 0.22 * lit).toFixed(3)})`);
  halo.addColorStop(0.30, `rgba(215,225,255,${(0.02 + 0.08 * lit).toFixed(3)})`);
  halo.addColorStop(1,    'rgba(215,225,255,0)');
  m.fillStyle = halo;
  m.fillRect(0, 0, S, S);

  // Surface: limb darkening plus the maria, blurred so they read as tone, not spots
  const surf = new OffscreenCanvas(S, S), s = surf.getContext('2d');
  const limb = s.createRadialGradient(c - r * 0.15, c - r * 0.15, 0, c, c, r);
  limb.addColorStop(0,   '#fbf8ef');
  limb.addColorStop(0.7, '#eeeadf');
  limb.addColorStop(1,   '#cfcbc0');
  s.fillStyle = limb;
  s.beginPath(); s.arc(c, c, r, 0, Math.PI * 2); s.fill();
  s.globalCompositeOperation = 'source-atop';
  s.filter = `blur(${Math.max(0.6, r * 0.07).toFixed(1)}px)`;
  s.fillStyle = 'rgba(112,116,132,0.38)';
  for (const [dx, dy, rx, ry] of MOON_MARIA) {
    s.beginPath(); s.ellipse(c + dx * r, c + dy * r, rx * r, ry * r, 0.3, 0, Math.PI * 2); s.fill();
  }
  s.filter = 'none';

  // Earthshine: the unlit part is faintly visible, especially near new moon
  m.globalAlpha = 0.05 + 0.06 * (1 - lit);
  m.drawImage(surf, 0, 0);
  m.globalAlpha = 1;

  // Phase mask: the lit half plus (gibbous) or minus (crescent) the
  // terminator ellipse, blurred so the terminator fades like the real one
  const mask = new OffscreenCanvas(S, S), q = mask.getContext('2d');
  q.fillStyle = '#000';
  q.beginPath(); q.arc(c, c, r, -Math.PI / 2, Math.PI / 2, phase >= 0.5); q.fill();
  q.globalCompositeOperation = k > 0 ? 'destination-out' : 'source-over';
  q.beginPath(); q.ellipse(c, c, Math.max(0.01, r * Math.abs(k)), r, 0, 0, Math.PI * 2); q.fill();
  s.globalCompositeOperation = 'destination-in';
  s.filter = `blur(${Math.max(1, r * 0.12).toFixed(1)}px)`;
  s.drawImage(mask, 0, 0);
  // Soft outer edge too: seen through air, the moon's rim isn't razor sharp
  m.filter = `blur(${Math.max(0.8, r * 0.06).toFixed(1)}px)`;
  m.drawImage(surf, 0, 0);
  m.filter = 'none';
  return oc;
}

function drawMoon() {
  const moon = skyState?.moon;
  if (!moon || skyState.stars < 0.15) return;
  const W = wxCanvas.width, H = wxCanvas.height;
  const r = Math.round(Math.min(W, H) * 0.032);
  const key = `${r}:${moon.age}`;
  if (moonOCKey !== key) { moonOC = renderMoon(r, moon.age); moonOCKey = key; }
  // Thin clouds still let it through, a little dimmer
  wxCtx.globalAlpha = Math.min(1, skyState.stars) * (wxMode === 'cloudy-night' ? 0.75 : 1);
  wxCtx.drawImage(moonOC, W * moon.x - moonOC.width / 2, H * moon.y - moonOC.height / 2);
  wxCtx.globalAlpha = 1;
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
  drawWeatherSky(() => {
    wxCtx.fillStyle = getSkyGrad(key, baseStops);
    wxCtx.fillRect(0, 0, wxCanvas.width, wxCanvas.height);
  });
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

function drawStars(ts, vis = 1) {
  wxCtx.fillStyle = '#ffffff';
  for (const s of wxStars) {
    wxCtx.globalAlpha = vis * s.base * (0.4 + 0.6 * Math.sin(ts * s.freq + s.phi));
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
      drawTimeSky();
      wxAnimId = null;
      return;               // static — no RAF loop needed

    case 'clear-night':
      drawTimeSky();
      drawStars(ts, skyState.stars);
      drawMoon();
      break;

    case 'cloudy-day':
      drawTimeSky();
      drawClouds(dt);
      break;

    case 'cloudy-night':
      drawTimeSky();
      drawStars(ts, skyState.stars);
      drawMoon();
      drawClouds(dt);       // dark puffs occlude stars beneath them
      break;

    case 'overcast':
      drawWeatherSky(drawOvercastSky);
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
      drawTimeSky();
      drawClouds(dt);
      drawStreaks(dt);
      break;

    case 'windy-night':
      drawTimeSky();
      drawStars(ts, skyState.stars);
      drawMoon();
      drawClouds(dt);
      drawStreaks(dt);
      break;

    case 'rain':
    case 'storm':
      drawWeatherSky(drawRainSky);
      drawRain(dt);
      break;

    case 'storm-severe':
      drawWeatherSky(drawStormDarkSky);
      drawRain(dt);
      break;

    case 'hurricane':
      drawWeatherSky(drawStormDarkSky);
      drawRain(dt);
      drawStreaks(dt);
      break;

    case 'tornado':
      drawWeatherSky(drawTornadoSky);
      drawRain(dt);
      drawFunnel(ts);
      break;

    case 'sleet':
      drawWeatherSky(drawSnowSky);
      drawSleet(dt);
      break;

    case 'hail':
      drawWeatherSky(drawStormDarkSky);
      drawHail(ts, dt);
      break;

    case 'snow':
      drawWeatherSky(drawSnowSky);
      drawSnow(ts, dt);
      break;

    case 'thundersnow':
      drawWeatherSky(drawSnowSky);
      drawSnow(ts, dt);
      break;

    case 'blizzard':
      drawWeatherSky(drawBlizzardSky);
      drawStreaks(dt);
      drawBlizzard(dt);
      break;

    case 'extreme-heat':
      drawWeatherSky(drawHeatSky);
      drawHeatShimmer(ts);
      break;

    case 'extreme-cold':
      drawWeatherSky(drawColdSky);
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
  // Drives the sky-aware glass tint in CSS — "none" when the canvas is off,
  // since the panels then sit on the plain theme background
  document.body.dataset.wx = getWxQuality() === 'off' ? 'none' : mode;
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
  if (benchRunning) return; // a weather refresh mid-benchmark would swap the scene being measured
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
  // "Overcast"/"considerable cloudiness" = full 100% cloud cover, genuinely
  // dim regardless of time of day — that's what earns the flat grey sky and
  // forces dark theme below. "Mostly Cloudy" is NOT full cover (NWS still
  // has it well short of "Overcast") and stays plenty bright during the
  // day, so it's handled by the regular cloudy-day/cloudy-night branch
  // further down instead of being lumped in here.
  if (d.includes('overcast') || d.includes('considerable'))
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
setInterval(refreshSky, 60000);

/* ══════════════════════════════════════════════════════════
   NWS WEATHER ALERTS
   ══════════════════════════════════════════════════════════ */
const ALERT_SEV  = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
const ALERT_CLS  = { Extreme: 'alert-extreme', Severe: 'alert-severe', Moderate: 'alert-moderate', Minor: 'alert-minor' };
// Filled in lazily: ICON is defined further down the file
const alertIcon = sev => (sev === 'Minor' || !sev) ? ICON.info : ICON.alert;

/* ── Alert sound & TTS ────────────────────────────────────── */
const getSoundEnabled = () => localStorage.getItem('alertSound') === 'true';
const getTtsEnabled   = () => localStorage.getItem('alertTts')   === 'true';
const getBootSoundEnabled = () => localStorage.getItem('bootSound') !== 'false'; // default on
// Piper length_scale — higher = slower/clearer. 1.15 (slightly slower than
// the model's natural 1.0 pace) matches the server's own default; kept in
// sync manually since this is sent explicitly on every request rather than
// omitted, so the Settings slider and the server config can't drift apart
// silently.
const getTtsRate = () => parseFloat(localStorage.getItem('ttsRate')) || 1.15;
// Defaults to 'Minor' (read every alert) so adding this setting doesn't
// silently change behavior for anyone who already has Read Aloud on —
// beeps are unaffected by this either way, only the spoken readout.
const getTtsMinSeverity = () => localStorage.getItem('ttsMinSeverity') || 'Minor';
// 0-100, default 100 (unchanged from before this setting existed). One
// dial for all three dashboard sounds rather than three independent ones —
// simplest to use, and matches how a TV/speaker's own volume control works.
const getSoundVolume = () => {
  const v = parseInt(localStorage.getItem('soundVolume'), 10);
  return Number.isFinite(v) ? v : 100;
};

let audioCtx       = null;
let masterGainNode = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
// Boot chime, alert beeps, and TTS playback all route through this one
// shared gain node instead of straight to ctx.destination, so the Sound
// Volume slider controls all three uniformly — nothing extra to wire up
// each time a new sound is added.
function getMasterGain() {
  const ctx = getAudioCtx();
  if (!masterGainNode) {
    masterGainNode = ctx.createGain();
    masterGainNode.connect(ctx.destination);
  }
  masterGainNode.gain.value = getSoundVolume() / 100;
  return masterGainNode;
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
  const out = getMasterGain();
  const beep = (freq, start, dur) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(out);
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
    const out   = getMasterGain();
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
      gain.connect(out);
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
let ttsPrefetch      = null; // { item, promise } — the queue's front item, fetched ahead while the previous item was still playing

function cancelTts() {
  ttsQueue = [];
  ttsPrefetch = null;
  if (currentTtsSource) { try { currentTtsSource.stop(); } catch { /* already stopped */ } currentTtsSource = null; }
  ttsPlaying = false;
}

// Speed/clarity is tuned server-side via Piper's own settings now (see
// /api/tts) — deliberately no client-side playbackRate here. Time-stretching
// an already-synthesized voice via playbackRate reintroduces warble on top
// of whatever the engine already produced.
const TTS_GAP_MS = 300; // brief pause between queued utterances, for clarity

async function fetchTtsAudio(text) {
  let res;
  try {
    res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, rate: getTtsRate() }),
    });
  } catch {
    throw new Error('Could not reach the dashboard server for text-to-speech.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.warn('TTS request failed:', body.detail || res.status);
    throw new Error('Text-to-speech engine unavailable on this device.');
  }
  return res.arrayBuffer();
}

function speakText(text, onerror, onsuccess) {
  ttsQueue.push({ text, onerror, onsuccess });
  processTtsQueue();
}

async function processTtsQueue() {
  if (ttsPlaying || ttsQueue.length === 0) return;
  ttsPlaying = true;
  const item = ttsQueue.shift();
  const done = () => {
    currentTtsSource = null;
    ttsPlaying = false;
    setTimeout(processTtsQueue, TTS_GAP_MS);
  };
  try {
    // A multi-chunk alert (see chunkTextForSpeech below) used to only start
    // fetching each chunk once it became the current item — meaning the
    // synthesis time for chunk N+1 played out as an audible silent gap
    // after chunk N finished. Reusing a prefetch kicked off while the
    // previous item was still playing (below) closes that gap; falls back
    // to fetching now for the very first item, or after cancelTts() cleared
    // the queue mid-prefetch.
    const audioPromise = (ttsPrefetch && ttsPrefetch.item === item) ? ttsPrefetch.promise : fetchTtsAudio(item.text);
    ttsPrefetch = null;
    const arrayBuffer = await audioPromise;

    const ctx = getAudioCtx();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(getMasterGain());
    source.onended = done;
    currentTtsSource = source;
    source.start();
    item.onsuccess?.();

    // Start fetching the NEXT queued item now, overlapping with this one's
    // playback — capped to a single item of look-ahead (not the whole
    // remaining queue) so a long, many-chunk alert doesn't fire a burst of
    // concurrent Piper processes at once on Pi-class hardware.
    if (ttsQueue.length) {
      const nextItem = ttsQueue[0];
      const nextPromise = fetchTtsAudio(nextItem.text);
      nextPromise.catch(() => {}); // real handling happens once this item is dequeued and actually awaited, above
      ttsPrefetch = { item: nextItem, promise: nextPromise };
    }
  } catch (err) {
    item.onerror?.(err.message || 'Text-to-speech failed.');
    done();
  }
}

// NWS bulletins use formatting that reads fine on screen but trips up a
// TTS frontend: "* WHEN...Until 430 PM CDT" glues a bare bullet, an
// ellipsis, and a number-only time directly onto the next word with no
// separating space — exactly the kind of thing that makes a synthesizer
// slur or skip the phrase, which is often where the county/time detail
// actually lives (the WHERE/WHEN bullets). This doesn't drop or reword
// anything NWS said — every word survives — it just fixes spacing/
// punctuation so the engine can actually pronounce it clearly, the same
// way a TV announcer would naturally pause at these bullets rather than
// reading the raw asterisks and dots aloud.
function normalizeForSpeech(text) {
  return text
    .replace(/\*\s*([A-Z][A-Z ]*?)\.\.\./g, '$1: ')   // "* WHEN..." -> "WHEN: "
    .replace(/\.{2,}/g, '. ')                          // any other "..." -> a clean pause
    .replace(/\b(\d{1,2})(\d{2})\s*(AM|PM)\b/gi, '$1:$2 $3') // "430 PM" -> "4:30 PM"
    .replace(/\b(\d{1,2}:\d{2})(AM|PM)\b/gi, '$1 $2')  // "11:08PM" -> "11:08 PM"
    .replace(/\s+/g, ' ')
    .trim();
}

// Splits long text on sentence boundaries into chunks no larger than
// maxLen, greedily packing as many whole sentences as fit. A full NWS
// bulletin (description + instruction) easily runs past a thousand
// characters — synthesizing that as a single /api/tts request risked the
// request timing out on Pi-class hardware with nothing spoken at all (only
// the short intro sentence played, then silence). Queuing several smaller
// requests instead keeps each one fast regardless of how long the overall
// alert text is.
function chunkTextForSpeech(text, maxLen = 400) {
  const sentences = text.replace(/\s*\n+\s*/g, ' ').split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if (current && current.length + s.length + 1 > maxLen) {
      chunks.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function speakAlerts(sorted) {
  if (!getTtsEnabled()) return;
  // Lower ALERT_SEV rank = more severe (Extreme:0 ... Unknown:4) — "at
  // least this severe" means rank <= the threshold's rank. Alert Sound
  // (the beep) is unaffected — it fires for every new alert regardless;
  // only the spoken readout is filtered here.
  const minRank   = ALERT_SEV[getTtsMinSeverity()] ?? 3;
  const speakable = sorted.filter(f => (ALERT_SEV[f.properties.severity] ?? 4) <= minRank);
  if (speakable.length) speakAlertList(speakable);
}

// Reads the given alerts out, regardless of the Read Aloud setting (also
// used by the Read Aloud button in the alert details)
function speakAlertList(list) {
  cancelTts();
  speakText(
    'The National Weather Service has issued the following alert' +
    (list.length > 1 ? 's' : '') + '.',
    showError
  );
  for (const f of list) {
    const p     = f.properties;
    const areas = p.areaDesc
      ? p.areaDesc.split(';').map(s => s.trim()).filter(Boolean).join(', ')
      : '';
    // Read the alert exactly as NWS issued it — event, areas, headline,
    // full description, and any instruction — like a TV EAS crawl reads
    // the actual bulletin verbatim, not a shortened summary of it.
    const text = normalizeForSpeech([
      areas ? `${p.event} for ${areas}.` : `${p.event}.`,
      p.headline,
      p.description,
      p.instruction,
    ].filter(Boolean).join(' '));
    for (const chunk of chunkTextForSpeech(text)) speakText(chunk, showError);
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

/* ── Which alerts were already announced ────────────────────
   Kept in localStorage (alert id → when last seen), so an
   update, restart or page reload doesn't beep and read out alerts that
   were already announced. When NWS extends or edits an alert it issues it
   under a new id, so that is announced again. Entries are dropped 3 days
   after the alert was last active. The very first load starts quietly. */
const ANNOUNCED_KEY = 'announcedAlerts';
const ANNOUNCED_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

function takeUnannounced(features) {
  let stored = null;
  try { stored = localStorage.getItem(ANNOUNCED_KEY); } catch { /* storage blocked */ }
  let seen = {};
  try { seen = JSON.parse(stored) || {}; } catch { /* start fresh */ }
  const now = Date.now();
  // No record at all (first load after installing this, or a fresh unit):
  // whatever is already active is on the banner, but isn't announced, so
  // the update itself doesn't set off the beeps
  const firstRun = stored === null;
  const fresh = firstRun ? [] : features.filter(f => !seen[f.properties.id]);
  for (const f of features) seen[f.properties.id] = { t: now };
  for (const [id, v] of Object.entries(seen)) if (now - v.t > ANNOUNCED_KEEP_MS) delete seen[id];
  try { localStorage.setItem(ANNOUNCED_KEY, JSON.stringify(seen)); } catch { /* storage full/blocked */ }
  return fresh;
}

/* ── Render alert banner (scrolling ticker) ───────────────── */
let lastAlertKey = '';
let currentAlerts = []; // most severe first, for the details view

// simulated: Debug Tools ▸ Simulate Alerts, which announces every time
function renderAlerts(features, { simulated = false } = {}) {
  const banner = document.getElementById('alert-banner');
  if (!features.length) {
    banner.hidden = true;
    lastAlertKey = '';
    currentAlerts = [];
    if (!alertModal.hidden) renderAlertDetails();
    return;
  }

  const sorted = [...features].sort((a, b) =>
    (ALERT_SEV[a.properties.severity] ?? 4) - (ALERT_SEV[b.properties.severity] ?? 4));
  currentAlerts = sorted;
  if (!alertModal.hidden) renderAlertDetails();
  const toAnnounce = simulated ? sorted : takeUnannounced(sorted);

  // Redraw the ticker only when the alerts change, so it doesn't jump
  // back to the start every 5-minute refresh
  const key = sorted.map(f => f.properties.id || f.properties.event).join('|');
  if (key !== lastAlertKey) banner.innerHTML = alertTickerHtml(sorted);
  lastAlertKey = key;
  banner.hidden = false;

  if (toAnnounce.length) {
    playAlertSound();
    setTimeout(() => speakAlerts(toAnnounce), ALERT_BEEP_TOTAL_MS + 500); // beeps first, then voice
  }
}

function alertTickerHtml(sorted) {
  return sorted.map(f => {
    const p        = f.properties;
    const cls      = ALERT_CLS[p.severity]  || 'alert-minor';
    const ico      = alertIcon(p.severity);
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
      <span class="alert-more">Details ›</span>
    </div>`;
  }).join('');
}

/* ── Alert details (tap the banner) ──────────────────────────
   Every active alert in full, most severe first, with buttons to read it
   aloud again or replay the alert sound. Those play even when the alert
   sound / read-aloud settings are off, since someone asked for them. */
const alertModal = document.getElementById('alert-modal');
const alertModalBody = document.getElementById('alert-modal-body');

function fmtAlertTime(iso) {
  return new Date(iso).toLocaleString([], {
    weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: getTimeFormat() !== '24h',
  });
}

function renderAlertDetails() {
  alertModalBody.innerHTML = currentAlerts.map((f, i) => {
    const p = f.properties;
    const areas = p.areaDesc ? p.areaDesc.split(';').map(a => a.trim()).filter(Boolean).join(', ') : '';
    const ends = p.ends || p.expires;
    const when = [p.effective && `From ${fmtAlertTime(p.effective)}`, ends && `until ${fmtAlertTime(ends)}`]
      .filter(Boolean).join(' ');
    const sev = (p.severity || 'Minor').toLowerCase();
    return `<div class="settings-section alert-card alert-card-${sev}">
      <div class="alert-card-head">
        <span class="alert-sev">${escHtml(p.severity || 'Alert')}</span>
        <div class="settings-section-title">${escHtml(p.event)}</div>
      </div>
      ${when ? `<p class="settings-desc">${escHtml(when)}</p>` : ''}
      ${p.headline && p.headline !== p.event ? `<p class="alert-headline">${escHtml(p.headline)}</p>` : ''}
      ${areas ? `<p class="settings-desc"><strong>Areas:</strong> ${escHtml(areas)}</p>` : ''}
      ${p.description ? `<div class="alert-text">${escHtml(p.description)}</div>` : ''}
      ${p.instruction ? `<div class="alert-text"><strong>What to do</strong><br>${escHtml(p.instruction)}</div>` : ''}
      <div class="alert-card-actions">
        <button class="btn btn-accent btn-sm" data-alert-say="${i}">Read Aloud</button>
        <button class="btn btn-ghost btn-sm" data-alert-beep>Play Alert Sound</button>
        <button class="btn btn-ghost btn-sm" data-alert-stop>Stop</button>
      </div>
    </div>`;
  }).join('') || '<p class="panel-hint">There are no weather alerts right now.</p>';
}

document.getElementById('alert-banner').addEventListener('click', e => {
  e.stopPropagation(); // not also a tap on the Lock Screen behind
  renderAlertDetails();
  alertModal.hidden = false;
});
alertModalBody.addEventListener('click', e => {
  const say = e.target.closest('[data-alert-say]');
  if (say) return speakAlertList([currentAlerts[+say.dataset.alertSay]].filter(Boolean));
  if (e.target.closest('[data-alert-beep]')) {
    try { playBeepSequence(getAudioCtx()); } catch { /* AudioContext unavailable */ }
    return;
  }
  if (e.target.closest('[data-alert-stop]')) cancelTts();
});
document.getElementById('alert-modal-close').addEventListener('click', () => { alertModal.hidden = true; });
alertModal.addEventListener('click', e => { if (e.target === alertModal) alertModal.hidden = true; });

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
  const nowM = skyNowMins(); // follows Debug ▸ Preview Sky Time when set
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
      refreshSky();
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

// A refresh someone taps isn't a startup, so it skips the startup chime
// (see Boot below). Updates and real restarts still chime.
document.getElementById('wx-refresh').addEventListener('click', () => {
  sessionStorage.setItem('quietReload', '1');
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
    headline = maxP >= 10 ? `${ICON.drop} Slight chance of rain (${maxP}%)` : `${ICON.sun} No rain today`;
  } else {
    headline = `${ICON.drop} Rain: ` + windows
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
    ? `${ICON.wifiOff} Offline · last synced ${Math.round(offlineMs / 60000)}m ago`
    : '';
  for (const id of ['connectivity-badge', 'lock-connectivity-badge']) {
    const el = document.getElementById(id);
    el.innerHTML = label;
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

/* ── Sidebar panels (To-Do / Bulletin) — each can be hidden ──────────
   Attributes on <html> drive the CSS; with both hidden the whole sidebar
   goes away and the calendar takes the full width. Hidden panels also
   stop polling the server (see loadTodo/loadBulletin). */
const getTodoEnabled     = () => localStorage.getItem('todoEnabled')     === 'true'; // default off
const getBulletinEnabled = () => localStorage.getItem('bulletinEnabled') === 'true'; // default off

function applySidebarPanels() {
  document.documentElement.toggleAttribute('data-hide-todo',     !getTodoEnabled());
  document.documentElement.toggleAttribute('data-hide-bulletin', !getBulletinEnabled());
}
applySidebarPanels();

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
  // password: the setup guide's Wi-Fi password is typed on this keyboard
  return ['text', 'search', 'email', 'number', 'password', 'tel', 'url'].includes(el.type);
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
  speedCheckAfterUpdate(commit);
}).catch(() => {});

/* ── Speed check after an update ─────────────────────────────
   The first time a new version runs (and on a brand-new unit), once
   startup has settled, measure the frame rate for a few seconds. If the
   screen is struggling, turn the graphics down one step at a time
   (Frosted Glass first, then the Animated Sky), measuring again after
   each, and leave a note in Settings ▸ Graphics. Silent. Skipped (and
   tried again next load) if the screen is hidden or busy. */
const SPEED_OK_FPS = 40;

function measureFps(ms = 5000) {
  return new Promise(resolve => {
    let frames = 0;
    const t0 = performance.now();
    const tick = now => {
      frames++;
      if (now - t0 < ms) requestAnimationFrame(tick);
      else resolve(frames * 1000 / (now - t0));
    };
    requestAnimationFrame(tick);
  });
}

async function speedCheckAfterUpdate(commit) {
  if (!commit || localStorage.getItem('speedCheckedCommit') === commit) return;
  await new Promise(r => setTimeout(r, 45000)); // let startup work (weather, calendar) finish
  if (document.hidden || !setupScreen.hidden || benchRunning) return;
  localStorage.setItem('speedCheckedCommit', commit);
  const changes = [];
  for (let i = 0; i < 3; i++) {
    const fps = await measureFps();
    if (document.hidden) break; // measured while hidden: not a real reading
    if (fps >= SPEED_OK_FPS) break;
    const step = getGlassMode() !== 'off'      ? ['gfxGlass', 'off', 'Frosted Glass Off']
               : getWxQuality() === 'full'     ? ['gfxWxQuality', 'reduced', 'Animated Sky Reduced']
               : getWxQuality() === 'reduced'  ? ['gfxWxQuality', 'off', 'Animated Sky Off']
               : null;
    if (!step) break;
    localStorage.setItem(step[0], step[1]);
    applyGlassSetting();
    applyWxMode(wxMode);
    changes.push(step[2]);
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!changes.length) return;
  const when = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
  localStorage.setItem('autoGfxNote',
    `After the update on ${when} the screen was running slowly, so the graphics were changed to ${changes.join(', then ')}.`);
  showToast('The screen was running slowly after the update, so the graphics were turned down. See Settings, Graphics.', 'success');
}

// Debug Options, Graphics and Reset are hidden by default — Debug so kids/
// guests don't stumble into weather/alert simulation tools, Graphics
// because the higher quality tiers can make weaker Pi hardware choppy and
// shouldn't be a casual accidental change, Reset because it erases
// everything. Tapping the version text 7 times in a row reveals them, same "developer options" convention
// Android uses. Stored in localStorage so it stays unlocked across
// reloads once found; taps more than 2s apart don't count toward the streak.
const ADVANCED_SECTION_IDS = ['debug-section', 'graphics-section', 'reset-section',
  'nav-advanced-title', 'nav-graphics', 'nav-debug', 'nav-backups', 'nav-reset'];
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
    showToast('Advanced settings unlocked.', 'success');
  } else {
    debugTapTimer = setTimeout(() => { debugTapCount = 0; }, 2000);
  }
});
document.getElementById('debug-lock-btn').addEventListener('click', () => {
  localStorage.removeItem('debugUnlocked');
  ADVANCED_SECTION_IDS.forEach(id => { document.getElementById(id).hidden = true; });
  showSettingsPane('general');
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
    document.getElementById('update-nav-dot').hidden = !r.updateAvailable;
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
// Every 5 minutes — was 12 hours, which meant waiting up to half a day to
// see a just-pushed update reflected. /api/update-check is just a `git
// fetch` + two `git rev-parse` calls (not a rate-limited GitHub API call),
// so polling this often is cheap. Runs on a plain setInterval, which isn't
// paused by the Lock Screen overlay (that's just a DOM/CSS state, not a
// separate page) — it keeps checking in the background even while locked,
// so the badge is already accurate the moment someone unlocks.
setInterval(checkForUpdate, 5 * 60 * 1000);

document.getElementById('update-badge').addEventListener('click', () => {
  document.getElementById('settings-btn').click();
  showSettingsPane('general');
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
  document.getElementById('sound-volume-slider').value  = getSoundVolume();
  document.getElementById('toggle-boot-sound').checked  = getBootSoundEnabled();
  document.getElementById('toggle-alert-sound').checked = getSoundEnabled();
  document.getElementById('toggle-alert-tts').checked   = getTtsEnabled();
  document.getElementById('tts-min-severity').value     = getTtsMinSeverity();
  document.getElementById('tts-rate-slider').value      = getTtsRate();
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
  document.querySelectorAll('#lock-agenda-style-options .theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.val === getLockAgendaStyle()));
  document.getElementById('toggle-osk').checked = getOskEnabled();
  document.getElementById('toggle-todo').checked     = getTodoEnabled();
  document.getElementById('toggle-bulletin').checked = getBulletinEnabled();
  document.querySelectorAll('#date-format-options .theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.val === getDateFormat()));
  document.querySelectorAll('#time-format-options .theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.val === getTimeFormat()));
  settingsModal.hidden = false;
});

document.getElementById('sound-volume-slider').addEventListener('input', e => {
  localStorage.setItem('soundVolume', e.target.value);
  if (masterGainNode) masterGainNode.gain.value = getSoundVolume() / 100; // live feedback while dragging
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
document.getElementById('tts-min-severity').addEventListener('change', e => {
  localStorage.setItem('ttsMinSeverity', e.target.value);
});
document.getElementById('tts-rate-slider').addEventListener('input', e => {
  localStorage.setItem('ttsRate', e.target.value);
});
document.getElementById('tts-rate-test-btn').addEventListener('click', () => {
  cancelTts();
  speakText(
    'This is a test of the alert text to speech system at the current speech rate.',
    showError,
    () => showToast('Speaking now via server-side text to speech.', 'success')
  );
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
document.getElementById('lock-agenda-style-options').addEventListener('click', e => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  localStorage.setItem('lockAgendaStyle', btn.dataset.val);
  document.querySelectorAll('#lock-agenda-style-options .theme-opt').forEach(b =>
    b.classList.toggle('active', b === btn));
  if (!document.getElementById('lock-screen').hidden) renderLockScreen();
});
document.getElementById('toggle-todo').addEventListener('change', e => {
  localStorage.setItem('todoEnabled', e.target.checked);
  applySidebarPanels();
  loadTodo(); // refresh right away when turned back on (no-op when off)
});
document.getElementById('toggle-bulletin').addEventListener('change', e => {
  localStorage.setItem('bulletinEnabled', e.target.checked);
  applySidebarPanels();
  loadBulletin();
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

// Debug ▸ Preview Sky Time: [minutes from sunrise or sunset, which]. Falls
// back to a 7am/6pm day when sunrise/sunset haven't loaded (offline).
const SKY_PREVIEW = {
  dawn:    [-20, 'rise'],
  sunrise: [10,  'rise'],
  golden:  [70,  'rise'],
  midday:  [0,   'mid'],
  sunset:  [-10, 'set'],
  dusk:    [25,  'set'],
  night:   [180, 'set'],
};

document.getElementById('debug-sky-grid').addEventListener('click', e => {
  const btn = e.target.closest('.debug-sky-btn');
  if (!btn) return;
  const rise = sunriseMins ?? 7 * 60, set = sunsetMins ?? 18 * 60;
  const preview = SKY_PREVIEW[btn.dataset.sky];
  skyClockOverride = !preview ? null
    : preview[1] === 'mid'  ? (rise + set) / 2
    : (preview[1] === 'rise' ? rise : set) + preview[0];
  refreshSky();
  // Swap a day/night weather visual to match the previewed time; clear
  // skies stand in when no weather visual is showing yet
  const half = isCurrentlyDay() ? 'day' : 'night';
  if (/-(day|night)$/.test(wxMode)) applyWxMode(wxMode.replace(/(day|night)$/, half));
  else if (wxMode === 'none') applyWxMode(`clear-${half}`);
  else applyWxMode(wxMode);
  document.querySelectorAll('.debug-sky-btn').forEach(b =>
    b.classList.toggle('active', b === btn && !!preview));
});

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
    ], { simulated: true });
  } else {
    renderAlerts([{ properties: { severity: sev, event, headline, areaDesc: DEFAULT_AREA } }], { simulated: true });
  }
  document.querySelectorAll('.debug-alert-btn').forEach(b =>
    b.classList.toggle('active', b === btn && sev !== 'none'));
});
document.getElementById('settings-close').addEventListener('click', () => { settingsModal.hidden = true; });

// Two-pane Settings: categories on the left, one category's settings on
// the right. On a narrow screen only one side shows at a time ("in-pane"
// = a category is open), with a Back button to the list.
const settingsShell = document.getElementById('settings-shell');
const settingsNarrow = () => window.matchMedia('(max-width: 720px)').matches;
let settingsPane = 'general';

function showSettingsPane(name, { enter = true } = {}) {
  settingsPane = name;
  settingsShell.querySelectorAll('.settings-nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.pane === name));
  let title = '';
  settingsShell.querySelectorAll('.settings-pane').forEach(p => {
    p.classList.toggle('active', p.dataset.pane === name);
    if (p.dataset.pane === name) title = p.dataset.title;
  });
  document.getElementById('settings-pane-title').textContent = title;
  document.getElementById('settings-panes').scrollTop = 0;
  settingsShell.classList.toggle('in-pane', enter);
  if (name === 'graphics') syncGraphicsOptions();
  if (name === 'family') refreshFamilyStatus();
  if (name === 'debug') refreshUpdateChannel();
  if (name === 'backups') refreshBackups();
}

// Settings ▸ Debug Tools ▸ Update Channel
async function refreshUpdateChannel() {
  try {
    const { channel } = await api('GET', '/api/update-channel');
    document.querySelectorAll('#update-channel-options .theme-opt').forEach(b =>
      b.classList.toggle('active', b.dataset.val === channel));
  } catch { /* leave as is */ }
}
document.getElementById('update-channel-options').addEventListener('click', async e => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  try {
    await api('POST', '/api/update-channel', { channel: btn.dataset.val });
    refreshUpdateChannel();
    checkForUpdate();
  } catch (err) { showError(errText(err)); }
});

// Settings ▸ Backups: newest first; Restore takes two taps
async function refreshBackups() {
  const list = document.getElementById('backup-list');
  let backups;
  try { backups = await api('GET', '/api/backups'); }
  catch (err) { list.innerHTML = `<p class="panel-hint">Couldn't list backups: ${escHtml(errText(err))}</p>`; return; }
  if (!backups.length) {
    list.innerHTML = '<p class="panel-hint">No backups yet. One is saved the next time the dashboard starts.</p>';
    return;
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  list.innerHTML = backups.map(b => {
    const when = new Date(b.at).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      hour12: getTimeFormat() !== '24h',
    });
    const what = b.counts
      ? [plural(b.counts.calendar_events, 'event'), plural(b.counts.todo_items, 'to-do'), plural(b.counts.bulletin_posts, 'post')].join(' · ')
      : 'Contents unreadable';
    return `<div class="settings-section backup-row">
      <div><div class="backup-when">${escHtml(when)}</div><div class="settings-desc">${what}</div></div>
      <button class="btn btn-ghost btn-sm" data-restore="${escHtml(b.name)}" ${b.counts ? '' : 'disabled'}>Restore</button>
    </div>`;
  }).join('');
}

let restoreArmed = null;
document.getElementById('backup-list').addEventListener('click', async e => {
  const btn = e.target.closest('[data-restore]');
  if (!btn) return;
  if (restoreArmed !== btn) {
    restoreArmed = btn;
    btn.textContent = 'Tap again to restore';
    btn.classList.add('btn-danger-outline');
    setTimeout(() => {
      if (restoreArmed !== btn) return;
      restoreArmed = null;
      btn.textContent = 'Restore';
      btn.classList.remove('btn-danger-outline');
    }, 4000);
    return;
  }
  restoreArmed = null;
  btn.disabled = true;
  btn.textContent = 'Restoring…';
  try {
    await api('POST', '/api/backups/restore', { name: btn.dataset.restore, confirm: 'RESTORE' });
    showToast('Restored. What was there before was saved as a backup first.', 'success');
    sessionStorage.setItem('quietReload', '1');
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    showError(errText(err));
    refreshBackups();
  }
});

settingsShell.querySelector('.settings-nav').addEventListener('click', e => {
  const item = e.target.closest('.settings-nav-item');
  if (item) showSettingsPane(item.dataset.pane);
});
document.getElementById('settings-back').addEventListener('click', () => settingsShell.classList.remove('in-pane'));
// Opening Settings: the last category on a big screen, the list on a phone
document.getElementById('settings-btn').addEventListener('click', () =>
  showSettingsPane(settingsPane, { enter: !settingsNarrow() }));

// Settings ▸ Family Link: on / off / paused, from the same status the
// setup guide uses
async function refreshFamilyStatus() {
  const chip = document.getElementById('family-status');
  const openBtn = document.getElementById('remote-open-btn');
  try {
    const s = await api('GET', '/api/remote/status');
    const screen = remoteScreen(s);
    const [cls, label, action] =
      screen === 'live'      ? ['on', 'On', 'Share & Manage'] :
      screen === 'reconnect' ? ['paused', 'Paused: needs attention', 'Fix It'] :
      s.code                 ? ['', 'Not finished', 'Continue Setup'] :
                               ['', 'Off', 'Set Up Family Link'];
    chip.className = `family-status ${cls}`;
    chip.textContent = label;
    openBtn.textContent = action;
  } catch {
    chip.className = 'family-status';
    chip.textContent = 'Status unavailable';
  }
}
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.hidden = true; });

/* ── Graphics (Settings ▸ Advanced ▸ Graphics) ────────────── */
// Same reasoning as getWxQuality above — defaults to lowest, not full.
const getGlassMode = () => localStorage.getItem('gfxGlass') || 'off';

function applyGlassSetting() {
  document.documentElement.dataset.glass = getGlassMode();
}
applyGlassSetting();

// Settings ▸ Graphics pane: show the current choices whenever it opens
function syncGraphicsOptions() {
  const note = document.getElementById('auto-gfx-note');
  note.textContent = localStorage.getItem('autoGfxNote') || '';
  note.hidden = !note.textContent;
  document.querySelectorAll('#gfx-glass .theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.val === getGlassMode()));
  document.getElementById('toggle-gfx-lightning').checked = getLightningEnabled();
  document.querySelectorAll('#gfx-wx-quality .theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.val === getWxQuality()));
}

document.getElementById('gfx-glass').addEventListener('click', e => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  localStorage.setItem('gfxGlass', btn.dataset.val);
  localStorage.removeItem('autoGfxNote');
  document.getElementById('auto-gfx-note').hidden = true;
  document.querySelectorAll('#gfx-glass .theme-opt').forEach(b =>
    b.classList.toggle('active', b === btn));
  applyGlassSetting();
});

document.getElementById('gfx-wx-quality').addEventListener('click', e => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  localStorage.setItem('gfxWxQuality', btn.dataset.val);
  localStorage.removeItem('autoGfxNote');
  document.getElementById('auto-gfx-note').hidden = true;
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

/* ── Remote Access submenu (opened from Settings) ─────────── */
// A guided setup for a non-technical owner, one step per screen, then a
// "share & manage" view once the family link is on. Only two steps are
// required; turning off Tailscale key expiry is offered afterwards as a
// clearly optional extra (skipping it means a quick re-sign-in about twice
// a year, which the main-screen badge below gives advance warning of). Which screen shows is
// derived entirely from /api/remote/status (polled while open), so steps
// finished on a phone — Tailscale sign-in, allowing public links, turning
// off key expiry — advance this screen by themselves. Every link is also a
// QR code, since the wall screen itself can't usefully open web pages.
const remoteModal = document.getElementById('remote-modal');
const remoteBody  = document.getElementById('remote-body');
const TS_MACHINES_URL = 'https://login.tailscale.com/admin/machines';
let remotePollId  = null;
let remoteStatus  = null;
let remoteLastHtml = '';
// Transient UI state that isn't part of the server status
const remoteUi = { loginUrl: null, approveUrl: null, busy: null, error: '' };

function qrSvg(text, cls = '') {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return `<div class="qr-box ${cls}">${qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true })}</div>`;
}

function scanBlock(url, caption) {
  return `${qrSvg(url)}
    <p class="settings-desc remote-center">${caption}</p>
    <p class="settings-desc remote-center remote-small">Or open: <a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(url)}</a></p>`;
}

const stepHead = (n, title) =>
  `<p class="remote-step">Step ${n} of 2</p><h4 class="remote-title">${title}</h4>`;
const waitingNote = '<p class="settings-desc remote-center remote-waiting">This screen moves on by itself when you\'re done.</p>';
const btn = (action, label, cls = 'btn-ghost') =>
  `<button class="btn ${cls} btn-sm" data-action="${action}" ${remoteUi.busy ? 'disabled' : ''}>${remoteUi.busy === action ? 'One moment…' : label}</button>`;

function expiryInstructions() {
  return `${qrSvg(TS_MACHINES_URL, 'qr-small')}
    <ol class="remote-steps">
      <li>Scan this with your phone's camera (sign in again if asked).</li>
      <li>Find <strong>family-dashboard</strong> in the list and tap the <strong>⋯</strong> next to it.</li>
      <li>Tap <strong>Disable key expiry</strong>.</li>
    </ol>`;
}

function remoteScreen(s) {
  const ts = s.tailscale || {};
  if (!ts.installed) return 'not-installed';
  if (!ts.running || ['NoState', 'Starting'].includes(ts.state)) return 'starting';
  if (ts.state !== 'Running') return s.code ? 'reconnect' : 'connect';
  return s.code && ts.funnelOn ? 'live' : 'link';
}

function renderRemote() {
  const s  = remoteStatus;
  const ts = s.tailscale || {};
  const loginUrl = remoteUi.loginUrl || ts.authUrl;
  let html;

  switch (remoteScreen(s)) {
    case 'not-installed':
      html = `<h4 class="remote-title">Almost ready</h4>
        <p class="settings-desc">This needs the latest update first. Tap <strong>Update available</strong>
        at the top of the screen, then <strong>Update Now</strong>. When the dashboard comes back, open this again.</p>`;
      break;

    case 'starting':
      html = `<h4 class="remote-title">Getting ready…</h4>
        <p class="settings-desc">This takes a few seconds.</p>`;
      break;

    case 'reconnect':
    case 'connect': {
      const reconnect = remoteScreen(s) === 'reconnect';
      html = (reconnect
        ? `<div class="remote-warn">${ICON.alert} <strong>The family link is paused.</strong> This dashboard needs to sign in to Tailscale again. Family members can't open the calendar until you do.</div>
           <h4 class="remote-title">Sign this dashboard back in</h4>`
        : `${stepHead(1, 'Connect this dashboard')}
           <p class="settings-desc">This uses a free service called <strong>Tailscale</strong> to reach the
           calendar safely from anywhere. You sign in once, with your Google, Apple or Microsoft
           account. There's no new password to remember.</p>`)
        + (loginUrl
          ? scanBlock(loginUrl, 'Scan this with your phone\'s camera, then sign in.') + waitingNote
          : `<div class="remote-actions">${btn('login', 'Get sign-in code', 'btn-accent')}</div>`);
      break;
    }

    case 'link':
      html = `${stepHead(2, 'Turn on the family link')}
        <p class="settings-desc">This makes a private link to <strong>just the calendar</strong>. Nothing
        else on this dashboard can be reached from it, and it only works with your family code.</p>`
        + (remoteUi.approveUrl
          ? `<p class="settings-desc"><strong>One more OK:</strong> Tailscale asks you once to allow a link
             that works for people outside your account.</p>
             ${scanBlock(remoteUi.approveUrl, 'Scan this, tap <strong>Enable</strong>, then come back.')}${waitingNote}`
          : `<div class="remote-actions">${btn('enable', 'Turn on family link', 'btn-accent')}</div>`);
      break;

    case 'live': {
      const link = `${ts.publicUrl}#code=${s.code}`;
      html = `<div class="remote-ok">${ICON.check} <strong>The family link is on.</strong></div>
        <p class="settings-desc">Family members scan this with their phone's camera. It opens the calendar
        already signed in. No app or account needed.</p>
        ${qrSvg(link, 'qr-large')}
        <div class="remote-actions remote-center-row">
          ${btn('copy', 'Copy link')}
          ${navigator.share ? btn('share', 'Share…') : ''}
          ${btn('homescreen', 'Add to a home screen: how')}
        </div>
        <p class="settings-desc remote-center">Or go to <strong>${escHtml(ts.publicUrl.replace(/^https:\/\//, '').replace(/\/$/, ''))}</strong>
        and enter the family code:</p>
        <div class="remote-code">${escHtml(s.code)}</div>
        ${ts.keyExpiry ? `<details class="remote-details remote-optional">
          <summary><span class="remote-tag">Optional</span> Never sign in again (about 1 minute)</summary>
          <p class="settings-desc">Tailscale asks this dashboard to sign in again about every 6 months.
          The next time is <strong>${escHtml(new Date(ts.keyExpiry).toLocaleDateString())}</strong>.
          If you skip this, that's fine: a reminder appears at the top of the screen two weeks before,
          and signing back in takes two taps.</p>
          <p class="settings-desc">To turn the re-sign-in off for good:</p>
          ${expiryInstructions()}
        </details>` : ''}
        <div class="remote-manage">
          <p class="settings-desc"><strong>Someone shouldn't have the code anymore?</strong> Make a new one.
          Everyone will need the new code or link.</p>
          <div class="remote-actions">
            ${btn('reset', 'Make a new code')}
            ${btn('off', 'Turn off family link', 'btn-danger-outline')}
          </div>
        </div>
        <details class="remote-details">
          <summary>For the technical person</summary>
          <p class="settings-desc">Tailscale address: <code>${escHtml(ts.ip || '')}</code><br>
          SSH from your own Tailscale devices: <code>ssh user@family-dashboard</code><br>
          Full dashboard: <code>http://family-dashboard:3000</code><br>
          The public link serves only the calendar (remote.js, port 3001).</p>
        </details>`;
      break;
    }
  }

  if (remoteUi.error) html += `<p class="remote-error">${escHtml(remoteUi.error)}</p>`;
  // Re-render only on change — polling every 3s would otherwise reset
  // half-tapped "tap again" buttons and redraw the QR codes needlessly.
  if (html !== remoteLastHtml) {
    remoteBody.innerHTML = html;
    remoteLastHtml = html;
  }
}

async function refreshRemote() {
  try {
    remoteStatus = await api('GET', '/api/remote/status');
    // A step's link is only needed until that step is done
    if (remoteStatus.tailscale?.state === 'Running') remoteUi.loginUrl = null;
    if (remoteStatus.tailscale?.funnelOn) remoteUi.approveUrl = null;
    renderRemote();
  } catch (err) {
    remoteBody.innerHTML = `<p class="remote-error">Couldn't check: ${escHtml(err.message)}</p>`;
    remoteLastHtml = '';
  }
}

async function remoteAction(action, fn) {
  remoteUi.busy = action;
  remoteUi.error = '';
  renderRemote();
  try { await fn(); }
  catch (err) { remoteUi.error = errText(err); }
  remoteUi.busy = null;
  await refreshRemote();
}

// Two taps for the actions that cut family members off
let remoteArmed = null;
function confirmTap(el, confirmLabel) {
  if (remoteArmed === el) { remoteArmed = null; return true; }
  remoteArmed = el;
  const label = el.textContent;
  el.textContent = confirmLabel;
  setTimeout(() => { if (remoteArmed === el) { remoteArmed = null; el.textContent = label; } }, 4000);
  return false;
}

remoteBody.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const s = remoteStatus;

  switch (el.dataset.action) {
    case 'login':
      return remoteAction('login', async () => {
        const r = await api('POST', '/api/remote/tailscale-login');
        if (r.url) remoteUi.loginUrl = r.url;
        else if (!r.done) throw new Error('Couldn\'t get a sign-in code. Check the internet connection and try again.');
      });

    case 'enable':
      return remoteAction('enable', async () => {
        if (!s.code) await api('POST', '/api/remote/code');
        const r = await api('POST', '/api/remote/funnel', { on: true });
        if (r.url) remoteUi.approveUrl = r.url;
        else if (!r.done) throw new Error('Couldn\'t turn on the link. Check the internet connection and try again.');
      });

    case 'copy': {
      const link = `${s.tailscale.publicUrl}#code=${s.code}`;
      // navigator.clipboard needs https/localhost — over plain http from a
      // phone on home Wi-Fi, fall back to the legacy copy command.
      try { await navigator.clipboard.writeText(link); }
      catch {
        const t = Object.assign(document.createElement('textarea'), { value: link });
        document.body.append(t); t.select();
        document.execCommand('copy'); t.remove();
      }
      return showToast('Link copied.', 'success');
    }

    case 'homescreen':
      closeRemoteModal();
      return document.getElementById('homescreen-guide-btn').click();

    case 'share':
      return navigator.share({ title: 'Family Calendar', url: `${s.tailscale.publicUrl}#code=${s.code}` }).catch(() => {});

    case 'reset':
      if (!confirmTap(el, 'Tap again to confirm')) return;
      return remoteAction('reset', async () => {
        await api('POST', '/api/remote/code');
        showToast('New code made. Share the new link with your family.', 'success');
      });

    case 'off':
      if (!confirmTap(el, 'Tap again to turn off')) return;
      return remoteAction('off', async () => {
        await api('DELETE', '/api/remote/code');
        showToast('Family link turned off.', 'success');
      });
  }
});

document.getElementById('remote-open-btn').addEventListener('click', () => {
  showSettingsPane('family');
  settingsModal.hidden = true;
  remoteModal.hidden = false;
  remoteUi.error = '';
  remoteLastHtml = '';
  refreshRemote();
  remotePollId = setInterval(refreshRemote, 3000);
});

function closeRemoteModal() {
  clearInterval(remotePollId);
  remotePollId = null;
  remoteModal.hidden = true;
  settingsModal.hidden = false;
  checkRemoteHealth();
  refreshFamilyStatus();
}
document.getElementById('remote-close').addEventListener('click', closeRemoteModal);
remoteModal.addEventListener('click', e => { if (e.target === remoteModal) closeRemoteModal(); });

/* ── Home-screen guide (Settings ▸ Family Link ▸ Show me how) ──
   Illustrated steps for adding the Family Link to an iPhone or Android
   home screen, so it opens like an app. The pictures are simple drawn
   phones (inline SVG), with the thing to tap circled. */
const homescreenModal = document.getElementById('homescreen-modal');
const homescreenBody  = document.getElementById('homescreen-body');
let homescreenTab = 'ios';
let hsClipId = 0;

function hsFrame(inner) {
  const id = `hs-clip-${++hsClipId}`;
  return `<svg class="hs-phone" viewBox="0 0 150 280" aria-hidden="true">
    <defs><clipPath id="${id}"><rect x="6" y="6" width="138" height="268" rx="20"/></clipPath></defs>
    <rect x="1" y="1" width="148" height="278" rx="24" class="hs-body"/>
    <g clip-path="url(#${id})">
      <rect x="6" y="6" width="138" height="268" class="hs-screen"/>${inner}
    </g></svg>`;
}
const hsRing = (x, y, w, h, r = 8) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" class="hs-hl"/>`;
const hsText = (x, y, t, cls = '') => `<text x="${x}" y="${y}" class="hs-t ${cls}">${t}</text>`;
// The Family Calendar app icon, top-left corner at x,y
const hsAppIcon = (x, y, s = 22) => `<g transform="translate(${x},${y}) scale(${s / 22})">
  <rect width="22" height="22" rx="5" class="hs-appicon"/>
  <rect x="5" y="6" width="12" height="11" rx="1.5" fill="none" stroke="#fff" stroke-width="1.6"/>
  <path d="M5 9.5h12M8.5 4.5v3M13.5 4.5v3" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></g>`;

// The calendar page itself, between y0 and y1
function hsPage(y0, y1) {
  const colors = ['#2f7cf6', '#2fb35a', '#a64fd8', '#f08a00', '#e5483e'];
  let out = hsText(16, y0 + 12, 'Family Calendar', 'hs-bold');
  for (let i = 0; ; i++) {
    const y = y0 + 22 + i * 28;
    if (y + 22 > y1) break;
    out += `<rect x="14" y="${y}" width="122" height="22" rx="5" class="hs-card"/>
      <rect x="18" y="${y + 4}" width="3" height="14" rx="1.5" fill="${colors[i % 5]}"/>
      <rect x="26" y="${y + 6}" width="${50 + (i * 17) % 40}" height="4" rx="2" class="hs-line"/>
      <rect x="26" y="${y + 13}" width="34" height="3" rx="1.5" class="hs-line2"/>`;
  }
  return out;
}

function hsHome() {
  const tiles = ['#f2385a', '#2fb35a', '#f08a00', '#0a9fe0', '#a64fd8', '#7c8597', '#2f7cf6', '#e5483e', '#2fb35a', '#f08a00', '#0a9fe0'];
  let out = '<rect x="6" y="6" width="138" height="268" class="hs-wall"/>';
  tiles.forEach((c, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    out += `<rect x="${17 + col * 31}" y="${30 + row * 38}" width="22" height="22" rx="5" fill="${c}" opacity="0.85"/>`;
  });
  // Ours, in the next free spot
  out += hsAppIcon(17 + 3 * 31, 30 + 2 * 38) + hsText(17 + 3 * 31 + 11, 30 + 2 * 38 + 31, 'Family Cal…', 'hs-white hs-mid');
  out += hsRing(17 + 3 * 31 - 5, 30 + 2 * 38 - 5, 32, 42, 9);
  return out;
}

const HS_STEPS = {
  ios: [
    [() => hsPage(20, 220)
        + '<rect x="6" y="226" width="138" height="48" class="hs-bar"/>'
        + '<rect x="20" y="231" width="110" height="14" rx="7" class="hs-pill"/>'
        + hsText(75, 241, 'family-dashboard…', 'hs-mid hs-small')
        + '<path d="M22 256l-4 4 4 4M44 256l4 4-4 4" class="hs-ico"/>'
        + '<path d="M70 259v7h10v-7M75 252v10M71.5 255.5 75 252l3.5 3.5" class="hs-ico"/>'
        + '<path d="M98 254h8v10h-8zM118 256h8v8h-8z" class="hs-ico"/>'
        + hsRing(64, 248, 22, 22, 6),
     'Open the Family Link in <strong>Safari</strong>. Tap the <strong>Share</strong> button (a square with an arrow).'],
    [() => hsPage(20, 220)
        + '<rect x="6" y="6" width="138" height="268" class="hs-dim"/>'
        + '<rect x="6" y="104" width="138" height="170" rx="14" class="hs-sheet"/>'
        + ['Copy', 'Add to Reading List', 'Add Bookmark', 'Add to Favorites', 'Add to Home Screen', 'Find on Page']
            .map((t, i) => `<rect x="14" y="${118 + i * 23}" width="122" height="19" rx="5" class="hs-card"/>`
              + hsText(20, 131 + i * 23, t, 'hs-small')).join('')
        + '<path d="M123 207h8v8h-8zM127 209v4M125 211h4" class="hs-ico"/>'
        + hsRing(11, 207 - 4, 128, 25, 7),
     'Scroll down and tap <strong>Add to Home Screen</strong>.'],
    [() => '<rect x="6" y="6" width="138" height="268" class="hs-screen2"/>'
        + hsText(16, 30, 'Cancel', 'hs-blue hs-small') + hsText(75, 30, 'Add to Home', 'hs-bold hs-mid hs-small')
        + hsText(122, 30, 'Add', 'hs-blue hs-bold hs-small') + hsRing(113, 19, 26, 16, 6)
        + '<rect x="14" y="46" width="122" height="44" rx="8" class="hs-card"/>'
        + hsAppIcon(22, 57) + hsText(52, 66, 'Family Calendar', 'hs-small hs-bold')
        + '<rect x="52" y="73" width="70" height="3" rx="1.5" class="hs-line2"/>'
        + '<rect x="6" y="170" width="138" height="104" class="hs-keys"/>',
     'Tap <strong>Add</strong> in the top corner.'],
    [hsHome, '<strong>Family Calendar</strong> is on the home screen. Tap it to open, just like an app.'],
  ],
  android: [
    [() => '<rect x="6" y="6" width="138" height="36" class="hs-bar"/>'
        + '<rect x="14" y="16" width="102" height="16" rx="8" class="hs-pill"/>'
        + hsText(65, 27, 'family-dashboard…', 'hs-mid hs-small')
        + '<circle cx="130" cy="18" r="1.6" class="hs-dot"/><circle cx="130" cy="24" r="1.6" class="hs-dot"/><circle cx="130" cy="30" r="1.6" class="hs-dot"/>'
        + hsRing(122, 12, 16, 24, 6) + hsPage(48, 268),
     'Open the Family Link in <strong>Chrome</strong>. Tap the <strong>⋮</strong> menu at the top right.'],
    [() => hsPage(48, 268) + '<rect x="6" y="6" width="138" height="268" class="hs-dim"/>'
        + '<rect x="56" y="14" width="84" height="146" rx="8" class="hs-sheet"/>'
        + ['New tab', 'History', 'Downloads', 'Share…', 'Add to Home screen', 'Settings']
            .map((t, i) => hsText(63, 34 + i * 22, t, 'hs-small')).join('')
        + hsRing(58, 114, 80, 20, 6),
     'Tap <strong>Add to Home screen</strong>. (It may say <strong>Install app</strong>.)'],
    [() => hsPage(48, 268) + '<rect x="6" y="6" width="138" height="268" class="hs-dim"/>'
        + '<rect x="18" y="90" width="114" height="92" rx="12" class="hs-sheet"/>'
        + hsText(28, 110, 'Install app', 'hs-bold')
        + hsAppIcon(28, 120) + hsText(56, 134, 'Family Calendar', 'hs-small')
        + hsText(70, 166, 'Cancel', 'hs-blue hs-small') + hsText(102, 166, 'Install', 'hs-blue hs-bold hs-small')
        + hsRing(96, 155, 34, 16, 6),
     'Tap <strong>Install</strong> (or <strong>Add</strong>).'],
    [hsHome, '<strong>Family Calendar</strong> is on the home screen. Tap it to open, just like an app.'],
  ],
};

async function renderHomescreenGuide() {
  const steps = HS_STEPS[homescreenTab].map(([pic, text], i) => `
    <div class="hs-step">${hsFrame(pic())}<span class="hs-num">${i + 1}</span><p>${text}</p></div>`).join('');
  let extra = '';
  try {
    const s = await api('GET', '/api/remote/status');
    if (remoteScreen(s) === 'live') {
      extra = `<div class="hs-qr">${qrSvg(`${s.tailscale.publicUrl}#code=${s.code}`)}
        <p class="settings-desc">Scan this with the phone's camera to open the Family Link, then follow the steps above.
        ${homescreenTab === 'ios' ? `If the home-screen icon asks for the family code the first time, it's
        <strong>${escHtml(s.code)}</strong>.` : ''}</p></div>`;
    } else {
      extra = '<p class="hs-note">Family Link isn\'t on yet. Turn it on first, then open it on the phone.</p>';
    }
  } catch { /* the steps still make sense without the code */ }
  homescreenBody.innerHTML = `
    <div class="hs-tabs" role="tablist">
      <button class="theme-opt ${homescreenTab === 'ios' ? 'active' : ''}" data-hs-tab="ios">iPhone and iPad</button>
      <button class="theme-opt ${homescreenTab === 'android' ? 'active' : ''}" data-hs-tab="android">Android</button>
    </div>
    <div class="hs-steps">${steps}</div>${extra}`;
}

homescreenBody.addEventListener('click', e => {
  const tab = e.target.closest('[data-hs-tab]');
  if (!tab) return;
  homescreenTab = tab.dataset.hsTab;
  renderHomescreenGuide();
});
document.getElementById('homescreen-guide-btn').addEventListener('click', () => {
  settingsModal.hidden = true;
  homescreenModal.hidden = false;
  renderHomescreenGuide();
});
function closeHomescreenGuide() {
  homescreenModal.hidden = true;
  settingsModal.hidden = false;
}
document.getElementById('homescreen-close').addEventListener('click', closeHomescreenGuide);
homescreenModal.addEventListener('click', e => { if (e.target === homescreenModal) closeHomescreenGuide(); });

// Main-screen badge: only when the family link is on (a code exists) and
// needs the owner — it's paused because Tailscale signed this dashboard
// out, or that's due within two weeks (the optional key-expiry step was
// skipped). Tapping it opens the Remote Access screen, which shows the fix.
const REMOTE_WARN_DAYS = 14;
async function checkRemoteHealth() {
  const badge = document.getElementById('remote-badge');
  try {
    const s  = await api('GET', '/api/remote/status');
    const ts = s.tailscale || {};
    const paused  = !!s.code && ts.running && ts.state !== 'Running';
    const expires = ts.keyExpiry ? new Date(ts.keyExpiry) : null;
    const dueSoon = !!s.code && expires && expires - Date.now() < REMOTE_WARN_DAYS * 86400000;
    badge.innerHTML = ICON.alert + (paused ? ' Family Link paused'
      : ` Family Link: sign in by ${escHtml(expires?.toLocaleDateString([], { month: 'short', day: 'numeric' }) || '')}`);
    badge.hidden = !(paused || dueSoon);
  } catch { /* server busy/restarting — check again next interval */ }
}
setTimeout(checkRemoteHealth, 45000);
setInterval(checkRemoteHealth, 30 * 60 * 1000);

document.getElementById('remote-badge').addEventListener('click', () => {
  document.getElementById('settings-btn').click();
  document.getElementById('remote-open-btn').click();
});

/* ── Line icons for the setup and phone-access guides ─────────
   Inline SVG (stroke = currentColor) rather than emoji, so these screens
   look the same on every device and match the rest of the type. */
const ICON = {
  check:   '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  checkCircle: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>',
  lock:    '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  pin:     '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  alert:   '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  refresh: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>',
  calendar:'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  info:    '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>',
  wifiOff: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9a15 15 0 0 1 6.4-3.6M22 9a15 15 0 0 0-8.6-4.3M5.5 12.5a10 10 0 0 1 4.2-2.3M18.5 12.5a10 10 0 0 0-2-1.4M9 16a5 5 0 0 1 6 0M12 19.5h.01M3 3l18 18"/></svg>',
  drop:    '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  sun:     '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};

/* ══════════════════════════════════════════════════════════
   WI-FI PICKER
   Shared by the first-run setup guide and Settings ▸ Wi-Fi. Lists nearby
   networks (strongest first), taps open a password field, plain-language
   errors. Talks to /api/setup/wifi/* (setup.js → nmcli).
   ══════════════════════════════════════════════════════════ */
function signalBars(pct) {
  const n = pct >= 75 ? 4 : pct >= 50 ? 3 : pct >= 25 ? 2 : 1;
  return `<span class="wifi-bars" aria-label="Signal ${n} of 4">${[1, 2, 3, 4].map(i =>
    `<i class="${i <= n ? 'on' : ''}" style="height:${i * 25}%"></i>`).join('')}</span>`;
}

// onChange(status) fires after a successful connection
function createWifiPicker(container, onChange) {
  const st = { status: null, networks: null, scanning: false, selected: null, hidden: false, busy: false, error: '' };

  function render() {
    const s = st.status;
    let html = '';
    if (s && !s.available) {
      html += `<p class="settings-desc">${s.online
        ? `${ICON.check} Connected to the internet with a network cable. No Wi-Fi needed.`
        : 'No Wi-Fi hardware found. Plug in a network cable instead.'}</p>`;
      container.innerHTML = html;
      return;
    }
    if (s?.ssid) {
      html += `<div class="wifi-current">${ICON.check} Connected to <strong>${escHtml(s.ssid)}</strong>${s.online ? '' : ' (no internet yet)'}</div>`;
    } else if (s?.wired && s.online) {
      html += `<div class="wifi-current">${ICON.check} Connected with a network cable</div>`;
    }

    if (st.hidden) {
      html += `<div class="wifi-panel">
        <div class="wifi-panel-title">Join a network by name</div>
        <p class="settings-desc">For a network that doesn't show up in the list. Type its name exactly, including capital letters.</p>
        <input type="text" class="wifi-hidden-ssid" placeholder="Network name" autocomplete="off">
        <input type="password" class="wifi-pass" placeholder="Password (leave empty if there isn't one)" autocomplete="off">
        <label class="wifi-show"><input type="checkbox" data-wifi="show"> Show password</label>
        ${st.error ? `<p class="remote-error">${escHtml(st.error)}</p>` : ''}
        <div class="wifi-panel-actions">
          <button class="btn btn-ghost btn-sm" data-wifi="cancel-hidden" ${st.busy ? 'disabled' : ''}>Cancel</button>
          <button class="btn btn-accent btn-sm" data-wifi="connect-hidden" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Connecting…' : 'Connect'}</button>
        </div>
      </div>`;
      container.innerHTML = html;
      return;
    }

    html += `<div class="wifi-head"><span>${s?.ssid ? 'Switch to a different network' : 'Choose your Wi-Fi network'}</span>
      <button class="btn btn-ghost btn-sm" data-wifi="scan" ${st.scanning ? 'disabled' : ''}>${ICON.refresh} ${st.scanning ? 'Searching…' : 'Refresh'}</button></div>`;

    if (!st.networks && st.scanning) {
      html += '<p class="settings-desc">Looking for networks…</p>';
    } else if (st.networks && !st.networks.length) {
      html += '<p class="settings-desc">No networks found. Make sure the router is on, then search again.</p>';
    }

    html += '<div class="wifi-list">';
    for (const [i, n] of (st.networks || []).entries()) {
      const open = st.selected === i;
      html += `<div class="wifi-item ${open ? 'open' : ''}">
        <button class="wifi-row" data-wifi="pick" data-i="${i}">
          ${signalBars(n.signal)}
          <span class="wifi-name">${escHtml(n.ssid)}</span>
          ${n.connected ? '<span class="wifi-tag">Connected</span>' : ''}
          ${n.secure ? `<span class="wifi-lock" title="Password protected">${ICON.lock}</span>` : ''}
        </button>
        ${open && !n.connected ? `<div class="wifi-connect">
          ${n.secure ? '<input type="password" class="wifi-pass" placeholder="Wi-Fi password" autocomplete="off">' : ''}
          <label class="wifi-show"><input type="checkbox" data-wifi="show"> Show password</label>
          <div class="wifi-panel-actions">
            <button class="btn btn-ghost btn-sm" data-wifi="pick" data-i="${i}" ${st.busy ? 'disabled' : ''}>Cancel</button>
            <button class="btn btn-accent btn-sm" data-wifi="connect" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Connecting… (up to 30 seconds)' : 'Connect'}</button>
          </div>
        </div>` : ''}
      </div>`;
    }
    html += '</div>';

    html += '<button class="btn-link" data-wifi="hidden">My network isn\'t listed</button>';

    if (st.error) html += `<p class="remote-error">${escHtml(st.error)}</p>`;
    container.innerHTML = html;
  }

  async function refreshStatus() {
    try { st.status = await api('GET', '/api/setup/state').then(r => r.wifi); }
    catch { st.status = null; }
  }

  async function scan() {
    st.scanning = true; st.error = ''; render();
    try { st.networks = await api('GET', '/api/setup/wifi/networks'); }
    catch (err) { st.error = err.message; }
    st.scanning = false;
    await refreshStatus();
    render();
  }

  async function connect(ssid, password, hidden) {
    st.busy = true; st.error = ''; render();
    try {
      st.status = await api('POST', '/api/setup/wifi/connect', { ssid, password, hidden });
      st.selected = null; st.hidden = false;
      showToast(`Connected to ${ssid}.`, 'success');
      onChange?.(st.status);
      st.busy = false;
      await scan();
    } catch (err) {
      st.busy = false;
      st.error = errText(err);
      render();
    }
  }

  container.addEventListener('click', e => {
    const el = e.target.closest('[data-wifi]');
    if (!el) return;
    const item = el.closest('.wifi-item, .wifi-panel');
    switch (el.dataset.wifi) {
      case 'scan':   return scan();
      case 'hidden': st.hidden = true; st.selected = null; st.error = ''; render(); return container.querySelector('.wifi-hidden-ssid')?.focus();
      case 'cancel-hidden': st.hidden = false; st.error = ''; return render();
      case 'pick': {
        const i = +el.dataset.i;
        st.selected = st.selected === i ? null : i;
        st.error = '';
        render();
        return container.querySelector('.wifi-item.open .wifi-pass')?.focus();
      }
      case 'show':
        item.querySelectorAll('.wifi-pass').forEach(p => { p.type = el.checked ? 'text' : 'password'; });
        return;
      case 'connect': {
        const n = st.networks[st.selected];
        const pass = item.querySelector('.wifi-pass')?.value || '';
        if (n.secure && !pass) { st.error = 'Type the Wi-Fi password first.'; return render(); }
        return connect(n.ssid, pass, false);
      }
      case 'connect-hidden': {
        const ssid = item.querySelector('.wifi-hidden-ssid').value.trim();
        if (!ssid) { st.error = 'Type the network name first.'; return render(); }
        return connect(ssid, item.querySelector('.wifi-pass').value, true);
      }
    }
  });
  // Enter on the on-screen/physical keyboard connects
  container.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('.wifi-pass, .wifi-hidden-ssid')) return;
    e.preventDefault();
    e.target.closest('.wifi-item, .wifi-panel')?.querySelector('[data-wifi^="connect"]')?.click();
  });

  return { start: async () => { await refreshStatus(); render(); scan(); }, status: () => st.status };
}

/* ── Settings ▸ Wi-Fi ─────────────────────────────────────── */
const wifiModal = document.getElementById('wifi-modal');
const settingsWifiPicker = createWifiPicker(document.getElementById('wifi-modal-body'), refreshWifiSettingsStatus);

async function refreshWifiSettingsStatus() {
  const el = document.getElementById('wifi-settings-status');
  try {
    const { wifi } = await api('GET', '/api/setup/state');
    el.textContent = wifi.ssid ? `Connected to ${wifi.ssid}.`
      : wifi.wired && wifi.online ? 'Connected with a network cable.'
      : wifi.available ? 'Not connected.' : 'Wi-Fi isn\'t available on this device.';
  } catch { el.textContent = 'Couldn\'t check Wi-Fi.'; }
}
document.getElementById('settings-btn').addEventListener('click', refreshWifiSettingsStatus);

document.getElementById('wifi-open-btn').addEventListener('click', () => {
  settingsModal.hidden = true;
  wifiModal.hidden = false;
  settingsWifiPicker.start();
});
function closeWifiModal() { wifiModal.hidden = true; settingsModal.hidden = false; refreshWifiSettingsStatus(); }
document.getElementById('wifi-close').addEventListener('click', closeWifiModal);
wifiModal.addEventListener('click', e => { if (e.target === wifiModal) closeWifiModal(); });

/* ── Settings ▸ Reset for a new owner ─────────────────────── */
const resetModal = document.getElementById('reset-modal');
document.getElementById('reset-open-btn').addEventListener('click', () => {
  settingsModal.hidden = true;
  resetModal.hidden = false;
});
document.getElementById('reset-cancel').addEventListener('click', () => {
  resetModal.hidden = true;
  settingsModal.hidden = false;
});

let resetArmed = false;
document.getElementById('reset-confirm').addEventListener('click', async e => {
  const btn = e.currentTarget;
  if (!resetArmed) {
    resetArmed = true;
    btn.textContent = 'Tap again: this can\'t be undone';
    setTimeout(() => { resetArmed = false; btn.textContent = 'Erase Everything'; }, 5000);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Erasing…';
  try {
    await api('POST', '/api/setup/reset', {
      confirm: 'RESET',
      forgetWifi: document.getElementById('reset-forget-wifi').checked,
    });
    localStorage.clear();
    location.reload();
  } catch (err) {
    showError('Reset failed: ' + errText(err));
    btn.disabled = false;
    btn.textContent = 'Erase Everything';
    resetArmed = false;
  }
});

/* ══════════════════════════════════════════════════════════
   FIRST-RUN SETUP GUIDE
   Full-screen, one step at a time, shown when the server reports first-run
   mode (a fresh plug-and-play card, a new install, or after "Reset for a
   new owner"). Wi-Fi comes first so a card with nothing preconfigured
   works. Everything here stays changeable later in Settings.
   ══════════════════════════════════════════════════════════ */
const setupScreen = document.getElementById('setup-screen');
const setupCard   = document.getElementById('setup-card');
const SETUP_STEPS = ['welcome', 'wifi', 'location', 'screen', 'done'];
const setup = { step: 'welcome', online: false, loc: null, locBusy: false, locError: '', bench: null };
let setupWifiPicker = null;

function setupHead(n, title) {
  return `<p class="remote-step">Step ${n} of 3</p><h2 class="setup-title">${title}</h2>`;
}

function renderSetup() {
  let html = '';
  switch (setup.step) {
    case 'welcome':
      html = `<div class="setup-hero">${ICON.calendar}</div>
        <h2 class="setup-title">Welcome to your Family Dashboard</h2>
        <p class="setup-text">Let's get it ready. It takes about 5 minutes: connect to Wi-Fi,
        tell it where you are, and let it tune itself for this screen.</p>
        <div class="setup-actions"><button class="btn btn-accent setup-big" data-setup="next">Let's go</button></div>`;
      break;

    case 'wifi':
      html = `${setupHead(1, 'Connect to the internet')}
        <p class="setup-text">The dashboard needs the internet for weather and updates.</p>
        <div id="setup-wifi"></div>
        <div class="setup-actions">
          <button class="btn btn-ghost" data-setup="back">Back</button>
          <button class="btn btn-accent" data-setup="next" ${setup.online ? '' : 'disabled'}>Next</button>
        </div>`;
      break;

    case 'location': {
      const tf = getTimeFormat();
      html = `${setupHead(2, 'Where is this dashboard?')}
        <p class="setup-text">Your ZIP code sets the weather, weather alerts and the clock's time zone.</p>
        <div class="setup-zip">
          <input type="text" id="setup-zip" inputmode="numeric" maxlength="5" placeholder="ZIP code"
                 value="${escHtml(setup.loc?.zip || '')}" autocomplete="off">
          <button class="btn btn-accent" data-setup="zip" ${setup.locBusy ? 'disabled' : ''}>${setup.locBusy ? 'Looking up…' : 'Look up'}</button>
        </div>
        ${setup.loc ? `<div class="wifi-current">${ICON.pin} <strong>${escHtml(setup.loc.city)}</strong>${setup.loc.timeZone
          ? ` · ${escHtml(friendlyTimeZone(setup.loc.timeZone))}` : ''}</div>` : ''}
        ${setup.locError ? `<p class="remote-error">${escHtml(setup.locError)}</p>` : ''}
        <p class="setup-text setup-label">How should the clock look?</p>
        <div class="theme-options">
          <button class="theme-opt ${tf === '12h' ? 'active' : ''}" data-setup="tf" data-val="12h">3:30 PM</button>
          <button class="theme-opt ${tf === '24h' ? 'active' : ''}" data-setup="tf" data-val="24h">15:30</button>
        </div>
        <div class="setup-actions">
          <button class="btn btn-ghost" data-setup="back">Back</button>
          <button class="btn btn-accent" data-setup="next" ${setup.loc ? '' : 'disabled'}>Next</button>
        </div>`;
      break;
    }

    case 'screen':
      html = `${setupHead(3, 'Tune it for this screen')}`
        + (setup.bench
          ? `<div class="wifi-current">${ICON.check} Done. Using the smoothest look this screen handles well.</div>
             <p class="setup-text">You can change this anytime in Settings.</p>
             <div class="setup-actions"><button class="btn btn-accent" data-setup="next">Next</button></div>`
          : `<p class="setup-text">The dashboard will try out its animations and visual effects and keep
             the nicest ones that still run smoothly here. It takes about <strong>3 minutes</strong>.
             The screen will change a few times. Please don't touch it while it works.</p>
             <div class="setup-actions">
               <button class="btn btn-ghost" data-setup="back">Back</button>
               <button class="btn btn-ghost" data-setup="skip-bench">Skip (use the simplest look)</button>
               <button class="btn btn-accent" data-setup="bench">Start</button>
             </div>`);
      break;

    case 'done':
      html = `<div class="setup-hero setup-hero-ok">${ICON.checkCircle}</div>
        <h2 class="setup-title">You're all set</h2>
        <p class="setup-text">Add events with <strong>+ Add Event</strong>, and find everything else
        in <strong>Settings</strong> (the gear button, top right).</p>
        <p class="setup-text">Want family to see and add events from their phones when they're away
        from home? You can set that up now, or anytime later in Settings.</p>
        <div class="setup-actions setup-actions-col">
          <button class="btn btn-accent setup-big" data-setup="finish">Start using the dashboard</button>
          <button class="btn btn-ghost" data-setup="finish-remote">Set up phone access first</button>
        </div>`;
      break;
  }
  setupCard.innerHTML = html;

  if (setup.step === 'wifi') {
    setupWifiPicker = createWifiPicker(document.getElementById('setup-wifi'), s => {
      setup.online = !!s.online;
      document.querySelector('[data-setup="next"]').disabled = !setup.online;
    });
    setupWifiPicker.start().then(() => {
      setup.online = !!setupWifiPicker.status()?.online;
      const next = document.querySelector('[data-setup="next"]');
      if (next) next.disabled = !setup.online;
    });
  }
}

// "America/Chicago" → "Central Standard Time" (whatever the browser calls it)
function friendlyTimeZone(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || tz;
  } catch { return tz; }
}

async function setupLookupZip() {
  const zip = document.getElementById('setup-zip').value.trim();
  if (!/^\d{5}$/.test(zip)) { setup.locError = 'Type a 5-digit ZIP code.'; return renderSetup(); }
  setup.locBusy = true; setup.locError = ''; renderSetup();
  try {
    const geo = await geocodeZip(zip);
    const station = await resolveNwsStation(geo.lat, geo.lon);
    setup.loc = {
      lat: geo.lat, lon: geo.lon, zip,
      city: geo.city || station.label || 'Your location',
      detail: geo.detail || zip,
      stationId: station.stationId,
      timeZone: station.timeZone,
    };
  } catch {
    setup.locError = 'Couldn\'t find that ZIP code. Check it and try again.';
  }
  setup.locBusy = false;
  renderSetup();
}

async function setupSaveLocation() {
  const { timeZone, ...loc } = setup.loc;
  setActiveLocation(loc);
  // Refresh now: finishing via "Set up phone access first" doesn't reload,
  // and the dashboard would otherwise keep showing the default location's
  // weather until the next scheduled refresh.
  fetchWeather();
  fetchAlerts();
  if (timeZone) {
    try { await api('POST', '/api/setup/timezone', { timeZone }); }
    catch { showError('Couldn\'t set the time zone. You can fix the clock later in Settings.'); }
  }
}

async function setupRunBench() {
  setupScreen.hidden = true; // measure the dashboard itself, not this card
  try { setup.bench = await runGraphicsBenchmark({ fromSetup: true }); }
  catch { setup.bench = { skipped: true }; }
  setupScreen.hidden = false;
  renderSetup();
}

async function setupFinish(openRemote) {
  try { await api('POST', '/api/setup/complete'); } catch { /* shows again next load; harmless */ }
  if (!openRemote) return location.reload(); // clean start with the new location/settings
  setupScreen.hidden = true;
  document.getElementById('settings-btn').click();
  document.getElementById('remote-open-btn').click();
}

setupCard.addEventListener('click', async e => {
  const el = e.target.closest('[data-setup]');
  if (!el || el.disabled) return;
  const i = SETUP_STEPS.indexOf(setup.step);
  switch (el.dataset.setup) {
    case 'next':
      if (setup.step === 'location') await setupSaveLocation();
      setup.step = SETUP_STEPS[i + 1];
      return renderSetup();
    case 'back':
      setup.step = SETUP_STEPS[i - 1];
      return renderSetup();
    case 'zip':
      return setupLookupZip();
    case 'tf':
      localStorage.setItem('timeFormat', el.dataset.val);
      refreshDateTimeDisplaysAppWide();
      return renderSetup();
    case 'bench':
      return setupRunBench();
    case 'skip-bench':
      localStorage.setItem('gfxGlass', 'off');
      localStorage.setItem('gfxWxQuality', 'off');
      setup.bench = { skipped: true };
      return renderSetup();
    case 'finish':
      return setupFinish(false);
    case 'finish-remote':
      return setupFinish(true);
  }
});
setupCard.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'setup-zip') { e.preventDefault(); setupLookupZip(); }
});

api('GET', '/api/setup/state').then(s => {
  if (!s.firstRun) return;
  // A touchscreen with no keyboard attached — turn the on-screen keyboard
  // on before the first text field (the Wi-Fi password) needs it.
  if (navigator.maxTouchPoints > 0 && localStorage.getItem('oskEnabled') === null) localStorage.setItem('oskEnabled', 'true');
  setupScreen.hidden = false;
  renderSetup();
}).catch(() => {});

/* ── Debug ▸ Device Login ─────────────────────────────────── */
document.getElementById('device-pw-btn').addEventListener('click', async e => {
  const out = document.getElementById('device-pw');
  if (!out.hidden) { out.hidden = true; e.currentTarget.textContent = 'Show'; return; }
  try {
    const r = await api('GET', '/api/device/password');
    out.innerHTML = r.password
      ? `Username: <code>${escHtml(r.user)}</code><br>Password: <code>${escHtml(r.password)}</code>`
      : `Username: <code>${escHtml(r.user)}</code><br>This unit uses the password set when it was built (no per-device password on file).`;
  } catch (err) {
    out.textContent = errText(err);
  }
  out.hidden = false;
  e.currentTarget.textContent = 'Hide';
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
  if (s?.gpu?.throttled != null) lines.push(`THROTTLED: ${s.gpu.throttled ? 'YES' : 'No'}`);
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
   DEBUG: GRAPHICS BENCHMARK
   Steps through every Glass Blur × Weather Animation combination and
   measures the page's real frame rate via rAF — so it includes compositing
   the blurred panels over the canvas, not just the canvas's own capped
   loop. Weather Animation = Off has no canvas, so the scene doesn't matter
   there and it's measured once per glass tier.
   ══════════════════════════════════════════════════════════ */
const BENCH_GLASS  = ['off', 'reduced', 'full'];
const BENCH_WX     = ['off', 'reduced', 'full'];
// Heavy rain is the most particles; overcast is the biggest/most overdraw
// cloud scene — together they bracket the realistic worst cases.
const BENCH_SCENES = [
  { mode: 'rain',     intensity: 'heavy',    label: 'Heavy rain' },
  { mode: 'overcast', intensity: 'moderate', label: 'Overcast' },
];
const BENCH_WARMUP_MS  = 2000;
const BENCH_MEASURE_MS = 8000;
const BENCH_JANK_MS    = 25; // a frame this long is a visible hitch at 60Hz
let benchRunning = false;

const benchSleep = ms => new Promise(r => setTimeout(r, ms));

function benchVerdict(avgFps, lowFps) {
  if (avgFps >= 50 && lowFps >= 30) return 'smooth';
  if (avgFps >= 30) return 'ok';
  return 'choppy';
}

function benchMeasure(ms) {
  return new Promise(resolve => {
    const deltas = [];
    let start = 0, last = 0;
    // Browsers throttle rAF to ~1fps (or pause it) for a hidden/occluded
    // tab, which would read as "choppy" — flag it rather than trust it.
    let wasHidden = document.hidden;
    const onVis = () => { if (document.hidden) wasHidden = true; };
    document.addEventListener('visibilitychange', onVis);
    function tick(ts) {
      if (!start) start = ts;
      else deltas.push(ts - last);
      last = ts;
      if (ts - start < ms) return requestAnimationFrame(tick);
      document.removeEventListener('visibilitychange', onVis);
      resolve({ deltas, elapsed: ts - start, wasHidden });
    }
    requestAnimationFrame(tick);
  });
}

async function benchRunOne(glass, wx, scene) {
  localStorage.setItem('gfxGlass', glass);
  localStorage.setItem('gfxWxQuality', wx);
  applyGlassSetting();
  wxIntensity = scene.intensity;
  applyWxMode(scene.mode);
  if (getLockScreenEnabled()) revealPrivacy(); // measure the dashboard, not the lock screen

  // Warm-up so particle init and the first blur passes after a switch don't
  // skew the numbers; the sysstats call resets the server's CPU baseline so
  // the second one reports CPU over exactly the measured window.
  await benchSleep(BENCH_WARMUP_MS);
  await api('GET', '/api/sysstats').catch(() => null);
  const { deltas, elapsed, wasHidden } = await benchMeasure(BENCH_MEASURE_MS);
  const stats = await api('GET', '/api/sysstats').catch(() => null);

  const worst  = [...deltas].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(deltas.length / 100)));
  const avgFps = deltas.length * 1000 / elapsed;
  const lowFps = 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length);
  const round1 = n => Math.round(n * 10) / 10;
  return {
    glass, wx,
    scene:      wx === 'off' ? null : scene.label,
    avgFps:     round1(avgFps),
    lowFps:     round1(lowFps),
    jankPct:    round1(deltas.filter(d => d > BENCH_JANK_MS).length / deltas.length * 100),
    cpuPercent: stats?.cpuPercent ?? null,
    tempC:      stats?.tempC ?? null,
    throttled:  stats?.gpu?.throttled ?? null,
    verdict:    wasHidden ? 'invalid' : benchVerdict(avgFps, lowFps),
  };
}

// Highest-cost combo that's smooth in every scene; ties go to the higher
// weather tier, since the animated sky is the more noticeable of the two.
function benchRecommend(runs) {
  let best = null;
  for (const glass of BENCH_GLASS) for (const wx of BENCH_WX) {
    const rs = runs.filter(r => r.glass === glass && r.wx === wx);
    if (!rs.length || !rs.every(r => r.verdict === 'smooth' || r.verdict === 'invalid')) continue;
    if (rs.every(r => r.verdict === 'invalid')) continue;
    const score = BENCH_GLASS.indexOf(glass) + BENCH_WX.indexOf(wx);
    if (!best || score > best.score || (score === best.score && BENCH_WX.indexOf(wx) > BENCH_WX.indexOf(best.wx)))
      best = { glass, wx, score };
  }
  return best ? { glass: best.glass, wx: best.wx } : null;
}

function renderBenchResults(res) {
  const el = document.getElementById('bench-results');
  if (!res) { el.innerHTML = ''; return; }
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const rec = res.recommended;
  const when = new Date(res.ranAt).toLocaleString();
  const rows = res.runs.map(r => `
    <tr>
      <td>${cap(r.glass)}</td><td>${cap(r.wx)}</td><td>${r.scene || '—'}</td>
      <td>${r.avgFps}</td><td>${r.lowFps}</td><td>${r.jankPct}%</td>
      <td>${r.cpuPercent != null ? r.cpuPercent + '%' : '—'}</td>
      <td class="bench-${r.verdict}">${cap(r.verdict)}</td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="bench-rec">
      ${rec
        ? `<strong>Recommended:</strong> Frosted Glass <strong>${cap(rec.glass)}</strong>, Animated Sky <strong>${cap(rec.wx)}</strong>
           <button class="btn btn-ghost btn-sm" id="bench-apply">Apply</button>`
        : '<strong>Nothing stayed smooth</strong> — keep Frosted Glass and Animated Sky both Off.'}
      ${res.runs.some(r => r.verdict === 'invalid') ? '<br>Note: the screen was hidden or covered during some runs (marked Invalid), so those were skipped. Re-run for a complete result.' : ''}
      ${res.runs.some(r => r.throttled) ? '<br>Note: the Pi reported throttling (heat or undervoltage) during the run, so these numbers may be pessimistic.' : ''}
      <br><span class="settings-desc">${when} · ${res.screen}</span>
    </div>
    <div class="bench-scroll"><table>
      <tr><th>Glass</th><th>Sky</th><th>Scene</th><th>Avg FPS</th><th>1% low</th><th>Jank</th><th>CPU</th><th></th></tr>
      ${rows}
    </table></div>`;
  document.getElementById('bench-apply')?.addEventListener('click', () => {
    localStorage.setItem('gfxGlass', rec.glass);
    localStorage.setItem('gfxWxQuality', rec.wx);
    applyGlassSetting();
    applyWxMode(wxMode);
    showToast('Recommended graphics settings applied.', 'success');
  });
}

// fromSetup: run by the first-run setup guide — applies the recommended
// settings itself and returns the result instead of opening Debug Options.
async function runGraphicsBenchmark({ fromSetup = false } = {}) {
  if (benchRunning) return null;
  benchRunning = true;
  const saved = {
    glass: localStorage.getItem('gfxGlass'), wx: localStorage.getItem('gfxWxQuality'),
    mode: wxMode, intensity: wxIntensity,
  };
  // The overlay's polling would reset the server's CPU baseline mid-window
  const perfWasOn = !perfOverlay.hidden;
  stopPerfOverlay();
  document.querySelectorAll('.modal-overlay').forEach(m => { m.hidden = true; });

  const plan = [];
  for (const glass of BENCH_GLASS) for (const wx of BENCH_WX)
    for (const scene of (wx === 'off' ? BENCH_SCENES.slice(0, 1) : BENCH_SCENES)) plan.push({ glass, wx, scene });

  const banner = document.getElementById('bench-banner');
  banner.hidden = false;
  // A stray tap mid-run would open menus over the dashboard and skew the
  // measurements — swallow all input until it's done (capture phase on
  // window, ahead of every other listener).
  const INPUT_EVENTS = ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'keydown', 'wheel', 'contextmenu'];
  const blockInput = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  INPUT_EVENTS.forEach(t => window.addEventListener(t, blockInput, { capture: true, passive: false }));
  const runs = [];
  try {
    for (const [i, p] of plan.entries()) {
      banner.textContent = fromSetup
        ? `Tuning the display for this screen (${i + 1} of ${plan.length}). This takes about 3 minutes. The screen is locked until it's done.`
        : `Benchmark ${i + 1}/${plan.length}: Glass ${p.glass} · Sky ${p.wx}` +
          (p.wx === 'off' ? '' : ` · ${p.scene.label}`) + ' — touch is locked until it\'s done';
      runs.push(await benchRunOne(p.glass, p.wx, p.scene));
    }
  } finally {
    INPUT_EVENTS.forEach(t => window.removeEventListener(t, blockInput, { capture: true }));
    const restore = (key, val) => val == null ? localStorage.removeItem(key) : localStorage.setItem(key, val);
    restore('gfxGlass', saved.glass);
    restore('gfxWxQuality', saved.wx);
    applyGlassSetting();
    wxIntensity = saved.intensity;
    benchRunning = false;
    applyWxMode(saved.mode);
    banner.hidden = true;
    if (perfWasOn) startPerfOverlay();
  }

  const res = {
    ranAt:       new Date().toISOString(),
    screen:      `${window.innerWidth}×${window.innerHeight} @${Math.round(window.devicePixelRatio * 100) / 100}x`,
    userAgent:   navigator.userAgent,
    runs,
    recommended: benchRecommend(runs),
  };
  renderBenchResults(res);
  try { await api('POST', '/api/benchmark', res); }
  catch { if (!fromSetup) showToast('Benchmark finished, but saving results to the server failed.'); }
  if (fromSetup) {
    const rec = res.recommended || { glass: 'off', wx: 'off' };
    localStorage.setItem('gfxGlass', rec.glass);
    localStorage.setItem('gfxWxQuality', rec.wx);
    applyGlassSetting();
    applyWxMode(wxMode);
  } else {
    debugModal.hidden = false;
  }
  return res;
}

document.getElementById('debug-run-bench').addEventListener('click', () => {
  runGraphicsBenchmark().catch(err => showToast(`Benchmark failed: ${err.message}`));
});

document.getElementById('debug-open-btn').addEventListener('click', async () => {
  if (benchRunning) return;
  try { renderBenchResults(await api('GET', '/api/benchmark')); } catch { /* keep whatever's shown */ }
});

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
  const eu = getDateFormat() === 'EU';
  let text;
  if (calView === 'day') {
    const DN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    text = fmtLongDate(start, { weekday: DN[start.getDay()] });
  } else if (calView === 'month') {
    text = `${MLONG[start.getMonth()]} ${start.getFullYear()}`;
  } else {
    const sm = start.getMonth() === end.getMonth();
    if (sm) {
      text = eu
        ? `${start.getDate()}–${end.getDate()} ${M[start.getMonth()]} ${start.getFullYear()}`
        : `${M[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
    } else {
      text = eu
        ? `${start.getDate()} ${M[start.getMonth()]} – ${end.getDate()} ${M[end.getMonth()]} ${end.getFullYear()}`
        : `${M[start.getMonth()]} ${start.getDate()} – ${M[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    }
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
  const range   = getMonthGridRange(year, month);

  if (structureChanged) {
    setCalLabel(pivot, lastDay);
    buildMonthStructure(year, month, range);
    _lastCalKey = calKey;
  }

  // Fetch the whole visible grid (not just this month) so the leading/trailing
  // other-month cells — including the next-month lookahead row — show events too.
  let events;
  try {
    events = await api('GET', `/api/calendar?start=${toYMD(range.start)}&end=${toYMD(addDays(range.start, range.cells - 1))}`);
  } catch { events = []; }

  const sig = eventsSig(events);
  if (structureChanged || sig !== _lastEventsSig) {
    calEvents = events;
    fillMonthEvents(calEvents);
    _lastEventsSig = sig;
  }
}

// Visible date range for a month grid. Normally just the weeks spanning the
// month, but once today is in the current month's final week, today's row
// would be the bottom row with little or nothing of next month visible —
// so add the following week as a lookahead. The grid always starts on the
// Sunday on/before the 1st and covers whole weeks, so the leading/trailing
// days of the adjacent months are always shown (rarely this means 7 rows).
function getMonthGridRange(year, month) {
  const startDow = new Date(year, month, 1).getDay();
  const daysInMo = new Date(year, month + 1, 0).getDate();
  const start = new Date(year, month, 1 - startDow);
  let cells = Math.ceil((startDow + daysInMo) / 7) * 7;
  let lookahead = false;

  const now = new Date();
  if (now.getFullYear() === year && now.getMonth() === month) {
    const todayIdx = startDow + now.getDate() - 1;
    if (Math.floor(todayIdx / 7) === cells / 7 - 1) {
      cells += 7;
      lookahead = true;
    }
  }
  return { start, cells, lookahead };
}

function buildMonthStructure(year, month, range = getMonthGridRange(year, month)) {
  const today = todayYMD();
  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MON   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Reuse cal-header for day-name row (no gutter in month view — grid starts at col 1)
  const hdr = document.getElementById('cal-header');
  hdr.innerHTML = '';
  DAYS.forEach(name => {
    const cell = document.createElement('div');
    cell.className = 'cal-day-hdr';
    cell.innerHTML = `<div class="hdr-name">${name}</div>`;
    hdr.appendChild(cell);
  });

  const grid = document.getElementById('cal-month-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateRows = `repeat(${range.cells / 7}, minmax(0, 1fr))`;

  for (let i = 0; i < range.cells; i++) {
    const d   = addDays(range.start, i);
    const ymd = toYMD(d);
    const thisMonth = d.getMonth() === month;
    const cell = document.createElement('div');
    cell.className = 'cal-month-cell' +
      (ymd === today   ? ' is-today'    : '') +
      (!thisMonth      ? ' other-month' : '') +
      (!thisMonth && range.lookahead && ymd > today ? ' lookahead' : '');
    cell.dataset.date = ymd;
    // Label the 1st of the lookahead month ("Nov 1") so the month change is obvious
    const dateLabel = range.lookahead && !thisMonth && d.getDate() === 1
      ? `${MON[d.getMonth()]} 1` : d.getDate();
    cell.innerHTML = `<div class="cal-month-date${typeof dateLabel === 'string' ? ' with-month' : ''}">${dateLabel}</div>
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
    const time = ev.end_time ? `${fmt12h(ev.start_time)}–${fmt12h(ev.end_time)}` : fmt12h(ev.start_time);
    chip.textContent = (ev.all_day || !ev.start_time) ? ev.title : `${time} ${ev.title}`;
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

// ── Custom date/time picker popups ───────────────────────────────
// Fully custom UI, not the native <input type="date"/"time"> picker — the
// native widget's own display format can't be made to follow this app's
// Date & Time Format setting (it always shows whatever the OS/browser
// locale dictates, regardless of what's configured here), and testing
// found its actual behavior calling showPicker() varied noticeably across
// browsers/versions (Chromium vs Firefox, old vs new Chromium builds).
// Being fully custom means identical, predictable behavior everywhere.
const dateOverlay = document.getElementById('dt-date-overlay');
const timeOverlay = document.getElementById('dt-time-overlay');
let activeDatePicker  = null; // { input } for whichever field is open
let activeTimePicker  = null;
let datePickerViewDate = new Date(); // month currently shown in the date popup

const DT_MLONG     = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
const DT_DOW_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function parseYMD(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function closeDtPopups() {
  dateOverlay.hidden = true;
  timeOverlay.hidden = true;
  activeDatePicker = null;
  activeTimePicker = null;
}
// Same click-outside-closes pattern as every other modal in the app
// (addModal, detailModal, etc.) — clicking the dimmed backdrop itself
// (not the popup card) dismisses it.
dateOverlay.addEventListener('click', e => { if (e.target === dateOverlay) closeDtPopups(); });
timeOverlay.addEventListener('click', e => { if (e.target === timeOverlay) closeDtPopups(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDtPopups(); });

/* ── Date picker: calendar grid, same layout logic as the month view ── */
function renderDatePickerGrid() {
  const year  = datePickerViewDate.getFullYear();
  const month = datePickerViewDate.getMonth();
  document.getElementById('dt-date-popup-label').textContent = `${DT_MLONG[month]} ${year}`;

  const weekdaysEl = document.getElementById('dt-date-weekdays');
  if (!weekdaysEl.childElementCount) weekdaysEl.innerHTML = DT_DOW_SHORT.map(d => `<span>${d}</span>`).join('');

  const grid = document.getElementById('dt-date-grid');
  grid.innerHTML = '';
  const startDow    = new Date(year, month, 1).getDay();
  const daysInMo    = new Date(year, month + 1, 0).getDate();
  const totalCells  = Math.ceil((startDow + daysInMo) / 7) * 7;
  const today       = toYMD(new Date());
  const selected    = activeDatePicker?.input.value || '';

  for (let i = 0; i < totalCells; i++) {
    const d   = new Date(year, month, 1 + i - startDow);
    const ymd = toYMD(d);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'dt-date-cell' +
      (d.getMonth() !== month ? ' other-month' : '') +
      (ymd === today    ? ' is-today'    : '') +
      (ymd === selected ? ' is-selected' : '');
    cell.textContent = d.getDate();
    cell.addEventListener('click', () => {
      activeDatePicker.input.value = ymd;
      activeDatePicker.input.dispatchEvent(new Event('change'));
      closeDtPopups();
    });
    grid.appendChild(cell);
  }
}

function openDatePicker(input) {
  closeDtPopups();
  activeDatePicker = { input };
  datePickerViewDate = input.value ? parseYMD(input.value) : new Date();
  datePickerViewDate.setDate(1);
  renderDatePickerGrid();
  dateOverlay.hidden = false;
}
document.getElementById('dt-date-prev').addEventListener('click', () => {
  datePickerViewDate.setMonth(datePickerViewDate.getMonth() - 1);
  renderDatePickerGrid();
});
document.getElementById('dt-date-next').addEventListener('click', () => {
  datePickerViewDate.setMonth(datePickerViewDate.getMonth() + 1);
  renderDatePickerGrid();
});
document.getElementById('dt-date-today').addEventListener('click', () => {
  if (!activeDatePicker) return;
  activeDatePicker.input.value = toYMD(new Date());
  activeDatePicker.input.dispatchEvent(new Event('change'));
  closeDtPopups();
});
document.getElementById('dt-date-close').addEventListener('click', closeDtPopups);

/* ── Time picker: scrollable list of 15-minute slots, formatted per the
   app's own 12h/24h setting — tap one directly rather than dialing hour/
   minute/AM-PM separately. */
function renderTimePickerList() {
  const list = document.getElementById('dt-time-list');
  list.innerHTML = '';
  const selected = activeTimePicker?.input.value || '';
  let selectedBtn = null;
  for (let mins = 0; mins < 24 * 60; mins += 15) {
    const h = Math.floor(mins / 60), m = mins % 60;
    const value = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dt-time-opt' + (value === selected ? ' is-selected' : '');
    btn.textContent = fmt12hHM(h, m);
    btn.addEventListener('click', () => {
      activeTimePicker.input.value = value;
      activeTimePicker.input.dispatchEvent(new Event('change'));
      closeDtPopups();
    });
    if (value === selected) selectedBtn = btn;
    list.appendChild(btn);
  }
  (selectedBtn || list.firstChild)?.scrollIntoView({ block: 'center' });
}

function openTimePicker(input) {
  closeDtPopups();
  activeTimePicker = { input };
  renderTimePickerList();
  timeOverlay.hidden = false;
}
document.getElementById('dt-time-clear').addEventListener('click', () => {
  if (!activeTimePicker) return;
  activeTimePicker.input.value = '';
  activeTimePicker.input.dispatchEvent(new Event('change'));
  closeDtPopups();
});

// formatFn turns the native input's raw value ("2026-07-23" / "14:30")
// into the app's own date/time format; sync() must be called manually
// after setting the underlying input's .value via JS (opening the form
// for add/edit doesn't fire a native 'change' event), which is why each
// wireup below returns its sync function instead of just attaching
// listeners.
function wireCustomDateTimeInput(inputId, btnId, textId, kind, formatFn, placeholder) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(btnId);
  const text  = document.getElementById(textId);
  const sync = () => {
    if (input.value) {
      text.textContent = formatFn(input.value);
      text.classList.remove('placeholder');
    } else {
      text.textContent = placeholder;
      text.classList.add('placeholder');
    }
  };
  btn.addEventListener('click', () => {
    if (kind === 'date') openDatePicker(input);
    else openTimePicker(input);
  });
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  sync();
  return sync;
}

function formatDateForDisplay(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return getDateFormat() === 'EU'
    ? `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`
    : `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}/${y}`;
}
function formatTimeForDisplay(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return fmt12hHM(h, m);
}

const syncEvDate  = wireCustomDateTimeInput('ev-date',  'ev-date-btn',  'ev-date-text',  'date', formatDateForDisplay, 'Select date');
const syncEvStart = wireCustomDateTimeInput('ev-start', 'ev-start-btn', 'ev-start-text', 'time', formatTimeForDisplay, 'Start time');
const syncEvEnd   = wireCustomDateTimeInput('ev-end',   'ev-end-btn',   'ev-end-text',   'time', formatTimeForDisplay, 'End time');
const syncEvUntil = wireCustomDateTimeInput('ev-until', 'ev-until-btn', 'ev-until-text', 'date', formatDateForDisplay, 'No end date');
function syncAllEventFormDisplays() { syncEvDate(); syncEvStart(); syncEvEnd(); syncEvUntil(); }

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
  syncAllEventFormDisplays();
  addModal.hidden = false;
  document.getElementById('ev-title').focus();
});

function closeAddModal() {
  addModal.hidden = true;
  closeDtPopups(); // a date/time popup left open with its parent form gone would float uselessly
  addForm.reset();
  syncAllEventFormDisplays(); // reset() doesn't fire input/change, so the custom displays need an explicit refresh
  untilRow.style.display    = 'none';
  intervalRow.style.display = 'none';
  timeFields.style.display  = 'flex';
  swatchContainer.querySelectorAll('.color-swatch').forEach((el, i) =>
    el.classList.toggle('selected', i === 0));
  selectedColor = COLORS[0].hex;
  editingEventId = null;
  editingOccurrenceDate = null;
  document.getElementById('add-modal-title').textContent  = 'Add Event';
  document.getElementById('add-modal-submit').textContent = 'Save Event';
  document.getElementById('edit-recur-hint').hidden = true;
  document.getElementById('ev-repeat-row').style.display = 'flex';
}

// Reuses the Add Event form/modal for editing — populates every field from
// the existing event, then the submit handler below routes to PATCH instead
// of POST based on `editingEventId`. Edits the whole series by default; pass
// occurrenceDate (an occurrence's display_date) to instead edit just that one
// occurrence — it's detached into its own standalone event on save (see the
// submit handler and the server's PATCH ?mode=single), so the recurrence
// fields are hidden here since they no longer apply to a single occurrence.
function openEditModal(ev, occurrenceDate = null) {
  editingEventId = ev.id;
  editingOccurrenceDate = occurrenceDate;

  document.getElementById('ev-title').value  = ev.title;
  document.getElementById('ev-desc').value   = ev.description || '';
  document.getElementById('ev-person').value = ev.person || '';

  selectedColor = ev.color;
  swatchContainer.querySelectorAll('.color-swatch').forEach((el, i) =>
    el.classList.toggle('selected', COLORS[i].hex === ev.color));

  document.getElementById('ev-date').value = occurrenceDate || ev.event_date;

  allDayCbx.checked = !!ev.all_day;
  timeFields.style.display = allDayCbx.checked ? 'none' : 'flex';
  document.getElementById('ev-start').value = ev.start_time || '';
  document.getElementById('ev-end').value   = ev.end_time   || '';
  document.getElementById('ev-private').checked = !!ev.is_private;

  document.getElementById('ev-repeat-row').style.display = occurrenceDate ? 'none' : 'flex';
  recurSel.value = occurrenceDate ? 'none' : (ev.recurrence || 'none');
  const repeats = recurSel.value !== 'none';
  untilRow.style.display    = repeats ? 'flex' : 'none';
  intervalRow.style.display = repeats ? 'flex' : 'none';
  document.getElementById('ev-interval-unit').textContent = RECUR_UNIT_LABELS[recurSel.value] || '';
  document.getElementById('ev-recur-interval').value = ev.recurrence_interval || 1;
  document.getElementById('ev-until').value = ev.recurrence_until || '';
  syncAllEventFormDisplays();

  document.getElementById('add-modal-title').textContent  = 'Edit Event';
  document.getElementById('add-modal-submit').textContent = 'Save Changes';
  const hintEl = document.getElementById('edit-recur-hint');
  if (occurrenceDate) {
    hintEl.textContent = 'Editing just this occurrence — the rest of the series is unaffected.';
    hintEl.hidden = false;
  } else {
    hintEl.textContent = 'Editing a recurring event updates the entire series (all occurrences).';
    hintEl.hidden = !repeats;
  }

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
    if (isEdit) {
      const url = editingOccurrenceDate
        ? `/api/calendar/${editingEventId}?date=${editingOccurrenceDate}&mode=single`
        : `/api/calendar/${editingEventId}`;
      await api('PATCH', url, payload);
    } else {
      await api('POST', '/api/calendar', payload);
    }
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

// Event details rows (the rest come from ICON)
const DETAIL_ICON = {
  clock:  '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  person: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
};

function showEventDetail(ev) {
  detailEventId   = ev.id;
  detailEventDate = ev.display_date;
  detailEventFull = ev;
  document.getElementById('detail-color-bar').style.background = ev.color;
  document.getElementById('detail-title').textContent = ev.title;

  const [y, m, d] = ev.display_date.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const DNLONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dateFmt = fmtLongDate(dateObj, { weekday: DNLONG[dateObj.getDay()] });

  const row = (icon, text) => `<div class="detail-row">${icon}<span>${text}</span></div>`;
  let info = row(ICON.calendar, dateFmt);
  info += row(DETAIL_ICON.clock, ev.start_time
    ? fmt12h(ev.start_time) + (ev.end_time ? ` – ${fmt12h(ev.end_time)}` : '')
    : 'All day');
  if (ev.person) info += row(DETAIL_ICON.person, escHtml(ev.person));
  if (ev.is_private) info += row(ICON.lock, 'Private <span class="detail-sub">Shows as "Busy" until someone taps it</span>');

  const isRecurring = ev.recurrence && ev.recurrence !== 'none';
  if (isRecurring) {
    info += row(ICON.refresh, describeRecurrence(ev));
    document.getElementById('detail-delete').textContent = 'Delete…';
  } else {
    document.getElementById('detail-delete').textContent = 'Delete Event';
  }

  if (ev.description) info += `<div class="detail-desc">${escHtml(ev.description)}</div>`;

  if (ev.created_at) {
    const createdFmt = fmtLongDate(new Date(ev.created_at * 1000));
    info += `<div class="detail-created">Created ${createdFmt}</div>`;
  }

  document.getElementById('detail-body').innerHTML = info;
  detailModal.hidden = false;
}

// Settings > Date & Time Format changes should be visible immediately, not
// just on the next natural refresh — re-renders everything currently on
// screen that shows a date or time. Forces the calendar's structure-cache
// keys to miss so setCalLabel/event chips actually rebuild even though the
// underlying view/dates haven't changed, only their formatting.
function refreshDateTimeDisplaysAppWide() {
  updateClock();
  _lastCalKey = null;
  _lastEventsSig = null;
  loadCalendar();
  if (!document.getElementById('lock-screen').hidden) renderLockAgenda();
  if (!addModal.hidden) syncAllEventFormDisplays();
  if (!detailModal.hidden && detailEventFull) showEventDetail(detailEventFull);
}

document.getElementById('detail-close').addEventListener('click', () => { detailModal.hidden = true; });
detailModal.addEventListener('click', e => { if (e.target === detailModal) detailModal.hidden = true; });

/* ── Recurring event scope picker ────────────────────────────
   Shared by Edit and Delete: a recurring event needs to know which
   occurrence(s) an action applies to. Non-recurring events skip this
   entirely and act immediately, same as before. */
const recurScopeModal = document.getElementById('recur-scope-modal');

function openRecurScopeModal(title, options) {
  document.getElementById('recur-scope-title').textContent = title;
  const container = document.getElementById('recur-scope-options');
  container.innerHTML = '';
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${opt.danger ? 'btn-danger-outline' : 'btn-ghost'}`;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => { closeRecurScopeModal(); opt.action(); });
    container.appendChild(btn);
  });
  recurScopeModal.hidden = false;
}

function closeRecurScopeModal() { recurScopeModal.hidden = true; }

document.getElementById('recur-scope-cancel').addEventListener('click', closeRecurScopeModal);
recurScopeModal.addEventListener('click', e => { if (e.target === recurScopeModal) closeRecurScopeModal(); });

document.getElementById('detail-edit').addEventListener('click', () => {
  if (!detailEventFull) return;
  const isRecurring = detailEventFull.recurrence && detailEventFull.recurrence !== 'none';
  if (!isRecurring) {
    detailModal.hidden = true;
    openEditModal(detailEventFull);
    return;
  }
  openRecurScopeModal('Edit which events?', [
    { label: 'This Event Only',          action: () => { detailModal.hidden = true; openEditModal(detailEventFull, detailEventDate); } },
    { label: 'All Events in the Series', action: () => { detailModal.hidden = true; openEditModal(detailEventFull); } },
  ]);
});

async function deleteCalendarEvent(scope) {
  try {
    const url = (!scope || scope === 'all')
      ? `/api/calendar/${detailEventId}`
      : `/api/calendar/${detailEventId}?date=${detailEventDate}&mode=${scope}`;
    await api('DELETE', url);
    detailModal.hidden = true;
    loadCalendar();
  } catch (err) { showError('Delete failed: ' + err.message); }
}

document.getElementById('detail-delete').addEventListener('click', () => {
  if (!detailEventId) return;
  const ev = detailEventFull;
  const isRecurring = ev && ev.recurrence && ev.recurrence !== 'none';
  if (!isRecurring) return deleteCalendarEvent('all');

  openRecurScopeModal('Delete which events?', [
    { label: 'This Occurrence Only',      danger: true, action: () => deleteCalendarEvent('single') },
    { label: 'This and Following Events', danger: true, action: () => deleteCalendarEvent('future') },
    { label: 'All Previous Events',       danger: true, action: () => deleteCalendarEvent('past') },
    { label: 'All Events in the Series',  danger: true, action: () => deleteCalendarEvent('all') },
  ]);
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
  if (!getTodoEnabled()) return; // hidden — skip the poll entirely
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
  if (!getBulletinEnabled()) return; // hidden — skip the poll entirely
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
const quietReload = sessionStorage.getItem('quietReload') === '1';
sessionStorage.removeItem('quietReload');
if (getBootSoundEnabled() && !quietReload) {
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
