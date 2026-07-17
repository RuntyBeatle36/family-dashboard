// Seeds US holiday events into the calendar via the running server's API.
// Not part of the app itself — run manually, e.g.:
//   node scripts/seed-holidays.js
//   node scripts/seed-holidays.js 2037 2045        (extend past the default range)
//   DASH_URL=http://192.168.1.156:3000 node scripts/seed-holidays.js
//
// Dates are computed, not hardcoded, so nth-weekday holidays (Thanksgiving,
// Labor Day, ...) and Easter are correct for every year generated.
//
// Safe to re-run for a NEW year range. Re-running the SAME range will create
// duplicate events — if that happens, delete the extras via the calendar UI
// (they're plain one-time events like anything else, nothing special about
// them structurally) or `DELETE FROM calendar_events WHERE color = '#a855f7'
// AND event_date BETWEEN ...` directly against db/dashboard.db.

const BASE = process.env.DASH_URL || 'http://localhost:3000';
const START_YEAR = parseInt(process.argv[2], 10) || 2026;
const END_YEAR   = parseInt(process.argv[3], 10) || 2036; // inclusive
const COLOR = '#a855f7'; // Purple — pick a different one first if a family member already uses it

function nthWeekdayOfMonth(year, month, weekday, n) {
  // month: 1-12, weekday: 0=Sun..6=Sat, n: 1st/2nd/3rd/4th occurrence
  const first = new Date(year, month - 1, 1);
  const day = 1 + ((7 + weekday - first.getDay()) % 7) + (n - 1) * 7;
  return new Date(year, month - 1, day);
}

function lastWeekdayOfMonth(year, month, weekday) {
  const last = new Date(year, month, 0); // day 0 of next month = last day of this month
  const day = last.getDate() - ((7 + last.getDay() - weekday) % 7);
  return new Date(year, month - 1, day);
}

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for the date of Easter Sunday.
function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

// weekday numbers: Sun=0 Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=6
function buildHolidaysForYear(year) {
  const list = [];
  const fixed = (title, month, day) => list.push({ title, date: new Date(year, month - 1, day) });
  const nth   = (title, month, weekday, n) => list.push({ title, date: nthWeekdayOfMonth(year, month, weekday, n) });
  const last  = (title, month, weekday) => list.push({ title, date: lastWeekdayOfMonth(year, month, weekday) });

  fixed("🎉 New Year's Day", 1, 1);
  nth('Martin Luther King Jr. Day', 1, 1, 3);
  nth('Presidents Day', 2, 1, 3);
  fixed("💘 Valentine's Day", 2, 14);
  fixed("🍀 St. Patrick's Day", 3, 17);
  const easter = easterDate(year);
  list.push({ title: '🐰 Easter', date: easter });
  fixed('🎊 Cinco de Mayo', 5, 5);
  nth("💐 Mother's Day", 5, 0, 2);
  last('Memorial Day', 5, 1);
  nth("👔 Father's Day", 6, 0, 3);
  fixed('Juneteenth', 6, 19);
  fixed('🎆 Independence Day', 7, 4);
  nth('Labor Day', 9, 1, 1);
  nth('Columbus Day', 10, 1, 2);
  fixed('🎃 Halloween', 10, 31);
  fixed('Veterans Day', 11, 11);
  const thanksgiving = nthWeekdayOfMonth(year, 11, 4, 4);
  list.push({ title: '🦃 Thanksgiving', date: thanksgiving });
  list.push({ title: '🛍️ Black Friday', date: addDays(thanksgiving, 1) });
  fixed('🎄 Christmas Eve', 12, 24);
  fixed('🎄 Christmas Day', 12, 25);
  fixed("🎊 New Year's Eve", 12, 31);

  return list;
}

async function main() {
  let created = 0, failed = 0;
  for (let year = START_YEAR; year <= END_YEAR; year++) {
    for (const h of buildHolidaysForYear(year)) {
      const res = await fetch(`${BASE}/api/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: h.title,
          event_date: toYMD(h.date),
          all_day: true,
          color: COLOR,
          recurrence: 'none',
        }),
      });
      if (res.ok) created++; else { failed++; console.error('FAILED', h.title, toYMD(h.date), await res.text()); }
    }
  }
  console.log(`Created ${created} holiday events (${START_YEAR}-${END_YEAR}), ${failed} failed.`);
}

main();
