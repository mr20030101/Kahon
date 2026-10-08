import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useProject } from '../hooks/useProject';
import { PROJECT_COLORS } from '../lib/constants';
import BoardView from '../components/BoardView';
import ListView from '../components/ListView';
import MembersModal from '../components/MembersModal';
import ProjectDetails, { StatusPill } from '../components/ProjectDetails';
import { formatDue } from '../lib/dates';
import TaskPanel from '../components/TaskPanel';
import { Avatar, EditableText, Icon } from '../components/ui';
import { confirmDialog } from '../lib/dialog';

export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refreshProjects } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const data = useProject(projectId);
  const [showMembers, setShowMembers] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [hideCompleted, setHideCompleted] = useHiddenCompleted(projectId);

  // Board is the default; ?view=list switches to the list. Old ?view=board links still work.
  const view = params.get('view') === 'list' ? 'list' : 'board';
  const openId = params.get('task');

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const open = (id) => setParam('task', id);
  const close = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('task');
      return next;
    });
  }, [setParams]);

  if (data.loading) {
    return <div className="page"><div className="skeleton tall" /><div className="skeleton" /><div className="skeleton" /></div>;
  }
  if (data.error) {
    return (
      <div className="page empty-state">
        <h3>{data.error === 'not-found' ? "This project isn't available" : 'Could not load this project'}</h3>
        <p className="muted">{data.error === 'not-found' ? "It was deleted, or you're not a member." : data.error}</p>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>Go to My tasks</button>
      </div>
    );
  }

  const { project, sections, tasks, members, actions } = data;
  const isOwner = members.some((m) => m.user_id === user.id && m.role === 'owner');
  const openTasks = tasks.filter((t) => !t.parent_id && !t.completed).length;
  const doneTasks = tasks.filter((t) => !t.parent_id && t.completed).length;
  const total = openTasks + doneTasks;

  const removeProject = async () => {
    setShowMenu(false);
    const ok = await confirmDialog({
      title: `Delete "${project.name}"?`,
      text: "All of its sections, tasks, comments and attachments will be deleted. This can't be undone.",
      confirmText: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    if (await actions.deleteProject()) {
      await refreshProjects();
      navigate('/');
    }
  };

  return (
    <div className={`page page-project${view === 'board' ? ' is-board' : ''}`}>
      <header className="page-head">
        <div className="project-title">
          <span className="swatch big" style={{ background: project.color }} />
          <div>
            <EditableText as="h1" value={project.name} disabled={!isOwner}
              onSave={async (name) => { await actions.updateProject({ name }); refreshProjects(); }} placeholder="Project name" />
            <div className="project-meta">
              <button type="button" className="status-btn" onClick={() => setShowDetails(true)} title="Project details">
                <StatusPill status={project.status} />
              </button>
              <div className="progress" title={`${doneTasks} of ${total} tasks done`}>
                <div className="progress-track"><div className="progress-fill" style={{ width: total ? `${(doneTasks / total) * 100}%` : 0, background: project.color }} /></div>
                <span className="muted small">{doneTasks} of {total} done</span>
              </div>
              {(project.start_date || project.due_date) && (
                <span className="muted small">
                  {project.start_date ? formatDue(project.start_date) : '…'} – {project.due_date ? formatDue(project.due_date) : '…'}
                </span>
              )}
            </div>
            {project.description?.trim() && (
              <button type="button" className="project-blurb" onClick={() => setShowDetails(true)} title="Read more">
                {project.description.trim().split('\n')[0]}
              </button>
            )}
          </div>
        </div>

        <div className="head-actions">
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'is-on' : ''} onClick={() => setParam('view', 'list')}>
              <Icon.list /> List
            </button>
            <button role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'is-on' : ''} onClick={() => setParam('view', null)}>
              <Icon.board /> Board
            </button>
          </div>
          {hideCompleted && (
            <button type="button" className="chip" onClick={() => setHideCompleted(false)} title="Show completed tasks">
              Completed hidden <span aria-hidden="true">·</span> <strong>Show</strong>
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => setShowDetails(true)} title="Project details">
            <Icon.info /> About
          </button>
          <button className="avatar-stack" onClick={() => setShowMembers(true)} title="Members">
            {members.slice(0, 4).map((m) => <Avatar key={m.user_id} profile={m.profile} size={28} />)}
            {members.length > 4 && <span className="avatar more">+{members.length - 4}</span>}
            <Icon.users />
          </button>
          <div className="menu-wrap">
            <button className="icon-btn" onClick={() => setShowMenu((s) => !s)} aria-label="Project options" aria-expanded={showMenu}><Icon.more /></button>
            {showMenu && (
              <div className="menu" onMouseLeave={() => setShowMenu(false)}>
                <label className="menu-switch">
                  <span>Hide completed tasks</span>
                  <span className="switch-toggle">
                    <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
                    <span aria-hidden="true" />
                  </span>
                </label>
                <button className="menu-item" onClick={() => { setShowMenu(false); setShowDetails(true); }}>
                  <Icon.info /> Project details
                </button>
                {isOwner && (
                  <>
                    <hr className="menu-sep" />
                    <p className="menu-label">Color</p>
                    <div className="swatches small">
                      {PROJECT_COLORS.map((c) => (
                        <button key={c} className={`swatch-btn${c === project.color ? ' is-on' : ''}`} style={{ background: c }}
                          aria-label={`Color ${c}`}
                          onClick={async () => { await actions.updateProject({ color: c }); refreshProjects(); }} />
                      ))}
                    </div>
                    <button className="menu-item danger" onClick={removeProject}><Icon.trash /> Delete project</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {sections.length === 0 && (
        <div className="empty-state">
          <h3>No sections yet</h3>
          <p className="muted">Sections are the columns of your board, like To do or In review. Add one to start adding tasks.</p>
        </div>
      )}

      {view === 'list'
        ? <ListView sections={sections} tasks={tasks} members={members} hideCompleted={hideCompleted} actions={actions} onOpen={open} />
        : <BoardView sections={sections} tasks={tasks} members={members} hideCompleted={hideCompleted} actions={actions} onOpen={open} />}

      {openId && <TaskPanel key={openId} taskId={openId} onClose={close} onPatch={actions.patchLocal} onRemoved={actions.removeLocal} />}
      {showDetails && (
        <ProjectDetails project={project} isOwner={isOwner} onClose={() => setShowDetails(false)}
          onSave={(patch) => actions.updateProject(patch)} />
      )}
      {showMembers && (
        <MembersModal project={project} members={members} isOwner={isOwner}
          onClose={() => setShowMembers(false)} onChanged={data.reload} />
      )}
    </div>
  );
}

// "Hide completed" is a viewing preference, remembered per project in this browser.
function useHiddenCompleted(projectId) {
  const key = `kahon:hide-completed:${projectId}`;
  const read = () => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  };
  const [hidden, setHidden] = useState(read);
  useEffect(() => setHidden(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (value) => {
    setHidden(value);
    try {
      if (value) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch { /* storage unavailable: still works for this visit */ }
  };
  return [hidden, update];
}
