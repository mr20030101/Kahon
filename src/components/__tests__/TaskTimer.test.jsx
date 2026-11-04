// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const db = vi.hoisted(() => ({ entries: [], inserts: [] }));
vi.mock('../../lib/supabase', () => {
  const chain = (table) => {
    const q = {};
    const proxy = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok) => Promise.resolve(q.insert ? (db.inserts.push(q.insert), { error: null }) : { data: db.entries, error: null }).then(ok);
        }
        return (...args) => {
          if (prop === 'insert') q.insert = { table, row: args[0] };
          return proxy;
        };
      },
    });
    return proxy;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: chain, channel: () => channel, removeChannel: () => {} } };
});
const timer = vi.hoisted(() => ({ running: null, start: vi.fn(), stop: vi.fn() }));
vi.mock('../../context/TimerContext', () => ({ useTimer: () => timer, useNow: () => new Date('2026-11-04T10:00:00Z').getTime() }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => vi.fn() }));
vi.mock('../../lib/dialog', () => ({ confirmDialog: async () => true }));

const { default: TaskTimer } = await import('../TaskTimer');

const ME = 'me';
const task = { id: 'task-1', title: 'Write docs', project_id: 'p1' };
const members = [{ user_id: ME, profile: { full_name: 'Me Myself' } }, { user_id: 'them', profile: { full_name: 'Des Allen' } }];
const show = (props = {}) => render(<TaskTimer task={task} members={members} userId={ME} editable isOwner={false} {...props} />);

beforeEach(() => {
  timer.running = null;
  timer.start.mockClear();
  timer.stop.mockClear();
  db.inserts = [];
  db.entries = [
    { id: 'e1', task_id: task.id, user_id: 'them', started_at: '2026-11-04T08:00:00Z', ended_at: '2026-11-04T09:30:00Z', note: 'research' },
    { id: 'e2', task_id: task.id, user_id: ME, started_at: '2026-11-03T08:00:00Z', ended_at: '2026-11-03T08:20:00Z', note: null },
  ];
});
afterEach(cleanup);

describe('TaskTimer', () => {
  it('totals everyone\'s time and starts your timer', async () => {
    show();
    expect(await screen.findByText('1h 50m logged')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Start timer'));
    expect(timer.start).toHaveBeenCalledWith(task);
  });

  it('shows your running timer, counts it in the total, and stops it', async () => {
    timer.running = { id: 'run', task_id: task.id, user_id: ME, started_at: '2026-11-04T09:45:00Z', ended_at: null, task };
    show();
    expect(await screen.findByText('2h 05m logged')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Stop timer, 15:00'));
    expect(timer.stop).toHaveBeenCalled();
  });

  it('logs time worked offline', async () => {
    show();
    fireEvent.click(await screen.findByText('1h 50m logged'));
    fireEvent.change(screen.getByLabelText('Time worked'), { target: { value: '1h 30m' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'call with client' } });
    fireEvent.click(screen.getByText('Add time'));
    await vi.waitFor(() => expect(db.inserts).toHaveLength(1));
    const { row } = db.inserts[0];
    expect(row).toMatchObject({ task_id: task.id, user_id: ME, note: 'call with client' });
    expect((new Date(row.ended_at) - new Date(row.started_at)) / 1000).toBe(5400);
  });

  it("only shows the total to people who can't edit", async () => {
    show({ editable: false });
    expect(await screen.findByText('1h 50m logged')).toBeTruthy();
    expect(screen.queryByLabelText('Start timer')).toBeNull();
  });
});
