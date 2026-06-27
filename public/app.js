/* ═══════════════════════════════════════════════════════════
   Family Dashboard — app.js
   ═══════════════════════════════════════════════════════════ */

/* ── Constants ────────────────────────────────────────────── */
const CAL_START = 6;          // first hour shown (6 AM)
const CAL_END   = 23;         // last hour shown (11 PM, exclusive)
const HOUR_PX   = 64;         // pixels per hour in the time grid
const REFRESH_MS = 15000;     // live-poll interval for data

// Zip 78414 (South Corpus Christi, TX)
const WX_LAT = 27.6969;
const WX_LON = -97.3772;

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

const WX_CODES = {
  0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
  45:'Fog',48:'Icy fog',
  51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
  61:'Light rain',63:'Rain',65:'Heavy rain',
  71:'Light snow',73:'Snow',75:'Heavy snow',
  80:'Light showers',81:'Showers',82:'Heavy showers',
  95:'Thunderstorm',96:'Thunderstorm w/ hail',99:'Thunderstorm w/ heavy hail',
};
const WX_ICONS = {
  0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',
  51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',
  71:'🌨️',73:'❄️',75:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',
  95:'⛈️',96:'⛈️',99:'⛈️',
};

/* ── State ────────────────────────────────────────────────── */
let weekOffset = 0;        // 0 = current week, ±N = N weeks offset
let calEvents  = [];       // last-fetched calendar events for current week
let detailEventId = null;  // ID of event shown in detail modal

/* ══════════════════════════════════════════════════════════
   CLOCK & DATE
   ══════════════════════════════════════════════════════════ */
