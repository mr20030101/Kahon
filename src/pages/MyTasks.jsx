import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { dayDiff } from '../lib/dates';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { notifyTaskUpdate } from '../lib/notify';
import { canEdit } from '../lib/roles';
import TaskPanel from '../components/TaskPanel';
import CalendarView from '../components/CalendarView';
import { Avatar, Check, DueLabel, Icon, PriorityTag } from '../components/ui';

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
  const [people, setPeople] = useState({}); // task id -> other assignees' profiles
  const [collapsed, setCollapsed] = useState(() => new Set());
  const view = params.get('view') || 'list';
  const openId = params.get('task');

  // Everyone else assigned to each task (main assignee plus extra assignees), for the Collaborators column.
  const loadPeople = useCallback(async (list) => {
    if (!list.length) return setPeople({});
    const { data: links } = await supabase.from('task_assignees').select('task_id, user_id').in('task_id', list.map((t) => t.id));
    const byTask = {};
    const add = (taskId, userId) => {
      if (!userId || userId === user.id) return;
      byTask[taskId] ??= [];
      if (!byTask[taskId].includes(userId)) byTask[taskId].push(userId);
    };
    for (const t of list) add(t.id, t.assignee_id);
    for (const l of links || []) add(l.task_id, l.user_id);
    const ids = [...new Set(Object.values(byTask).flat())];
    const { data: profiles } = ids.length
      ? await supabase.from('profiles').select('id, full_name, email, color, avatar_path').in('id', ids)
      : { data: [] };
    const byId = Object.fromEntries((profiles || []).map((pr) => [pr.id, pr]));
    setPeople(Object.fromEntries(Object.entries(byTask).map(([k, v]) => [k, v.map((id) => byId[id]).filter(Boolean)])));
  }, [user.id]);

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
      loadPeople(list);
    }
    setLoading(false);
  }, [user.id, toast, loadPeople]);

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
  const groups = useMemo(
    () => GROUPS.map((g) => ({ ...g, items: visible.filter((t) => g.test(dayDiff(t.due_date))) })),
    [visible],
  );
  const shown = groups.filter((g) => g.items.length);

  const patch = (id, change) => setTasks((list) => list.map((t) => (t.id === id ? { ...t, ...change } : t)));

  const updateTask = async (id, change) => {
    const before = tasks.find((t) => t.id === id);
    if (!before || !canEdit(roles[before.project_id])) return;
    patch(id, change);
    const { error } = await supabase.from('tasks').update(change).eq('id', id);
    if (error) {
      toast(error.message, 'error');
      load();
    } else {
      notifyTaskUpdate(id, change);
    }
  };
  const toggle = (task, completed) => updateTask(task.id, { completed });

  const setParam = (key, value) => setParams((cur) => {
    const next = new URLSearchParams(cur);
    if (value) next.set(key, value);
    else next.delete(key);
    return next;
  });
  const open = (id) => setParam('task', id);
  const close = useCallback(() => setParams((cur) => {
    const next = new URLSearchParams(cur);
    next.delete('task');
    return next;
  }), [setParams]);
  const flip = (key) => setCollapsed((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const VIEWS = [
    { key: 'list', label: 'List', icon: Icon.list },
    { key: 'board', label: 'Board', icon: Icon.board },
    { key: 'calendar', label: 'Calendar', icon: Icon.calendar },
  ];

  const projectChip = (t) => t.project && (
    <span className="project-chip"><span className="swatch" style={{ background: t.project.color }} /><span className="truncate">{t.project.name}</span></span>
  );
  const collaborators = (t) => (
    <span className="avatar-row">
      {(people[t.id] || []).slice(0, 3).map((pr) => <Avatar key={pr.id} profile={pr} size={24} />)}
      {(people[t.id] || []).length > 3 && <span className="muted small">+{people[t.id].length - 3}</span>}
    </span>
  );

  const firstName = profile?.full_name?.split(' ')[0];
  const openCount = tasks.filter((t) => !t.completed).length;

  let rowNo = 0;

  return (
    <div className={`page page-full my-tasks${view === 'board' ? ' is-board' : ''}`}>
      <header className="page-head my-head">
        <div>
          <h1>My tasks</h1>
          <p className="muted">
            {loading ? 'Loading…' : openCount
              ? `${firstName ? `${firstName}, you` : 'You'} have ${openCount} open task${openCount === 1 ? '' : 's'} across your projects.`
              : 'Nothing open. Tasks assigned to you in any project land here.'}
          </p>
        </div>
      </header>

      <div className="view-bar">
        <div className="tabs" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key}
              className={`tab${view === v.key ? ' is-on' : ''}`} onClick={() => setParam('view', v.key === 'list' ? null : v.key)}>
              <v.icon width="16" height="16" /> {v.label}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show completed
        </label>
      </div>

      {!loading && view !== 'calendar' && shown.length === 0 && (
        <div className="empty-state">
          <h3>Your box is empty</h3>
          <p className="muted">Open a project and assign a task to yourself, or ask a teammate to add you to theirs.</p>
        </div>
      )}

      {view === 'list' && shown.length > 0 && (
        <div className="my-table" role="table" aria-label="My tasks">
          <div className="my-tr my-th" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Name</span>
            <span role="columnheader">Due date</span>
            <span role="columnheader">Project</span>
            <span role="columnheader">Collaborators</span>
            <span role="columnheader">Priority</span>
          </div>
          {shown.map((g) => {
            const isClosed = collapsed.has(g.key);
            return (
              <div key={g.key} className={`my-group my-${g.key}`} role="rowgroup">
                <button type="button" className="my-group-head" onClick={() => flip(g.key)} aria-expanded={!isClosed}>
                  <Icon.chevron width="16" height="16" className={`my-caret${isClosed ? '' : ' is-open'}`} />
                  {g.label} <span className="count">{g.items.length}</span>
                </button>
                {!isClosed && g.items.map((t) => {
                  rowNo += 1;
                  return (
                    <div key={t.id} role="row" className={`my-tr my-row${t.completed ? ' is-done' : ''}`} onClick={() => open(t.id)}>
                      <span className="my-num muted small">{rowNo}</span>
                      <span className="my-name">
                        <Check checked={t.completed} onChange={(v) => toggle(t, v)} disabled={!canEdit(roles[t.project_id])} />
                        <button className="task-title" onClick={(e) => { e.stopPropagation(); open(t.id); }}>{t.title}</button>
                      </span>
                      <span><DueLabel value={t.due_date} completed={t.completed} /></span>
                      <span className="my-proj">{projectChip(t)}</span>
                      <span className="my-people">{collaborators(t)}</span>
                      <span className="my-prio"><PriorityTag value={t.priority} /></span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {view === 'board' && shown.length > 0 && (
        <div className="board">
          {groups.map((g) => (
            <section key={g.key} className={`column my-${g.key}`}>
              <div className="column-head"><h3>{g.label}</h3><span className="count">{g.items.length}</span></div>
              <div className="column-body">
                {g.items.length === 0 && <p className="column-empty">Nothing here</p>}
                {g.items.map((t) => (
                  <div key={t.id} className={`card my-card${t.completed ? ' is-done' : ''}`} onClick={() => open(t.id)}>
                    <div className="card-top">
                      <Check checked={t.completed} onChange={(v) => toggle(t, v)} disabled={!canEdit(roles[t.project_id])} />
                      <p className="card-title">{t.title}</p>
                    </div>
                    <div className="card-meta">
                      <PriorityTag value={t.priority} />
                      <DueLabel value={t.due_date} completed={t.completed} />
                      <span className="spacer" />
                      {collaborators(t)}
                    </div>
                    {projectChip(t)}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {view === 'calendar' && (
        <CalendarView tasks={tasks} hideCompleted={!showDone} actions={{ updateTask }} onOpen={open}
          labels={[]} labelsByTask={new Map()} readOnly={false} />
      )}

      {openId && <TaskPanel key={openId} taskId={openId} onClose={close} onPatch={patch}
        onRemoved={(id) => setTasks((list) => list.filter((t) => t.id !== id))} />}
    </div>
  );
}
