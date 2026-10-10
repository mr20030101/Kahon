import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PROJECT_COLORS } from '../lib/constants';
import { PROFILE_BRIEF } from '../lib/profiles';
import { confirmDialog } from '../lib/dialog';
import { notify } from '../lib/notify';
import { timeAgo } from '../lib/dates';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { Avatar, Icon, Modal, initials } from './ui';

// Workspace roles. Keep in sync with workspace_members_role_check in schema.sql.
const WS_ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
];
const wsRoleLabel = (role) => WS_ROLES.find((r) => r.value === role)?.label ?? 'Member';

export function WorkspaceTile({ workspace, size = 28 }) {
  return (
    <span className="ws-tile" aria-hidden="true" style={{ background: workspace.color, width: size, height: size, fontSize: size * 0.4 }}>
      {initials(workspace.name)}
    </span>
  );
}

/** The workspace picker at the top of the sidebar. */
export function WorkspaceSwitcher({ onNavigate }) {
  const { workspaces, current, setCurrent } = useWorkspace();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (id) => {
    setOpen(false);
    if (id === current?.id) return;
    setCurrent(id);
    // A project page belongs to the workspace you're leaving.
    if (pathname.startsWith('/p/')) navigate('/');
    onNavigate?.();
  };

  return (
    <div className="ws" ref={ref}>
      {current ? (
        <button type="button" className="ws-switch" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
          title="Switch workspace">
          <WorkspaceTile workspace={current} />
          <span className="ws-name">
            <strong className="truncate">{current.name}</strong>
            <span>{wsRoleLabel(current.role)}</span>
          </span>
          <Icon.chevron width="14" height="14" className={open ? 'is-open' : ''} />
        </button>
      ) : (
        <button type="button" className="ws-switch is-empty" onClick={() => setShowNew(true)}>
          <Icon.plus width="16" height="16" /> Create a workspace
        </button>
      )}
      {open && (
        <div className="ws-menu" role="menu">
          <p className="ws-menu-head">Workspaces</p>
          {workspaces.map((w) => (
            <button key={w.id} type="button" role="menuitemradio" aria-checked={w.id === current?.id} className="ws-option" onClick={() => pick(w.id)}>
              <WorkspaceTile workspace={w} size={24} />
              <span className="truncate">{w.name}</span>
              {w.id === current?.id && <Icon.check width="16" height="16" />}
            </button>
          ))}
          <div className="ws-sep" />
          <button type="button" role="menuitem" className="ws-option" onClick={() => { setOpen(false); setShowSettings(true); }}>
            <Icon.settings width="16" height="16" /> Workspace settings
          </button>
          <button type="button" role="menuitem" className="ws-option" onClick={() => { setOpen(false); setShowNew(true); }}>
            <Icon.plus width="16" height="16" /> Create workspace
          </button>
        </div>
      )}
      {showNew && <NewWorkspaceModal onClose={() => setShowNew(false)} />}
      {showSettings && current && <WorkspaceSettingsModal workspace={current} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export function NewWorkspaceModal({ onClose }) {
  const navigate = useNavigate();
  const { refresh, setCurrent } = useWorkspace();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const { data, error: err } = await supabase.rpc('create_workspace', { p_name: name.trim(), p_color: color });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    await refresh();
    setCurrent(data);
    onClose();
    navigate('/');
  };

  return (
    <Modal title="New workspace" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label className="label">
          Company or team name
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." maxLength={80} />
        </label>
        <fieldset className="label">
          <legend>Color</legend>
          <div className="swatches">
            {PROJECT_COLORS.map((c) => (
              <button type="button" key={c} className={`swatch-btn${c === color ? ' is-on' : ''}`} style={{ background: c }}
                onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={c === color} />
            ))}
          </div>
        </fieldset>
        <p className="muted small">You'll be its admin: you invite people and create its projects. Nobody outside it can see anything inside.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create workspace'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function WorkspaceSettingsModal({ workspace, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { refresh } = useWorkspace();
  const admin = workspace.role === 'admin';
  const [name, setName] = useState(workspace.name);
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('workspace_members')
      .select(`role, user_id, added_at, profile:profiles(${PROFILE_BRIEF})`).eq('workspace_id', workspace.id);
    setMembers((data || []).sort((a, b) => (a.role === b.role
      ? (a.profile?.full_name || '').localeCompare(b.profile?.full_name || '')
      : a.role === 'admin' ? -1 : 1)));
    if (admin) {
      const { data: inv } = await supabase.from('workspace_invitations')
        .select('id, email, role, last_sent_at').eq('workspace_id', workspace.id).order('created_at');
      setInvites(inv || []);
    }
  }, [workspace.id, admin]);

  useEffect(() => { load(); }, [load]);

  const rename = async (e) => {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === workspace.name) return;
    const { error: err } = await supabase.from('workspaces').update({ name: next }).eq('id', workspace.id);
    if (err) return toast(err.message, 'error');
    toast('Workspace renamed');
    refresh();
  };

  const invite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('invite_to_workspace', { p_workspace: workspace.id, p_email: email.trim(), p_role: role });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEmail('');
    toast(`Invitation sent to ${data.email}`);
    notify('workspace_invited', { invitation_id: data.invitation_id });
    load();
  };

  const changeRole = async (member, next) => {
    if (next === member.role) return;
    const self = member.user_id === user.id;
    if (next === 'admin') {
      const ok = await confirmDialog({ title: `Make ${member.profile?.full_name || 'them'} an admin?`, text: `Admins invite and remove people and create projects in ${workspace.name}.`, confirmText: 'Make admin' });
      if (!ok) return;
    } else if (self) {
      const ok = await confirmDialog({ title: 'Step down as admin?', text: `You'll stay in ${workspace.name} as a member, but can no longer invite people or create projects.`, confirmText: 'Step down', danger: true });
      if (!ok) return;
    }
    const { error: err } = await supabase.rpc('set_workspace_role', { p_workspace: workspace.id, p_user: member.user_id, p_role: next });
    if (err) return toast(err.message, 'error');
    if (self) refresh();
    load();
  };

  const remove = async (member) => {
    const self = member.user_id === user.id;
    const ok = await confirmDialog(self
      ? { title: `Leave ${workspace.name}?`, text: 'You will lose access to all of its projects.', confirmText: 'Leave workspace', danger: true }
      : { title: `Remove ${member.profile?.full_name || 'this person'}?`, text: `They lose access to every project in ${workspace.name} and are unassigned from its open tasks. Projects only they managed pass to you.`, confirmText: 'Remove', danger: true });
    if (!ok) return;
    const { error: err } = await supabase.rpc('remove_workspace_member', { p_workspace: workspace.id, p_user: member.user_id });
    if (err) return toast(err.message, 'error');
    if (self) {
      await refresh();
      onClose();
      navigate('/');
      return;
    }
    load();
  };

  const resend = (i) => {
    notify('workspace_invited', { invitation_id: i.id });
    toast(`Invitation sent again to ${i.email}`);
  };

  const cancelInvite = async (i) => {
    const { error: err } = await supabase.from('workspace_invitations').delete().eq('id', i.id);
    if (err) return toast(err.message, 'error');
    setInvites((list) => list.filter((x) => x.id !== i.id));
  };

  const adminCount = (members || []).filter((m) => m.role === 'admin').length;
  const me = (members || []).find((m) => m.user_id === user.id);

  return (
    <Modal title="Workspace settings" onClose={onClose} width={540}>
      {admin ? (
        <form onSubmit={rename} className="invite-row">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Workspace name" />
          <button className="btn btn-ghost" disabled={!name.trim() || name.trim() === workspace.name}>Rename</button>
        </form>
      ) : (
        <p className="ws-title"><WorkspaceTile workspace={workspace} /> <strong>{workspace.name}</strong></p>
      )}

      <p className="settings-label invites-head">People</p>
      {admin && (
        <>
          <form onSubmit={invite} className="invite-row">
            <input className="input" type="email" placeholder="teammate@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)} aria-label="Email to invite" />
            <label className="field-select role-select invite-role">
              <span>{wsRoleLabel(role)}</span>
              <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role for the new person">
                {WS_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" disabled={busy || !email.trim()}>{busy ? 'Inviting…' : 'Invite'}</button>
          </form>
          {error && <p className="form-error">{error}</p>}
          <p className="muted small">People join once they accept the invitation. Admins invite people and create projects; members work in the projects they're added to.</p>
        </>
      )}

      {members === null ? <div className="skeleton" /> : (
        <ul className="member-list">
          {members.map((m) => {
            const lastAdmin = m.role === 'admin' && adminCount === 1;
            return (
              <li key={m.user_id}>
                <span className="member-who">
                  <Avatar profile={m.profile} size={32} />
                  <span className="member-meta">
                    <strong>{m.profile?.full_name || m.profile?.email}{m.user_id === user.id ? ' (you)' : ''}</strong>
                    <span className="muted small">{m.profile?.job_title ? `${m.profile.job_title} · ${m.profile.email}` : m.profile?.email}</span>
                  </span>
                </span>
                {admin ? (
                  <>
                    <label className="field-select role-select" title={lastAdmin ? 'A workspace needs at least one admin' : undefined}>
                      <span>{wsRoleLabel(m.role)}</span>
                      <select value={m.role} disabled={lastAdmin} onChange={(e) => changeRole(m, e.target.value)}
                        aria-label={`Role for ${m.profile?.full_name || 'member'}`}>
                        {WS_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </label>
                    {m.user_id !== user.id && (
                      <button className="icon-btn" onClick={() => remove(m)} aria-label={`Remove ${m.profile?.full_name || 'member'}`} title="Remove from workspace">
                        <Icon.x />
                      </button>
                    )}
                  </>
                ) : (
                  <span className="role">{wsRoleLabel(m.role)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {invites.length > 0 && (
        <>
          <p className="settings-label invites-head">Invited</p>
          <ul className="member-list">
            {invites.map((i) => (
              <li key={i.id}>
                <span className="avatar avatar-empty" style={{ width: 32, height: 32 }} aria-hidden="true" />
                <span className="member-meta">
                  <strong className="truncate">{i.email}</strong>
                  <span className="muted small">{wsRoleLabel(i.role)} · invitation sent{i.last_sent_at ? ` ${timeAgo(i.last_sent_at)}` : ''} · hasn't joined yet</span>
                </span>
                <span className="invite-actions">
                  <button className="link-btn" onClick={() => resend(i)}>Resend</button>
                  <button className="link-btn muted-link" onClick={() => cancelInvite(i)}>Cancel</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {me && !(me.role === 'admin' && adminCount === 1) && (
        <div className="ws-leave">
          <button className="link-btn danger-link" onClick={() => remove(me)}>Leave {workspace.name}</button>
        </div>
      )}
    </Modal>
  );
}

/** "All workspaces · Loop · NCP" chips for Home, My tasks and Inbox; hidden with only one workspace. */
export function WorkspaceFilter() {
  const { workspaces, scope, setScope } = useWorkspace();
  if (workspaces.length < 2) return null;
  return (
    <div className="ws-filter" role="group" aria-label="Show workspaces">
      <button type="button" className={`chip${scope === 'all' ? ' is-on' : ''}`} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
        All workspaces
      </button>
      {workspaces.map((w) => (
        <button key={w.id} type="button" className={`chip${scope === w.id ? ' is-on' : ''}`} aria-pressed={scope === w.id} onClick={() => setScope(w.id)}>
          <span className="swatch" style={{ background: w.color }} />{w.name}
        </button>
      ))}
    </div>
  );
}

/** Which company a task or project is for, shown while all workspaces are listed together. */
export function WorkspaceTag({ projectId }) {
  const { workspaceOf, scope } = useWorkspace();
  const w = workspaceOf(projectId);
  if (!w || scope !== 'all') return null;
  return <span className="ws-tag"><i style={{ background: w.color }} />{w.name}</span>;
}

/** Invitations waiting for you: join or decline. Shown under the workspace switcher. */
export function WorkspaceInvitations() {
  const { invitations, respond } = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  if (!invitations.length) return null;

  const answer = async (invite, accept) => {
    setBusy(invite.id);
    const error = await respond(invite, accept);
    setBusy(null);
    if (error) toast(error.message, 'error');
    else if (accept) toast(`You joined ${invite.workspace_name}`);
  };

  return (
    <ul className="ws-invites" aria-label="Workspace invitations">
      {invitations.map((i) => (
        <li key={i.id}>
          <p><strong>{i.invited_by_name || 'Someone'}</strong> invited you to <strong>{i.workspace_name}</strong></p>
          <span className="ws-invite-actions">
            <button type="button" className="btn btn-primary btn-small" disabled={busy === i.id} onClick={() => answer(i, true)}>Join</button>
            <button type="button" className="btn btn-ghost btn-small on-dark" disabled={busy === i.id} onClick={() => answer(i, false)}>Decline</button>
          </span>
        </li>
      ))}
    </ul>
  );
}
