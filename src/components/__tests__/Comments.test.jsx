// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

// ---- A small stand-in for Supabase: tables of rows, and a record of every write.
const db = vi.hoisted(() => ({ tables: {}, writes: [] }));

vi.mock('../../lib/supabase', () => {
  const from = (table) => {
    const q = { table, ops: [] };
    const result = () => {
      const op = (name) => q.ops.find(([n]) => n === name);
      for (const name of ['insert', 'update', 'delete']) {
        if (op(name)) {
          db.writes.push({ table, op: name, args: op(name)[1], filters: q.ops.filter(([n]) => ['eq', 'match'].includes(n)) });
          const row = name === 'insert' ? { id: `new-${db.writes.length}`, created_at: new Date().toISOString(), ...op(name)[1][0] } : null;
          return { data: row, error: null };
        }
      }
      const rows = db.tables[table] || [];
      return { data: op('single') || op('maybeSingle') ? rows[0] ?? null : rows, error: null };
    };
    const chain = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') return (ok, fail) => Promise.resolve(result()).then(ok, fail);
        return (...args) => {
          q.ops.push([prop, args]);
          return chain;
        };
      },
    });
    return chain;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from,
      rpc: vi.fn(async (name, args) => {
        db.writes.push({ table: `rpc:${name}`, op: 'rpc', args: [args] });
        return { error: null };
      }),
      channel: () => channel,
      removeChannel: () => {},
    },
  };
});

const confirm = vi.hoisted(() => ({ answer: true, asked: [] }));
vi.mock('../../lib/dialog', () => ({
  confirmDialog: async (opts) => {
    confirm.asked.push(opts);
    return confirm.answer;
  },
  isDialogOpen: () => false,
}));
vi.mock('../../lib/notify', () => ({ notify: vi.fn(), notifyTaskUpdate: vi.fn() }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => vi.fn() }));
vi.mock('../Attachments', () => ({ checkFiles: (f) => f, useFileViewer: () => ({ open: () => {}, element: null }) }));
vi.mock('../CommentFiles', () => ({
  useCommentFiles: () => ({ of: () => [], uploadingFor: () => 0, upload: vi.fn(), remove: vi.fn(), clearDeleted: vi.fn() }),
  CommentFileList: () => null,
  PendingFiles: () => null,
  useFileTarget: () => [{}, false],
  usePendingFiles: () => ({ items: [], add: () => {}, drop: () => {}, take: () => [], putBack: () => {}, done: () => {} }),
}));

const { default: Comments } = await import('../Comments');

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const task = { id: 'task-1', project_id: 'project-1' };
const members = [
  { user_id: ME, role: 'editor', profile: { id: ME, full_name: 'Me Myself' } },
  { user_id: THEM, role: 'editor', profile: { id: THEM, full_name: 'Des Allen' } },
];
const comment = (id, extra = {}) => ({
  id, task_id: task.id, body: `Body of ${id}`, author_id: THEM, author: { full_name: 'Des Allen' },
  parent_id: null, pinned_at: null, edited_at: null, created_at: `2026-11-0${id.slice(-1)}T10:00:00Z`, ...extra,
});

const show = (props = {}) => render(
  <Comments task={task} members={members} userId={ME} commentable editable isOwner={false} {...props} />,
);
const commentEl = (text) => screen.getByText(text).closest('.comment');

beforeEach(() => {
  db.writes = [];
  confirm.asked = [];
  confirm.answer = true;
  db.tables = {
    comments: [
      comment('c1'),
      comment('c2', { pinned_at: '2026-11-04T09:00:00Z' }),
      comment('c3', { parent_id: 'c1', author_id: ME, author: { full_name: 'Me Myself' } }),
    ],
    comment_reactions: [{ comment_id: 'c1', user_id: THEM, emoji: '🎉', created_at: '2026-11-04T10:00:00Z' }],
    comment_followers: [],
  };
});
afterEach(cleanup);

