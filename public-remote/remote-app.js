/* ═══════════════════════════════════════════════════════════
   Family Calendar (remote) — the calendar only, for family members away
   from home. Talks to the same /api/calendar handlers as the dashboard,
   via remote.js (which requires the shared family code).
   ═══════════════════════════════════════════════════════════ */

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

const RECUR_UNIT = {
  daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)',
  monthly_weekday: 'month(s)', yearly: 'year(s)',
};

const $ = id => document.getElementById(id);

let viewYear, viewMonth;   // month shown in the agenda
let events = [];           // expanded occurrences for that month
let current = null;        // occurrence open in the detail sheet
let editing = null;        // { ev, occurrenceDate } while the form edits an event
let selectedColor = COLORS[0].hex;

/* ── Utilities ────────────────────────────────────────────── */
class AuthError extends Error {}

async function api(method, path, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/login') throw new AuthError('Signed out');
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

const pad = n => String(n).padStart(2, '0');
const toDateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Uses the phone's own locale/12-vs-24h preference
function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function timeRange(ev) {
  if (ev.all_day || !ev.start_time) return 'All day';
  return ev.end_time ? `${fmtTime(ev.start_time)} – ${fmtTime(ev.end_time)}` : fmtTime(ev.start_time);
}

function describeRecurrence(ev) {
  const n = Math.max(1, parseInt(ev.recurrence_interval, 10) || 1);
  const every = (one, many) => (n === 1 ? one : `Every ${n} ${many}`);
  switch (ev.recurrence) {
    case 'daily':   return every('Daily', 'days');
    case 'weekly':  return every('Weekly', 'weeks');
    case 'monthly': return every('Monthly', 'months') + ' (same date)';
    case 'monthly_weekday': {
      const d = parseDate(ev.event_date);
      const nth = ['1st', '2nd', '3rd', '4th', '5th'][Math.ceil(d.getDate() / 7) - 1];
      return every('Monthly', 'months') + ` (${nth} ${d.toLocaleDateString([], { weekday: 'long' })})`;
    }
    case 'yearly':  return every('Yearly', 'years');
    default:        return '';
  }
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error-toast', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function handleError(err) {
  if (err instanceof AuthError) return showLogin('You were signed out. Enter the family code again.');
  toast(err.message, true);
}

/* ── Sheets ───────────────────────────────────────────────── */
function openSheet(id)  { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
function closeSheet(id) {
  $(id).hidden = true;
  if (document.querySelectorAll('.sheet-backdrop:not([hidden])').length === 0) document.body.style.overflow = '';
}
document.querySelectorAll('.sheet-backdrop').forEach(b =>
  b.addEventListener('click', e => { if (e.target === b) closeSheet(b.id); }));

// Bottom-sheet choice list; resolves with the chosen value, or null
function choose(title, options) {
  return new Promise(resolve => {
    $('choice-title').textContent = title;
    const list = $('choice-list');
    list.replaceChildren();
    const done = v => { closeSheet('choice-sheet'); resolve(v); };
    for (const opt of options) {
      const b = document.createElement('button');
      b.className = `btn btn-block ${opt.danger ? 'btn-danger' : ''}`;
      b.textContent = opt.label;
      b.addEventListener('click', () => done(opt.value));
      list.append(b);
    }
    $('choice-cancel').onclick = () => done(null);
    openSheet('choice-sheet');
  });
}

/* ── Sign in ──────────────────────────────────────────────── */
function showLogin(msg) {
  $('cal-view').hidden = true;
  $('login-view').hidden = false;
  document.querySelectorAll('.sheet-backdrop').forEach(b => closeSheet(b.id));
  if (msg) $('login-msg').textContent = msg;
  $('login-code').focus();
}

async function signIn(code) {
  $('login-error').textContent = '';
  $('login-btn').disabled = true;
  try {
    await api('POST', '/api/login', { code });
    $('login-code').value = '';
    showCalendar();
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    $('login-btn').disabled = false;
  }
}

$('login-form').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('login-code').value.trim();
  if (code) signIn(code);
});

