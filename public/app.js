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

/* ── WMO weather code maps ────────────────────────────────── */
const WX_CODES = {
  0:'Clear sky', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
  45:'Fog', 48:'Icy fog',
  51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle',
  61:'Light rain', 63:'Rain', 65:'Heavy rain',
  71:'Light snow', 73:'Snow', 75:'Heavy snow',
  80:'Light showers', 81:'Showers', 82:'Heavy showers',
  95:'Thunderstorm', 96:'Thunderstorm w/ hail', 99:'Thunderstorm w/ heavy hail',
};
const WX_ICONS = {
  0:'☀️', 1:'🌤️', 2:'⛅', 3:'☁️', 45:'🌫️', 48:'🌫️',
  51:'🌦️', 53:'🌦️', 55:'🌧️', 61:'🌧️', 63:'🌧️', 65:'🌧️',
  71:'🌨️', 73:'❄️', 75:'❄️', 80:'🌦️', 81:'🌧️', 82:'⛈️',
  95:'⛈️', 96:'⛈️', 99:'⛈️',
};

/* ── App state ────────────────────────────────────────────── */
let weekOffset    = 0;
let calEvents     = [];
let detailEventId = null;
let selectedColor = COLORS[0].hex;

// Sunrise/sunset from Open-Meteo (updated each weather fetch)
let sunriseMins = null; // minutes since midnight
let sunsetMins  = null;

/* ══════════════════════════════════════════════════════════
   THEME
   ══════════════════════════════════════════════════════════ */
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
   WEATHER
   ══════════════════════════════════════════════════════════ */
function makeWxUrl(lat, lon) {
  return (
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code` +
    `&hourly=precipitation_probability,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
    `&timezone=America%2FChicago&forecast_days=1`
  );
}

async function fetchWeather() {
  const zipData = getActiveZip();
  document.getElementById('wx-neighborhood').textContent = `${zipData.name} · ${zipData.zip}`;

  try {
    const r = await fetch(makeWxUrl(zipData.lat, zipData.lon),
                          { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();

    // Parse sunrise/sunset for auto theme (times like "2026-06-26T06:18")
    if (d.daily?.sunrise?.[0] && d.daily?.sunset?.[0]) {
      const parseISO = iso => {
        const t = iso.split('T')[1]; // "06:18"
        const [hh, mm] = t.split(':').map(Number);
        return hh * 60 + mm;
      };
      sunriseMins = parseISO(d.daily.sunrise[0]);
      sunsetMins  = parseISO(d.daily.sunset[0]);
      applyTheme(); // re-evaluate now that we have real times
    }

    const code = d.current.weather_code;
    document.getElementById('wx-icon').textContent  = WX_ICONS[code]  ?? '🌡️';
    document.getElementById('wx-temp').textContent  = Math.round(d.current.temperature_2m) + '°';
    document.getElementById('wx-feels').textContent = 'Feels ' + Math.round(d.current.apparent_temperature) + '°';
    document.getElementById('wx-desc').textContent  = WX_CODES[code]  ?? 'Unknown';
    document.getElementById('wx-hi-lo').textContent =
      `Hi ${Math.round(d.daily.temperature_2m_max[0])}° / Lo ${Math.round(d.daily.temperature_2m_min[0])}°`;

    renderRain(d.hourly);
  } catch (err) {
    document.getElementById('wx-desc').textContent = 'Weather unavailable';
    document.getElementById('wx-rain').innerHTML   = '';
  }
}

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
});

document.getElementById('settings-btn').addEventListener('click', () => {
  zipSelect.value = getActiveZip().zip;
  updateZipCoords();
  applyTheme(); // refresh status text
  settingsModal.hidden = false;
});
document.getElementById('settings-close').addEventListener('click', () => { settingsModal.hidden = true; });
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.hidden = true; });

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
   CALENDAR — load (two-phase: structure first, events second)
   ══════════════════════════════════════════════════════════ */
async function loadCalendar() {
  const weekStart = getWeekStart(weekOffset);
  const weekEnd   = addDays(weekStart, 6);

  // Phase 1 — instant (no network): update label + render empty grid
  setWeekLabel(weekStart, weekEnd);
  buildCalStructure(weekStart);
  scrollToNow();

  // Phase 2 — async: fetch events and populate columns
  try {
    calEvents = await api('GET', `/api/calendar?start=${toYMD(weekStart)}&end=${toYMD(weekEnd)}`);
  } catch {
    calEvents = [];
  }
  fillCalEvents(calEvents);
}

function setWeekLabel(weekStart, weekEnd) {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sm = weekStart.getMonth() === weekEnd.getMonth();
  document.getElementById('cal-week-label').textContent = sm
    ? `${M[weekStart.getMonth()]} ${weekStart.getDate()}–${weekEnd.getDate()}, ${weekStart.getFullYear()}`
    : `${M[weekStart.getMonth()]} ${weekStart.getDate()} – ${M[weekEnd.getMonth()]} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
}

/* ── Build grid skeleton (no events) ─────────────────────── */
function buildCalStructure(weekStart) {
  const today = todayYMD();
  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const days  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
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

document.getElementById('cal-prev').addEventListener('click',  () => { weekOffset--; loadCalendar(); });
document.getElementById('cal-next').addEventListener('click',  () => { weekOffset++; loadCalendar(); });
document.getElementById('cal-today').addEventListener('click', () => { weekOffset = 0; loadCalendar(); });

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
setInterval(loadTodo, REFRESH_MS);

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
setInterval(loadBulletin, REFRESH_MS);

/* ── Service worker ───────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* ── Boot ─────────────────────────────────────────────────── */
loadCalendar();
