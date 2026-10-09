import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useInbox } from '../hooks/useInbox';
import { timeAgo } from '../lib/dates';
import { plainMentions } from '../lib/richtext';
import { Avatar, Icon } from '../components/ui';

const WHAT = {
  assigned: 'assigned you',
  comment: 'commented on',
  updated: 'updated',
  mention: 'mentioned you on',
  added_to_project: 'added you to',
  due_soon: 'Due soon:',
  overdue: 'Overdue:',
};

function dayGroup(iso) {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'This week';
  return 'Earlier';
}

export default function Inbox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { items, unread, markRead, clearRead } = useInbox(user.id);

  const [filter, setFilter] = useState('all');

  const groups = useMemo(() => {
    const shown = (items ?? []).filter((n) => filter === 'all' || !n.read_at);
    const out = [];
    for (const n of shown) {
      const label = dayGroup(n.created_at);
      if (out.at(-1)?.label !== label) out.push({ label, items: [] });
      out.at(-1).items.push(n);
    }
    return out;
  }, [items, filter]);

  const open = (n) => {
    markRead([n.id]);
    if (n.task) navigate(`/p/${n.task.project_id}?task=${n.task.id}`);
    else if (n.project) navigate(`/p/${n.project.id}`);
  };

  return (
    <div className="page page-full">
      <header className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="muted">{unread ? `${unread} unread` : 'You’re all caught up.'}</p>
        </div>
        <div className="head-actions">
          {items?.length > 0 && (
            <div className="seg" role="tablist" aria-label="Filter">
              <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'is-on' : ''} onClick={() => setFilter('all')}>All</button>
              <button type="button" role="tab" aria-selected={filter === 'unread'} className={filter === 'unread' ? 'is-on' : ''} onClick={() => setFilter('unread')}>
                Unread {unread > 0 && <span className="count">{unread}</span>}
              </button>
            </div>
          )}
          {unread > 0 && (
            <button className="btn btn-ghost" onClick={() => markRead(items.filter((n) => !n.read_at).map((n) => n.id))}>
              <Icon.check2 /> Mark all read
            </button>
          )}
          {items?.some((n) => n.read_at) && <button className="btn btn-ghost" onClick={clearRead}>Clear read</button>}
        </div>
      </header>

      {items === null && <div><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>}
      {items?.length === 0 && (
        <div className="empty-state">
          <h3>Nothing here yet</h3>
          <p className="muted">When someone assigns you a task, mentions you, comments on or changes your work, or a task is due, it shows up here.</p>
        </div>
      )}
      {items?.length > 0 && groups.length === 0 && (
        <div className="empty-state">
          <h3>No unread notifications</h3>
          <p className="muted">You’re all caught up.</p>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.label} className="inbox-group">
          <h2 className="inbox-group-head">{g.label} <span className="count">{g.items.length}</span></h2>
          <ul className="inbox">
            {g.items.map((n) => {
              const due = n.kind === 'due_soon' || n.kind === 'overdue';
              return (
                <li key={n.id}>
                  <button type="button" className={`inbox-item${n.read_at ? '' : ' is-unread'}`} onClick={() => open(n)}>
                    <span className="unread-dot" aria-label={n.read_at ? undefined : 'Unread'} />
                    {due
                      ? <span className={`inbox-icon${n.kind === 'overdue' ? ' is-late' : ''}`}><Icon.calendar /></span>
                      : <Avatar profile={n.actor} size={32} />}
                    <span className="inbox-text">
                      <span className="inbox-title">
                        {!due && <strong>{n.actor?.full_name || 'Someone'} </strong>}
                        {WHAT[n.kind]}{' '}
                        <strong>{n.kind === 'added_to_project' ? n.project?.name : n.task?.title ?? 'a deleted task'}</strong>
                      </span>
                      {n.comment?.body && <span className="inbox-quote">{plainMentions(n.comment.body).slice(0, 240)}</span>}
                    </span>
                    <span className="inbox-project muted small">
                      {n.project && <><span className="swatch" style={{ background: n.project.color }} /> <span className="truncate">{n.project.name}</span></>}
                    </span>
                    <span className="inbox-time muted small" title={new Date(n.created_at).toLocaleString()}>{timeAgo(n.created_at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
