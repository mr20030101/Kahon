import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import NewProjectModal from './NewProjectModal';
import SettingsModal from './SettingsModal';
import { Avatar, Icon, Lockup } from './ui';

export default function Sidebar({ open, onNavigate }) {
  const { profile, signOut } = useAuth();
  const { projects, loaded } = useWorkspace();
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`}>
      <div className="brand">
        <Lockup height={28} />
      </div>

      <nav className="side-nav">
        <NavLink to="/" end className="nav-item" onClick={onNavigate}>
          <Icon.inbox /> My tasks
        </NavLink>
      </nav>

      <div className="side-head">
        <span>Projects</span>
        <button className="icon-btn on-dark" onClick={() => setShowNew(true)} aria-label="New project" title="New project">
          <Icon.plus />
        </button>
      </div>

      <nav className="side-nav project-nav">
        {projects.map((p) => (
          <NavLink key={p.id} to={`/p/${p.id}`} className="nav-item" onClick={onNavigate}>
            <span className="swatch" style={{ background: p.color }} />
            <span className="truncate">{p.name}</span>
          </NavLink>
        ))}
        {loaded && projects.length === 0 && (
          <button className="side-empty" onClick={() => setShowNew(true)}>
            Create your first project to start adding tasks.
          </button>
        )}
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