function updateClock() {
  const now = new Date();
  const h   = now.getHours();
  const m   = String(now.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  document.getElementById('clock').textContent = `${h % 12 || 12}:${m} ${ampm}`;

  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  document.getElementById('date-str').textContent =
    `${DAYS[now.getDay()]}, ${MONS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}
updateClock();
setInterval(updateClock, 1000);

/* ══════════════════════════════════════════════════════════
   WEATHER
   ══════════════════════════════════════════════════════════ */
const WX_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${WX_LAT}&longitude=${WX_LON}` +
  `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code` +
  `&hourly=precipitation_probability,weather_code` +
  `&daily=temperature_2m_max,temperature_2m_min` +
  `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
  `&timezone=America%2FChicago&forecast_days=1`;

async function fetchWeather() {
  try {
    const r = await fetch(WX_URL, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();

    const code = d.current.weather_code;
    document.getElementById('wx-icon').textContent  = WX_ICONS[code] ?? '🌡️';
    document.getElementById('wx-temp').textContent  = Math.round(d.current.temperature_2m) + '°';
    document.getElementById('wx-feels').textContent = 'Feels ' + Math.round(d.current.apparent_temperature) + '°';
    document.getElementById('wx-desc').textContent  = WX_CODES[code] ?? 'Unknown';
    document.getElementById('wx-hi-lo').textContent =
      `Hi ${Math.round(d.daily.temperature_2m_max[0])}° / Lo ${Math.round(d.daily.temperature_2m_min[0])}°`;

    renderRain(d.hourly);
  } catch {
    document.getElementById('wx-desc').textContent = 'Weather unavailable';
    document.getElementById('wx-rain').innerHTML = '';
  }
}

function renderRain(hourly) {
  const container = document.getElementById('wx-rain');
  const now = new Date();
  const nowH = now.getHours();

  // Today's date prefix for filtering
  const todayPfx = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // Build hour-by-hour data for display window 6am–10pm
  const DISPLAY_START = 6;
  const DISPLAY_END   = 22; // exclusive
  const hours = [];

  hourly.time.forEach((t, i) => {
    if (!t.startsWith(todayPfx)) return;
    const h = parseInt(t.split('T')[1]);
    if (h < DISPLAY_START || h >= DISPLAY_END) return;
    hours.push({ hour: h, prob: hourly.precipitation_probability[i] });
  });

  if (!hours.length) {
    container.innerHTML = '<span class="rain-loading">No rain data</span>';
    return;
  }

  // Find rain windows (consecutive hours ≥ 30%)
  const windows = findRainWindows(hours, 30);

  // Build headline
  let headline;
  if (!windows.length) {
    const maxProb = Math.max(...hours.map(h => h.prob));
    headline = maxProb >= 10
      ? `☁️ Slight chance (${maxProb}%)`
      : `☀️ No rain today`;
  } else {
    headline = '🌧 Rain: ' + windows
      .map(w => `${fmt12h(w.start)}–${fmt12h(w.end)} (${w.peak}%)`)
      .join(' · ');
  }

  // Build bars HTML
  const bars = hours.map(h => {
    const heightPx = Math.max(2, Math.round(h.prob * 0.32));
    const isCurrent = h.hour === nowH;
    return `<div class="rain-bar${isCurrent ? ' rain-now' : ''}"
               style="height:${heightPx}px;opacity:${0.4 + h.prob * 0.006}"
               title="${fmt12h(h.hour)}: ${h.prob}%"></div>`;
  }).join('');

  // X-axis labels: 6a 9a 12p 3p 6p 9p
  const xLabels = ['6a','','','9a','','','12p','','','3p','','','6p','','','9p'].slice(0, hours.length);
  const labelsHtml = `<div class="rain-x-labels">${xLabels.map(l=>`<span>${l}</span>`).join('')}</div>`;

  container.innerHTML = `
    <span class="rain-headline">${headline}</span>
    <div class="rain-chart">
      <div class="rain-bars">${bars}</div>
      ${labelsHtml}
    </div>
  `;
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
   CALENDAR
   ══════════════════════════════════════════════════════════ */

// Week helpers — week starts on Sunday
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

// Load and render the current week
async function loadCalendar() {
  const weekStart = getWeekStart(weekOffset);
  const weekEnd   = addDays(weekStart, 6);
  const start = toYMD(weekStart);
  const end   = toYMD(weekEnd);

  // Update nav label
  const MONS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sameMonth  = weekStart.getMonth() === weekEnd.getMonth();
  const lbl = sameMonth
    ? `${MONS_SHORT[weekStart.getMonth()]} ${weekStart.getDate()}–${weekEnd.getDate()}, ${weekStart.getFullYear()}`
    : `${MONS_SHORT[weekStart.getMonth()]} ${weekStart.getDate()} – ${MONS_SHORT[weekEnd.getMonth()]} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
  document.getElementById('cal-week-label').textContent = lbl;

  try {
    calEvents = await api('GET', `/api/calendar?start=${start}&end=${end}`);
  } catch {
    calEvents = [];
  }

  renderCalGrid(weekStart, calEvents);
  scrollToNow();
}

function renderCalGrid(weekStart, events) {
  const today = todayYMD();
  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build day date array
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // ── Header ─────────────────────────────────────────────
  const hdr = document.getElementById('cal-header');
  hdr.innerHTML = '<div class="cal-gutter-hdr"></div>';
  days.forEach(d => {
    const ymd = toYMD(d);
    const isToday = ymd === today;
    const cell = document.createElement('div');
    cell.className = 'cal-day-hdr' + (isToday ? ' is-today' : '');
    cell.innerHTML = `<div class="hdr-name">${DAYS[d.getDay()]}</div>
                      <div class="hdr-num">${d.getDate()}</div>`;
    hdr.appendChild(cell);
  });

  // ── All-day strip ───────────────────────────────────────
  const strip = document.getElementById('cal-allday-strip');
  strip.innerHTML = '<div class="cal-gutter-allday"><span>all‑day</span></div>';
  days.forEach(d => {
    const ymd = toYMD(d);
    const col = document.createElement('div');
    col.className = 'cal-allday-col';
    col.dataset.date = ymd;

    const allDayEvs = events.filter(ev =>
      ev.display_date === ymd && (ev.all_day || !ev.start_time)
    );
    allDayEvs.forEach(ev => {
      const chip = document.createElement('div');
      chip.className = 'allday-chip';
      chip.style.background = ev.color;
      chip.textContent = ev.title;
      chip.addEventListener('click', () => showEventDetail(ev));
      col.appendChild(chip);
    });

    strip.appendChild(col);
  });

  // ── Time gutter ─────────────────────────────────────────
  const gutter = document.getElementById('cal-time-gutter');
  gutter.innerHTML = '';
  for (let h = CAL_START; h < CAL_END; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'cal-hour-label';
    lbl.textContent = h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;
    gutter.appendChild(lbl);
  }

  // ── Day columns ─────────────────────────────────────────
  const daysContainer = document.getElementById('cal-days');
  daysContainer.innerHTML = '';

  days.forEach(d => {
    const ymd = toYMD(d);
    const col = document.createElement('div');
    col.className = 'cal-day-col' + (ymd === today ? ' is-today' : '');
    col.dataset.date = ymd;

    // Hour rows (grid lines)
    for (let h = CAL_START; h < CAL_END; h++) {
      const row = document.createElement('div');
      row.className = 'cal-hour-row';
      col.appendChild(row);
    }

    // Timed events for this day
    const timedEvs = events.filter(ev =>
      ev.display_date === ymd && !ev.all_day && ev.start_time
    );
    const laid = layoutEvents(timedEvs);
    laid.forEach(ev => placeEventBlock(col, ev));

    daysContainer.appendChild(col);
  });

  // Current time line
  updateNowLine();
}

// ── Event block placement ─────────────────────────────────
function placeEventBlock(col, ev) {
  const startMins = timeToMins(ev.start_time);
  const endMins   = timeToMins(ev.end_time || addOneHour(ev.start_time));
  const gridStart = CAL_START * 60;

  if (endMins <= gridStart || startMins >= CAL_END * 60) return;

  const topPx    = Math.max(0, (startMins - gridStart) / 60 * HOUR_PX);
  const heightPx = Math.max(20, (Math.min(endMins, CAL_END * 60) - Math.max(startMins, gridStart)) / 60 * HOUR_PX);

  const el = document.createElement('div');
  el.className = 'cal-event';
  el.style.cssText = `
    top:    ${topPx}px;
    height: ${heightPx}px;
    left:   calc(${ev._left}% + 2px);
    width:  calc(${ev._width}% - 4px);
    background: ${ev.color};
  `;

  const showTime   = heightPx >= 36;
  const showPerson = heightPx >= 50 && ev.person;
  el.innerHTML =
    `<div class="ev-title">${escHtml(ev.title)}</div>` +
    (showTime   ? `<div class="ev-time">${fmt12h(ev.start_time)} – ${fmt12h(ev.end_time || addOneHour(ev.start_time))}</div>` : '') +
    (showPerson ? `<div class="ev-person">${escHtml(ev.person)}</div>` : '');

  el.addEventListener('click', () => showEventDetail(ev));
  col.appendChild(el);
}

// Greedy column-layout for overlapping events
function layoutEvents(events) {
  if (!events.length) return [];
  const sorted = [...events].sort((a, b) =>
    (a.start_time || '00:00') < (b.start_time || '00:00') ? -1 : 1
  );

  // Assign each event to a column (slot)
  const slots = []; // slots[i] = end time of last event placed in column i
  const evCols = sorted.map(ev => {
    const s = ev.start_time || '00:00';
    const e = ev.end_time   || addOneHour(s);
    let col = 0;
    while (col < slots.length && slots[col] > s) col++;
    slots[col] = e;
    return { ev, col };
  });

  // Determine how many columns each event's time span needs
  return evCols.map(({ ev, col }) => {
    const s = ev.start_time || '00:00';
    const e = ev.end_time   || addOneHour(s);
    const concurrent = evCols.filter(({ ev: ev2 }) => {
      const s2 = ev2.start_time || '00:00';
      const e2 = ev2.end_time   || addOneHour(s2);
      return s2 < e && e2 > s;
    });
    const numCols = Math.max(...concurrent.map(c => c.col)) + 1;
    return {
      ...ev,
      _left:  (col / numCols) * 100,
      _width: (1   / numCols) * 100,
    };
  });
}

// ── Current time indicator ────────────────────────────────
function updateNowLine() {
  document.querySelectorAll('.cal-now-line').forEach(el => el.remove());

  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  if (h < CAL_START || h >= CAL_END) return;

  const col = document.querySelector(`.cal-day-col[data-date="${todayYMD()}"]`);
  if (!col) return;

  const topPx = ((h - CAL_START) + m / 60) * HOUR_PX;
  const line  = document.createElement('div');
  line.className = 'cal-now-line';
  line.style.top = topPx + 'px';
  col.appendChild(line);
}

function scrollToNow() {
  const scroll = document.getElementById('cal-body-scroll');
  const now    = new Date();
  const h = now.getHours();
  const target = Math.max(0, ((h - CAL_START - 1) * HOUR_PX));
  scroll.scrollTop = target;
}

// Refresh now-line every minute
setInterval(updateNowLine, 60000);
setInterval(loadCalendar, REFRESH_MS);

// ── Calendar navigation ───────────────────────────────────
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

// Build color swatches
const swatchContainer = document.getElementById('color-swatches');
let selectedColor = COLORS[0].hex;
COLORS.forEach(c => {
  const s = document.createElement('div');
  s.className = 'color-swatch' + (c.hex === selectedColor ? ' selected' : '');
  s.style.background = c.hex;
  s.title = c.name;
  s.addEventListener('click', () => {
    swatchContainer.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
    s.classList.add('selected');
    selectedColor = c.hex;
    document.getElementById('ev-color').value = c.hex;
  });
  swatchContainer.appendChild(s);
});

// Show/hide recurrence until row
recurSel.addEventListener('change', () => {
  untilRow.style.display = recurSel.value === 'none' ? 'none' : 'flex';
});

// Show/hide time fields
allDayCbx.addEventListener('change', () => {
  timeFields.style.display = allDayCbx.checked ? 'none' : 'flex';
});

document.getElementById('cal-add-btn').addEventListener('click', () => {
  document.getElementById('ev-date').value = toYMD(new Date());
  addModal.hidden = false;
  document.getElementById('ev-title').focus();
});

document.getElementById('add-modal-cancel').addEventListener('click', () => {
  addModal.hidden = true;
  addForm.reset();
  untilRow.style.display = 'none';
  timeFields.style.display = 'flex';
});

addModal.addEventListener('click', e => { if (e.target === addModal) document.getElementById('add-modal-cancel').click(); });

addForm.addEventListener('submit', async e => {
  e.preventDefault();
  const person   = document.getElementById('ev-person').value.trim();
  const allDay   = allDayCbx.checked;
  const start    = document.getElementById('ev-start').value;
  const end      = document.getElementById('ev-end').value;
  const recur    = recurSel.value;
  const until    = document.getElementById('ev-until').value;

  await api('POST', '/api/calendar', {
    title:            document.getElementById('ev-title').value.trim(),
    person,
    color:            selectedColor,
    event_date:       document.getElementById('ev-date').value,
    start_time:       allDay ? null : (start || null),
    end_time:         allDay ? null : (end   || null),
    all_day:          allDay,
    recurrence:       recur,
    recurrence_until: recur !== 'none' ? (until || null) : null,
  });

  addModal.hidden = true;
  addForm.reset();
  untilRow.style.display = 'none';
  timeFields.style.display = 'flex';
  loadCalendar();
});

/* ══════════════════════════════════════════════════════════
   EVENT DETAIL MODAL
   ══════════════════════════════════════════════════════════ */
const detailModal = document.getElementById('detail-modal');

function showEventDetail(ev) {
  detailEventId = ev.id;
  document.getElementById('detail-color-bar').style.background = ev.color;
  document.getElementById('detail-title').textContent = ev.title;

  const DAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const [y, m, d] = ev.display_date.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dateFmt = `${DAYS_LONG[dateObj.getDay()]}, ${dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

  let info = `<strong>Date:</strong> ${dateFmt}<br>`;

  if (ev.start_time) {
    const endStr = ev.end_time ? ` – ${fmt12h(ev.end_time)}` : '';
    info += `<strong>Time:</strong> ${fmt12h(ev.start_time)}${endStr}<br>`;
  } else {
    info += `<strong>Time:</strong> All day<br>`;
  }

  if (ev.person) info += `<strong>Person:</strong> ${escHtml(ev.person)}<br>`;

  const recurLabels = { none:'', daily:'Repeats every day', weekly:'Repeats every week',
                        monthly:'Repeats every month', yearly:'Repeats every year' };
  if (ev.recurrence && ev.recurrence !== 'none') {
    info += `<strong>Recurrence:</strong> ${recurLabels[ev.recurrence] || ev.recurrence}<br>`;
    const deleteLabel = 'Delete All Occurrences';
    document.getElementById('detail-delete').textContent = deleteLabel;
  } else {
    document.getElementById('detail-delete').textContent = 'Delete Event';
  }

  document.getElementById('detail-body').innerHTML = info;
  detailModal.hidden = false;
}

document.getElementById('detail-close').addEventListener('click', () => {
  detailModal.hidden = true;
});

detailModal.addEventListener('click', e => {
  if (e.target === detailModal) detailModal.hidden = true;
});

document.getElementById('detail-delete').addEventListener('click', async () => {
  if (!detailEventId) return;
  await api('DELETE', `/api/calendar/${detailEventId}`);
  detailModal.hidden = true;
  loadCalendar();
});

/* ══════════════════════════════════════════════════════════
   TODO LIST
   ══════════════════════════════════════════════════════════ */
const todoList    = document.getElementById('todo-list');
const clearDoneBtn = document.getElementById('clear-done');

function renderTodo(items) {
  todoList.innerHTML = '';
  clearDoneBtn.style.display = items.some(i => i.done) ? 'block' : 'none';

  if (!items.length) {
    todoList.innerHTML = '<li class="empty">Nothing on the list</li>';
    return;
  }

  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'todo-item' + (item.done ? ' done' : '');
    li.innerHTML = `
      <label>
        <input type="checkbox" ${item.done ? 'checked' : ''} />
        <span>${escHtml(item.text)}</span>
      </label>
      <button class="btn-delete" title="Delete">✕</button>
    `;
    li.querySelector('input').addEventListener('change', async e => {
      await api('PATCH', `/api/todo/${item.id}`, { done: e.target.checked });
      loadTodo();
    });
    li.querySelector('.btn-delete').addEventListener('click', async () => {
      await api('DELETE', `/api/todo/${item.id}`);
      loadTodo();
    });
    todoList.appendChild(li);
  });
}

async function loadTodo() {
  renderTodo(await api('GET', '/api/todo'));
}

document.getElementById('todo-form').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('todo-input');
  const text  = input.value.trim();
  if (!text) return;
  await api('POST', '/api/todo', { text });
  input.value = '';
  loadTodo();
});

clearDoneBtn.addEventListener('click', async () => {
  await api('DELETE', '/api/todo/done/all');
  loadTodo();
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
      <div class="bul-footer">
        <button class="btn-delete">✕</button>
      </div>
    `;
    li.querySelector('.btn-delete').addEventListener('click', async () => {
      await api('DELETE', `/api/bulletin/${post.id}`);
      loadBulletin();
    });
    bulletinList.appendChild(li);
  });
}

async function loadBulletin() {
  renderBulletin(await api('GET', '/api/bulletin'));
}

document.getElementById('bulletin-form').addEventListener('submit', async e => {
  e.preventDefault();
  const author  = document.getElementById('bulletin-author').value.trim() || 'Anonymous';
  const message = document.getElementById('bulletin-msg').value.trim();
  if (!message) return;
  await api('POST', '/api/bulletin', { author, message });
  document.getElementById('bulletin-msg').value = '';
  loadBulletin();
});

loadBulletin();
setInterval(loadBulletin, REFRESH_MS);

/* ══════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════ */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
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

// "14:30" → "2:30 PM"  |  "6" (hour number) → "6 AM"
function fmt12h(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return val === 12 ? '12 PM' : val < 12 ? `${val} AM` : `${val - 12} PM`;
  }
  const [h, m] = String(val).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// "HH:MM" → total minutes since midnight
function timeToMins(str) {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + (m || 0);
}

function addOneHour(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  return `${String(Math.min(h + 1, 23)).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

/* ── Service worker ───────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* ── Initial load ─────────────────────────────────────────── */
loadCalendar();