$('logout-btn').addEventListener('click', async () => {
  // Empty JSON body: remote.js only accepts JSON for POSTs (CSRF guard)
  try { await api('POST', '/api/logout', {}); } catch { /* signing out anyway */ }
  showLogin('Signed out. Enter the family code to sign back in.');
});

/* ── Agenda ───────────────────────────────────────────────── */
function showCalendar() {
  $('login-view').hidden = true;
  $('cal-view').hidden = false;
  loadMonth({ toToday: true });
  offerInstall();
  attachHomeScreenPass();
}

// iPhone: put a one-time home-screen pass in the page address (and the
// app manifest), so an icon added from here opens already signed in. See
// remote.js. Not needed on Android, where the installed app shares
// Chrome's sign-in, nor inside the home-screen app itself.
async function attachHomeScreenPass() {
  if (!isIOS || isStandalone()) return;
  let pass = null;
  try { pass = sessionStorage.getItem('homeScreenPass'); } catch { /* private mode */ }
  if (!pass) {
    try { ({ pass } = await api('POST', '/api/pass', {})); } catch { return; }
    try { sessionStorage.setItem('homeScreenPass', pass); } catch { /* private mode */ }
  }
  history.replaceState(null, '', `/?pass=${pass}`);
  document.querySelector('link[rel="manifest"]').href = `/manifest.webmanifest?pass=${pass}`;
}

// toToday: in the current month, open scrolled to today — earlier days stay
// above it, a scroll up away. Refreshes after adding/editing pass nothing,
// so the list stays where the person was.
async function loadMonth({ toToday = false } = {}) {
  const first = new Date(viewYear, viewMonth, 1);
  const last  = new Date(viewYear, viewMonth + 1, 0);
  // "Nov 2026" on narrow phones, where "November 2026" gets cut off
  const month = window.matchMedia('(max-width: 400px)').matches ? 'short' : 'long';
  $('month-label').textContent = first.toLocaleDateString([], { month, year: 'numeric' });
  try {
    events = await api('GET', `/api/calendar?start=${toDateStr(first)}&end=${toDateStr(last)}`);
    renderAgenda();
    refreshPeople();
    if (toToday) $('today')?.scrollIntoView({ block: 'start' });
  } catch (err) {
    handleError(err);
  }
}

function renderAgenda() {
  const agenda = $('agenda');
  agenda.replaceChildren();

  const byDay = new Map();
  for (const ev of events) {
    if (!byDay.has(ev.display_date)) byDay.set(ev.display_date, []);
    byDay.get(ev.display_date).push(ev);
  }
  // Today always gets a row while viewing the current month, even if empty
  const todayStr = toDateStr(new Date());
  const now = new Date();
  if (now.getFullYear() === viewYear && now.getMonth() === viewMonth && !byDay.has(todayStr)) byDay.set(todayStr, []);

  const days = [...byDay.keys()].sort();
  if (!days.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing on the calendar this month.';
    agenda.append(p);
    return;
  }

  for (const day of days) {
    const date = parseDate(day);
    const section = document.createElement('section');
    section.className = `day${day === todayStr ? ' today' : ''}`;
    if (day === todayStr) section.id = 'today';

    const head = document.createElement('div');
    head.className = 'day-head';
    head.textContent = date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    if (day === todayStr) {
      const t = document.createElement('span');
      t.className = 'muted';
      t.textContent = 'Today';
      head.append(t);
    }

    const list = document.createElement('div');
    list.className = 'day-events';
    const dayEvents = byDay.get(day).sort((a, b) =>
      (b.all_day - a.all_day) || (a.start_time || '').localeCompare(b.start_time || ''));
    if (!dayEvents.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.margin = '0.25rem 0.75rem 0.5rem';
      p.textContent = 'Nothing scheduled';
      list.append(p);
    }
    for (const ev of dayEvents) list.append(eventButton(ev));

    section.append(head, list);
    agenda.append(section);
  }
}

