import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { confirmDialog, isDialogOpen } from '../lib/dialog';
import { getTheme, setTheme } from '../lib/theme';
import { AVATAR_COLORS, avatarUrl, removeAvatarFile, timeZones, uploadAvatar } from '../lib/profiles';
import { Icon } from './ui';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'display', label: 'Display' },
  { id: 'account', label: 'Account' },
];

// Editable profile fields and their limits (matching profiles_details_check in schema.sql).
const FIELDS = { full_name: 120, job_title: 100, department: 100, location: 100, bio: 1000 };

export default function SettingsModal({ onClose, initialSection = 'profile' }) {
  const [section, setSection] = useState(initialSection);

  useEffect(() => {
    // A confirmation dialog on top handles its own Escape.
    const onKey = (e) => e.key === 'Escape' && !isDialogOpen() && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon.x /></button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" className={section === s.id ? 'is-on' : ''}
                aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {section === 'profile' && <ProfileSection />}
            {section === 'notifications' && <NotificationsSection />}
            {section === 'display' && <DisplaySection />}
            {section === 'account' && <AccountSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const { user, profile, updateProfile } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);
  const [form, setForm] = useState(() => draftFrom(profile));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const zones = useState(timeZones)[0];

  // Pick up the profile once it loads, without clobbering edits in progress.
  useEffect(() => {
    if (profile && !form.loaded) setForm(draftFrom(profile));
  }, [profile, form.loaded]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const dirty = profile && ['full_name', 'job_title', 'department', 'location', 'bio', 'timezone', 'color']
    .some((k) => (form[k] || '') !== (profile[k] || ''));

  const save = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) return toast('Your full name is required', 'error');
    setSaving(true);
    const error = await updateProfile({
      full_name: form.full_name.trim(),
      job_title: form.job_title.trim() || null,
      department: form.department.trim() || null,
      location: form.location.trim() || null,
      bio: form.bio.trim() || null,
      timezone: form.timezone || null,
      color: form.color,
    });
    setSaving(false);
    toast(error ? error.message : 'Profile saved', error ? 'error' : undefined);
  };

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast('Choose an image under 15 MB', 'error');
    setUploading(true);
    try {
      const old = profile.avatar_path;
      const path = await uploadAvatar(file, user.id);
      const error = await updateProfile({ avatar_path: path });
      if (error) {
        await removeAvatarFile(path);
        throw error;
      }
      await removeAvatarFile(old);
      toast('Photo updated');
    } catch (err) {
      toast(`Could not upload photo: ${err.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async () => {
    const old = profile.avatar_path;
    const error = await updateProfile({ avatar_path: null });
    if (error) return toast(error.message, 'error');
    await removeAvatarFile(old);
  };

  if (!profile) return <p className="muted">Loading…</p>;
  const photo = avatarUrl(profile.avatar_path);

  return (
    <form className="settings-form" onSubmit={save}>
      <div className="photo-row">
        <button type="button" className={`photo-drop${photo ? ' has-photo' : ''}`} onClick={() => fileRef.current?.click()}
          disabled={uploading} aria-label="Upload your photo" style={photo ? undefined : { color: form.color }}>
          {photo ? <img src={photo} alt="" /> : <Icon.user width="40" height="40" />}
        </button>
        <div className="photo-copy">
          <span className="settings-label">Your photo</span>
          <div className="photo-actions">
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : photo ? 'Change photo' : 'Upload your photo'}
            </button>
            {photo && !uploading && <button type="button" className="link-btn muted-link" onClick={removePhoto}>Remove</button>}
          </div>
          <span className="muted small">Photos help your teammates recognize you in Kahon.</span>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic" hidden onChange={pickPhoto} />
      </div>

      <div className="settings-grid">
        <label className="label">
          <span>Your full name <span className="required" aria-hidden="true">*</span></span>
          <input className="input" required maxLength={FIELDS.full_name} value={form.full_name} onChange={set('full_name')} autoComplete="name" />
        </label>
        <label className="label">Job title
          <input className="input" maxLength={FIELDS.job_title} value={form.job_title} onChange={set('job_title')} autoComplete="organization-title" />
        </label>
        <label className="label">Department or team
          <input className="input" maxLength={FIELDS.department} value={form.department} onChange={set('department')} />
        </label>
        <label className="label">Email
          <input className="input" value={profile.email || user.email} disabled title="Your sign-in email" />
        </label>
        <label className="label">Location
          <input className="input" maxLength={FIELDS.location} value={form.location} onChange={set('location')} placeholder="City, country" />
        </label>
        <label className="label">Time zone
          <select className="input" value={form.timezone} onChange={set('timezone')}>
            <option value="">Not set</option>
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </div>

      <label className="label">About me
        <textarea className="input textarea" rows={4} maxLength={FIELDS.bio} value={form.bio} onChange={set('bio')}
          placeholder="What you work on, your usual hours, how you like to get tasks…" />
        <span className="hint">{form.bio.length}/{FIELDS.bio}</span>
      </label>

      <fieldset className="label">
        <legend>Avatar color</legend>
        <div className="swatches small">
          {AVATAR_COLORS.map((c) => (
            <button key={c} type="button" className={`swatch-btn${c === form.color ? ' is-on' : ''}`} style={{ background: c }}
              aria-label={`Color ${c}`} aria-pressed={c === form.color} onClick={() => setForm((f) => ({ ...f, color: c }))} />
          ))}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setForm((f) => ({
            ...f, color: AVATAR_COLORS.filter((c) => c !== f.color)[Math.floor(Math.random() * (AVATAR_COLORS.length - 1))],
          }))}>Shuffle</button>
        </div>
      </fieldset>

      <div className="settings-actions">
        <button className="btn btn-primary" disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save changes'}</button>
        {dirty && <button type="button" className="link-btn" onClick={() => setForm(draftFrom(profile))}>Discard</button>}
      </div>
    </form>
  );
}

function draftFrom(p) {
  return {
    loaded: !!p,
    full_name: p?.full_name || '',
    job_title: p?.job_title || '',
    department: p?.department || '',
    location: p?.location || '',
    bio: p?.bio || '',
    timezone: p?.timezone || '',
    color: p?.color || AVATAR_COLORS[0],
  };
}

function NotificationsSection() {
  const { profile, updateProfile } = useAuth();
  const toast = useToast();
  const on = profile?.email_notifications !== false;

  const toggle = async () => {
    const error = await updateProfile({ email_notifications: !on });
    if (error) toast(error.message, 'error');
  };

  return (
    <div className="settings-form">
      <div className="setting-row">
        <div>
          <strong>Email notifications</strong>
          <p className="muted small">
            Emails when you're assigned a task, added to a project, or someone comments on a task you're
            assigned to or created. Never for things you did yourself.
          </p>
        </div>
        <label className="switch-toggle">
          <input type="checkbox" checked={on} onChange={toggle} disabled={!profile} />
          <span aria-hidden="true" />
          <span className="sr-only">Email notifications</span>
        </label>
      </div>
    </div>
  );
}

function DisplaySection() {
  const [theme, setChoice] = useState(getTheme);
  const choose = (value) => {
    setChoice(value);
    setTheme(value);
  };
  const options = [
    { value: 'system', label: 'System', hint: 'Match your device' },
    { value: 'light', label: 'Light', hint: 'Always light' },
    { value: 'dark', label: 'Dark', hint: 'Always dark' },
  ];
  return (
    <div className="settings-form">
      <fieldset className="label">
        <legend>Theme</legend>
        <div className="theme-options" role="radiogroup">
          {options.map((o) => (
            <label key={o.value} className={`theme-option theme-${o.value}${theme === o.value ? ' is-on' : ''}`}>
              <input type="radio" name="theme" value={o.value} checked={theme === o.value} onChange={() => choose(o.value)} />
              <span className="theme-swatch" aria-hidden="true" />
              <strong>{o.label}</strong>
              <span className="muted small">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="muted small">Saved in this browser.</p>
    </div>
  );
}

function AccountSection() {
  return (
    <div className="settings-form account-sections">
      <EmailBlock />
      <PasswordBlock />
      <TwoFactorBlock />
      <SessionsBlock />
      <LeaveBlock />
      <DeleteBlock />
    </div>
  );
}

function Block({ title, description, children }) {
  return (
    <section className="account-block">
      <h3 className="settings-subhead">{title}</h3>
      {description && <p className="muted small">{description}</p>}
      {children}
    </section>
  );
}

function EmailBlock() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const next = email.trim().toLowerCase();
    if (next === user.email) return setError("That's already your email.");
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ email: next }, { emailRedirectTo: window.location.origin });
    setBusy(false);
    if (err) return setError(err.message);
    setSent(next);
    setEditing(false);
    setEmail('');
  };

  return (
    <Block title="Email" description="You sign in with this address, and notification emails go to it. Teammates add you to projects by it.">
      <div className="email-row">
        <span className="email-value">{user?.email}</span>
        <span className="tag tag-soft">Sign-in and notification email</span>
        {!editing && <button type="button" className="link-btn push-right" onClick={() => setEditing(true)}>Change email</button>}
      </div>
      {user?.new_email && !sent && (
        <p className="form-notice">A change to {user.new_email} is waiting for confirmation. Check both inboxes.</p>
      )}
      {sent && (
        <p className="form-notice">
          We sent confirmation links to {user.email} and {sent}. Open both to finish the change; until then you keep signing in with {user.email}.
        </p>
      )}
      {editing && (
        <form className="inline-form" onSubmit={submit}>
          <input className="input" type="email" required autoFocus placeholder="New email address" value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <button className="btn btn-primary" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send confirmation'}</button>
          <button type="button" className="link-btn" onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </Block>
  );
}

function PasswordBlock() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const change = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(err.message);
    setPassword('');
    setConfirm('');
    setOpen(false);
    toast('Password changed');
  };

  return (
    <Block title="Password">
      {!open ? (
        <ActionRow text="Change the password you sign in with" action="Change password" onClick={() => setOpen(true)} />
      ) : (
        <form className="stack" onSubmit={change}>
          <div className="settings-grid">
            <label className="label">New password
              <input className="input" type="password" autoFocus value={password} minLength={8} autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="label">Confirm new password
              <input className="input" type="password" value={confirm} autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)} />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="settings-actions">
            <button className="btn btn-primary" disabled={busy || !password}>{busy ? 'Saving…' : 'Change password'}</button>
            <button type="button" className="link-btn" onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
          </div>
        </form>
      )}
    </Block>
  );
}

function TwoFactorBlock() {
  const toast = useToast();
  const [factor, setFactor] = useState(undefined); // verified TOTP factor, null when off
  const [setup, setSetup] = useState(null); // { id, qr, secret } while enrolling
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactor(data?.totp?.find((f) => f.status === 'verified') ?? null);
  };
  useEffect(() => {
    load();
  }, []);

  const start = async () => {
    setError('');
    setBusy(true);
    // Clear any half-finished setup from before, so the new one doesn't clash with it.
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all ?? []) {
      if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data: enrolled, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${Date.now()}` });
    setBusy(false);
    if (err) return setError(err.message);
    setSetup({ id: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
  };

  const confirmSetup = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: setup.id, code: code.trim() });
    setBusy(false);
    if (err) return setError(err.message.includes('Invalid') ? "That code didn't work. Check your app and try again." : err.message);
    setSetup(null);
    setCode('');
    await load();
    toast('Two-factor authentication is on');
  };

  const cancelSetup = async () => {
    if (setup) await supabase.auth.mfa.unenroll({ factorId: setup.id });
    setSetup(null);
    setCode('');
    setError('');
  };

  const turnOff = async () => {
    const ok = await confirmDialog({
      title: 'Turn off two-factor authentication?',
      text: 'You will sign in with just your password, which makes your account easier to break into.',
      confirmText: 'Turn off',
      danger: true,
    });
    if (!ok) return;
    const { error: err } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (err) return toast(err.message, 'error');
    await supabase.auth.refreshSession();
    await load();
    toast('Two-factor authentication is off');
  };

  return (
    <Block title="Two-factor authentication"
      description="Ask for a code from an authenticator app (Google Authenticator, 1Password, Authy…) whenever you sign in.">
      {factor === undefined && <p className="muted small">Checking…</p>}
      {factor && (
        <div className="info-box is-on">
          <Icon.check2 />
          <span className="grow">Two-factor authentication is on.</span>
          <button type="button" className="link-btn" onClick={turnOff}>Turn off</button>
        </div>
      )}
      {factor === null && !setup && (
        <div className="info-box">
          <Icon.info />
          <span className="grow">Two-factor authentication is off.</span>
          <button type="button" className="btn btn-primary btn-small" onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Set up'}</button>
        </div>
      )}
      {setup && (
        <form className="mfa-setup" onSubmit={confirmSetup}>
          <img className="mfa-qr" src={setup.qr} alt="QR code for your authenticator app" />
          <div className="stack">
            <ol className="mfa-steps">
              <li>Scan the QR code with your authenticator app.</li>
              <li>Can't scan it? Enter this key instead: <code className="mfa-secret">{setup.secret}</code></li>
              <li>Type the 6-digit code the app shows.</li>
            </ol>
            <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required
              placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="6-digit code" />
            <div className="settings-actions">
              <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Turn on'}</button>
              <button type="button" className="link-btn" onClick={cancelSetup}>Cancel</button>
            </div>
          </div>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </Block>
  );
}

function SessionsBlock() {
  const toast = useToast();
  const signOutOthers = async () => {
    const ok = await confirmDialog({
      title: 'Log out other sessions?',
      text: 'You will stay signed in here. Every other browser and device will need to sign in again.',
      confirmText: 'Log out others',
    });
    if (!ok) return;
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    toast(error ? error.message : 'Logged out of all other sessions', error ? 'error' : undefined);
  };
  return (
    <Block title="Security">
      <ActionRow text="Log out of all sessions except this current browser" action="Log out other sessions" onClick={signOutOthers} />
    </Block>
  );
}

function LeaveBlock() {
  const toast = useToast();
  const navigate = useNavigate();
  const { refreshProjects } = useWorkspace();
  const leave = async () => {
    const ok = await confirmDialog({
      title: 'Leave all projects?',
      text: "You will lose access to every project you're in. Owners can add you back later. Your account stays.",
      confirmText: 'Leave all projects',
      danger: true,
    });
    if (!ok) return;
    const { data, error } = await supabase.rpc('leave_all_projects');
    if (error) return toast(error.message, 'error');
    await refreshProjects();
    navigate('/');
    toast(`Left ${data} project${data === 1 ? '' : 's'}`);
  };
  return (
    <Block title="Deactivation">
      <ActionRow text="Remove your access to every project in Kahon" action="Leave all projects" onClick={leave} />
    </Block>
  );
}

function DeleteBlock() {
  const toast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Delete your account?',
      text: `This permanently deletes ${user.email}: your profile, photo, comments and uploaded files. Projects only you are in are deleted too. Projects you created with co-owners pass to them. This cannot be undone.`,
      confirmText: 'Delete my account',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    setBusy(false);
    if (error) {
      let message = error.message;
      try {
        message = (await error.context.json()).error || message;
      } catch { /* keep the generic message */ }
      return toast(message, 'error');
    }
    if (data?.deleted) {
      await supabase.auth.signOut({ scope: 'local' });
      window.location.assign('/');
    }
  };

  return (
    <Block title="Deletion">
      <ActionRow text="Deleting your account is a permanent action and cannot be undone" action={busy ? 'Deleting…' : 'Delete my account'}
        onClick={remove} danger disabled={busy} />
    </Block>
  );
}

function ActionRow({ text, action, onClick, danger, disabled }) {
  return (
    <div className="action-row">
      <span className="muted">{text}</span>
      <button type="button" className={`action-link${danger ? ' is-danger' : ''}`} onClick={onClick} disabled={disabled}>
        {action} <Icon.chevron width="16" height="16" />
      </button>
    </div>
  );
}
