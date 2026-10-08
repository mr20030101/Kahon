import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { byPosition } from '../lib/position';
import { timeAgo } from '../lib/dates';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Attachments, { removeAttachmentFiles } from './Attachments';
import AskAI from './AskAI';
import MentionInput from './MentionInput';
import RichText from './RichText';
import { ActivityLog, ExtraAssignees, LabelPicker, MoveTaskModal, RepeatSelect } from './TaskExtras';
import { AssigneeSelect, Avatar, Check, DueInput, Icon, InlineAdd, PrioritySelect } from './ui';
import { confirmDialog, isDialogOpen } from '../lib/dialog';
import { notify } from '../lib/notify';
import { PROFILE_BRIEF } from '../lib/profiles';

const COMMENT_SELECT = `id, body, created_at, edited_at, author_id, author:profiles(${PROFILE_BRIEF})`;

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
  const [commentText, setCommentText] = useState('');
  const [editingComment, setEditingComment] = useState(null);
  const [editingDesc, setEditingDesc] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [moving, setMoving] = useState(false);
  const [fileDrag, setFileDrag] = useState(false);
  const attachmentsRef = useRef(null);
  const commentRef = useRef(null);
  const editRef = useRef(null);
  const navigate = useNavigate();

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
        supabase.from('project_members').select(`role, user_id, profile:profiles(${PROFILE_BRIEF})`).eq('project_id', t.project_id),
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comments', filter: `task_id=eq.${taskId}` },
        ({ new: row }) => setComments((list) => list.map((x) => (x.id === row.id ? { ...x, body: row.body, edited_at: row.edited_at } : x))))
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
    // The database completes subtasks along with their parent; show it right away.
    if (patch.completed === true) {
      subtasks.filter((s) => !s.completed).forEach((s) => onPatch?.(s.id, { completed: true }));
      setSubtasks((list) => list.map((s) => ({ ...s, completed: true })));
    }
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

  const saveSubtask = async (sub, patch) => {
    setSubtasks((list) => list.map((x) => (x.id === sub.id ? { ...x, ...patch } : x)));
    onPatch?.(sub.id, patch);
    const { error } = await supabase.from('tasks').update(patch).eq('id', sub.id);
    if (error) toast(error.message, 'error');
    else if (patch.assignee_id) notify('task_assigned', { task_id: sub.id });
  };

  const duplicateTask = async () => {
    setShowMenu(false);
    const { data, error } = await supabase.from('tasks').insert({
      project_id: task.project_id, section_id: task.section_id, parent_id: task.parent_id,
      title: `${task.title} (copy)`.slice(0, 500), description: task.description, assignee_id: task.assignee_id,
      due_date: task.due_date, priority: task.priority, recurrence: task.recurrence, position: task.position + 0.5,
    }).select().single();
    if (error) return toast(error.message, 'error');
    if (subtasks.length) {
      await supabase.from('tasks').insert(subtasks.map((st) => ({
        project_id: st.project_id, section_id: st.section_id, parent_id: data.id, title: st.title,
        description: st.description, assignee_id: st.assignee_id, due_date: st.due_date, priority: st.priority, position: st.position,
      })));
    }
    const [{ data: tl }, { data: ta }] = await Promise.all([
      supabase.from('task_labels').select('label_id').eq('task_id', taskId),
      supabase.from('task_assignees').select('user_id').eq('task_id', taskId),
    ]);
    if (tl?.length) await supabase.from('task_labels').insert(tl.map((r) => ({ task_id: data.id, label_id: r.label_id })));
    if (ta?.length) await supabase.from('task_assignees').insert(ta.map((r) => ({ task_id: data.id, user_id: r.user_id })));
    onPatch?.(data.id, data, true);
    toast('Task duplicated');
  };

  const copyLink = async () => {
    setShowMenu(false);
    const url = `${window.location.origin}/p/${task.project_id}?task=${taskId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast(url);
    }
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

  // From the comment box (no argument) or with given text (Ask AI's "Post as comment").
  const postComment = async (text) => {
    const fromBox = text === undefined;
    const body = (fromBox ? commentRef.current?.getValue() ?? '' : text).trim().slice(0, 5000);
    if (!body) return;
    if (fromBox) {
      commentRef.current?.clear();
      setCommentText('');
    }
    const { data, error } = await supabase
      .from('comments')
      .insert({ task_id: taskId, author_id: user.id, body })
      .select(COMMENT_SELECT)
      .single();
    if (error) return toast(error.message, 'error');
    setComments((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]));
    notify('comment_added', { comment_id: data.id });
  };

  const saveCommentEdit = async (c) => {
    const body = (editRef.current?.getValue() ?? '').trim().slice(0, 5000);
    if (!body) return;
    setEditingComment(null);
    if (body === c.body) return;
    const edited_at = new Date().toISOString();
    setComments((list) => list.map((x) => (x.id === c.id ? { ...x, body, edited_at } : x)));
    const { error } = await supabase.from('comments').update({ body, edited_at }).eq('id', c.id);
    if (error) toast(error.message, 'error');
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
            <div className="menu-wrap">
              <button className="icon-btn" onClick={() => setShowMenu((v) => !v)} aria-label="Task options" aria-expanded={showMenu} title="More"><Icon.more /></button>
              {showMenu && (
                <div className="menu" onMouseLeave={() => setShowMenu(false)}>
                  <button className="menu-item" onClick={duplicateTask}><Icon.copy /> Duplicate task</button>
                  {!task.parent_id && (
                    <button className="menu-item" onClick={() => { setShowMenu(false); setMoving(true); }}><Icon.move /> Move to project…</button>
                  )}
                  <button className="menu-item" onClick={copyLink}><Icon.link /> Copy link</button>
                  <button className="menu-item danger" onClick={() => { setShowMenu(false); deleteTask(); }}><Icon.trash /> Delete task</button>
                </div>
              )}
            </div>
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
              <dt>Also assigned</dt>
              <dd><ExtraAssignees taskId={taskId} members={members} mainAssignee={task.assignee_id} /></dd>
              <dt>Due date</dt>
              <dd><DueInput value={task.due_date} completed={task.completed} onChange={(v) => save({ due_date: v })} /></dd>
              <dt>Priority</dt>
              <dd><PrioritySelect value={task.priority} onChange={(v) => save({ priority: v })} /></dd>
              <dt>Labels</dt>
              <dd><LabelPicker taskId={taskId} projectId={task.project_id} /></dd>
              {!task.parent_id && (
                <>
                  <dt>Repeat</dt>
                  <dd><RepeatSelect value={task.recurrence} onChange={(v) => save({ recurrence: v })} /></dd>
                </>
              )}
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
            {editingDesc || !descDraft.trim() ? (
              <>
                <textarea
                  className="description"
                  placeholder="Add details, links or acceptance criteria"
                  value={descDraft}
                  autoFocus={editingDesc}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onFocus={() => setEditingDesc(true)}
                  onBlur={() => { saveDescription(); setEditingDesc(false); }}
                  rows={Math.min(14, Math.max(4, descDraft.split('\n').length + 1))}
                />
                {editingDesc && <p className="hint format-hint">**bold** · *italic* · `code` · - list · 1. numbered list · links</p>}
              </>
            ) : (
              <div className="description is-view" role="button" tabIndex={0} title="Click to edit"
                onClick={(e) => e.target.tagName !== 'A' && setEditingDesc(true)}
                onKeyDown={(e) => e.key === 'Enter' && setEditingDesc(true)}>
                <RichText text={descDraft} />
              </div>
            )}

            <Attachments ref={attachmentsRef} task={task} userId={user.id} canManageAll={isOwner} />

            <AskAI
              taskId={taskId}
              canAddSubtasks={!task.parent_id}
              onAddSubtasks={async (titles) => {
                for (const title of titles) await addSubtask(title);
                toast(`Added ${titles.length} subtask${titles.length === 1 ? '' : 's'}`);
              }}
              onPostComment={(text) => postComment(text)}
            />

            {!task.parent_id && (
              <>
                <h4 className="panel-h">Subtasks {subtasks.length > 0 && <span className="count">{subtasks.filter((s) => s.completed).length}/{subtasks.length}</span>}</h4>
                <ul className="subtasks">
                  {subtasks.map((s) => (
                    <li key={s.id} className={s.completed ? 'is-done' : ''}>
                      <Check checked={s.completed} onChange={(v) => toggleSubtask(s, v)} />
                      <button type="button" className="grow subtask-title" onClick={() => navigate(`/p/${s.project_id}?task=${s.id}`)} title="Open subtask">{s.title}</button>
                      <span className="subtask-fields">
                        <DueInput value={s.due_date} completed={s.completed} onChange={(v) => saveSubtask(s, { due_date: v })} />
                        <AssigneeSelect compact value={s.assignee_id} members={members} onChange={(v) => saveSubtask(s, { assignee_id: v })} />
                      </span>
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
                      <span className="muted small">{timeAgo(c.created_at)}{c.edited_at ? ' · edited' : ''}</span>
                      {c.author_id === user.id && editingComment !== c.id && (
                        <span className="comment-tools">
                          <button className="link-btn" onClick={() => setEditingComment(c.id)}>Edit</button>
                          <button className="link-btn" onClick={() => deleteComment(c)}>Delete</button>
                        </span>
                      )}
                    </div>
                    {editingComment === c.id ? (
                      <div className="comment-box is-editing">
                        <MentionInput ref={editRef} members={members} initial={c.body} rows={3} autoFocus
                          onSubmit={() => saveCommentEdit(c)} aria-label="Edit comment" />
                        <div className="comment-actions">
                          <span className="hint">Ctrl + Enter to save</span>
                          <button className="link-btn" onClick={() => setEditingComment(null)}>Cancel</button>
                          <button className="btn btn-primary btn-small" onClick={() => saveCommentEdit(c)}>Save</button>
                        </div>
                      </div>
                    ) : (
                      <RichText text={c.body} className="comment-text" />
                    )}
                  </div>
                </li>
              ))}
              {comments.length === 0 && <li className="muted small">No comments yet. Ask a question or leave an update.</li>}
            </ul>
            <div className="comment-box">
              <MentionInput ref={commentRef} members={members} placeholder="Write a comment. Type @ to mention someone." rows={2}
                onTextChange={setCommentText} onSubmit={() => postComment()} aria-label="Comment" />
              <div className="comment-actions">
                <span className="hint">Ctrl + Enter to post</span>
                <button className="btn btn-primary" onClick={() => postComment()} disabled={!commentText.trim()}>Comment</button>
              </div>
            </div>

            <button type="button" className="link-btn activity-toggle" onClick={() => setShowActivity((v) => !v)} aria-expanded={showActivity}>
              <Icon.history width="16" height="16" /> {showActivity ? 'Hide activity' : 'Show activity'}
            </button>
            {showActivity && <ActivityLog taskId={taskId} members={members} />}

            <p className="muted small created-line">
              Created {creator ? `by ${creator.full_name} ` : ''}{timeAgo(task.created_at)}
              {task.completed && task.completed_at ? `, completed ${timeAgo(task.completed_at)}` : ''}
            </p>
          </div>
        )}
      </aside>
      {moving && task && (
        <MoveTaskModal task={task} onClose={() => setMoving(false)} onMoved={(projectId) => {
          setMoving(false);
          onRemoved?.(taskId);
          navigate(`/p/${projectId}?task=${taskId}`);
        }} />
      )}
    </>
  );
}
