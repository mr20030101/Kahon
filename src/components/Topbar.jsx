import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNow, useTimer } from '../context/TimerContext';
import { entrySeconds, formatClock } from '../lib/duration';
import { SEARCH_SHORTCUT, openSearch } from './SearchPalette';
import SettingsModal from './SettingsModal';
import { Avatar, Icon, Lockup } from './ui';

// The bar above every page: search, plus the profile menu (settings, sign out).
// On phones it also holds the menu button and logo, since the sidebar is hidden.
export default function Topbar({ onOpenNav }) {
  const { profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => !wrapRef.current?.contains(e.target) && setMenuOpen(false);
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <button className="icon-btn topbar-menu" onClick={onOpenNav} aria-label="Open menu"><Icon.menu /></button>
      <span className="topbar-logo"><Lockup height={27} /></span>
      <button type="button" className="topbar-search" onClick={openSearch}>
        <Icon.search />
        <span className="truncate">Search tasks by title or ID</span>
        <kbd>{SEARCH_SHORTCUT}</kbd>
      </button>

      <TimerChip />
      <div className="menu-wrap topbar-me" ref={wrapRef}>
        <button type="button" className="topbar-profile" onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen} aria-haspopup="menu" aria-label="Profile menu">
          <Avatar profile={profile} size={30} />
          <span className="topbar-name truncate">{profile?.full_name || 'Loading…'}</span>
          <Icon.chevron width="14" height="14" />
        </button>
        {menuOpen && (
          <div className="menu profile-menu" role="menu">
            <div className="profile-menu-who">
              <strong className="truncate">{profile?.full_name}</strong>
              <span className="truncate muted small">{profile?.job_title || profile?.email}</span>
            </div>
            <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); setShowSettings(true); }}>
              <Icon.settings /> Profile and settings
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={signOut}>
              <Icon.logout /> Sign out
            </button>
          </div>
        )}
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </header>
  );
}

// Your running timer, from any page: the task (opens it), how long, and a stop button.
function TimerChip() {
  const { running, stop } = useTimer();
  const now = useNow(!!running);
  if (!running) return null;
  const elapsed = formatClock(entrySeconds(running, now));
  const task = running.task;
  return (
    <div className="timer-chip" role="status">
      <span className="timer-dot" aria-hidden="true" />
      {task ? (
        <Link to={`/p/${task.project_id}?task=${task.id}`} className="timer-chip-task" title={`Open "${task.title}"`}>
          <span className="truncate">{task.title}</span>
        </Link>
      ) : <span className="timer-chip-task">Timer</span>}
      <span className="timer-chip-clock">{elapsed}</span>
      <button type="button" className="icon-btn" onClick={stop} aria-label={`Stop the timer (${elapsed})`} title="Stop timer">
        <Icon.stop width="14" height="14" />
      </button>
    </div>
  );
}
