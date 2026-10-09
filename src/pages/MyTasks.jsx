import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { dayDiff } from '../lib/dates';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { notifyTaskUpdate } from '../lib/notify';
import { canEdit } from '../lib/roles';
import TaskPanel from '../components/TaskPanel';
import { Check, DueLabel, PriorityTag } from '../components/ui';

const GROUPS = [
  { key: 'overdue', label: 'Overdue', test: (d) => d !== null && d < 0 },
  { key: 'today', label: 'Today', test: (d) => d === 0 },
  { key: 'week', label: 'Next 7 days', test: (d) => d !== null && d > 0 && d <= 7 },
  { key: 'later', label: 'Later', test: (d) => d !== null && d > 7 },
  { key: 'nodate', label: 'No due date', test: (d) => d === null },
];

export default function MyTasks() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tasks, setTasks] = useState([]);
  const [roles, setRoles] = useState({}); // project id -> your role there
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const openId = params.get('task');

  // Tasks you're the main assignee of, plus those you're also assigned to.
  const load = useCallback(async () => {
    const select = '*, project:projects(id, name, color, archived_at)';
    const { data: extra } = await supabase.from('task_assignees').select('task_id').eq('user_id', user.id);
    const extraIds = (extra || []).map((r) => r.task_id);
    const [main, also, mine] = await Promise.all([
      supabase.from('tasks').select(select).eq('assignee_id', user.id),
      extraIds.length ? supabase.from('tasks').select(select).in('id', extraIds) : Promise.resolve({ data: [] }),
      supabase.from('project_members').select('project_id, role').eq('user_id', user.id),
    ]);
    setRoles(Object.fromEntries((mine.data || []).map((m) => [m.project_id, m.role])));
    const error = main.error || also.error;
    if (error) toast(error.message, 'error');
    else {
      const byId = new Map([...(main.data || []), ...(also.data || [])].map((t) => [t.id, t]));
      const list = [...byId.values()]
        .filter((t) => !t.project?.archived_at)
        .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
      setTasks(list);
    }
    setLoading(false);
  }, [user.id, toast]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`mytasks-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `assignee_id=eq.${user.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees', filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener('focus', load);
      supabase.removeChannel(channel);
    };
  }, [user.id, load]);

  const visible = tasks.filter((t) => showDone || !t.completed);
  const grouped = useMemo(
    () => GROUPS.map((g) => ({ ...g, items: visible.filter((t) => g.test(dayDiff(t.due_date))) })).filter((g) => g.items.length),
    [visible],
  );

  const patch = (id, change) => setTasks((list) => list.map((t) => (t.id === id ? { ...t, ...change } : t)));

  const toggle = async (task, completed) => {
    patch(task.id, { completed });
    const { error } = await supabase.from('tasks').update({ completed }).eq('id', task.id);
    if (error) {
      toast(error.message, 'error');
      load();
    } else {
      notifyTaskUpdate(task.id, { completed });
    }
  };

  const open = (id) => setParams({ task: id });
  const close = useCallback(() => setParams({}), [setParams]);
  const firstName = profile?.full_name?.split(' ')[0];
  const openCount = tasks.filter((t) => !t.completed).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>My tasks</h1>
          <p className="muted">
            {loading ? 'Loading…' : openCount
              ? `${firstName ? `${firstName}, you` : 'You'} have ${openCount} open task${openCount === 1 ? '' : 's'} across your projects.`
              : 'Nothing open. Tasks assigned to you in any project land here.'}
          </p>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show completed
        </label>
      </header>

      {!loading && grouped.length === 0 && (
        <div className="empty-state">
          <h3>Your box is empty</h3>
          <p className="muted">Open a project and assign a task to yourself, or ask a teammate to add you to theirs.</p>
        </div>
      )}

      {grouped.map((g) => (
        <section key={g.key} className={`my-group my-${g.key}`}>
          <h2>{g.label} <span className="count">{g.items.length}</span></h2>
          {g.items.map((t) => (
            <div key={t.id} className={`my-row${t.completed ? ' is-done' : ''}`} onClick={() => open(t.id)}>
              <Check checked={t.completed} onChange={(v) => toggle(t, v)} disabled={!canEdit(roles[t.project_id])} />
              <button className="task-title" onClick={(e) => { e.stopPropagation(); open(t.id); }}>{t.title}</button>
              <span className="spacer" />
              <PriorityTag value={t.priority} />
              <DueLabel value={t.due_date} completed={t.completed} />
              {t.project && (
                <span className="project-chip"><span className="swatch" style={{ background: t.project.color }} />{t.project.name}</span>
              )}
            </div>
          ))}
        </section>
      ))}

      {openId && <TaskPanel key={openId} taskId={openId} onClose={close} onPatch={patch}
        onRemoved={(id) => setTasks((list) => list.filter((t) => t.id !== id))} />}
    </div>
  );
}
