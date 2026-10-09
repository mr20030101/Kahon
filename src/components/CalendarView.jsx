import { useMemo, useState } from 'react';
import { dayDiff } from '../lib/dates';
import { LabelChips } from './LabelsModal';
import { Icon } from './ui';

// Month calendar of a project's tasks by due date. Drag a task onto another day to change it.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The six weeks shown for a month, starting on a Monday.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export default function CalendarView({ tasks, hideCompleted, actions, onOpen, labels, labelsByTask, readOnly }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [dragOver, setDragOver] = useState(null);

  const top = tasks.filter((t) => !t.parent_id && !(hideCompleted && t.completed));
  const byDay = useMemo(() => {
    const map = new Map();
    for (const t of top) {
      if (!t.due_date) continue;
      const list = map.get(t.due_date) ?? [];
      list.push(t);
      map.set(t.due_date, list);
    }
    return map;
  }, [top]);
  const undated = top.filter((t) => !t.due_date).length;
  const days = monthGrid(cursor.year, cursor.month);
  const title = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shift = (n) => setCursor(({ year, month }) => {
    const d = new Date(year, month + n, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const drop = (e, day) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/kahon-task');
    if (id) actions.updateTask(id, { due_date: day });
  };

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon.chevron style={{ transform: 'rotate(180deg)' }} /></button>
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Next month"><Icon.chevron /></button>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}>Today</button>
        {undated > 0 && <span className="muted small push-right">{undated} task{undated === 1 ? '' : 's'} without a due date</span>}
      </div>
      <div className="calendar-grid" role="grid" aria-label={title}>
        {WEEKDAYS.map((d) => <div key={d} className="calendar-weekday" role="columnheader">{d}</div>)}
        {days.map((d) => {
          const key = iso(d);
          const items = byDay.get(key) ?? [];
          const outside = d.getMonth() !== cursor.month;
          return (
            <div key={key} role="gridcell"
              className={`calendar-day${outside ? ' is-outside' : ''}${dayDiff(key) === 0 ? ' is-today' : ''}${dragOver === key ? ' is-over' : ''}`}
              onDragOver={(e) => { if (!readOnly && e.dataTransfer.types.includes('text/kahon-task')) { e.preventDefault(); setDragOver(key); } }}
              onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
              onDrop={(e) => drop(e, key)}>
              <span className="calendar-date">{d.getDate()}</span>
              {items.map((t) => (
                <button key={t.id} type="button" draggable={!readOnly} className={`calendar-task${t.completed ? ' is-done' : ''}${!t.completed && dayDiff(key) < 0 ? ' is-late' : ''}`}
                  onDragStart={(e) => e.dataTransfer.setData('text/kahon-task', t.id)} onClick={() => onOpen(t.id)} title={t.title}>
                  <span className="truncate">{t.title}</span>
                  <LabelChips ids={labelsByTask.get(t.id)} labels={labels} max={1} />
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
