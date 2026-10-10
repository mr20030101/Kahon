import { useState } from 'react';
import { useSuperadmin } from '../hooks/useSuperadmin';
import { AdminBody, AdminHead, PeriodPicker, dateLabel, number } from '../components/AdminParts';

// Browser errors people hit (client_errors), grouped by message. Text is shown as text only:
// any signed-in person can write to that table, so nothing in it is trusted.

export default function AdminErrors() {
  const [days, setDays] = useState(7);
  const { data, status, error, load } = useSuperadmin('admin_list_errors', { p_days: days });
  const rows = data || [];
  const total = rows.reduce((n, r) => n + Number(r.occurrences), 0);

  return (
    <div className="page">
      <AdminHead title="Errors" description="Errors people hit in their browser, grouped by message. Newest first."
        onRefresh={load} loading={status === 'loading'}>
        <PeriodPicker value={days} onChange={setDays} />
      </AdminHead>
      <AdminBody status={status} error={error} onRetry={load} what="errors">
        <div className="admin-stats" aria-label="Error summary">
          <div><strong>{number(total)}</strong><span>Errors</span></div>
          <div><strong>{rows.length}</strong><span>Different errors</span></div>
          <div><strong>{rows.filter((r) => new Date(r.last_seen) > Date.now() - 86_400_000).length}</strong><span>Seen in the last day</span></div>
          <div><strong>{new Set(rows.map((r) => r.last_version).filter(Boolean)).size}</strong><span>App versions affected</span></div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state"><h3>No errors in the last {days} days</h3></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Error</th>
                  <th scope="col">Times</th>
                  <th scope="col">People</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Version</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.message}-${r.last_seen}`}>
                    <td className="admin-wrap admin-error">
                      <details>
                        <summary>{r.message}</summary>
                        <p className="muted small">Last on {r.last_url || 'an unknown page'}{r.last_user ? ` · ${r.last_user}` : ''} · first seen {dateLabel(r.first_seen, true)}</p>
                        {r.sample_stack && <pre>{r.sample_stack}</pre>}
                      </details>
                    </td>
                    <td>{number(r.occurrences)}</td>
                    <td>{number(r.people)}</td>
                    <td>{dateLabel(r.last_seen, true)}</td>
                    <td>{r.last_version || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminBody>
    </div>
  );
}
