import { useState } from 'react';
import { useSuperadmin } from '../hooks/useSuperadmin';
import { AdminBody, AdminHead, AdminSection, PeriodPicker, dateLabel, number } from '../components/AdminParts';
import { WorkspaceTile } from '../components/Workspaces';

// Ask AI requests and tokens, for what Groq costs and who's near the daily limit.
// The limit is the ask-ai function's AI_DAILY_LIMIT secret; 30 unless it was changed.
const DAILY_LIMIT = 30;

export default function AdminAI() {
  const [days, setDays] = useState(30);
  const { data, status, error, load } = useSuperadmin('admin_ai_usage', { p_days: days });
  const daily = data?.daily || [];
  const people = data?.people || [];
  const workspaces = data?.workspaces || [];
  const sum = (key) => daily.reduce((n, d) => n + Number(d[key] ?? 0), 0);

  return (
    <div className="page">
      <AdminHead title="Ask AI usage" description="Requests and tokens by day, person and workspace."
        onRefresh={load} loading={status === 'loading'}>
        <PeriodPicker value={days} onChange={setDays} />
      </AdminHead>
      <AdminBody status={status} error={error} onRetry={load} what="Ask AI usage">
        <div className="admin-stats" aria-label="Ask AI summary">
          <div><strong>{number(sum('requests'))}</strong><span>Requests</span></div>
          <div><strong>{number(sum('input_tokens'))}</strong><span>Tokens read</span></div>
          <div><strong>{number(sum('output_tokens'))}</strong><span>Tokens written</span></div>
          <div><strong>{people.length}</strong><span>People using it</span></div>
        </div>

        <AdminSection title="People" count={people.length}
          note={`Busiest day is their most requests in one day; ${DAILY_LIMIT} is the daily limit.`}>
          {people.length === 0 ? <p className="muted">Nobody used Ask AI in the last {days} days.</p> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th scope="col">Person</th><th scope="col">Requests</th><th scope="col">Busiest day</th><th scope="col">Tokens</th><th scope="col">Last used</th></tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.user_id}>
                      <td><div className="admin-person-copy"><strong>{p.name || 'Deleted account'}</strong><span>{p.email}</span></div></td>
                      <td>{number(p.requests)}</td>
                      <td className={p.busiest_day >= DAILY_LIMIT ? 'is-pending' : ''}>{p.busiest_day}{p.busiest_day >= DAILY_LIMIT ? ' · hit the limit' : ''}</td>
                      <td>{number(Number(p.input_tokens) + Number(p.output_tokens))}</td>
                      <td>{dateLabel(p.last_used, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminSection>

        <AdminSection title="Workspaces" count={workspaces.length}>
          {workspaces.length === 0 ? <p className="muted">No requests on tasks that still exist.</p> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th scope="col">Workspace</th><th scope="col">Requests</th><th scope="col">Tokens</th></tr></thead>
                <tbody>
                  {workspaces.map((w) => (
                    <tr key={w.id}>
                      <td><div className="admin-person"><WorkspaceTile workspace={w} size={28} /><strong>{w.name}</strong></div></td>
                      <td>{number(w.requests)}</td>
                      <td>{number(w.tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminSection>

        <AdminSection title="By day" count={daily.length}>
          {daily.length === 0 ? <p className="muted">No requests yet.</p> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th scope="col">Day</th><th scope="col">Requests</th><th scope="col">Tokens read</th><th scope="col">Tokens written</th></tr></thead>
                <tbody>
                  {[...daily].reverse().map((d) => (
                    <tr key={d.day}>
                      <td>{dateLabel(`${d.day}T00:00`)}</td>
                      <td>{number(d.requests)}</td>
                      <td>{number(d.input_tokens)}</td>
                      <td>{number(d.output_tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminSection>
      </AdminBody>
    </div>
  );
}
