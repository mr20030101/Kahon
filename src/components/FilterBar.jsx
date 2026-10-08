import { useEffect, useRef, useState } from 'react';
import { EMPTY_FILTERS, isFiltering } from '../lib/filters';
import { PRIORITIES } from '../lib/constants';
import { Icon } from './ui';

// Search box plus a Filter menu (assignee, priority, due date, labels) above a project's views.
export default function FilterBar({ filters, onChange, members, labels, resultCount }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const set = (key, value) => onChange({ ...filters, [key]: value });
  const active = [filters.assignee !== 'any', filters.priority !== 'any', filters.due !== 'any', filters.labels.length > 0].filter(Boolean).length;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !wrapRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="filter-bar">
      <label className="search-box">
        <Icon.search />
        <input type="search" placeholder="Search tasks" value={filters.query} onChange={(e) => set('query', e.target.value)}
          aria-label="Search tasks" />
      </label>
      <div className="menu-wrap" ref={wrapRef}>
        <button type="button" className={`btn btn-ghost btn-small${active ? ' is-active' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon.filter /> Filter{active ? ` · ${active}` : ''}
        </button>
        {open && (
          <div className="menu filter-menu">
            <label className="label">Assignee
              <select className="input" value={filters.assignee} onChange={(e) => set('assignee', e.target.value)}>
                <option value="any">Anyone</option>
                <option value="me">Me</option>
                <option value="none">Unassigned</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || m.profile?.email}</option>)}
              </select>
            </label>
            <label className="label">Priority
              <select className="input" value={filters.priority} onChange={(e) => set('priority', e.target.value)}>
                <option value="any">Any</option>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                <option value="none">No priority</option>
              </select>
            </label>
            <label className="label">Due date
              <select className="input" value={filters.due} onChange={(e) => set('due', e.target.value)}>
                <option value="any">Any time</option>
                <option value="overdue">Overdue</option>
                <option value="today">Today</option>
                <option value="week">Within 7 days</option>
                <option value="none">No due date</option>
              </select>
            </label>
            {labels.length > 0 && (
              <fieldset className="label">
                <legend>Labels</legend>
                <div className="label-picks">
                  {labels.map((l) => {
                    const on = filters.labels.includes(l.id);
                    return (
                      <button key={l.id} type="button" className={`label-chip${on ? ' is-on' : ''}`} style={{ '--chip': l.color }}
                        aria-pressed={on} onClick={() => set('labels', on ? filters.labels.filter((x) => x !== l.id) : [...filters.labels, l.id])}>
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {active > 0 && <button type="button" className="link-btn" onClick={() => onChange({ ...EMPTY_FILTERS, query: filters.query })}>Clear filters</button>}
          </div>
        )}
      </div>
      {isFiltering(filters) && (
        <span className="muted small">
          {resultCount} match{resultCount === 1 ? '' : 'es'} · <button type="button" className="link-btn" onClick={() => onChange(EMPTY_FILTERS)}>Clear</button>
        </span>
      )}
    </div>
  );
}
