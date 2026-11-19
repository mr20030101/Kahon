import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatDue, timeAgo } from '../lib/dates';
import { notify } from '../lib/notify';
import { useToast } from '../context/ToastContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { Avatar, Icon, Modal } from './ui';
import { hasThumb } from './Attachments';
import { thumbPathOf } from '../lib/uploads';

// Pieces of the task panel: labels, extra assignees, repeat, activity history, moving, merging.

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return { open, setOpen, ref };
}

/** Labels on a task, with a picker of the project's labels. */
export function LabelPicker({ taskId, projectId, readOnly }) {
  const toast = useToast();
  const [labels, setLabels] = useState([]);
  const [chosen, setChosen] = useState([]);
  const { open, setOpen, ref } = usePopover();

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from('project_labels').select('*').eq('project_id', projectId).order('name'),
      supabase.from('task_labels').select('label_id').eq('task_id', taskId),
    ]).then(([l, tl]) => {
      if (!alive) return;
      setLabels(l.data || []);
      setChosen((tl.data || []).map((r) => r.label_id));
    });
    return () => {
      alive = false;
    };
  }, [taskId, projectId]);

  const toggle = async (id) => {
    const on = chosen.includes(id);
    setChosen((list) => (on ? list.filter((x) => x !== id) : [...list, id]));
    const { error } = on
      ? await supabase.from('task_labels').delete().eq('task_id', taskId).eq('label_id', id)
      : await supabase.from('task_labels').insert({ task_id: taskId, label_id: id });
    if (error) {
      toast(error.message, 'error');
      setChosen((list) => (on ? [...list, id] : list.filter((x) => x !== id)));
    }
  };

  const shown = labels.filter((l) => chosen.includes(l.id));
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="field-select chip-field" onClick={() => setOpen((o) => !o)} disabled={readOnly}>
        {shown.length
          ? shown.map((l) => <span key={l.id} className="label-chip is-on" style={{ '--chip': l.color }}>{l.name}</span>)
          : <span className="muted">{readOnly ? 'None' : 'Add labels'}</span>}
      </button>
      {open && (
        <div className="menu picker-menu">
          {labels.length === 0 && <p className="muted small">No labels yet. Create them from the project's ⋯ menu → Labels.</p>}
          {labels.map((l) => (
            <label key={l.id} className="picker-row">
              <input type="checkbox" checked={chosen.includes(l.id)} onChange={() => toggle(l.id)} />
              <span className="label-chip is-on" style={{ '--chip': l.color }}>{l.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** People assigned alongside the main assignee. */
export function ExtraAssignees({ taskId, members, mainAssignee, readOnly }) {
  const toast = useToast();
  const [ids, setIds] = useState([]);
  const { open, setOpen, ref } = usePopover();

  useEffect(() => {
    let alive = true;
    supabase.from('task_assignees').select('user_id').eq('task_id', taskId)
      .then(({ data }) => alive && setIds((data || []).map((r) => r.user_id)));
    return () => {
      alive = false;
    };
  }, [taskId]);

  const toggle = async (userId) => {
    const on = ids.includes(userId);
    setIds((list) => (on ? list.filter((x) => x !== userId) : [...list, userId]));
    const { error } = on
      ? await supabase.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', userId)
      : await supabase.from('task_assignees').insert({ task_id: taskId, user_id: userId });
    if (error) {
      toast(error.message, 'error');
      setIds((list) => (on ? [...list, userId] : list.filter((x) => x !== userId)));
    } else if (!on) {
      notify('task_assigned', { task_id: taskId, user_id: userId });
    }
  };

  const profile = (id) => members.find((m) => m.user_id === id)?.profile;
  const options = members.filter((m) => m.user_id !== mainAssignee);
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="field-select chip-field" onClick={() => setOpen((o) => !o)} disabled={readOnly}>
        {ids.length
          ? ids.map((id) => profile(id) && <span key={id} className="person-chip"><Avatar profile={profile(id)} size={20} /> {profile(id).full_name}</span>)
          : <span className="muted">{readOnly ? 'Nobody' : 'Add people'}</span>}
      </button>
      {open && (
        <div className="menu picker-menu">
          {options.length === 0 && <p className="muted small">Everyone in the project is already assigned.</p>}
          {options.map((m) => (
            <label key={m.user_id} className="picker-row">
              <input type="checkbox" checked={ids.includes(m.user_id)} onChange={() => toggle(m.user_id)} />
              <Avatar profile={m.profile} size={22} /> {m.profile?.full_name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export const REPEAT_OPTIONS = [
  { value: '', label: "Doesn't repeat" },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
];

export function RepeatSelect({ value, onChange, disabled }) {
  const label = REPEAT_OPTIONS.find((o) => o.value === (value || ''))?.label;
  return (
    <label className="field-select" title="When you complete it, the next one is created with the due date moved on">
      {value && <Icon.repeat width="16" height="16" />}
      <span className={value ? '' : 'muted'}>{label}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Repeat" disabled={disabled}>
        {REPEAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

const FIELD_TEXT = {
  title: 'renamed it',
  description: 'edited the description',
  priority: 'changed the priority',
  section: 'moved it',
  project: 'moved it to another project',
  recurrence: 'set it to repeat',
};

/** What changed on a task, newest last. */
export function ActivityLog({ taskId, members }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    supabase.from('task_activity').select('*').eq('task_id', taskId).order('created_at')
      .then(({ data }) => alive && setRows(data || []));
    return () => {
      alive = false;
    };
  }, [taskId]);

  const name = (id) => members.find((m) => m.user_id === id)?.profile?.full_name || 'Someone';
  const describe = (r) => {
    switch (r.field) {
      case 'created': return 'created this task';
      case 'completed': return r.new_value === 'true' ? 'marked it complete' : 'reopened it';
      case 'assignee': return r.new_value ? `assigned it to ${name(r.new_value)}` : 'unassigned it';
      case 'due_date': return r.new_value ? `set the due date to ${formatDue(r.new_value)}` : 'removed the due date';
      case 'priority': return r.new_value ? `set the priority to ${r.new_value}` : 'removed the priority';
      case 'section': return `moved it to ${r.new_value}`;
      case 'project': return `moved it to ${r.new_value}`;
      case 'title': return `renamed it to "${r.new_value}"`;
      case 'recurrence': return `set it to repeat ${r.new_value}`;
      case 'merged': return `merged "${r.new_value}" into it`;
      default: return FIELD_TEXT[r.field] || `changed ${r.field}`;
    }
  };

  if (rows === null) return <p className="muted small">Loading…</p>;
  if (!rows.length) return <p className="muted small">No activity recorded yet.</p>;
  return (
    <ul className="activity">
      {rows.map((r) => (
        <li key={r.id}>
          <strong>{r.actor_id ? name(r.actor_id) : 'Kahon'}</strong> {describe(r)} <span className="muted small">{timeAgo(r.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Move a task (with subtasks and attachments) to another project. */
export function MoveTaskModal({ task, onClose, onMoved }) {
  const toast = useToast();
  const { projects } = useWorkspace();
  // Tasks stay inside their workspace: one company's work never moves into another's.
  const workspaceId = projects.find((p) => p.id === task.project_id)?.workspace_id;
  const choices = projects.filter((p) => p.id !== task.project_id && !p.archived_at && p.workspace_id === workspaceId);
  const [projectId, setProjectId] = useState(choices[0]?.id || '');
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    supabase.from('sections').select('id, name').eq('project_id', projectId).order('position').then(({ data }) => {
      setSections(data || []);
      setSectionId(data?.[0]?.id || '');
    });
  }, [projectId]);

  const move = async () => {
    if (busy || !sectionId) return;
    setBusy(true);
    try {
      // Attachment files in storage are under the project's folder, so they move first. Files in
      // Google Drive stay where they are: who can open them goes by their row, which move_task updates.
      const { data: subs } = await supabase.from('tasks').select('id').eq('parent_id', task.id);
      const ids = [task.id, ...(subs || []).map((s) => s.id)];
      const { data: files } = await supabase.from('task_attachments').select('path, mime_type').in('task_id', ids)
        .is('drive_file_id', null);
      for (const f of files || []) {
        const to = projectId + f.path.slice(task.project_id.length);
        const { error } = await supabase.storage.from('attachments').move(f.path, to);
        if (error) throw error;
        // Images uploaded before thumbnails existed have none, so a failed thumbnail move is fine.
        if (hasThumb(f)) await supabase.storage.from('attachments').move(thumbPathOf(f.path), thumbPathOf(to));
      }
      const { error } = await supabase.rpc('move_task', { p_task: task.id, p_project: projectId, p_section: sectionId });
      if (error) throw error;
      toast(`Moved to ${projects.find((p) => p.id === projectId)?.name}`);
      onMoved(projectId);
    } catch (err) {
      toast(`Could not move the task: ${err.message}`, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal title="Move task" onClose={onClose} width={460}>
      {choices.length === 0 ? (
        <p className="muted">You're not in any other project in this workspace to move it to.</p>
      ) : (
        <div className="stack">
          <label className="label">Project
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="label">Section
            <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!sections.length}>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <p className="muted small">
            Subtasks, comments and attachments move with it. Labels are removed (they belong to a project), and anyone
            assigned who isn't in that project is unassigned.
          </p>
          <div className="settings-actions">
            <button className="btn btn-primary" onClick={move} aria-busy={busy}>{busy ? 'Moving…' : 'Move task'}</button>
            <button className="link-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Merge a duplicate task into another task in the same project, then delete the duplicate. */
export function MergeTaskModal({ task, onClose, onMerged }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const q = query.trim();
    const timer = setTimeout(async () => {
      // Its own subtasks would go with it, so they can't be the target.
      let req = supabase.from('tasks').select('id, title, short_id, completed, parent_id')
        .eq('project_id', task.project_id).neq('id', task.id)
        .or(`parent_id.is.null,parent_id.neq.${task.id}`)
        .order('completed').order('updated_at', { ascending: false }).limit(30);
      if (q) req = req.ilike('title', `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const { data, error } = await req;
      if (!alive) return;
      if (error) toast(error.message, 'error');
      setResults(data || []);
    }, q ? 200 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, task.id, task.project_id, toast]);

  const target = results?.find((r) => r.id === targetId);

  const merge = async () => {
    if (busy || !target) return;
    setBusy(true);
    const { error } = await supabase.rpc('merge_tasks', { p_source: task.id, p_target: target.id });
    if (error) {
      toast(`Could not merge the task: ${error.message}`, 'error');
      setBusy(false);
      return;
    }
    toast(`Merged into "${target.title}"`);
    onMerged(target.id);
  };

  return (
    <Modal title="Merge task" onClose={onClose} width={500}>
      <div className="stack">
        <p className="muted small">
          Merge <strong>{task.title}</strong> into another task in this project. Its comments, attachments, subtasks,
          time and labels move there, empty details are filled in, and its description is added to the end. Then this
          task is deleted.
        </p>
        <label className="search-box merge-search">
          <Icon.search width="16" height="16" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a task…" aria-label="Find a task" />
        </label>
        <div className="merge-list" role="radiogroup" aria-label="Task to merge into">
          {results === null && <p className="muted small">Loading…</p>}
          {results?.length === 0 && <p className="muted small">No tasks match.</p>}
          {results?.map((r) => (
            <label key={r.id} className={`picker-row${r.id === targetId ? ' is-on' : ''}`}>
              <input type="radio" name="merge-target" checked={r.id === targetId} onChange={() => setTargetId(r.id)} />
              <span className={`merge-title${r.completed ? ' is-done' : ''}`}>{r.title}</span>
              {r.parent_id && <span className="muted small">subtask</span>}
              {r.short_id && <span className="task-id">{r.short_id}</span>}
            </label>
          ))}
        </div>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={merge} disabled={!target} aria-busy={busy}>
            {busy ? 'Merging…' : 'Merge task'}
          </button>
          <button className="link-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
