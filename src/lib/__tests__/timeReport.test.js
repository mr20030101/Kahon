import { describe, expect, it } from 'vitest';
import { entriesInRange, hours, rangeBounds, summarize, toCsv } from '../timeReport';

const at = (iso, mins, extra = {}) => ({
  started_at: new Date(iso).toISOString(),
  ended_at: new Date(new Date(iso).getTime() + mins * 60000).toISOString(),
  ...extra,
});

describe('time report', () => {
  // Wednesday, Nov 5 2026.
  const today = new Date(2026, 10, 5, 15, 0);

  it('works out weeks (from Monday) and months', () => {
    expect(rangeBounds('week', today)).toEqual([new Date(2026, 10, 2), new Date(2026, 10, 9)]);
    expect(rangeBounds('last-week', today)).toEqual([new Date(2026, 9, 26), new Date(2026, 10, 2)]);
    expect(rangeBounds('month', today)).toEqual([new Date(2026, 10, 1), new Date(2026, 11, 1)]);
    expect(rangeBounds('last-month', today)).toEqual([new Date(2026, 9, 1), new Date(2026, 10, 1)]);
    expect(rangeBounds('all', today)).toEqual([null, null]);
    // A Sunday belongs to the week that started the Monday before.
    expect(rangeBounds('week', new Date(2026, 10, 8))[0]).toEqual(new Date(2026, 10, 2));
  });

  it('keeps entries that started in the range', () => {
    const entries = [at('2026-11-02T09:00', 60), at('2026-11-01T23:30', 60), at('2026-10-20T10:00', 30)];
    expect(entriesInRange(entries, 'week', today)).toHaveLength(1);
    expect(entriesInRange(entries, 'month', today)).toHaveLength(2);
    expect(entriesInRange(entries, 'last-month', today)).toHaveLength(1);
    expect(entriesInRange(entries, 'all', today)).toHaveLength(3);
  });

  it('adds up hours per person and per task, most first', () => {
    const entries = [
      at('2026-11-02T09:00', 90, { user_id: 'a', task_id: 't1' }),
      at('2026-11-03T09:00', 30, { user_id: 'b', task_id: 't1' }),
      at('2026-11-03T11:00', 180, { user_id: 'b', task_id: 't2' }),
    ];
    const r = summarize(entries);
    expect(r.total).toBe(300 * 60);
    expect(r.people.map((p) => [p.id, p.seconds / 60])).toEqual([['b', 210], ['a', 90]]);
    expect(r.tasks.map((t) => [t.id, t.seconds / 60, t.people])).toEqual([['t2', 180, ['b']], ['t1', 120, ['a', 'b']]]);
  });

  it('counts a running timer up to now', () => {
    const start = new Date('2026-11-05T14:00:00Z');
    const r = summarize([{ user_id: 'a', task_id: 't', started_at: start.toISOString(), ended_at: null }], start.getTime() + 45 * 60000);
    expect(r.total).toBe(45 * 60);
  });

  it('writes a CSV a spreadsheet can open safely', () => {
    expect(hours(5400)).toBe('1.50');
    const csv = toCsv([at('2026-11-02T09:00', 90, { user_id: 'a', task_id: 't', note: 'Fixed "login", tested' })], {
      nameOf: () => 'Ana', titleOf: () => '=HYPERLINK("x")',
    });
    const [head, row] = csv.split('\r\n');
    expect(head).toBe('Date,Person,Task,Hours,Note');
    expect(row).toBe(`2026-11-02,Ana,"'=HYPERLINK(""x"")",1.50,"Fixed ""login"", tested"`);
  });
});
