import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { Avatar, Icon, Modal } from './ui';
import { confirmDialog } from '../lib/dialog';
import { notify } from '../lib/notify';
import { timeAgo } from '../lib/dates';
import ProfileCard from './ProfileCard';

export default function MembersModal({ project, members, isOwner, onClose, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { refreshProjects } = useWorkspace();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);
  const [invites, setInvites] = useState([]);

  const add = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('add_member_by_email', { p_project: project.id, p_email: email.trim() });
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
    toast(`Added ${data.full_name || data.email} to ${project.name}`);
    notify('member_added', { project_id: project.id, user_id: data.id });
    onChanged();
  };

  const loadInvites = useCallback(async () => {
    const { data } = await supabase.from('invitations').select('id, email, created_at, last_sent_at')
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
    const self = member.user_id === user.id;
    const name = member.profile?.full_name || member.profile?.email || 'this person';
    const ok = await confirmDialog(role === 'owner'
      ? { title: `Make ${name} an owner?`, text: `Owners can add and remove members, change roles, rename ${project.name} and delete it.`, confirmText: 'Make owner' }
      : self
        ? { title: 'Step down as owner?', text: `You'll stay in ${project.name} as a member, but can no longer manage it.`, confirmText: 'Step down', danger: true }
        : { title: `Make ${name} a member?`, text: `They'll stay in ${project.name} but can no longer manage it.`, confirmText: 'Make member', danger: true });
    if (!ok) return;
    const { error: err } = await supabase.rpc('set_member_role', { p_project: project.id, p_user: member.user_id, p_role: role });
    if (err) {
      toast(err.message, 'error');
      return;
    }
    toast(role === 'owner' ? `${name} is now an owner` : self ? 'You are now a member' : `${name} is now a member`);
    onChanged();
  };

  const sorted = [...members].sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0));

  return (
    <Modal title="Members" onClose={onClose}>
      {isOwner && (
        <form onSubmit={add} className="invite-row">
          <input className="input" type="email" placeholder="teammate@company.com" value={email}
            onChange={(e) => setEmail(e.target.value)} aria-label="Teammate email" />
          <button className="btn btn-primary" disabled={busy || !email.trim()}>{busy ? 'Adding…' : 'Add'}</button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
      {isOwner && <p className="muted small">People with a Kahon account are added straight away. Anyone else gets an invitation email and joins when they sign up.</p>}
      <ul className="member-list">
        {sorted.map((m) => (
          <li key={m.user_id}>
            <button type="button" className="member-who" onClick={() => setViewing(m.user_id)} title="View profile">
              <Avatar profile={m.profile} size={32} />
              <span className="member-meta">
                <strong>{m.profile?.full_name}{m.user_id === user.id ? ' (you)' : ''}</strong>
                <span className="muted small">{m.profile?.job_title ? `${m.profile.job_title} · ${m.profile.email}` : m.profile?.email}</span>
              </span>
            </button>
            {isOwner ? (
              <label className="field-select role-select" title={m.role === 'owner' && ownerCount === 1 ? 'A project needs at least one owner' : undefined}>
                <span>{m.role === 'owner' ? 'Owner' : 'Member'}</span>
                <select value={m.role} aria-label={`Role for ${m.profile?.full_name || 'member'}`}
                  disabled={m.role === 'owner' && ownerCount === 1}
                  onChange={(e) => changeRole(m, e.target.value)}>
                  <option value="owner">Owner</option>
                  <option value="member">Member</option>
                </select>
              </label>
            ) : (
              <span className="role">{m.role === 'owner' ? 'Owner' : 'Member'}</span>
            )}
            {m.role !== 'owner' && (isOwner || m.user_id === user.id) && (
              <button className="icon-btn" onClick={() => removeMember(m)}
                aria-label={m.user_id === user.id ? 'Leave project' : 'Remove member'}
                title={m.user_id === user.id ? 'Leave project' : 'Remove member'}>
                <Icon.x />
              </button>
            )}
          </li>
        ))}
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
                  <span className="muted small">Invitation sent{i.last_sent_at ? ` ${timeAgo(i.last_sent_at)}` : ''} · hasn't joined yet</span>
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
