// The project admin's time report: which entries fall in a date range, and the hours they add up
// to per person and per task. An entry counts toward the day it started on (local time).
import { entrySeconds } from './duration';

export const RANGES = [
  { value: 'week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'all', label: 'All time' },
];

/** [from, to) as Dates for a range, weeks starting Monday; null bounds for "all". */
export function rangeBounds(range, today = new Date()) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const monday = new Date(day);
  monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  const plusDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  switch (range) {
    case 'week': return [monday, plusDays(monday, 7)];
    case 'last-week': return [plusDays(monday, -7), monday];
    case 'month': return [new Date(day.getFullYear(), day.getMonth(), 1), new Date(day.getFullYear(), day.getMonth() + 1, 1)];
    case 'last-month': return [new Date(day.getFullYear(), day.getMonth() - 1, 1), new Date(day.getFullYear(), day.getMonth(), 1)];
    default: return [null, null];
  }
}

export function entriesInRange(entries, range, today = new Date()) {
  const [from, to] = rangeBounds(range, today);
  if (!from) return entries;
  return entries.filter((e) => {
    const t = new Date(e.started_at);
    return t >= from && t < to;
  });
}

/** Total seconds, plus rows per person and per task, each sorted most time first. */
export function summarize(entries, now = Date.now()) {
  const people = new Map();
  const tasks = new Map();
  let total = 0;
  for (const e of entries) {
    const s = entrySeconds(e, now);
    total += s;
    const p = people.get(e.user_id) ?? { id: e.user_id, seconds: 0, entries: 0 };
    p.seconds += s;
    p.entries += 1;
    people.set(e.user_id, p);
    const t = tasks.get(e.task_id) ?? { id: e.task_id, seconds: 0, people: new Set() };
    t.seconds += s;
    t.people.add(e.user_id);
    tasks.set(e.task_id, t);
  }
  const bySeconds = (a, b) => b.seconds - a.seconds;
  return {
    total,
    people: [...people.values()].sort(bySeconds),
    tasks: [...tasks.values()].map((t) => ({ ...t, people: [...t.people] })).sort(bySeconds),
  };
}

/** Decimal hours for billing and spreadsheets: 5400 -> "1.50". */
export const hours = (seconds) => (Math.max(0, seconds) / 3600).toFixed(2);

const csvCell = (value) => {
  const text = String(value ?? '');
  // Quote anything with separators, and defuse cells a spreadsheet would run as a formula.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** One row per entry, for a spreadsheet. nameOf/titleOf look up people and tasks by id. */
export function toCsv(entries, { nameOf, titleOf, now = Date.now() }) {
  const rows = [['Date', 'Person', 'Task', 'Hours', 'Note']];
  const sorted = [...entries].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  for (const e of sorted) {
    const d = new Date(e.started_at);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    rows.push([date, nameOf(e.user_id), titleOf(e.task_id), hours(entrySeconds(e, now)), e.note || (e.ended_at ? '' : '(running)')]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}