function eventButton(ev) {
  const b = document.createElement('button');
  b.className = 'event';
  b.type = 'button';

  const bar = document.createElement('span');
  bar.className = 'event-bar';
  bar.style.background = ev.color;

  const body = document.createElement('span');
  body.className = 'event-body';
  const title = document.createElement('div');
  title.className = 'event-title';
  title.textContent = ev.title;
  const meta = document.createElement('div');
  meta.className = 'event-meta';
  meta.textContent = [
    timeRange(ev),
    ev.person,
    ev.recurrence !== 'none' ? '🔁' : '',
    ev.is_private ? '🔒' : '',
  ].filter(Boolean).join(' · ');
  body.append(title, meta);

  b.append(bar, body);
  b.addEventListener('click', () => showDetail(ev));
  return b;
}

function refreshPeople() {
  const people = [...new Set(events.map(e => e.person).filter(Boolean))].sort();
  $('people').replaceChildren(...people.map(p => Object.assign(document.createElement('option'), { value: p })));
}

$('prev-month').addEventListener('click', () => { shiftMonth(-1); });
$('next-month').addEventListener('click', () => { shiftMonth(1); });
$('today-btn').addEventListener('click', async () => {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  loadMonth({ toToday: true });
});

function shiftMonth(delta) {
  const d = new Date(viewYear, viewMonth + delta, 1);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  window.scrollTo(0, 0);
  loadMonth({ toToday: true }); // only does anything when landing back on the current month
}

/* ── Detail ───────────────────────────────────────────────── */
function showDetail(ev) {
  current = ev;
  $('detail-bar').style.background = ev.color;
  $('detail-title').textContent = ev.title;

  const rows = [
    ['When', `${parseDate(ev.display_date).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n${timeRange(ev)}`],
    ['Who', ev.person],
    ['Repeats', describeRecurrence(ev) + (ev.recurrence !== 'none' && ev.recurrence_until
      ? `, until ${parseDate(ev.recurrence_until).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` : '')],
    ['Private', ev.is_private ? 'Yes' : ''],
    ['Notes', ev.description],
  ].filter(([, v]) => v);

  $('detail-list').replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
  openSheet('detail-sheet');
}

$('detail-close').addEventListener('click', () => closeSheet('detail-sheet'));

$('detail-edit').addEventListener('click', async () => {
  const ev = current;
  let occurrenceDate = null;
  if (ev.recurrence !== 'none') {
    const scope = await choose('Edit repeating event', [
      { label: 'Just this one',  value: 'single' },
      { label: 'All events in the series', value: 'all' },
    ]);
    if (!scope) return;
    if (scope === 'single') occurrenceDate = ev.display_date;
  }
  closeSheet('detail-sheet');
  openForm(ev, occurrenceDate);
});

$('detail-delete').addEventListener('click', async () => {
  const ev = current;
  let query = '';
  if (ev.recurrence !== 'none') {
    const scope = await choose('Delete repeating event', [
      { label: 'Just this one',            value: 'single', danger: true },
      { label: 'This and all after it',    value: 'future', danger: true },
      { label: 'All events in the series', value: 'all',    danger: true },
    ]);
    if (!scope) return;
    if (scope === 'single') query = `?date=${ev.display_date}`;
    if (scope === 'future') query = `?date=${ev.display_date}&mode=future`;
  } else {
    const ok = await choose(`Delete "${ev.title}"?`, [{ label: 'Delete', value: true, danger: true }]);
    if (!ok) return;
  }
  try {
    await api('DELETE', `/api/calendar/${ev.id}${query}`);
    closeSheet('detail-sheet');
    toast('Event deleted');
    loadMonth();
  } catch (err) {
    handleError(err);
  }
});

/* ── Add / edit form ──────────────────────────────────────── */
function renderSwatches(extraColor) {
  const colors = COLORS.map(c => c.hex);
  if (extraColor && !colors.includes(extraColor)) colors.push(extraColor);
  $('f-colors').replaceChildren(...colors.map(hex => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = hex;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(hex === selectedColor));
    b.setAttribute('aria-label', COLORS.find(c => c.hex === hex)?.name || hex);
    b.addEventListener('click', () => {
      selectedColor = hex;
      $('f-colors').querySelectorAll('.swatch').forEach(s =>
        s.setAttribute('aria-checked', String(s === b)));
    });
    return b;
  }));
}

