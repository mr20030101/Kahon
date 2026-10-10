import { Icon } from './ui';

// Shared pieces of the super admin pages.

export function dateLabel(value, withTime = false) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}

export const number = (n) => Number(n ?? 0).toLocaleString();

export function AdminHead({ title, description, onRefresh, loading, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      <div className="head-actions">
        {children}
        <button className="btn btn-ghost" type="button" onClick={onRefresh} disabled={loading}>
          <Icon.history /> Refresh
        </button>
      </div>
    </header>
  );
}

/** Loading, error and access-denied states; renders children once the report is ready. */
export function AdminBody({ status, error, onRetry, what, children }) {
  if (status === 'loading') return <div aria-label={`Loading ${what}`}><div className="skeleton tall" /><div className="skeleton" /><div className="skeleton" /></div>;
  if (status === 'error') {
    return (
      <div className="empty-state">
        <h3>Could not load {what}</h3>
        <p className="muted">{error}</p>
        <button className="btn btn-ghost" type="button" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (status === 'denied') {
    return (
      <div className="empty-state">
        <h3>Super admin access required</h3>
        <p className="muted">This page is available only to a super admin. The account must pass two-factor authentication when it is enabled.</p>
      </div>
    );
  }
  return children;
}

/** "Last 7 / 30 / 90 days". */
export function PeriodPicker({ value, onChange }) {
  return (
    <div className="seg" role="group" aria-label="Period">
      {[7, 30, 90].map((d) => (
        <button key={d} type="button" className={value === d ? 'is-on' : ''} aria-pressed={value === d} onClick={() => onChange(d)}>
          {d} days
        </button>
      ))}
    </div>
  );
}

export function AdminSection({ title, count, note, children }) {
  return (
    <section className="admin-section">
      <h2>{title}{count !== undefined && <span className="count">{count}</span>}</h2>
      {note && <p className="muted small">{note}</p>}
      {children}
    </section>
  );
}