describe('Comments', () => {
  it('shows pinned comments first and replies under the comment they answer', async () => {
    show();
    await screen.findByText('Body of c1');
    const threads = [...document.querySelectorAll('.comments > li.thread')];
    expect(threads.map((t) => t.querySelector('.comment .comment-text').textContent)).toEqual(['Body of c2', 'Body of c1']);
    expect(within(threads[0]).getByText('Pinned')).toBeTruthy();
    expect(within(threads[1].querySelector('.replies')).getByText('Body of c3')).toBeTruthy();
  });

  it('adds a reaction, and shows who reacted', async () => {
    show();
    await screen.findByText('Body of c1');
    expect(within(commentEl('Body of c1')).getByTitle('Des Allen reacted with 🎉')).toBeTruthy();
    fireEvent.click(within(commentEl('Body of c1')).getByLabelText('React with 👍'));
    await vi.waitFor(() => expect(db.writes[0]).toMatchObject({
      table: 'comment_reactions', op: 'insert', args: [{ comment_id: 'c1', user_id: ME, emoji: '👍', task_id: task.id }],
    }));
    expect(within(commentEl('Body of c1')).getByLabelText('👍 1, including you')).toBeTruthy();
  });

  it('asks before deleting, and says the replies go too', async () => {
    db.tables.comments = [comment('c1', { author_id: ME }), comment('c3', { parent_id: 'c1' })];
    show();
    await screen.findByText('Body of c1');
    const open = () => {
      fireEvent.click(within(commentEl('Body of c1')).getAllByLabelText('More')[0]);
      fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    };
    confirm.answer = false;
    open();
    await vi.waitFor(() => expect(confirm.asked).toHaveLength(1));
    expect(confirm.asked[0].text).toMatch(/its reply/);
    expect(db.writes).toHaveLength(0);

    confirm.answer = true;
    open();
    await vi.waitFor(() => expect(db.writes).toHaveLength(1));
    expect(db.writes[0]).toMatchObject({ table: 'comments', op: 'delete' });
    expect(screen.queryByText('Body of c3')).toBeNull();
  });

  it('pins from the menu (editors only) and follows a thread', async () => {
    show();
    await screen.findByText('Body of c1');
    fireEvent.click(within(commentEl('Body of c1')).getByLabelText('More'));
    fireEvent.click(screen.getByRole('button', { name: /Pin to top/ }));
    await vi.waitFor(() => expect(db.writes[0]).toMatchObject({ table: 'rpc:pin_comment', args: [{ p_comment: 'c1', p_pinned: true }] }));

    fireEvent.click(within(commentEl('Body of c3')).getByLabelText('More'));
    fireEvent.click(screen.getByRole('button', { name: /Get notifications/ }));
    // A reply's menu follows the comment it answers.
    await vi.waitFor(() => expect(db.writes[1]).toMatchObject({ table: 'comment_followers', op: 'insert', args: [{ comment_id: 'c1', user_id: ME }] }));
  });

  it("hides pinning from people who can't edit, and everything but reading from viewers", async () => {
    show({ editable: false });
    await screen.findByText('Body of c1');
    fireEvent.click(within(commentEl('Body of c1')).getByLabelText('More'));
    expect(screen.queryByRole('button', { name: /Pin to top/ })).toBeNull();
    cleanup();

    show({ editable: false, commentable: false });
    await screen.findByText('Body of c1');
    expect(screen.queryByLabelText('React with 👍')).toBeNull();
    expect(screen.queryByText('Reply')).toBeNull();
    expect(screen.getByText(/you can read comments but not add them/)).toBeTruthy();
  });

  it('opens a reply box under the thread', async () => {
    show();
    await screen.findByText('Body of c1');
    fireEvent.click(within(commentEl('Body of c1')).getByText('Reply'));
    expect(screen.getByLabelText('Reply')).toBeTruthy();
  });
});
