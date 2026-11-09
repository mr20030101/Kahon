import { useCallback, useEffect, useRef, useState } from 'react';
import { PRIORITIES } from '../lib/constants';
import { confirmDialog, isDialogOpen } from '../lib/dialog';
import { useToast } from '../context/ToastContext';
import { Avatar, Icon } from './ui';

const plural = (n) => `${n} task${n === 1 ? '' : 's'}`;

// Selected task ids, kept in state so they survive filtering and view changes.
// `order` is the visible tasks in on-screen order, used for Shift-click ranges.
export function useTaskSelection(order) {
  const [selected, setSelected] = useState(() => new Set());
  const anchor = useRef(null);

  const pick = useCallback((id, { range = false } = {}) => {
    setSelected((cur) => {
      const next = new Set(cur);
      const from = order.indexOf(anchor.current);
      const to = order.indexOf(id);
      if (range && from !== -1 && to !== -1) {
        const [a, b] = from < to ? [from, to] : [to, from];
        order.slice(a, b + 1).forEach((x) => next.add(x));
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    anchor.current = id;
  }, [order]);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);

  const selectAll = useCallback(() => setSelected(new Set(order)), [order]);

  // Only tasks still on screen count (not deleted, filtered out, or hidden as completed).
  const visible = new Set(order);
  const ids = [...selected].filter((id) => visible.has(id));

  return { selected, ids, pick, clear, selectAll };
}

const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function BulkBar({ ids, total, tasks, sections, members, actions, onClear, onSelectAll }) {
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const ref = useRef(null);
  const n = ids.length;
  const chosen = tasks.filter((t) => ids.includes(t.id));
  const allDone = chosen.length > 0 && chosen.every((t) => t.completed);

  const run = (patch, message) => {
    setOpen(null);
    actions.bulkUpdate(ids, patch);
    toast(message);
    if ('completed' in patch || 'section_id' in patch) onClear();
  };

  const move = (section) => {
    setOpen(null);
    actions.bulkMove(ids, section.id);
    toast(`Moved ${plural(n)} to ${section.name}`);
    onClear();
  };

  const remove = useCallback(async () => {
    setOpen(null);
    const ok = await confirmDialog({
      title: `Delete ${plural(n)}?`,
      text: "Their subtasks, comments and attachments are deleted too. This can't be undone.",
      confirmText: `Delete ${plural(n)}`,
      danger: true,
    });
    if (!ok) return;
    actions.bulkDelete(ids);
    toast(`Deleted ${plural(n)}`);
    onClear();
  }, [n, ids, actions, toast, onClear]);

  useEffect(() => {
    const onKey = (e) => {
      if (isDialogOpen() || e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.panel, .modal-backdrop')) return;
      if (e.key === 'Escape') {
        if (open) setOpen(null);
        else onClear();
      } else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        remove();
      }
    };
    const onDown = (e) => {
      if (open && !ref.current?.contains(e.target)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, onClear, remove]);

  const toggle = (name) => setOpen((cur) => (cur === name ? null : name));
  const tool = (name, label, icon, onClick) => (
    <button type="button" className={`bulk-tool${open === name ? ' is-on' : ''}`} onClick={onClick || (() => toggle(name))}
      aria-label={label} title={label} aria-expanded={onClick ? undefined : open === name}>
      {icon}
    </button>
  );

  return (
    <div ref={ref} className="bulk-bar" role="toolbar" aria-label="Selected tasks">
      <span className="bulk-count" aria-live="polite">{plural(n)} selected</span>
      <div className="bulk-tools">
        <div className="bulk-anchor">
          {tool('move', 'Move to section', <Icon.arrowsUpDown />)}
          {open === 'move' && (
            <div className="bulk-pop" role="menu">
              <p className="menu-label">Move {plural(n)} to</p>
              {sections.map((s) => (
                <button key={s.id} type="button" role="menuitem" className="menu-item" onClick={() => move(s)}>{s.name}</button>
              ))}
            </div>
          )}
        </div>
        {tool('complete', allDone ? 'Mark incomplete' : 'Mark complete', <Icon.checkCircle />, () =>
          run({ completed: !allDone }, `${allDone ? 'Reopened' : 'Completed'} ${plural(n)}`))}
        <div className="bulk-anchor">
          {tool('assign', 'Assign', <Icon.userCircle />)}
          {open === 'assign' && (
            <div className="bulk-pop" role="menu">
              <p className="menu-label">Assign {plural(n)} to</p>
              <button type="button" role="menuitem" className="menu-item" onClick={() => run({ assignee_id: null }, `Unassigned ${plural(n)}`)}>
                <Avatar size={22} /> Unassigned
              </button>
              {members.map((m) => {
                const name = m.profile?.full_name || m.profile?.email;
                return (
                  <button key={m.user_id} type="button" role="menuitem" className="menu-item"
                    onClick={() => run({ assignee_id: m.user_id }, `Assigned ${plural(n)} to ${name}`)}>
                    <Avatar profile={m.profile} size={22} /> <span className="truncate">{name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="bulk-anchor">
          {tool('due', 'Set due date', <Icon.calendar />)}
          {open === 'due' && (
            <div className="bulk-pop" role="menu">
              <p className="menu-label">Due date for {plural(n)}</p>
              {[['Today', 0], ['Tomorrow', 1], ['In a week', 7]].map(([label, days]) => (
                <button key={label} type="button" role="menuitem" className="menu-item"
                  onClick={() => run({ due_date: isoDay(days) }, `Set ${plural(n)} due ${label.toLowerCase()}`)}>{label}</button>
              ))}
              <label className="bulk-date">
                <span>Pick a date</span>
                <input type="date" className="input" onChange={(e) => e.target.value && run({ due_date: e.target.value }, `Set the due date on ${plural(n)}`)} />
              </label>
              <hr className="menu-sep" />
              <button type="button" role="menuitem" className="menu-item" onClick={() => run({ due_date: null }, `Cleared the due date on ${plural(n)}`)}>No due date</button>
            </div>
          )}
        </div>
        {tool('delete', 'Delete (Del)', <Icon.trash />, remove)}
        <div className="bulk-anchor">
          {tool('more', 'More actions', <Icon.more />)}
          {open === 'more' && (
            <div className="bulk-pop" role="menu">
              {n < total && (
                <>
                  <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(null); onSelectAll(); }}>
                    Select all {total} shown
                  </button>
                  <hr className="menu-sep" />
                </>
              )}
              <p className="menu-label">Priority</p>
              {PRIORITIES.map((p) => (
                <button key={p.value} type="button" role="menuitem" className="menu-item"
                  onClick={() => run({ priority: p.value }, `Set ${plural(n)} to ${p.label.toLowerCase()} priority`)}>{p.label}</button>
              ))}
              <button type="button" role="menuitem" className="menu-item" onClick={() => run({ priority: null }, `Cleared the priority on ${plural(n)}`)}>None</button>
            </div>
          )}
        </div>
      </div>
      <span className="bulk-divider" aria-hidden="true" />
      <button type="button" className="bulk-tool" onClick={onClear} aria-label="Clear selection (Esc)" title="Clear selection (Esc)"><Icon.x /></button>
    </div>
  );
}
