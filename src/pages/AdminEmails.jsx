import { useState } from 'react';
import { useSuperadmin } from '../hooks/useSuperadmin';
import { AdminBody, AdminHead, AdminSection, PeriodPicker, dateLabel, number } from '../components/AdminParts';

// Emails Kahon sent (email_log) and who sends the most invitations, the early warning for spam.
// INVITE_DAILY_LIMIT in the notify function is 50 unless it was changed.
const INVITE_LIMIT = 50;

const KINDS = {
  task_assigned: 'Task assigned',
  task_updated: 'Task updated',
  mentioned: 'Mentioned',
  comment_added: 'New comment',
  member_added: 'Added to a project',
  invited: 'Invitations',
  digest: 'Due-date reminders',
  test: 'Test emails',
};

export default function AdminEmails() {
  const [days, setDays] = useState(30);
  const { data, status, error, load } = useSuperadmin('admin_email_stats', { p_days: days });
  const kinds = data?.kinds || [];
  const daily = data?.daily || [];
  const inviters = data?.inviters || [];
  const total = kinds.reduce((n, k) => n + Number(k.sent), 0);

  return (
    <div className="page">
      <AdminHead title="Emails sent" description="Notification and invitation emails, and who sends the most invitations."
        onRefresh={load} loading={status === 'loading'}>
        <PeriodPicker value={days} onChange={setDays} />
      </AdminHead>
      <AdminBody status={status} error={error} onRetry={load} what="email activity">
        <div className="admin-stats" aria-label="Email summary">
          <div><strong>{number(total)}</strong><span>Emails sent</span></div>
          <div><strong>{number(kinds.find((k) => k.kind === 'invited')?.sent)}</strong><span>Invitations</span></div>
          <div><strong>{inviters.length}</strong><span>People inviting</span></div>
          <div><strong>{number(daily.at(-1)?.sent)}</strong><span>Sent on the latest day</span></div>
        </div>

        <AdminSection title="Who sends invitations" count={inviters.length}
          note={`Each person can send ${INVITE_LIMIT} a day. Someone near that, or inviting lots of addresses they just made up, may be sending spam.`}>
          {inviters.length === 0 ? <p className="muted">No invitations in the last {days} days.</p> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th scope="col">Person</th><th scope="col">Invitations</th><th scope="col">Last 24 hours</th><th scope="col">Last sent</th></tr></thead>
                <tbody>
                  {inviters.map((p) => (
                    <tr key={p.user_id}>
                      <td><div className="admin-person-copy"><strong>{p.name || 'Deleted account'}</strong><span>{p.email}</span></div></td>
                      <td>{number(p.invites)}</td>
                      <td className={p.last_day >= INVITE_LIMIT * 0.8 ? 'is-pending' : ''}>{number(p.last_day)}</td>
                      <td>{dateLabel(p.last_sent, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminSection>

        <AdminSection title="By type" count={kinds.length}>
          {kinds.length === 0 ? <p className="muted">No emails in the last {days} days.</p> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th scope="col">Type</th><th scope="col">Sent</th><th scope="col">Last sent</th></tr></thead>
                <tbody>
                  {kinds.map((k) => (
                    <tr key={k.kind}>
                      <td>{KINDS[k.kind] || k.kind}</td>
                      <td>{number(k.sent)}</td>
                      <td>{dateLabel(k.last_sent, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminSection>

        <AdminSection title="By day" count={daily.length}>
          {daily.length > 0 && (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th scope="col">Day</th><th scope="col">Sent</th></tr></thead>
                <tbody>
                  {[...daily].reverse().map((d) => (
                    <tr key={d.day}><td>{dateLabel(`${d.day}T00:00`)}</td><td>{number(d.sent)}</td></tr>
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
