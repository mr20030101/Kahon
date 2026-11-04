import { describe, expect, it } from 'vitest';
import { entrySeconds, formatClock, formatDuration, parseDuration } from '../duration';

describe('durations', () => {
  it('reads what people type', () => {
    expect(parseDuration('1h 30m')).toBe(5400);
    expect(parseDuration('1h30m')).toBe(5400);
    expect(parseDuration('90m')).toBe(5400);
    expect(parseDuration('1.5h')).toBe(5400);
    expect(parseDuration('1:30')).toBe(5400);
    expect(parseDuration('45')).toBe(2700);
    expect(parseDuration('2 hours 5 mins')).toBe(7500);
    for (const bad of ['', 'soon', '1h 30', '1:75', 'h']) expect(parseDuration(bad)).toBeNull();
  });

  it('shows totals and running timers', () => {
    expect(formatDuration(30)).toBe('<1m');
    expect(formatDuration(45 * 60)).toBe('45m');
    expect(formatDuration(2 * 3600 + 5 * 60 + 59)).toBe('2h 05m');
    expect(formatClock(125)).toBe('2:05');
    expect(formatClock(3723)).toBe('1:02:03');
  });

  it('counts a running entry up to now', () => {
    const now = new Date('2026-11-04T10:00:00Z').getTime();
    expect(entrySeconds({ started_at: '2026-11-04T09:30:00Z', ended_at: null }, now)).toBe(1800);
    expect(entrySeconds({ started_at: '2026-11-04T09:00:00Z', ended_at: '2026-11-04T09:15:00Z' }, now)).toBe(900);
  });
});
