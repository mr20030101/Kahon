import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { dayDiff, timeAgo } from '../lib/dates';
import { plainMentions } from '../lib/richtext';
import { PROFILE_BRIEF } from '../lib/profiles';
import { notifyTaskUpdate } from '../lib/notify';
import { canEdit } from '../lib/roles';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useInbox } from '../hooks/useInbox';
import { StatusPill } from '../components/ProjectDetails';
import NewProjectModal from '../components/NewProjectModal';
import TaskPanel from '../components/TaskPanel';
import { Avatar, Check, DueLabel, Icon, Logo, PriorityTag } from '../components/ui';

const TASK_SELECT = 'id, title, due_date, priority, completed, completed_at, project_id, assignee_id, project:projects(id, name, color, archived_at)';
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function startOfWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const byDue = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999');

// The day in one sentence, the way a teammate would say it.
function summary({ overdue, today, closed }) {
  const parts = [];
  if (overdue) parts.push(`${plural(overdue, 'task')} overdue`);
  if (today) parts.push(`${today} due today`);
  const lead = parts.length ? `You have ${parts.join(' and ')}.` : 'Nothing due today. A good day to get ahead.';
  return closed ? `${lead} ${plural(closed, 'box', 'boxes')} closed this week.` : lead;
}

function Panel({ title, icon: I, action, children, className = '' }) {
  return (
    <section className={`hpanel ${className}`}>
      <header className="hpanel-head">
        {I && <span className="hpanel-icon"><I width="16" height="16" /></span>}
        <h2>{title}</h2>
        <span className="spacer" />
        {action}
      </header>
      {children}
    </section>
  );
}

function Quiet({ children }) {
  return <p className="hquiet"><Logo size={22} /> {children}</p>;
}

// Private notes, saved as you type. Falls back to this browser if the notes table isn't set up yet.
function Notepad({ userId }) {
  const [body, setBody] = useState(null);
  const [state, setState] = useState('');
  const [local, setLocal] = useState(false);
  const timer = useRef(null);
  const key = `kahon-notepad-${userId}`;

  useEffect(() => {
    supabase.from('user_notes').select('body').eq('user_id', userId).maybeSingle().then(({ data, error }) => {
      if (error) {
        setLocal(true);
        let saved = '';
        try { saved = localStorage.getItem(key) || ''; } catch { /* storage blocked */ }
        setBody(saved);
      } else setBody(data?.body ?? '');
    });
  }, [userId, key]);

  const change = (value) => {
    setBody(value);
    setState('Saving…');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (local) {
        try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
        setState('Saved on this device');
        return;
      }
      const { error } = await supabase.from('user_notes')
        .upsert({ user_id: userId, body: value, updated_at: new Date().toISOString() });
      setState(error ? 'Couldn’t save' : 'Saved');
    }, 600);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="hnotes">
      <textarea value={body ?? ''} disabled={body === null} onChange={(e) => change(e.target.value)}
        placeholder="Jot it down before it slips. Only you can see this." aria-label="Private notes" />
      <span className="muted small">{state || (local ? 'Saved on this device only' : 'Only you can see this')}</span>
    </div>
  );
}

