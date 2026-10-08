import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { Avatar, Icon, Modal } from './ui';
import { confirmDialog } from '../lib/dialog';

export default function MembersModal({ project, members, isOwner, onClose, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { refreshProjects } = useWorkspace();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
    toast(`Added ${data.full_name || data.email} to ${project.name}`);
    onChanged();
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
      {isOwner && <p className="muted small">They need a Kahon account first. Once added, the project appears in their sidebar.</p>}
      <ul className="member-list">
        {sorted.map((m) => (
          <li key={m.user_id}>
            <Avatar profile={m.profile} size={32} />
            <div className="member-meta">
              <strong>{m.profile?.full_name}{m.user_id === user.id ? ' (you)' : ''}</strong>
              <span className="muted small">{m.profile?.email}</span>
            </div>
            <span className="role">{m.role === 'owner' ? 'Owner' : 'Member'}</span>
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
    </Modal>
  );
}
