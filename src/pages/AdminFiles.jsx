import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { confirmDialog } from '../lib/dialog';
import { useToast } from '../context/ToastContext';
import { useSuperadmin } from '../hooks/useSuperadmin';
import { formatBytes } from '../components/Attachments';
import { AdminBody, AdminHead, AdminSection, dateLabel, number } from '../components/AdminParts';

const total = (rows, key) => rows.reduce((sum, r) => sum + Number(r[key] || 0), 0);
const plural = (n, word) => `${number(n)} ${word}${Number(n) === 1 ? '' : 's'}`;

function ProjectCell({ p }) {
  return <div className="admin-person-copy"><strong>{p.project_name}</strong>{p.workspace && <span>{p.workspace}</span>}</div>;
}

// Auto delete files from completed projects. The switch and every report go through RPCs that
// refuse anyone who isn't a super admin; the hourly file-cleanup function does the deleting.
export default function AdminFiles() {
  const toast = useToast();
  const { data, status, error, load } = useSuperadmin('admin_file_cleanup');
  const [saving, setSaving] = useState(false);

  const d = data || {};
  const due = d.due || [];
  const upcoming = d.upcoming || [];
  const log = d.log || [];
  const days = d.after_days ?? 2;

  const toggle = async (on) => {
    const ok = on
      ? await confirmDialog({
        title: 'Turn on auto delete?',
        text: `Files in projects that have been Complete for ${days} days are permanently deleted, checked every hour.`
          + (due.length ? ` ${plural(total(due, 'files'), 'file')} in ${plural(due.length, 'project')} will be deleted within the hour.` : '')
          + ' Projects, tasks and comments stay. Deleted files cannot be recovered.',
        confirmText: 'Turn on',
        danger: true,
      })
      : await confirmDialog({ title: 'Turn off auto delete?', text: 'Files in completed projects are kept until you turn it back on.', confirmText: 'Turn off' });
    if (!ok) return;
    setSaving(true);
    const { error: saveError } = await supabase.rpc('admin_set_auto_delete_files', { p_on: on });
    setSaving(false);
    if (saveError) toast(saveError.message, 'error');
    else toast(on ? 'Auto delete is on' : 'Auto delete is off');
    load();
  };

  return (
    <div className="page">
      <AdminHead title="File cleanup" description={`Delete the files in projects ${days} days after they're marked Complete.`}
        onRefresh={load} loading={status === 'loading'} />
      <AdminBody status={status} error={error} onRetry={load} what="file cleanup">
        <section className="admin-section admin-switch">
          <label className="menu-switch">
            <span>
              <strong>Auto delete files from completed projects</strong>
              <span className="muted small">
                {d.enabled ? 'On' : 'Off'}{d.updated_by ? ` · changed by ${d.updated_by} on ${dateLabel(d.updated_at, true)}` : ''}
              </span>
            </span>
            <span className="switch-toggle">
              <input type="checkbox" checked={!!d.enabled} disabled={saving} onChange={(e) => toggle(e.target.checked)}
                aria-label="Auto delete files from completed projects" />
              <span aria-hidden="true" />
            </span>
          </label>
          <p className="muted small">
            Task attachments and project reference files are deleted. Projects, tasks and comments stay.
            Reopening a project before then keeps its files.
          </p>
        </section>

        <div className="admin-stats" aria-label="File cleanup summary">
          <div><strong>{number(total(due, 'files'))}</strong><span>Files due now</span></div>
          <div><strong>{formatBytes(total(due, 'bytes'))}</strong><span>Space due now</span></div>
          <div><strong>{number(total(upcoming, 'files'))}</strong><span>Files due in the next {days} days</span></div>
          <div><strong>{formatBytes(total(log, 'bytes'))}</strong><span>Freed (last {log.length} runs)</span></div>
        </div>

        <AdminSection title={d.enabled ? 'Due now' : 'Would be deleted now'} count={due.length}
          note={d.enabled ? 'Deleted at the next hourly run.' : `Complete for ${days} days or more. Nothing is deleted while auto delete is off.`}>
          {due.length === 0 ? <p className="muted">No completed project has files waiting.</p> : (
            <ul className="admin-list">
              {due.map((p) => (
                <li key={p.project_id}>
                  <ProjectCell p={p} />
                  <span className="muted small">Complete since {dateLabel(p.completed_at)} · {plural(p.files, 'file')} · {formatBytes(p.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>

        <AdminSection title="Coming up" count={upcoming.length} note={`Completed in the last ${days} days.`}>
          {upcoming.length === 0 ? <p className="muted">No recently completed project has files.</p> : (
            <ul className="admin-list">
              {upcoming.map((p) => (
                <li key={p.project_id}>
                  <ProjectCell p={p} />
                  <span className="muted small">Deleted after {dateLabel(p.delete_after, true)} · {plural(p.files, 'file')} · {formatBytes(p.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>

        <AdminSection title="Recently deleted" count={log.length}>
          {log.length === 0 ? <p className="muted">Nothing has been deleted yet.</p> : (
            <ul className="admin-list">
              {log.map((l, i) => (
                <li key={i}>
                  <ProjectCell p={l} />
                  <span className="muted small">{dateLabel(l.created_at, true)} · {plural(l.files, 'file')} · {formatBytes(l.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      </AdminBody>
    </div>
  );
}
