import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatDue, timeAgo } from '../lib/dates';
import { notify } from '../lib/notify';
import { useToast } from '../context/ToastContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { Avatar, Icon, Modal } from './ui';

// Pieces of the task panel: labels, extra assignees, repeat, activity history, moving.

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
  const choices = projects.filter((p) => p.id !== task.project_id && !p.archived_at);
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
    setBusy(true);
    try {
      // Attachment files are stored under the project's folder, so they move first.
      const { data: subs } = await supabase.from('tasks').select('id').eq('parent_id', task.id);
      const ids = [task.id, ...(subs || []).map((s) => s.id)];
      const { data: files } = await supabase.from('task_attachments').select('path').in('task_id', ids);
      for (const f of files || []) {
        const to = projectId + f.path.slice(task.project_id.length);
        const { error } = await supabase.storage.from('attachments').move(f.path, to);
        if (error) throw error;
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
        <p className="muted">You're not in any other project to move it to.</p>
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
            <button className="btn btn-primary" onClick={move} disabled={busy || !sectionId}>{busy ? 'Moving…' : 'Move task'}</button>
            <button className="link-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
