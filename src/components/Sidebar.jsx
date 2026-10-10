import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useInbox } from '../hooks/useInbox';
import { useWorkspace } from '../context/WorkspaceContext';
import NewProjectModal from './NewProjectModal';
import SettingsModal from './SettingsModal';
import { WorkspaceInvitations, WorkspaceSwitcher } from './Workspaces';
import { Avatar, Icon, Lockup } from './ui';

export default function Sidebar({ open, onNavigate }) {
  const { user, profile, signOut } = useAuth();
  const { currentProjects: all, current, isAdmin, loaded } = useWorkspace();
  const { unread } = useInbox(user?.id, { limit: 50 });
  const [showArchived, setShowArchived] = useState(false);
  const projects = all.filter((p) => !p.archived_at);
  const archived = all.filter((p) => p.archived_at);
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`}>
      <div className="brand">
        <Lockup height={28} />
      </div>

      <WorkspaceSwitcher onNavigate={onNavigate} />
      <WorkspaceInvitations />

      <nav className="side-nav">
        <NavLink to="/" end className="nav-item" onClick={onNavigate}>
          <Icon.home /> Home
        </NavLink>
        <NavLink to="/my-tasks" className="nav-item" onClick={onNavigate}>
          <Icon.check2 /> My tasks
        </NavLink>
        <NavLink to="/inbox" className="nav-item" onClick={onNavigate}>
          <Icon.bell /> Inbox
          {unread > 0 && <span className="nav-badge" aria-label={`${unread} unread`}>{unread > 49 ? '50+' : unread}</span>}
        </NavLink>
      </nav>

      {/* Kahon-wide tools for super admins only. The database checks every action again. */}
      {profile?.is_superadmin && (
        <>
          <div className="side-head"><span>Super admin</span></div>
          <nav className="side-nav">
            <NavLink to="/admin/users" className="nav-item" onClick={onNavigate}>
              <Icon.users /> All users
            </NavLink>
            <NavLink to="/admin/workspaces" className="nav-item" onClick={onNavigate}>
              <Icon.board /> All workspaces
            </NavLink>
            <NavLink to="/admin/security" className="nav-item" onClick={onNavigate}>
              <Icon.check2 /> Security
            </NavLink>
            <NavLink to="/admin/errors" className="nav-item" onClick={onNavigate}>
              <Icon.info /> Errors
            </NavLink>
            <NavLink to="/admin/ai" className="nav-item" onClick={onNavigate}>
              <Icon.sparkle /> Ask AI usage
            </NavLink>
            <NavLink to="/admin/emails" className="nav-item" onClick={onNavigate}>
              <Icon.inbox /> Emails sent
            </NavLink>
          </nav>
        </>
      )}

      <div className="side-head">
        <span>Projects</span>
        {isAdmin && (
          <button className="icon-btn on-dark" onClick={() => setShowNew(true)} aria-label="New project" title="New project">
            <Icon.plus />
          </button>
        )}
      </div>

      <nav className="side-nav project-nav">
        {projects.map((p) => (
          <NavLink key={p.id} to={`/p/${p.id}`} className="nav-item" onClick={onNavigate}>
            <span className="swatch" style={{ background: p.color }} />
            <span className="truncate">{p.name}</span>
          </NavLink>
        ))}
        {archived.length > 0 && (
          <>
            <button type="button" className="side-archived" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
              <Icon.chevron width="14" height="14" className={showArchived ? 'is-open' : ''} /> Archived ({archived.length})
            </button>
            {showArchived && archived.map((p) => (
              <NavLink key={p.id} to={`/p/${p.id}`} className="nav-item is-archived" onClick={onNavigate}>
                <span className="swatch" style={{ background: p.color }} />
                <span className="truncate">{p.name}</span>
              </NavLink>
            ))}
          </>
        )}
        {loaded && current && all.length === 0 && (isAdmin ? (
          <button className="side-empty" onClick={() => setShowNew(true)}>
            Create your first project to start adding tasks.
          </button>
        ) : (
          <p className="side-empty">You haven't been added to any projects in {current.name} yet.</p>
        ))}
      </nav>

      <div className="side-foot">
        <button type="button" className="side-me" onClick={() => setShowSettings(true)} title="Profile and settings">
          <Avatar profile={profile} size={30} />
          <span className="side-user">
            <strong className="truncate">{profile?.full_name || 'Loading…'}</strong>
            <span className="truncate">{profile?.job_title || profile?.email}</span>
          </span>
        </button>
        <button className="icon-btn on-dark" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings">
          <Icon.settings />
        </button>
        <button className="icon-btn on-dark" onClick={signOut} aria-label="Sign out" title="Sign out">
          <Icon.logout />
        </button>
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </aside>
  );
}
