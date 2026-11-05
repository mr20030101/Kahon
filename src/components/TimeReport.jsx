import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNow, useTimer } from '../context/TimerContext';
import { formatDuration } from '../lib/duration';
import { RANGES, entriesInRange, hours, summarize, toCsv } from '../lib/timeReport';
import { Avatar, Icon, Modal } from './ui';

// Hours rendered on a project, for its project admins: the total in the project header, and a
// report by person and by task over a date range, with a CSV of every entry.

const PAGE = 1000; // PostgREST's default row cap per request.

/** Every time entry on the project's tasks. Only fetched when `enabled` (project admins). */
export function useProjectTime(projectId, enabled) {
  const { running } = useTimer();
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const all = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error: err } = await supabase.from('time_entries')
        .select('id, task_id, user_id, started_at, ended_at, note, task:tasks!inner(project_id)')
        .eq('task.project_id', projectId)
        .order('started_at', { ascending: false })
        .range(from, from + PAGE - 1);
      if (err) {
        setError(err.message);
        return;
      }
      all.push(...data);
      if (data.length < PAGE) break;
    }
    setError(null);
    setEntries(all);
  }, [projectId, enabled]);

  useEffect(() => {
    setEntries(null);
  }, [projectId]);
  // Again when you start or stop your own timer, so the total keeps up with you.
  useEffect(() => {
    load();
  }, [load, running?.id]);

  return { entries, error, reload: load };
}

/** "12h 30m logged" next to the project's progress; opens the report. */
export function TimeSummaryButton({ entries, onClick }) {
  const running = !!entries?.some((e) => !e.ended_at);
  const now = useNow(running);
  if (!entries) return null;
  const { total } = summarize(entries, now);
  return (
    <button type="button" className="time-summary" onClick={onClick} title="Hours logged on this project">
      <Icon.stopwatch width="15" height="15" />
      {total ? `${formatDuration(total)} logged` : 'No time logged'}
    </button>
  );
}

export default function TimeReport({ project, tasks, members, entries, error, onReload, onOpenTask, onClose }) {
  const [range, setRange] = useState('month');
  const [tab, setTab] = useState('people');

  // Fresh numbers each time it opens.
  useEffect(() => {
    onReload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const inRange = useMemo(() => entriesInRange(entries || [], range), [entries, range]);
  const running = inRange.some((e) => !e.ended_at);
  const now = useNow(running);
  const report = useMemo(() => summarize(inRange, now), [inRange, now]);

  const profileOf = (id) => members.find((m) => m.user_id === id)?.profile;
  const nameOf = (id) => profileOf(id)?.full_name || profileOf(id)?.email || 'Former member';
  const titleOf = (id) => tasks.find((t) => t.id === id)?.title || 'Untitled task';
  const rangeLabel = RANGES.find((r) => r.value === range)?.label;

  const download = () => {
    const csv = toCsv(inRange, { nameOf, titleOf, now });
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'project'} time - ${rangeLabel}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const rows = tab === 'people' ? report.people : report.tasks;
  const top = rows[0]?.seconds || 1;

  return (
    <Modal title="Time report" onClose={onClose} width={620}>
      <div className="time-report">
        <div className="time-report-bar">
          <select className="input" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
            {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-small" onClick={download} disabled={!inRange.length}>
            <Icon.download width="15" height="15" /> Export CSV
          </button>
        </div>

        {error && <p className="time-report-error small">Could not load time: {error}</p>}
        {!entries && !error && <div className="skeleton" />}

        {entries && (
          <>
            <div className="time-report-total">
              <strong>{report.total ? formatDuration(report.total) : '0m'}</strong>
              <span className="muted small">
                {hours(report.total)} hours · {report.people.length} {report.people.length === 1 ? 'person' : 'people'} · {report.tasks.length} {report.tasks.length === 1 ? 'task' : 'tasks'}
                {running ? ' · includes running timers' : ''}
              </span>
            </div>

            <div className="seg" role="tablist" aria-label="Group by">
              <button role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'is-on' : ''} onClick={() => setTab('people')}>
                <Icon.users /> By person
              </button>
              <button role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'is-on' : ''} onClick={() => setTab('tasks')}>
                <Icon.list /> By task
              </button>
            </div>

            {rows.length === 0
              ? <p className="muted small">No time logged {range === 'all' ? 'on this project yet' : `${rangeLabel.toLowerCase()}`}.</p>
              : (
                <ul className="time-report-rows">
                  {rows.map((row) => (
                    <li key={row.id}>
                      {tab === 'people'
                        ? (
                          <span className="time-report-who">
                            <Avatar profile={profileOf(row.id)} size={24} />
                            <span className="truncate">{nameOf(row.id)}</span>
                          </span>
                        )
                        : (
                          <button type="button" className="time-report-who time-report-task" onClick={() => onOpenTask(row.id)} title="Open task">
                            <span className="truncate">{titleOf(row.id)}</span>
                            <span className="time-report-avatars">
                              {row.people.slice(0, 3).map((id) => <Avatar key={id} profile={profileOf(id)} size={18} />)}
                            </span>
                          </button>
                        )}
                      <span className="time-report-meter" aria-hidden="true">
                        <span style={{ width: `${(row.seconds / top) * 100}%`, background: project.color }} />
                      </span>
                      <span className="time-report-hours">
                        <strong>{formatDuration(row.seconds)}</strong>
                        <span className="hint">{hours(row.seconds)} h</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </>
        )}
      </div>
    </Modal>
  );
}
