import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { byPosition } from '../lib/position';
import { timeAgo } from '../lib/dates';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Attachments, { removeAttachmentFiles } from './Attachments';
import { AssigneeSelect, Avatar, Check, DueInput, Icon, InlineAdd, PrioritySelect } from './ui';
import { confirmDialog, isDialogOpen } from '../lib/dialog';
import { notify } from '../lib/notify';

const COMMENT_SELECT = 'id, body, created_at, author_id, author:profiles(id, full_name, color, email)';

export default function TaskPanel({ taskId, onClose, onPatch, onRemoved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('loading');
  const [task, setTask] = useState(null);
  const [project, setProject] = useState(null);
  const [members, setMembers] = useState([]);
  const [sections, setSections] = useState([]);
  const [subtasks, setSubtasks] = useState([]);
  const [comments, setComments] = useState([]);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [comment, setComment] = useState('');
  const [fileDrag, setFileDrag] = useState(false);
  const attachmentsRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setStatus('loading');

    (async () => {
      const { data: t, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
      if (!alive) return;
      if (error || !t) {
        setStatus('missing');
        return;
      }
      const [p, m, s, sub, c] = await Promise.all([
        supabase.from('projects').select('id, name, color').eq('id', t.project_id).single(),
        supabase.from('project_members').select('role, user_id, profile:profiles(id, full_name, email, color)').eq('project_id', t.project_id),
        supabase.from('sections').select('id, name, position').eq('project_id', t.project_id).order('position'),
        supabase.from('tasks').select('*').eq('parent_id', taskId).order('position'),
        supabase.from('comments').select(COMMENT_SELECT).eq('task_id', taskId).order('created_at'),
      ]);
      if (!alive) return;
      setTask(t);
      setTitleDraft(t.title);
      setDescDraft(t.description || '');
      setProject(p.data);
      setMembers(m.data || []);
      setSections(s.data || []);
      setSubtasks(sub.data || []);
      setComments(c.data || []);
      setStatus('ready');
    })();

    const channel = supabase
      .channel(`task-${taskId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `id=eq.${taskId}` },
        ({ new: row }) => setTask((cur) => (cur ? { ...cur, ...row } : cur)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `parent_id=eq.${taskId}` },
        ({ eventType, new: row }) => {
          if (eventType === 'DELETE') return;
          setSubtasks((list) => {
            const exists = list.some((x) => x.id === row.id);
            return (exists ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row]).sort(byPosition);
          });
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, ({ old }) => {
        if (old.id === taskId) {
          setStatus('missing');
          return;
        }
        setSubtasks((list) => list.filter((x) => x.id !== old.id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `task_id=eq.${taskId}` },
        async ({ new: row }) => {
          const { data } = await supabase.from('comments').select(COMMENT_SELECT).eq('id', row.id).maybeSingle();
          if (data) setComments((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]));
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'comments' },
        ({ old }) => setComments((list) => list.filter((x) => x.id !== old.id)))
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [taskId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !isDialogOpen() && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (patch) => {
    setTask((cur) => ({ ...cur, ...patch }));
    onPatch?.(taskId, patch);
    const { error } = await supabase.from('tasks').update(patch).eq('id', taskId);
    if (error) toast(`Could not save: ${error.message}`, 'error');
    else if (patch.assignee_id) notify('task_assigned', { task_id: taskId });
  };

  const saveTitle = () => {
    const next = titleDraft.trim();
    if (!next) setTitleDraft(task.title);
    else if (next !== task.title) save({ title: next });
  };

  const saveDescription = () => {
    if (descDraft !== (task.description || '')) save({ description: descDraft });
  };

  const addSubtask = async (title) => {
    const last = subtasks.reduce((max, s) => Math.max(max, s.position), 0);
    const { data, error } = await supabase
      .from('tasks')
      .insert({ project_id: task.project_id, section_id: task.section_id, parent_id: taskId, title, position: last + 1000 })
      .select()
      .single();
    if (error) return toast(error.message, 'error');
    setSubtasks((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]));
    onPatch?.(data.id, data, true);
  };

  const toggleSubtask = async (sub, completed) => {
    setSubtasks((list) => list.map((x) => (x.id === sub.id ? { ...x, completed } : x)));
    onPatch?.(sub.id, { completed });
    const { error } = await supabase.from('tasks').update({ completed }).eq('id', sub.id);
    if (error) toast(error.message, 'error');
  };

  const deleteSubtask = async (sub) => {
    setSubtasks((list) => list.filter((x) => x.id !== sub.id));
    onRemoved?.(sub.id);
    await removeAttachmentFiles({ taskIds: [sub.id] });
    const { error } = await supabase.from('tasks').delete().eq('id', sub.id);
    if (error) toast(error.message, 'error');
  };

  const deleteTask = async () => {
    const ok = await confirmDialog({
      title: `Delete "${task.title}"?`,
      text: `${subtasks.length ? 'Its subtasks, comments and attachments' : 'Its comments and attachments'} will be deleted too. This can't be undone.`,
      confirmText: 'Delete task',
      danger: true,
    });
    if (!ok) return;
    await removeAttachmentFiles({ taskIds: [taskId, ...subtasks.map((s) => s.id)] });
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (error) return toast(error.message, 'error');
    onRemoved?.(taskId);
    toast('Task deleted');
    onClose();
  };

  const postComment = async () => {
    const body = comment.trim();
    if (!body) return;
    setComment('');
    const { data, error } = await supabase
      .from('comments')
      .insert({ task_id: taskId, author_id: user.id, body })
      .select(COMMENT_SELECT)
      .single();
    if (error) {
      setComment(body);
      return toast(error.message, 'error');
    }
    setComments((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]));
    notify('comment_added', { comment_id: data.id });
  };

  const deleteComment = async (c) => {
    setComments((list) => list.filter((x) => x.id !== c.id));
    const { error } = await supabase.from('comments').delete().eq('id', c.id);
    if (error) toast(error.message, 'error');
  };

  // Drop files anywhere on the panel to attach them.
  const isFileDrag = (e) => status === 'ready' && [...e.dataTransfer.types].includes('Files');
  const dropProps = {
    onDragOver: (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setFileDrag(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setFileDrag(false);
    },
    onDrop: (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setFileDrag(false);
      attachmentsRef.current?.upload([...e.dataTransfer.files]);
    },
  };

  const creator = members.find((m) => m.user_id === task?.created_by)?.profile;
  const isOwner = members.some((m) => m.user_id === user.id && m.role === 'owner');

  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside className="panel" aria-label="Task details" {...dropProps}>
        {fileDrag && (
          <div className="panel-drop" aria-hidden="true">
            <Icon.paperclip />
            <strong>Drop files to attach</strong>
            <span className="hint">Images, PDFs, docs, sheets and slides, up to 25 MB each</span>
          </div>
        )}
        <div className="panel-bar">
          {status === 'ready' && (
            <button className={`btn btn-complete${task.completed ? ' is-done' : ''}`} onClick={() => save({ completed: !task.completed })}>
              <Check checked={task.completed} onChange={(v) => save({ completed: v })} />
              {task.completed ? 'Completed' : 'Mark complete'}
            </button>
          )}
          <span className="spacer" />
          {status === 'ready' && (
            <button className="icon-btn" onClick={deleteTask} aria-label="Delete task" title="Delete task"><Icon.trash /></button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close panel" title="Close"><Icon.x /></button>
        </div>

        {status === 'loading' && <div className="panel-body"><div className="skeleton tall" /><div className="skeleton" /><div className="skeleton" /></div>}

        {status === 'missing' && (
          <div className="panel-body empty-state">
            <h3>This task isn't available</h3>
            <p className="muted">It was deleted, or you're not a member of its project.</p>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        )}

        {status === 'ready' && (
          <div className="panel-body">
            {project && (
              <Link className="crumb" to={`/p/${project.id}`}>
                <span className="swatch" style={{ background: project.color }} /> {project.name}
              </Link>
            )}
            <textarea
              className="panel-title"
              value={titleDraft}
              rows={1}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              aria-label="Task name"
            />

            <dl className="fields">
              <dt>Assignee</dt>
              <dd><AssigneeSelect value={task.assignee_id} members={members} onChange={(v) => save({ assignee_id: v })} /></dd>
              <dt>Due date</dt>
              <dd><DueInput value={task.due_date} completed={task.completed} onChange={(v) => save({ due_date: v })} /></dd>
              <dt>Priority</dt>
              <dd><PrioritySelect value={task.priority} onChange={(v) => save({ priority: v })} /></dd>
              {!task.parent_id && (
                <>
                  <dt>Section</dt>
                  <dd>
                    <label className="field-select">
                      <span>{sections.find((s) => s.id === task.section_id)?.name || 'None'}</span>
                      <select value={task.section_id || ''} aria-label="Section"
                        onChange={(e) => save({ section_id: e.target.value, position: Date.now() / 1000 })}>
                        {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </label>
                  </dd>
                </>
              )}
            </dl>

            <h4 className="panel-h">Description</h4>
            <textarea
              className="description"
              placeholder="Add details, links or acceptance criteria"
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={saveDescription}
              rows={4}
            />

            <Attachments ref={attachmentsRef} task={task} userId={user.id} canManageAll={isOwner} />

            {!task.parent_id && (
              <>
                <h4 className="panel-h">Subtasks {subtasks.length > 0 && <span className="count">{subtasks.filter((s) => s.completed).length}/{subtasks.length}</span>}</h4>
                <ul className="subtasks">
                  {subtasks.map((s) => (
                    <li key={s.id} className={s.completed ? 'is-done' : ''}>
                      <Check checked={s.completed} onChange={(v) => toggleSubtask(s, v)} />
                      <span className="grow">{s.title}</span>
                      <button className="icon-btn reveal" onClick={() => deleteSubtask(s)} aria-label="Delete subtask"><Icon.x /></button>
                    </li>
                  ))}
                </ul>
                <InlineAdd label="Add subtask" placeholder="Subtask name" onAdd={addSubtask} />
              </>
            )}

            <h4 className="panel-h">Comments</h4>
            <ul className="comments">
              {comments.map((c) => (
                <li key={c.id}>
                  <Avatar profile={c.author} size={28} />
                  <div className="comment-body">
                    <div className="comment-head">
                      <strong>{c.author?.full_name || 'Someone'}</strong>
                      <span className="muted small">{timeAgo(c.created_at)}</span>
                      {c.author_id === user.id && (
                        <button className="link-btn" onClick={() => deleteComment(c)}>Delete</button>
                      )}
                    </div>
                    <p>{c.body}</p>
                  </div>
                </li>
              ))}
              {comments.length === 0 && <li className="muted small">No comments yet. Ask a question or leave an update.</li>}
            </ul>
            <div className="comment-box">
              <textarea
                placeholder="Write a comment"
                value={comment}
                rows={2}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment();
                }}
                aria-label="Comment"
              />
              <div className="comment-actions">
                <span className="hint">Ctrl + Enter to post</span>
                <button className="btn btn-primary" onClick={postComment} disabled={!comment.trim()}>Comment</button>
              </div>
            </div>

            <p className="muted small created-line">
              Created {creator ? `by ${creator.full_name} ` : ''}{timeAgo(task.created_at)}
              {task.completed && task.completed_at ? `, completed ${timeAgo(task.completed_at)}` : ''}
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
