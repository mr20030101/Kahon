import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { confirmDialog } from '../lib/dialog';
import { useToast } from '../context/ToastContext';
import { useSuperadmin } from '../hooks/useSuperadmin';
import { AdminBody, AdminHead, AdminSection, dateLabel } from '../components/AdminParts';
import { WorkspaceTile } from '../components/Workspaces';

const ACTIONS = { resend_confirmation: 'Resent the confirmation email to' };

function PersonCell({ p }) {
  return <div className="admin-person-copy"><strong>{p.name}</strong>{p.name !== p.email && <span>{p.email}</span>}</div>;
}

export default function AdminSecurity() {
  const toast = useToast();
  const { data, status, error, load } = useSuperadmin('admin_security_overview');
  const [busy, setBusy] = useState(null);
  const [showAllNo2fa, setShowAllNo2fa] = useState(false);

  // Logged first (the database also checks the account is still unconfirmed), then sent
  // through Supabase Auth, which rate-limits resends on its own.
  const resend = async (u) => {
    const ok = await confirmDialog({ title: `Resend the confirmation email to ${u.email}?`, text: 'They get a new link to confirm their address. This is recorded in Recent admin actions.', confirmText: 'Resend' });
    if (!ok) return;
    setBusy(u.id);
    const { data: email, error: logError } = await supabase.rpc('admin_log_action', { p_action: 'resend_confirmation', p_user: u.id });
    const { error: sendError } = logError
      ? { error: logError }
      : await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin } });
    setBusy(null);
    if (sendError) toast(sendError.message, 'error');
    else toast(`Confirmation email sent to ${email}`);
    load();
  };

  const d = data || {};
  const no2fa = d.no_2fa || [];
  const superadmins = d.superadmins || [];
  const exposedAdmins = superadmins.filter((s) => !s.mfa_enabled);

  return (
    <div className="page">
      <AdminHead title="Security" description="Accounts and workspaces that need a look, and what super admins have done."
        onRefresh={load} loading={status === 'loading'} />
      <AdminBody status={status} error={error} onRetry={load} what="the security overview">
        <div className="admin-stats" aria-label="Security summary">
          <div><strong>{exposedAdmins.length}</strong><span>Super admins without two-factor</span></div>
          <div><strong>{no2fa.length}</strong><span>Accounts without two-factor</span></div>
          <div><strong>{(d.unconfirmed || []).length}</strong><span>Unconfirmed sign-ups</span></div>
          <div><strong>{(d.workspaces_without_admin || []).length}</strong><span>Workspaces with no admin</span></div>
        </div>

        <AdminSection title="Super admins" count={superadmins.length}
          note={exposedAdmins.length ? 'A super admin without two-factor is protected by a password alone. Turn it on in Settings, under Two-factor authentication.' : 'Every super admin uses two-factor.'}>
          <ul className="admin-list">
            {superadmins.map((s) => (
              <li key={s.id}>
                <PersonCell p={s} />
                <span className={s.mfa_enabled ? 'is-positive' : 'is-pending'}>{s.mfa_enabled ? '2FA enabled' : '2FA off'}</span>
              </li>
            ))}
          </ul>
        </AdminSection>

        <AdminSection title="Unconfirmed sign-ups" count={(d.unconfirmed || []).length}
          note="They can't sign in until they confirm. Resend the email if someone says it never arrived.">
          {(d.unconfirmed || []).length === 0 ? <p className="muted">Everyone has confirmed their email.</p> : (
            <ul className="admin-list">
              {d.unconfirmed.map((u) => (
                <li key={u.id}>
                  <PersonCell p={u} />
                  <span className="muted small">Signed up {dateLabel(u.created_at)}</span>
                  <button type="button" className="btn btn-ghost btn-small" disabled={busy === u.id} onClick={() => resend(u)}>
                    {busy === u.id ? 'Sending…' : 'Resend confirmation'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>

        <AdminSection title="New accounts this week" count={(d.new_accounts || []).length}>
          {(d.new_accounts || []).length === 0 ? <p className="muted">No new accounts in the last 7 days.</p> : (
            <ul className="admin-list">
              {d.new_accounts.map((u) => (
                <li key={u.id}>
                  <PersonCell p={u} />
                  <span className="muted small">{dateLabel(u.created_at)} · {u.confirmed ? 'confirmed' : 'unconfirmed'} · {u.workspaces} workspace{u.workspaces === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>

        <AdminSection title="Workspaces with no admin" count={(d.workspaces_without_admin || []).length}
          note="Nobody can invite people or create projects in these. Shouldn't happen; Kahon keeps at least one admin.">
          {(d.workspaces_without_admin || []).length === 0 ? <p className="muted">Every workspace has an admin.</p> : (
            <ul className="admin-list">
              {d.workspaces_without_admin.map((w) => (
                <li key={w.id}>
                  <span className="admin-person"><WorkspaceTile workspace={w} size={26} /><strong>{w.name}</strong></span>
                  <span className="muted small">{w.members} member{w.members === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>

        <AdminSection title="Accounts without two-factor" count={no2fa.length}>
          {no2fa.length === 0 ? <p className="muted">Everyone uses two-factor.</p> : (
            <>
              <ul className="admin-list">
                {(showAllNo2fa ? no2fa : no2fa.slice(0, 8)).map((u) => (
                  <li key={u.id}>
                    <PersonCell p={u} />
                    <span className="muted small">Last sign in {dateLabel(u.last_sign_in_at)}</span>
                  </li>
                ))}
              </ul>
              {no2fa.length > 8 && (
                <button type="button" className="link-btn" onClick={() => setShowAllNo2fa((v) => !v)}>
                  {showAllNo2fa ? 'Show fewer' : `Show all ${no2fa.length}`}
                </button>
              )}
            </>
          )}
        </AdminSection>

        <AdminSection title="Recent admin actions" count={(d.audit || []).length}>
          {(d.audit || []).length === 0 ? <p className="muted">No super admin actions yet.</p> : (
            <ul className="admin-list">
              {d.audit.map((a, i) => (
                <li key={i}>
                  <span><strong>{a.actor || 'A deleted account'}</strong> {ACTIONS[a.action] || a.action} {a.target_email}</span>
                  <span className="muted small">{dateLabel(a.created_at, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      </AdminBody>
    </div>
  );
}
