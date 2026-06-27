/* ── Clock & date ─────────────────────────────────────────── */
function updateClock() {
  const now = new Date();
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  document.getElementById('clock').textContent = `${h12}:${m} ${ampm}`;

  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  document.getElementById('date').textContent =
    `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}
updateClock();
setInterval(updateClock, 1000);

/* ── Weather (Open-Meteo, no API key needed) ──────────────── */
const WX_URL = 'https://api.open-meteo.com/v1/forecast' +
  '?latitude=27.8006&longitude=-97.3964' +
  '&current=temperature_2m,relative_humidity_2m,weather_code' +
  '&daily=temperature_2m_max,temperature_2m_min' +
  '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago&forecast_days=1';

const WX_CODES = {
  0:'Clear sky', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
  45:'Fog', 48:'Icy fog',
  51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle',
  61:'Light rain', 63:'Rain', 65:'Heavy rain',
  71:'Light snow', 73:'Snow', 75:'Heavy snow',
  80:'Light showers', 81:'Showers', 82:'Heavy showers',
  95:'Thunderstorm', 96:'Thunderstorm w/ hail', 99:'Thunderstorm w/ heavy hail'
};

const WX_ICONS = {
  0:'☀️', 1:'🌤️', 2:'⛅', 3:'☁️',
  45:'🌫️', 48:'🌫️',
  51:'🌦️', 53:'🌦️', 55:'🌧️',
  61:'🌧️', 63:'🌧️', 65:'🌧️',
  71:'🌨️', 73:'❄️', 75:'❄️',
  80:'🌦️', 81:'🌧️', 82:'⛈️',
  95:'⛈️', 96:'⛈️', 99:'⛈️'
};

async function fetchWeather() {
  try {
    const r = await fetch(WX_URL, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const code = d.current.weather_code;
    document.getElementById('wx-icon').textContent = WX_ICONS[code] || '🌡️';
    document.getElementById('wx-temp').textContent = Math.round(d.current.temperature_2m) + '°F';
    document.getElementById('wx-desc').textContent = WX_CODES[code] || 'Unknown';
    document.getElementById('wx-hi-lo').textContent =
      `Hi ${Math.round(d.daily.temperature_2m_max[0])}° / Lo ${Math.round(d.daily.temperature_2m_min[0])}°`;
    document.getElementById('wx-humidity').textContent =
      `Humidity ${d.current.relative_humidity_2m}%`;
  } catch {
    document.getElementById('wx-desc').textContent = 'Weather unavailable';
  }
}
fetchWeather();
setInterval(fetchWeather, 10 * 60 * 1000); // refresh every 10 min

/* ── Helpers ──────────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function timeAgo(unixSec) {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatEventDate(dateStr) {
  // dateStr is YYYY-MM-DD
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = date.getTime() === today.getTime();
  const isPast = date < today;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return {
    label: isToday ? 'TODAY' : `${days[date.getDay()]}\n${months[m-1]} ${d}`,
    cls: isToday ? 'today' : (isPast ? 'past' : '')
  };
}

function fmt12(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`;
}

/* ── Grocery list ─────────────────────────────────────────── */
const groceryList = document.getElementById('grocery-list');
const clearCheckedBtn = document.getElementById('clear-checked');

function renderGrocery(items) {
  groceryList.innerHTML = '';
  const hasChecked = items.some(i => i.checked);
  clearCheckedBtn.style.display = hasChecked ? 'block' : 'none';

  if (!items.length) {
    groceryList.innerHTML = '<li class="empty">No items yet</li>';
    return;
  }

  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'grocery-item' + (item.checked ? ' checked' : '');
    li.dataset.id = item.id;
    li.innerHTML = `
      <label>
        <input type="checkbox" ${item.checked ? 'checked' : ''} />
        <span class="item-name">${escHtml(item.name)}</span>
      </label>
      <button class="btn btn-delete" title="Delete">✕</button>
    `;
    li.querySelector('input[type="checkbox"]').addEventListener('change', async e => {
      await api('PATCH', `/api/grocery/${item.id}`, { checked: e.target.checked });
      loadGrocery();
    });
    li.querySelector('.btn-delete').addEventListener('click', async () => {
      await api('DELETE', `/api/grocery/${item.id}`);
      loadGrocery();
    });
    groceryList.appendChild(li);
  });
}

async function loadGrocery() {
  const items = await api('GET', '/api/grocery');
  renderGrocery(items);
}

document.getElementById('grocery-form').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('grocery-input');
  const name = input.value.trim();
  if (!name) return;
  await api('POST', '/api/grocery', { name });
  input.value = '';
  loadGrocery();
});

clearCheckedBtn.addEventListener('click', async () => {
  await api('DELETE', '/api/grocery/checked/all');
  loadGrocery();
});

loadGrocery();
setInterval(loadGrocery, 15000);

/* ── Bulletin board ───────────────────────────────────────── */
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
      <div class="bulletin-header">
        <span class="bulletin-author">${escHtml(post.author)}</span>
        <span class="bulletin-time">${timeAgo(post.created_at)}</span>
      </div>
      <div class="bulletin-msg">${escHtml(post.message)}</div>
      <div class="bulletin-footer">
        <button class="btn btn-delete" title="Delete">✕ Delete</button>
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
  const posts = await api('GET', '/api/bulletin');
  renderBulletin(posts);
}

document.getElementById('bulletin-form').addEventListener('submit', async e => {
  e.preventDefault();
  const author = document.getElementById('bulletin-author').value.trim() || 'Anonymous';
  const message = document.getElementById('bulletin-msg').value.trim();
  if (!message) return;
  await api('POST', '/api/bulletin', { author, message });
  document.getElementById('bulletin-msg').value = '';
  loadBulletin();
});

loadBulletin();
setInterval(loadBulletin, 15000);

/* ── Events ───────────────────────────────────────────────── */
const eventsList = document.getElementById('events-list');

// Default date input to today
document.getElementById('event-date').valueAsDate = new Date();

function renderEvents(events) {
  eventsList.innerHTML = '';
  if (!events.length) {
    eventsList.innerHTML = '<li class="empty">No upcoming events</li>';
    return;
  }
  events.forEach(ev => {
    const { label, cls } = formatEventDate(ev.event_date);
    const li = document.createElement('li');
    li.className = 'event-item';
    li.innerHTML = `
      <div class="event-date-badge ${cls}">${label.replace('\n','<br>')}</div>
      <div class="event-info">
        <span class="event-title">${escHtml(ev.title)}</span>
        ${ev.event_time ? `<span class="event-time-str">${fmt12(ev.event_time)}</span>` : ''}
      </div>
      <button class="btn btn-delete" title="Delete">✕</button>
    `;
    li.querySelector('.btn-delete').addEventListener('click', async () => {
      await api('DELETE', `/api/events/${ev.id}`);
      loadEvents();
    });
    eventsList.appendChild(li);
  });
}

async function loadEvents() {
  const events = await api('GET', '/api/events');
  renderEvents(events);
}

document.getElementById('events-form').addEventListener('submit', async e => {
  e.preventDefault();
  const title = document.getElementById('event-title').value.trim();
  const event_date = document.getElementById('event-date').value;
  const event_time = document.getElementById('event-time').value;
  if (!title || !event_date) return;
  await api('POST', '/api/events', { title, event_date, event_time: event_time || null });
  document.getElementById('event-title').value = '';
  document.getElementById('event-time').value = '';
  loadEvents();
});

loadEvents();
setInterval(loadEvents, 30000);

/* ── XSS guard ────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── Service worker registration ──────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