export default function Home() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const { projects } = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const openId = params.get('task');
  const { items: notes, markRead } = useInbox(user.id, { limit: 50 });

  const [mine, setMine] = useState(null);
  const [assigned, setAssigned] = useState(null);
  const [roles, setRoles] = useState({});
  const [details, setDetails] = useState({}); // project id -> { status, due_date, done, total }
  const [crew, setCrew] = useState([]);
  const [crewTasks, setCrewTasks] = useState([]);
  const [focus, setFocus] = useState('next');
  const [day, setDay] = useState(null); // a picked day on the week strip
  const [showNew, setShowNew] = useState(false);

  const live = useMemo(() => projects.filter((p) => !p.archived_at), [projects]);
  const liveIds = useMemo(() => live.map((p) => p.id), [live]);

  const load = useCallback(async () => {
    const notArchived = (t) => !t.project?.archived_at;
    const { data: extra } = await supabase.from('task_assignees').select('task_id').eq('user_id', user.id);
    const extraIds = (extra || []).map((r) => r.task_id);
    const [main, also, byMe, mem] = await Promise.all([
      supabase.from('tasks').select(TASK_SELECT).eq('assignee_id', user.id),
      extraIds.length ? supabase.from('tasks').select(TASK_SELECT).in('id', extraIds) : Promise.resolve({ data: [] }),
      supabase.from('tasks').select(TASK_SELECT).eq('created_by', user.id).not('assignee_id', 'is', null).neq('assignee_id', user.id).eq('completed', false),
      supabase.from('project_members').select('project_id, role').eq('user_id', user.id),
    ]);
    const merged = new Map([...(main.data || []), ...(also.data || [])].map((t) => [t.id, t]));
    setMine([...merged.values()].filter(notArchived));
    setAssigned((byMe.data || []).filter(notArchived).sort(byDue));
    setRoles(Object.fromEntries((mem.data || []).map((m) => [m.project_id, m.role])));
  }, [user.id]);

  // Project status and progress, the people you share projects with, and their tasks there.
  const loadTeam = useCallback(async () => {
    if (!liveIds.length) {
      setDetails({});
      setCrew([]);
      setCrewTasks([]);
      return;
    }
    const [st, members, all] = await Promise.all([
      supabase.from('projects').select('id, status, due_date').in('id', liveIds),
      supabase.from('project_members').select(`project_id, user_id, profile:profiles(${PROFILE_BRIEF})`).in('project_id', liveIds),
      supabase.from('tasks').select('project_id, assignee_id, due_date, completed, completed_at').in('project_id', liveIds).is('parent_id', null),
    ]);
    const info = Object.fromEntries((st.data || []).map((p) => [p.id, { ...p, done: 0, total: 0 }]));
    for (const t of all.data || []) {
      const p = info[t.project_id];
      if (!p) continue;
      p.total += 1;
      if (t.completed) p.done += 1;
    }
    setDetails(info);
    const people = new Map();
    for (const m of members.data || []) {
      if (m.user_id === user.id || !m.profile) continue;
      const cur = people.get(m.user_id) ?? { profile: m.profile, shared: 0 };
      cur.shared += 1;
      people.set(m.user_id, cur);
    }
    setCrew([...people.values()].sort((a, b) => b.shared - a.shared));
    setCrewTasks((all.data || []).filter((t) => t.assignee_id && people.has(t.assignee_id)));
  }, [liveIds, user.id]);

  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);
  useEffect(() => { loadTeam(); }, [loadTeam]);

  const weekStart = startOfWeek();
  const weekIso = weekStart.toISOString();
  const open = (mine || []).filter((t) => !t.completed);
  const overdue = open.filter((t) => t.due_date && dayDiff(t.due_date) < 0).sort(byDue);
  const dueToday = open.filter((t) => t.due_date && dayDiff(t.due_date) === 0);
  const closed = (mine || []).filter((t) => t.completed && t.completed_at >= weekIso)
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at));

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const key = iso(d);
    return { key, d, count: open.filter((t) => t.due_date === key).length, diff: dayDiff(key) };
  });

  const focusLists = {
    next: [
      { label: 'Overdue', tone: 'late', items: overdue },
      { label: 'Today', items: dueToday },
      { label: 'This week', items: open.filter((t) => t.due_date && dayDiff(t.due_date) > 0 && dayDiff(t.due_date) <= 7).sort(byDue) },
    ],
    later: [
      { label: 'Later', items: open.filter((t) => t.due_date && dayDiff(t.due_date) > 7).sort(byDue) },
      { label: 'No due date', items: open.filter((t) => !t.due_date) },
    ],
    closed: [{ label: 'Closed this week', items: closed }],
  };
  const groups = day
    ? [{ label: new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), items: open.filter((t) => t.due_date === day) }]
    : focusLists[focus].filter((g) => g.items.length);
  const focusCount = (k) => focusLists[k].reduce((n, g) => n + g.items.length, 0);

  const peopleById = useMemo(() => Object.fromEntries(crew.map((c) => [c.profile.id, c.profile])), [crew]);
  const pulse = useMemo(() => {
    const out = {};
    for (const t of crewTasks) {
      const s = (out[t.assignee_id] ??= { late: 0, done: 0, next: 0 });
      if (t.completed) { if (t.completed_at >= weekIso) s.done += 1; }
      else if (t.due_date && dayDiff(t.due_date) < 0) s.late += 1;
      else if (t.due_date && dayDiff(t.due_date) <= 7) s.next += 1;
    }
    return out;
  }, [crewTasks, weekIso]);

  const mentions = (notes || []).filter((n) => n.kind === 'mention').slice(0, 5);
  const openTask = (id) => setParams({ task: id });
  const close = useCallback(() => setParams({}), [setParams]);
  const openMention = (n) => {
    markRead([n.id]);
    if (n.task) navigate(`/p/${n.task.project_id}?task=${n.task.id}`);
  };
  const patch = (id, change) => {
    const apply = (list) => list?.map((t) => (t.id === id ? { ...t, ...change } : t));
    setMine(apply);
    setAssigned(apply);
  };
  const toggle = async (t, completed) => {
    patch(t.id, { completed, completed_at: completed ? new Date().toISOString() : null });
    const { error } = await supabase.from('tasks').update({ completed }).eq('id', t.id);
    if (error) {
      toast(error.message, 'error');
      load();
    } else notifyTaskUpdate(t.id, { completed });
  };

  const firstName = profile?.full_name?.split(' ')[0];
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="page home">
      <header className="hhero">
        <div className="hhero-text">
          <p className="hhero-date">{date}</p>
          <h1>{greeting()}{firstName ? `, ${firstName}` : ''}.</h1>
          <p className="hhero-line">
            {mine === null ? 'Getting your boxes ready…' : summary({ overdue: overdue.length, today: dueToday.length, closed: closed.length })}
          </p>
        </div>
        <div className="hweek" role="group" aria-label="This week">
          {week.map((w) => (
            <button key={w.key} type="button"
              className={`hday${w.diff === 0 ? ' is-today' : ''}${w.diff < 0 ? ' is-past' : ''}${day === w.key ? ' is-on' : ''}`}
              onClick={() => setDay((cur) => (cur === w.key ? null : w.key))}
              aria-pressed={day === w.key} title={`${plural(w.count, 'open task')} due`}>
              <span className="hday-name">{w.d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="hday-num">{w.d.getDate()}</span>
              <span className="hday-dots" aria-hidden="true">
                {Array.from({ length: Math.min(w.count, 4) }, (_, i) => <i key={i} />)}
              </span>
            </button>
          ))}
        </div>
        <svg className="hhero-art" viewBox="0 0 120 120" aria-hidden="true">
          <path d="M60 14 L104 39.4 L104 81.4 L60 106.8 L16 81.4 L16 39.4 Z" />
          <path d="M60 14 L104 39.4 L60 64.8 L16 39.4 Z" />
          <path d="M60 64.8 L60 106.8" />
        </svg>
      </header>

      <div className="hlayout">
        <div className="hmain">
          <Panel title={day ? 'Due that day' : 'Up next'} icon={Icon.check2}
            action={day
              ? <button type="button" className="btn btn-ghost btn-small" onClick={() => setDay(null)}>Back to all</button>
              : <Link to="/my-tasks" className="hlink">All my tasks <Icon.chevron width="14" height="14" /></Link>}>
            {!day && (
              <div className="seg hseg" role="tablist" aria-label="Show">
                {[['next', 'Up next'], ['later', 'Later'], ['closed', 'Closed']].map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={focus === k} className={focus === k ? 'is-on' : ''} onClick={() => setFocus(k)}>
                    {label} <span className="count">{focusCount(k)}</span>
                  </button>
                ))}
              </div>
            )}
            {mine === null ? <div className="skeleton" /> : groups.length === 0 ? (
              <Quiet>{day ? 'Nothing due that day.' : focus === 'closed' ? 'Close a box and it lands here.' : 'All clear. Every box is closed.'}</Quiet>
            ) : groups.map((g) => (
              <div key={g.label} className={`hgroup${g.tone ? ` is-${g.tone}` : ''}`}>
                <h3>{g.label} <span className="count">{g.items.length}</span></h3>
                <ul className="hlist">
                  {g.items.slice(0, 8).map((t) => (
                    <li key={t.id} className={`htask${t.completed ? ' is-done' : ''}`} onClick={() => openTask(t.id)}>
                      <Check checked={t.completed} onChange={(v) => toggle(t, v)} disabled={!canEdit(roles[t.project_id])} />
                      <span className="htask-main">
                        <span className="htask-title">{t.title}</span>
                        {t.project && <span className="htask-project"><span className="swatch" style={{ background: t.project.color }} />{t.project.name}</span>}
                      </span>
                      <PriorityTag value={t.priority} />
                      <DueLabel value={t.due_date} completed={t.completed} />
                    </li>
                  ))}
                </ul>
                {g.items.length > 8 && <Link to="/my-tasks" className="hlink hmore">+{g.items.length - 8} more in My tasks</Link>}
              </div>
            ))}
          </Panel>

          <Panel title="Waiting on others" icon={Icon.users}
            action={<span className="muted small">Open tasks you handed off</span>}>
            {assigned === null ? <div className="skeleton" /> : assigned.length === 0 ? (
              <Quiet>Nothing handed off right now.</Quiet>
            ) : (
              <ul className="hlist">
                {assigned.slice(0, 6).map((t) => (
                  <li key={t.id} className="htask" onClick={() => openTask(t.id)}>
                    <Avatar profile={peopleById[t.assignee_id]} size={26} />
                    <span className="htask-main">
                      <span className="htask-title">{t.title}</span>
                      <span className="htask-project">
                        {peopleById[t.assignee_id]?.full_name || 'Teammate'}
                        {t.project && <> · <span className="swatch" style={{ background: t.project.color }} />{t.project.name}</>}
                      </span>
                    </span>
                    <DueLabel value={t.due_date} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Projects" icon={Icon.list}
            action={<button type="button" className="btn btn-ghost btn-small" onClick={() => setShowNew(true)}><Icon.plus width="15" height="15" /> New project</button>}>
            {live.length === 0 ? (
              <Quiet>Start a project to give your tasks a home.</Quiet>
            ) : (
              <div className="hprojects">
                {live.map((p) => {
                  const d = details[p.id];
                  const pct = d?.total ? Math.round((d.done / d.total) * 100) : 0;
                  return (
                    <Link key={p.id} to={`/p/${p.id}`} className="hproject" style={{ '--pc': p.color }}>
                      <span className="hproject-head">
                        <span className="hproject-tile" aria-hidden="true">
                          <svg viewBox="0 0 120 120"><path d="M60 14 L104 39.4 L104 81.4 L60 106.8 L16 81.4 L16 39.4 Z" /><path className="lid" d="M60 14 L104 39.4 L60 64.8 L16 39.4 Z" /></svg>
                        </span>
                        <span className="hproject-title">
                          <span className="hproject-name" title={p.name}>{p.name}</span>
                          <span className="hproject-status"><StatusPill status={d?.status} /></span>
                        </span>
                      </span>
                      <span className="hproject-progress">
                        <span className="hproject-bar"><span style={{ width: `${pct}%` }} /></span>
                        <span className="hproject-meta">
                          <span><strong>{pct}%</strong> <span className="muted">· {d ? `${d.done}/${d.total} tasks` : '…'}</span></span>
                          {d?.due_date && <DueLabel value={d.due_date} />}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <aside className="hrail">
          <Panel title="Mentions" icon={Icon.comment}
            action={<Link to="/inbox" className="hlink">Inbox <Icon.chevron width="14" height="14" /></Link>}>
            {notes === null ? <div className="skeleton" /> : mentions.length === 0 ? (
              <Quiet>No one has @mentioned you lately.</Quiet>
            ) : (
              <ul className="hmentions">
                {mentions.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={`hmention${n.read_at ? '' : ' is-unread'}`} onClick={() => openMention(n)}>
                      <Avatar profile={n.actor} size={26} />
                      <span className="hmention-text">
                        <span className="truncate"><strong>{n.actor?.full_name || 'Someone'}</strong> · {timeAgo(n.created_at)}</span>
                        {n.comment?.body && <span className="hmention-quote">{plainMentions(n.comment.body)}</span>}
                        <span className="muted small truncate">on {n.task?.title ?? 'a deleted task'}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Notes" icon={Icon.edit} className="hpanel-notes">
            <Notepad userId={user.id} />
          </Panel>

          <Panel title="Team pulse" icon={Icon.users} action={<span className="muted small">This week</span>}>
            {crew.length === 0 ? (
              <Quiet>Invite teammates to a project to see how they’re doing.</Quiet>
            ) : (
              <ul className="hpulse">
                {crew.slice(0, 6).map(({ profile: pr }) => {
                  const s = pulse[pr.id] ?? { late: 0, done: 0, next: 0 };
                  return (
                    <li key={pr.id}>
                      <Avatar profile={pr} size={28} />
                      <span className="hpulse-name truncate">{pr.full_name || pr.email}</span>
                      <span className="hpulse-stats">
                        <span className={s.late ? 'is-late' : ''} title="Overdue">{s.late} late</span>
                        <span className={s.done ? 'is-good' : ''} title="Closed this week">{s.done} done</span>
                        <span title="Due in the next 7 days">{s.next} next</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </aside>
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
      {openId && <TaskPanel key={openId} taskId={openId} onClose={() => { close(); load(); }} onPatch={patch}
        onRemoved={() => load()} />}
    </div>
  );
}
