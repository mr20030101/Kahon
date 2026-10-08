import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Avatar, Icon } from '../components/ui';

function dateLabel(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');

    const { data: allowed, error: accessError } = await supabase.rpc('is_superadmin');
    if (accessError) {
      setError(accessError.message);
      setStatus('error');
      return;
    }
    if (!allowed) {
      setStatus('denied');
      return;
    }

    const { data, error: listError } = await supabase.rpc('admin_list_users');
    if (listError) {
      setError(listError.message);
      setStatus('error');
      return;
    }
    setUsers(data || []);
    setStatus('ready');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return users;
    return users.filter((user) =>
      [user.full_name, user.email, user.job_title, user.department]
        .some((value) => value?.toLocaleLowerCase().includes(term)),
    );
  }, [users, query]);
  const confirmed = users.filter((user) => user.email_confirmed_at).length;
  const withMfa = users.filter((user) => user.mfa_enabled).length;
  const superAdmins = users.filter((user) => user.is_superadmin).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>All users</h1>
          <p className="muted">Workspace accounts and their project access.</p>
        </div>
        <button className="btn btn-ghost" type="button" onClick={load} disabled={status === 'loading'}>
          <Icon.history /> Refresh
        </button>
      </header>

      {status === 'loading' && <div aria-label="Loading users"><div className="skeleton tall" /><div className="skeleton" /><div className="skeleton" /></div>}
      {status === 'error' && (
        <div className="empty-state">
          <h3>Could not load users</h3>
          <p className="muted">{error}</p>
          <button className="btn btn-ghost" type="button" onClick={load}>Try again</button>
        </div>
      )}
      {status === 'denied' && (
        <div className="empty-state">
          <h3>Super admin access required</h3>
          <p className="muted">This page is available only to a super admin. The account must pass two-factor authentication when it is enabled.</p>
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className="admin-stats" aria-label="User account summary">
            <div><strong>{users.length}</strong><span>Accounts</span></div>
            <div><strong>{confirmed}</strong><span>Email confirmed</span></div>
            <div><strong>{withMfa}</strong><span>Two-factor enabled</span></div>
            <div><strong>{superAdmins}</strong><span>Super admins</span></div>
          </div>

          <div className="admin-toolbar">
            <label className="search-box">
              <Icon.search />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, email, team…"
                aria-label="Search users"
              />
            </label>
            <span className="muted small">{filtered.length} of {users.length} accounts</span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <h3>{users.length ? 'No matching users' : 'No accounts yet'}</h3>
              {users.length > 0 && <p className="muted">Try another name, email address or team.</p>}
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Account</th>
                    <th scope="col">Projects</th>
                    <th scope="col">Last sign in</th>
                    <th scope="col">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="admin-person">
                          <Avatar profile={user} size={34} />
                          <div className="admin-person-copy">
                            <strong>{user.full_name || 'Unnamed user'}</strong>
                            <span>{user.email}</span>
                            {(user.job_title || user.department) && (
                              <span className="muted">{[user.job_title, user.department].filter(Boolean).join(' · ')}</span>
                            )}
                          </div>
                          {user.is_superadmin && <span className="admin-tag">Super admin</span>}
                        </div>
                      </td>
                      <td>
                        <div className="admin-account">
                          <span className={user.email_confirmed_at ? 'is-positive' : 'is-pending'}>
                            {user.email_confirmed_at ? 'Email confirmed' : 'Unconfirmed'}
                          </span>
                          <span className={user.mfa_enabled ? 'is-positive' : 'muted'}>
                            {user.mfa_enabled ? '2FA enabled' : '2FA off'}
                          </span>
                        </div>
                      </td>
                      <td>{user.projects ?? 0}<span className="muted admin-owned"> · {user.projects_owned ?? 0} owned</span></td>
                      <td>{dateLabel(user.last_sign_in_at)}</td>
                      <td>{dateLabel(user.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
