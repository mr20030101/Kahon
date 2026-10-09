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

export default function Inbox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { items, unread, markRead, clearRead } = useInbox(user.id);

  const open = (n) => {
    markRead([n.id]);
    if (n.task) navigate(`/p/${n.task.project_id}?task=${n.task.id}`);
    else if (n.project) navigate(`/p/${n.project.id}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="muted">{unread ? `${unread} unread` : 'You’re all caught up.'}</p>
        </div>
        <div className="head-actions">
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
      <ul className="inbox">
        {items?.map((n) => {
          const due = n.kind === 'due_soon' || n.kind === 'overdue';
          return (
            <li key={n.id}>
              <button type="button" className={`inbox-item${n.read_at ? '' : ' is-unread'}`} onClick={() => open(n)}>
                {due
                  ? <span className={`inbox-icon${n.kind === 'overdue' ? ' is-late' : ''}`}><Icon.calendar /></span>
                  : <Avatar profile={n.actor} size={32} />}
                <span className="inbox-text">
                  <span>
                    {!due && <strong>{n.actor?.full_name || 'Someone'} </strong>}
                    {WHAT[n.kind]}{' '}
                    <strong>{n.kind === 'added_to_project' ? n.project?.name : n.task?.title ?? 'a deleted task'}</strong>
                  </span>
                  {n.comment?.body && <span className="inbox-quote">{plainMentions(n.comment.body).slice(0, 160)}</span>}
                  <span className="muted small">
                    {n.project && <><span className="swatch" style={{ background: n.project.color }} /> {n.project.name} · </>}
                    {timeAgo(n.created_at)}
                  </span>
                </span>
                {!n.read_at && <span className="unread-dot" aria-label="Unread" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