function syncFormVisibility() {
  $('f-times').hidden = $('f-allday').checked;
  const repeats = $('f-recur').value !== 'none';
  $('f-recur-extra').hidden = !repeats;
  $('f-interval-unit').textContent = RECUR_UNIT[$('f-recur').value] || '';
}
$('f-allday').addEventListener('change', syncFormVisibility);
$('f-recur').addEventListener('change', syncFormVisibility);

// ev = null for a new event. occurrenceDate set = edit just that occurrence
// (detached into its own one-off event server-side, so no repeat fields).
function openForm(ev = null, occurrenceDate = null) {
  editing = ev ? { ev, occurrenceDate } : null;
  $('form-title').textContent = ev ? 'Edit Event' : 'New Event';
  $('form-error').textContent = '';

  const today = new Date();
  const defaultDate = (today.getFullYear() === viewYear && today.getMonth() === viewMonth)
    ? toDateStr(today) : toDateStr(new Date(viewYear, viewMonth, 1));

  $('f-title').value    = ev?.title || '';
  $('f-date').value     = ev ? (occurrenceDate || ev.event_date) : defaultDate;
  $('f-allday').checked = !!ev?.all_day;
  $('f-start').value    = ev?.start_time || '';
  $('f-end').value      = ev?.end_time || '';
  $('f-person').value   = ev?.person || '';
  $('f-private').checked = !!ev?.is_private;
  $('f-desc').value     = ev?.description || '';
  $('f-recur').value    = occurrenceDate ? 'none' : (ev?.recurrence || 'none');
  $('f-interval').value = ev?.recurrence_interval || 1;
  $('f-until').value    = ev?.recurrence_until || '';
  $('f-repeat-block').hidden = !!occurrenceDate;

  const hint = $('form-hint');
  hint.hidden = !(ev && ev.recurrence !== 'none');
  hint.textContent = occurrenceDate
    ? 'Changing just this one. The rest of the series stays the same.'
    : 'Changes apply to every event in the series.';

  selectedColor = ev?.color || COLORS[0].hex;
  renderSwatches(ev?.color);
  syncFormVisibility();
  openSheet('form-sheet');
  if (!ev) $('f-title').focus();
}

$('add-btn').addEventListener('click', () => openForm());
$('form-cancel').addEventListener('click', () => closeSheet('form-sheet'));

$('event-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('form-error');
  err.textContent = '';

  const title = $('f-title').value.trim();
  const date  = $('f-date').value;
  const allDay = $('f-allday').checked;
  const start = allDay ? null : ($('f-start').value || null);
  const end   = allDay ? null : ($('f-end').value || null);
  const recur = $('f-recur').value;
  const repeats = recur !== 'none' && !editing?.occurrenceDate;
  const until = repeats ? ($('f-until').value || null) : null;

  if (!title) { err.textContent = 'Add a title.'; return $('f-title').focus(); }
  if (!date)  { err.textContent = 'Pick a date.'; return $('f-date').focus(); }
  if (start && end && end < start) { err.textContent = 'End time is before the start time.'; return; }
  if (until && until < date) { err.textContent = '"Until" is before the start date.'; return; }

  const payload = {
    title,
    description: $('f-desc').value.trim(),
    person:      $('f-person').value.trim(),
    color:       selectedColor,
    event_date:  date,
    start_time:  start,
    end_time:    end,
    all_day:     allDay,
    is_private:  $('f-private').checked,
    recurrence:  repeats ? recur : 'none',
    recurrence_interval: repeats ? (parseInt($('f-interval').value, 10) || 1) : 1,
    recurrence_until:    until,
  };

  const save = $('form-save');
  save.disabled = true;
  save.textContent = 'Saving…';
  try {
    if (editing) {
      const q = editing.occurrenceDate ? `?date=${editing.occurrenceDate}&mode=single` : '';
      await api('PATCH', `/api/calendar/${editing.ev.id}${q}`, payload);
    } else {
      await api('POST', '/api/calendar', payload);
    }
    closeSheet('form-sheet');
    toast(editing ? 'Changes saved' : 'Event added');
    // Jump to the event's month so the person sees what they just saved
    const d = parseDate(date);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    loadMonth();
  } catch (e2) {
    if (e2 instanceof AuthError) return handleError(e2);
    err.textContent = e2.message;
  } finally {
    save.disabled = false;
    save.textContent = 'Save';
  }
});

