// Durations for time tracking: what people type into "Add time", and how time is shown.

/** Seconds from "1h 30m", "90m", "1.5h", "1:30", "45" (minutes) or "2h"; null if it isn't one. */
export function parseDuration(input = '') {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  let m = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  m = text.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Math.round(Number(m[1]) * 60);
  m = text.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60);
  return null;
}

/** "2h 05m", "45m", "<1m": for totals and log entries. */
export function formatDuration(seconds) {
  const mins = Math.floor(Math.max(0, seconds) / 60);
  if (mins < 1) return '<1m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "1:02:03" or "2:03": a running timer, to the second. */
export function formatClock(seconds) {
  const s = Math.floor(Math.max(0, seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Seconds in a time entry: up to now while it's running. */
export const entrySeconds = (e, now = Date.now()) =>
  Math.max(0, ((e.ended_at ? new Date(e.ended_at).getTime() : now) - new Date(e.started_at).getTime()) / 1000);
