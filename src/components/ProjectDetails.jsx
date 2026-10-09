import { useState } from 'react';
import { formatDue } from '../lib/dates';
import { Icon, Modal } from './ui';
import ProjectFiles from './ProjectFiles';

// Project overview: description, status, dates, links and reference files. Every member can read it;
// owners can edit it (projects update policy is owner-only).
export const PROJECT_STATUSES = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'off_track', label: 'Off track' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'complete', label: 'Complete' },
];

export const statusLabel = (value) => PROJECT_STATUSES.find((s) => s.value === value)?.label ?? 'On track';

const MAX_LINKS = 20;

// A web address the user typed, made absolute; null when it isn't a usable http(s) link.
function normalizeUrl(raw) {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export function StatusPill({ status }) {
  return <span className={`status-pill status-${status || 'on_track'}`}>{statusLabel(status)}</span>;
}

export default function ProjectDetails({ project, isOwner, onSave, onClose }) {
  const [editing, setEditing] = useState(false);
  return (
    <Modal title={editing ? 'Edit project details' : 'About this project'} onClose={onClose} width={620}>
      {editing
        ? <DetailsForm project={project} onCancel={() => setEditing(false)} onSave={async (patch) => {
          const ok = await onSave(patch);
          if (ok !== false) setEditing(false);
        }} />
        : <DetailsView project={project} isOwner={isOwner} onEdit={() => setEditing(true)} />}
    </Modal>
  );
}

function DetailsView({ project, isOwner, onEdit }) {
  const links = Array.isArray(project.links) ? project.links : [];
  return (
    <div className="project-details">
      <dl className="profile-facts">
        <dt>Status</dt><dd><StatusPill status={project.status} /></dd>
        <dt>Start date</dt><dd>{project.start_date ? formatDue(project.start_date) : <span className="muted">Not set</span>}</dd>
        <dt>Due date</dt><dd>{project.due_date ? formatDue(project.due_date) : <span className="muted">Not set</span>}</dd>
      </dl>

      <div>
        <p className="settings-label">Description</p>
        {project.description?.trim()
          ? <p className="profile-bio">{project.description}</p>
          : <p className="muted small">No description yet.{isOwner ? ' Add the goal, scope and anything new members should know.' : ''}</p>}
      </div>

      <div>
        <p className="settings-label">Links</p>
        {links.length ? (
          <ul className="project-links">
            {links.map((l, i) => (
              <li key={i}>
                <Icon.link width="16" height="16" />
                <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label || l.url}</a>
                {l.label && hostOf(l.url) && <span className="muted small truncate">{hostOf(l.url)}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="muted small">No links yet.</p>}
      </div>

      <ProjectFiles projectId={project.id} isOwner={isOwner} />

      {isOwner && (
        <div className="settings-actions">
          <button type="button" className="btn btn-primary" onClick={onEdit}>Edit details</button>
        </div>
      )}
    </div>
  );
}

function DetailsForm({ project, onSave, onCancel }) {
  const [form, setForm] = useState({
    description: project.description || '',
    status: project.status || 'on_track',
    start_date: project.start_date || '',
    due_date: project.due_date || '',
    links: (Array.isArray(project.links) ? project.links : []).map((l) => ({ label: l.label || '', url: l.url || '' })),
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setLink = (i, key) => (e) => setForm((f) => ({
    ...f, links: f.links.map((l, j) => (j === i ? { ...l, [key]: e.target.value } : l)),
  }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.start_date && form.due_date && form.due_date < form.start_date) {
      return setError('The due date must be on or after the start date.');
    }
    const links = [];
    for (const l of form.links) {
      if (!l.url.trim() && !l.label.trim()) continue;
      const url = normalizeUrl(l.url);
      if (!url) return setError(`"${l.url || l.label}" isn't a web address. Links must start with http:// or https://.`);
      links.push({ label: l.label.trim().slice(0, 100), url });
    }
    setSaving(true);
    await onSave({
      description: form.description.trim(),
      status: form.status,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      links,
    });
    setSaving(false);
  };

  return (
    <form className="settings-form" onSubmit={submit}>
      <div className="settings-grid">
        <label className="label">Status
          <select className="input" value={form.status} onChange={set('status')}>
            {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <span />
        <label className="label">Start date
          <input className="input" type="date" value={form.start_date} onChange={set('start_date')} />
        </label>
        <label className="label">Due date
          <input className="input" type="date" value={form.due_date} min={form.start_date || undefined} onChange={set('due_date')} />
        </label>
      </div>

      <label className="label">Description
        <textarea className="input textarea" rows={6} maxLength={5000} value={form.description} onChange={set('description')}
          placeholder="The goal, what's in and out of scope, who to ask, how the team works…" />
        <span className="hint">{form.description.length}/5000</span>
      </label>

      <fieldset className="label">
        <legend>Links</legend>
        <div className="link-rows">
          {form.links.map((l, i) => (
            <div key={i} className="link-row">
              <input className="input" placeholder="Label (e.g. Figma, Repo, Spec)" maxLength={100} value={l.label} onChange={setLink(i, 'label')} aria-label="Link label" />
              <input className="input" placeholder="https://…" value={l.url} onChange={setLink(i, 'url')} aria-label="Link address" inputMode="url" />
              <button type="button" className="icon-btn" aria-label="Remove link" title="Remove"
                onClick={() => setForm((f) => ({ ...f, links: f.links.filter((_, j) => j !== i) }))}>
                <Icon.x />
              </button>
            </div>
          ))}
          {form.links.length < MAX_LINKS && (
            <button type="button" className="link-btn add-link" onClick={() => setForm((f) => ({ ...f, links: [...f.links, { label: '', url: '' }] }))}>
              <Icon.plus width="16" height="16" /> Add link
            </button>
          )}
        </div>
      </fieldset>

      {error && <p className="form-error">{error}</p>}
      <div className="settings-actions">
        <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button>
        <button type="button" className="link-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