/* ── Add to Home Screen ───────────────────────────────────── */
// Offered once after signing in (the footer button brings it back), never
// when already opened from the home screen. Android Chrome can install
// straight from a button; iPhone needs the Share menu, so it gets steps.
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(navigator.userAgent);
let installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); // shown from our own sheet instead
  installPrompt = e;
});

const ICO_SHARE = '<svg class="step-ico" viewBox="0 0 24 24"><path d="M7 10v10h10V10M12 3v12M8 7l4-4 4 4"/></svg>';
const ICO_ADD   = '<svg class="step-ico" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';
const ICO_MENU  = '<svg class="step-ico" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>';

function openInstallSheet() {
  const steps = isIOS ? [
    `Tap the Share button ${ICO_SHARE} in Safari's toolbar. On newer iPhones, tap <strong>⋯</strong> first.`,
    `Scroll down and tap <strong>Add to Home Screen</strong> ${ICO_ADD}.`,
    'Tap <strong>Add</strong>.',
  ] : [
    `Tap the menu ${ICO_MENU} at the top right of Chrome.`,
    `Tap <strong>Add to Home screen</strong> or <strong>Install app</strong> ${ICO_ADD}.`,
    'Tap <strong>Install</strong> (or <strong>Add</strong>).',
  ];
  $('install-steps').innerHTML = steps.map(s => `<li>${s}</li>`).join('');
  $('install-note').textContent = isIOS
    ? 'It opens already signed in. If it ever asks, enter the family code.'
    : '';
  $('install-go').hidden = !installPrompt;
  $('install-sheet').hidden = false;
}

function closeInstallSheet() {
  $('install-sheet').hidden = true;
  try { localStorage.setItem('installTipSeen', '1'); } catch { /* private mode */ }
}

function offerInstall() {
  if (isStandalone() || !(isIOS || isAndroid)) return;
  $('install-help-btn').hidden = false;
  let seen = false;
  try { seen = localStorage.getItem('installTipSeen') === '1'; } catch { /* private mode */ }
  if (!seen) setTimeout(openInstallSheet, 1500);
}

$('install-help-btn').addEventListener('click', openInstallSheet);
$('install-later').addEventListener('click', closeInstallSheet);
$('install-sheet').addEventListener('click', e => { if (e.target === $('install-sheet')) closeInstallSheet(); });
$('install-go').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  closeInstallSheet();
});

/* ── Start ────────────────────────────────────────────────── */
(async () => {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();

  // A sign-in link carries the code in the URL fragment (#code=…), which
  // browsers never send to the server. Strip it right away so it doesn't
  // linger in the address bar, history or a home-screen shortcut.
  const linkCode = new URLSearchParams(location.hash.slice(1)).get('code');
  if (linkCode) history.replaceState(null, '', location.pathname);

  let s;
  try { s = await api('GET', '/api/session'); }
  catch { s = { enabled: true, authed: false }; }

  if (!s.enabled) {
    showLogin('Remote access is turned off right now.');
    $('login-code').disabled = true;
    $('login-btn').disabled = true;
    return;
  }
  // First launch of an iPhone home-screen icon: trade its pass for a session
  const pass = new URLSearchParams(location.search).get('pass');
  if (pass && isStandalone()) history.replaceState(null, '', '/');
  if (!s.authed && pass && isStandalone()) {
    try {
      await api('POST', '/api/pass/redeem', { pass });
      return showCalendar();
    } catch { /* expired or used: fall through to the family code */ }
  }
  if (s.authed) return showCalendar();
  showLogin();
  if (linkCode) {
    $('login-code').value = linkCode;
    signIn(linkCode);
  }
})();
