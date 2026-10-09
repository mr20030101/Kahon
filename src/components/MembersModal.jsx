import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { Avatar, Icon, Modal } from './ui';
import { confirmDialog } from '../lib/dialog';
import { notify } from '../lib/notify';
import { ROLES, roleLabel } from '../lib/roles';
import { timeAgo } from '../lib/dates';
import ProfileCard from './ProfileCard';

const ROLE_ORDER = ROLES.map((r) => r.value);

export default function MembersModal({ project, members, isOwner, onClose, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { refreshProjects } = useWorkspace();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);
  const [invites, setInvites] = useState([]);

  const add = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('add_member_by_email', { p_project: project.id, p_email: email.trim(), p_role: inviteRole });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEmail('');
    if (data.status === 'invited') {
      toast(`Invitation sent to ${data.email}`);
      notify('invited', { invitation_id: data.invitation_id });
      loadInvites();
      return;
    }
    toast(`Added ${data.full_name || data.email} to ${project.name} as ${roleLabel(inviteRole).toLowerCase()}`);
    notify('member_added', { project_id: project.id, user_id: data.id });
    onChanged();
  };

  const loadInvites = useCallback(async () => {
    const { data } = await supabase.from('invitations').select('id, email, role, created_at, last_sent_at')
      .eq('project_id', project.id).order('created_at');
    setInvites(data || []);
  }, [project.id]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  const resend = (invite) => {
    notify('invited', { invitation_id: invite.id });
    toast(`Invitation sent again to ${invite.email}`);
  };

  const cancelInvite = async (invite) => {
    const { error: err } = await supabase.from('invitations').delete().eq('id', invite.id);
    if (err) return toast(err.message, 'error');
    setInvites((list) => list.filter((i) => i.id !== invite.id));
  };

  const removeMember = async (member) => {
    const leaving = member.user_id === user.id;
    const ok = await confirmDialog(leaving
      ? { title: `Leave ${project.name}?`, text: 'You will lose access to its tasks.', confirmText: 'Leave project', danger: true }
      : { title: `Remove ${member.profile?.full_name || 'this person'}?`, text: `They will lose access to ${project.name}.`, confirmText: 'Remove', danger: true });
    if (!ok) return;
    const { error: err } = await supabase.from('project_members').delete()
      .eq('project_id', project.id).eq('user_id', member.user_id);
    if (err) {
      toast(err.message, 'error');
      return;
    }
    if (leaving) {
      await refreshProjects();
      navigate('/');
    } else {
      onChanged();
    }
  };

  const ownerCount = members.filter((m) => m.role === 'owner').length;

  const changeRole = async (member, role) => {
    if (role === member.role) return;
    const self = member.user_id === user.id;
    const name = member.profile?.full_name || member.profile?.email || 'this person';
    // Granting full control, or giving up your own, gets a second look. Other changes are easy to undo.
    if (role === 'owner') {
      const ok = await confirmDialog({ title: `Make ${name} a project admin?`, text: `Project admins can add and remove members, change roles, rename ${project.name} and delete it.`, confirmText: 'Make admin' });
      if (!ok) return;
    } else if (self && member.role === 'owner') {
      const ok = await confirmDialog({ title: 'Step down as project admin?', text: `You'll stay in ${project.name} as ${roleLabel(role).toLowerCase()}, but can no longer manage it.`, confirmText: 'Step down', danger: true });
      if (!ok) return;
    }
    const { error: err } = await supabase.rpc('set_member_role', { p_project: project.id, p_user: member.user_id, p_role: role });
    if (err) {
      toast(err.message, 'error');
      return;
    }
    toast(`${self ? 'You are' : `${name} is`} now ${role === 'owner' ? 'a project admin' : `${role === 'editor' ? 'an' : 'a'} ${roleLabel(role).toLowerCase()}`}`);
    onChanged();
  };

  const sorted = [...members].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  return (
    <Modal title="Members" onClose={onClose} width={520}>
      {isOwner && (
        <form onSubmit={add} className="invite-row">
          <input className="input" type="email" placeholder="teammate@company.com" value={email}
            onChange={(e) => setEmail(e.target.value)} aria-label="Teammate email" />
          <label className="field-select role-select invite-role">
            <span>{roleLabel(inviteRole)}</span>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} aria-label="Role for the new member">
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy || !email.trim()}>{busy ? 'Adding…' : 'Add'}</button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
      {isOwner && <p className="muted small">People with a Kahon account are added straight away. Anyone else gets an invitation email and joins with this role when they sign up.</p>}
      <ul className="member-list">
        {sorted.map((m) => {
          const lastOwner = m.role === 'owner' && ownerCount === 1;
          return (
            <li key={m.user_id}>
              <button type="button" className="member-who" onClick={() => setViewing(m.user_id)} title="View profile">
                <Avatar profile={m.profile} size={32} />
                <span className="member-meta">
                  <strong>{m.profile?.full_name}{m.user_id === user.id ? ' (you)' : ''}</strong>
                  <span className="muted small">{m.profile?.job_title ? `${m.profile.job_title} · ${m.profile.email}` : m.profile?.email}</span>
                </span>
              </button>
              {isOwner ? (
                <RoleMenu value={m.role} name={m.profile?.full_name || 'member'}
                  disabledReason={lastOwner ? 'A project needs at least one project admin' : undefined}
                  onPick={(role) => changeRole(m, role)}
                  onRemove={m.role !== 'owner' ? () => removeMember(m) : undefined} />
              ) : (
                <>
                  <span className="role">{roleLabel(m.role)}</span>
                  {m.user_id === user.id && m.role !== 'owner' && (
                    <button className="icon-btn" onClick={() => removeMember(m)} aria-label="Leave project" title="Leave project">
                      <Icon.x />
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {invites.length > 0 && (
        <>
          <p className="settings-label invites-head">Invited</p>
          <ul className="member-list">
            {invites.map((i) => (
              <li key={i.id}>
                <span className="avatar avatar-empty" style={{ width: 32, height: 32 }} aria-hidden="true" />
                <span className="member-meta">
                  <strong className="truncate">{i.email}</strong>
                  <span className="muted small">{roleLabel(i.role)} · invitation sent{i.last_sent_at ? ` ${timeAgo(i.last_sent_at)}` : ''} · hasn't joined yet</span>
                </span>
                {isOwner && (
                  <span className="invite-actions">
                    <button className="link-btn" onClick={() => resend(i)}>Resend</button>
                    <button className="link-btn muted-link" onClick={() => cancelInvite(i)}>Cancel</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {viewing && <ProfileCard userId={viewing} onClose={() => setViewing(null)} />}
    </Modal>
  );
}

// A member's role, with a menu of every role and what it allows, and "Remove from project".
// The menu is fixed-positioned so the modal's scrolling doesn't clip it.
function RoleMenu({ value, name, disabledReason, onPick, onRemove }) {
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!pos) return undefined;
    const close = () => setPos(null);
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) close();
    };
    // Escape closes the menu, not the Members modal underneath it.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close();
      buttonRef.current?.focus();
    };
    const onScroll = (e) => !menuRef.current?.contains(e.target) && close();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', onScroll, true);
    menuRef.current?.querySelector('[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) return setPos(null);
    const r = buttonRef.current.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 32);
    const left = Math.max(16, Math.min(r.right - width, window.innerWidth - width - 16));
    const below = window.innerHeight - r.bottom;
    setPos(below >= 420 || below >= r.top
      ? { left, width, top: r.bottom + 6, maxHeight: below - 22 }
      : { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: r.top - 22 });
  };

  const pick = (role) => {
    setPos(null);
    onPick(role);
  };

  return (
    <>
      <button ref={buttonRef} type="button" className="field-select role-select" onClick={toggle}
        disabled={!!disabledReason} title={disabledReason} aria-haspopup="menu" aria-expanded={!!pos}
        aria-label={`Role for ${name}: ${roleLabel(value)}`}>
        {roleLabel(value)}
      </button>
      {pos && (
        <div ref={menuRef} className="role-menu" role="menu" style={pos}>
          {ROLES.map((r) => (
            <button key={r.value} type="button" role="menuitemradio" aria-checked={r.value === value}
              className="role-option" onClick={() => pick(r.value)}>
              <span className="role-option-check">{r.value === value && <Icon.check width="16" height="16" />}</span>
              <span className="role-option-text">
                <strong>{r.label}</strong>
                <span>{r.description}</span>
              </span>
            </button>
          ))}
          {onRemove && (
            <button type="button" role="menuitem" className="role-option is-danger"
              onClick={() => { setPos(null); onRemove(); }}>
              <span className="role-option-check"><Icon.x width="16" height="16" /></span>
              <span className="role-option-text">
                <strong>Remove from project</strong>
                <span>They lose access to this project and its tasks.</span>
              </span>
            </button>
          )}
        </div>
      )}
    </>
  );
}
