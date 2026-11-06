import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useNow, useTimer } from '../context/TimerContext';
import { confirmDialog } from '../lib/dialog';
import { entrySeconds, formatClock, formatDuration, parseDuration } from '../lib/duration';
import { Popover } from './EmojiPicker';
import { Avatar, Icon } from './ui';

// The task panel's Time field: start and stop your timer, the time everyone has logged, and a
// log to add time worked offline or remove an entry. See TimerContext for the running timer.

const DAY = 24 * 3600;
const todayValue = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function TaskTimer({ task, members, userId, editable, isOwner }) {
  const toast = useToast();
  const { running, start, stop } = useTimer();
  const [entries, setEntries] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ duration: '', date: todayValue(), note: '' });
  const [saving, setSaving] = useState(false);
  const mine = running?.task_id === task.id;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase.from('time_entries').select('id, task_id, user_id, started_at, ended_at, note')
        .eq('task_id', task.id).order('started_at', { ascending: false });
      if (alive) setEntries(data || []);
    };
    load();
    const channel = supabase
      .channel(`time-${task.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries', filter: `task_id=eq.${task.id}` }, load)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'time_entries' },
        ({ old }) => setEntries((list) => list.filter((e) => e.id !== old.id)))
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
    // Your own start and stop show at once, before realtime catches up.
  }, [task.id, running?.id]);

  // Your running timer as the context knows it (it's ahead of the list right after Start).
  // Any other running entry of yours in the list is stale (stopped elsewhere, not reloaded yet).
  const others = entries.filter((e) => !(e.user_id === userId && !e.ended_at));
  const shown = mine ? [{ note: null, ...running }, ...others.filter((e) => e.id !== running.id)] : others;
  const anyRunning = shown.some((e) => !e.ended_at);
  const now = useNow(anyRunning);
  const total = shown.reduce((n, e) => n + entrySeconds(e, now), 0);
  const myElapsed = mine ? entrySeconds(running, now) : 0;

  const people = [];
  for (const e of shown) {
    const p = people.find((x) => x.id === e.user_id);
    if (p) p.seconds += entrySeconds(e, now);
    else people.push({ id: e.user_id, seconds: entrySeconds(e, now) });
  }
  const profileOf = (id) => members.find((m) => m.user_id === id)?.profile;

  const addTime = async (e) => {
    e.preventDefault();
    if (saving) return;
    const seconds = parseDuration(form.duration);
    if (!seconds) return toast('Write the time like 1h 30m, 90m or 1:30', 'error');
    if (seconds > DAY) return toast('One entry can be at most 24 hours', 'error');
    // Worked that day: ending now if it's today, else at the end of a working day.
    const end = form.date === todayValue() ? new Date() : new Date(`${form.date}T17:00:00`);
    if (Number.isNaN(end.getTime()) || end > new Date()) return toast("Pick today or a day before", 'error');
    setSaving(true);
    const { error } = await supabase.from('time_entries').insert({
      task_id: task.id, user_id: userId, note: form.note.trim() || null,
      started_at: new Date(end.getTime() - seconds * 1000).toISOString(), ended_at: end.toISOString(),
    });
    setSaving(false);
    if (error) return toast(error.message, 'error');
    setForm({ duration: '', date: todayValue(), note: '' });
    toast(`Logged ${formatDuration(seconds)}`);
  };

  const remove = async (entry) => {
    const ok = await confirmDialog({
      title: `Remove ${formatDuration(entrySeconds(entry))} of time?`,
      text: "It won't count toward this task any more. This can't be undone.",
      confirmText: 'Remove time',
      danger: true,
    });
    if (!ok) return;
    setEntries((list) => list.filter((x) => x.id !== entry.id));
    const { error } = await supabase.from('time_entries').delete().eq('id', entry.id);
    if (error) toast(error.message, 'error');
  };

  return (
    <div className="timer menu-wrap">
      {editable && (
        <button type="button" className={`timer-btn${mine ? ' is-running' : ''}`} onClick={() => (mine ? stop() : start(task))}
          aria-label={mine ? `Stop timer, ${formatClock(myElapsed)}` : 'Start timer'}>
          {mine ? <><Icon.stop width="14" height="14" /> {formatClock(myElapsed)}</> : <><Icon.play width="14" height="14" /> Start timer</>}
        </button>
      )}
      <button type="button" className="field-static timer-total" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {total ? `${formatDuration(total)} logged` : editable ? 'Log time' : 'No time logged'}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="timer-log" label="Time on this task">
          <h5>Time on this task{total ? ` · ${formatDuration(total)}` : ''}</h5>
          {people.length > 1 && (
            <p className="timer-people">
              {people.map((p) => <span key={p.id}><Avatar profile={profileOf(p.id)} size={18} /> {formatDuration(p.seconds)}</span>)}
            </p>
          )}
          {shown.length === 0 && <p className="muted small">No time logged yet.</p>}
          <ul className="timer-entries">
            {shown.slice(0, 30).map((entry) => (
              <li key={entry.id}>
                <Avatar profile={profileOf(entry.user_id)} size={22} />
                <span className="timer-entry-main">
                  <strong>{entry.ended_at ? formatDuration(entrySeconds(entry, now)) : `${formatClock(entrySeconds(entry, now))} running`}</strong>
                  <span className="hint">
                    {profileOf(entry.user_id)?.full_name || 'Someone'} · {new Date(entry.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </span>
                </span>
                {entry.ended_at && (entry.user_id === userId || isOwner) && (
                  <button type="button" className="icon-btn" onClick={() => remove(entry)} aria-label="Remove this time" title="Remove"><Icon.x /></button>
                )}
              </li>
            ))}
          </ul>
          {editable && (
            <form className="timer-add" onSubmit={addTime}>
              <input className="input" value={form.duration} placeholder="1h 30m" aria-label="Time worked" required
                onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))} />
              <input className="input" type="date" value={form.date} max={todayValue()} aria-label="Day worked"
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              <input className="input timer-note" value={form.note} maxLength={200} placeholder="What you did (optional)" aria-label="Note"
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              <button className="btn btn-primary btn-small" aria-busy={saving}>Add time</button>
            </form>
          )}
        </Popover>
      )}
    </div>
  );
}
