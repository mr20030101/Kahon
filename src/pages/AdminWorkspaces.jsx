import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Icon } from '../components/ui';
import { WorkspaceTile } from '../components/Workspaces';

// Every workspace on Kahon, for super admins. Read-only: the data comes from
// admin_list_workspaces(), which refuses anyone else.

function dateLabel(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export default function AdminWorkspaces() {
  const [workspaces, setWorkspaces] = useState([]);
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

    const { data, error: listError } = await supabase.rpc('admin_list_workspaces');
    if (listError) {
      setError(listError.message);
      setStatus('error');
      return;
    }
    setWorkspaces(data || []);
    setStatus('ready');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return workspaces;
    return workspaces.filter((w) =>
      [w.name, w.admin_names, w.created_by_name].some((value) => value?.toLocaleLowerCase().includes(term)),
    );
  }, [workspaces, query]);
  const sum = (key) => workspaces.reduce((n, w) => n + Number(w[key] ?? 0), 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>All workspaces</h1>
          <p className="muted">Every company and team on Kahon, who runs it, and how much is in it.</p>
        </div>
        <button className="btn btn-ghost" type="button" onClick={load} disabled={status === 'loading'}>
          <Icon.history /> Refresh
        </button>
      </header>

      {status === 'loading' && <div aria-label="Loading workspaces"><div className="skeleton tall" /><div className="skeleton" /><div className="skeleton" /></div>}
      {status === 'error' && (
        <div className="empty-state">
          <h3>Could not load workspaces</h3>
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
          <div className="admin-stats" aria-label="Workspace summary">
            <div><strong>{workspaces.length}</strong><span>Workspaces</span></div>
            <div><strong>{sum('members')}</strong><span>Memberships</span></div>
            <div><strong>{sum('projects')}</strong><span>Active projects</span></div>
            <div><strong>{sum('pending_invites')}</strong><span>Pending invitations</span></div>
          </div>

          <div className="admin-toolbar">
            <label className="search-box">
              <Icon.search />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search workspace or admin…"
                aria-label="Search workspaces"
              />
            </label>
            <span className="muted small">{filtered.length} of {workspaces.length} workspaces</span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <h3>{workspaces.length ? 'No matching workspaces' : 'No workspaces yet'}</h3>
              {workspaces.length > 0 && <p className="muted">Try another workspace or admin name.</p>}
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Workspace</th>
                    <th scope="col">Admins</th>
                    <th scope="col">People</th>
                    <th scope="col">Projects</th>
                    <th scope="col">Open tasks</th>
                    <th scope="col">Last activity</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((w) => (
                    <tr key={w.id}>
                      <td>
                        <div className="admin-person">
                          <WorkspaceTile workspace={w} size={34} />
                          <div className="admin-person-copy">
                            <strong>{w.name}</strong>
                            <span className="muted">Created by {w.created_by_name || 'a deleted account'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="admin-wrap">{w.admin_names || <span className="is-pending">No admin</span>}</td>
                      <td>
                        {w.members}
                        {w.pending_invites > 0 && <span className="muted admin-owned"> · {w.pending_invites} invited</span>}
                      </td>
                      <td>
                        {w.projects}
                        {w.archived_projects > 0 && <span className="muted admin-owned"> · {w.archived_projects} archived</span>}
                      </td>
                      <td>{w.open_tasks}</td>
                      <td>{dateLabel(w.last_activity)}</td>
                      <td>{dateLabel(w.created_at)}</td>
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
