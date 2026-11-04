import { useEffect, useRef, useState } from 'react';
import { dueTone, formatCreatedShort, formatDue } from '../lib/dates';
import { PRIORITIES } from '../lib/constants';
import { avatarUrl } from '../lib/profiles';

const svg = (d, extra = {}) => (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...extra} {...props}>{d}</svg>
);

export const Icon = {
  plus: svg(<path d="M12 5v14M5 12h14" />),
  home: svg(<path d="M4 11l8-6.5 8 6.5M6 9.5V20h4.5v-5.5h3V20H18V9.5" />),
  x: svg(<path d="M6 6l12 12M18 6L6 18" />),
  list: svg(<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />),
  board: svg(<><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="11" rx="1.5" /><rect x="17" y="4" width="4" height="7" rx="1.5" /></>),
  users: svg(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.6 3 5.2" /></>),
  trash: svg(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />),
  chevron: svg(<path d="M9 6l6 6-6 6" />),
  inbox: svg(<><path d="M4 13l2.5-8h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" /></>),
  logout: svg(<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />),
  menu: svg(<path d="M4 7h16M4 12h16M4 17h16" />),
  more: svg(<><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></>),
  subtasks: svg(<path d="M6 4v9a3 3 0 0 0 3 3h9M14 12l4 4-4 4" />),
  grip: svg(<><circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" /></>),
  bell: svg(<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />),
  bellOff: svg(<path d="M8.5 5.6A6 6 0 0 1 18 11v4M6 11v5l-1.5 2H17M10 20.5a2 2 0 0 0 4 0M3 3l18 18" />),
  search: svg(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>),
  filter: svg(<path d="M4 6h16M7 12h10M10 18h4" />),
  tag: svg(<><path d="M3 12V4h8l9.5 9.5a2 2 0 0 1 0 2.8l-5.2 5.2a2 2 0 0 1-2.8 0z" /><circle cx="7.5" cy="8.5" r="1.3" /></>),
  repeat: svg(<path d="M17 2l3 3-3 3M20 5H8a4 4 0 0 0-4 4v1M7 22l-3-3 3-3M4 19h12a4 4 0 0 0 4-4v-1" />),
  copy: svg(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
  move: svg(<path d="M5 12h14M13 6l6 6-6 6" />),
  archive: svg(<><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></>),
  calendar: svg(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  edit: svg(<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />),
  history: svg(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>),
  user: svg(<><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c.9-4 3.8-6 7.5-6s6.6 2 7.5 6" /></>),
  settings: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  link: svg(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />),
  check: svg(<path d="M5 12.5l4.5 4.5L19 7" />),
  check2: svg(<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.8" /></>),
  info: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
  sparkle: svg(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />),
  download: svg(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />),
  paperclip: svg(<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />),
  image: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-9 9" /></>),
  comment: svg(<path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />),
  clock: svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  play: svg(<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />),
  stop: svg(<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />),
  reply: svg(<path d="M10 8L5 12.5 10 17M5.5 12.5H14a5 5 0 0 1 5 5V19" />),
  pin: svg(<path d="M9 4h6M10 4v5.5L7 13h10l-3-3.5V4M12 13v7" />),
  smile: svg(<><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14.2c.9 1.3 2.1 1.9 3.5 1.9s2.6-.6 3.5-1.9M9 9.8h.01M15 9.8h.01" /></>),
  smilePlus: svg(<><path d="M20.4 11a8.5 8.5 0 1 1-7.4-7.4" /><path d="M8.5 14.2c.9 1.3 2.1 1.9 3.5 1.9s2.6-.6 3.5-1.9M9 9.8h.01M15 9.8h.01M18.5 2.5v5M16 5h5" /></>),
  at: svg(<><circle cx="12" cy="12" r="3.6" /><path d="M15.6 8.5v4.8a2.4 2.4 0 0 0 4.8 0V12a8.4 8.4 0 1 0-3.3 6.7" /></>),
  quote: svg(<path d="M5 5v14M9.5 7H20M9.5 12H20M9.5 17h7" />),
  code: svg(<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" />),
  highlight: svg(<path d="M14.5 4.5l5 5L11 18l-5 1 1-5zM12.5 6.5l5 5M4 21h7" />),
  table: svg(<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M9.5 9.5v10" /></>),
  divider: svg(<path d="M4 12h16M7 7h10M7 17h10" strokeOpacity="1" />),
  codeBlock: svg(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M10 10l-2.2 2.2L10 14.4M14 10l2.2 2.2-2.2 2.2" /></>),
  numbered: svg(<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M4 14.2c0-.8.6-1.2 1.3-1.2s1.2.5 1.2 1.1c0 1.2-2.5 1.9-2.5 3.4h2.6" />),
};

// Brand mark: an isometric box with a lit top. Below 44px the shaded face is dropped.
const MARK_BODY = 'M60 14 L104 39.4 L104 81.4 L60 106.8 L16 81.4 L16 39.4 Z';
const MARK_SHADE = 'M60 64.8 L60 106.8 L16 81.4 L16 39.4 Z';
const MARK_TOP = 'M60 14 L104 39.4 L60 64.8 L16 39.4 Z';
const WORDMARK = 'M4.09 0.00V-46.19H13.70V-23.06L11.04 -23.99L29.51 -46.19H41.54L23.25 -24.12L23.81 -30.94L41.91 0.00H30.69L19.41 -19.53L13.70 -12.65V0.00ZM54.62 0.74Q50.96 0.74 48.30 -0.43Q45.63 -1.61 44.21 -3.81Q42.78 -6.01 42.78 -9.05Q42.78 -11.90 44.08 -14.11Q45.38 -16.31 48.08 -17.79Q50.78 -19.28 54.81 -19.90L65.16 -21.58V-14.76L56.48 -13.21Q54.50 -12.83 53.44 -11.93Q52.39 -11.04 52.39 -9.36Q52.39 -7.81 53.57 -6.94Q54.75 -6.08 56.48 -6.08Q58.78 -6.08 60.51 -7.07Q62.25 -8.06 63.21 -9.77Q64.17 -11.47 64.17 -13.52V-22.32Q64.17 -24.24 62.65 -25.54Q61.13 -26.85 58.53 -26.85Q56.05 -26.85 54.16 -25.48Q52.27 -24.12 51.40 -21.89L43.96 -25.42Q44.95 -28.27 47.12 -30.32Q49.29 -32.36 52.33 -33.48Q55.37 -34.60 58.96 -34.60Q63.24 -34.60 66.53 -33.05Q69.81 -31.50 71.64 -28.74Q73.47 -25.98 73.47 -22.32V0.00H64.79V-5.46L66.90 -5.83Q65.41 -3.60 63.61 -2.14Q61.81 -0.68 59.58 0.03Q57.35 0.74 54.62 0.74ZM78.43 0.00V-46.93H87.73V-27.16L86.61 -28.64Q87.79 -31.68 90.43 -33.14Q93.06 -34.60 96.60 -34.60Q100.44 -34.60 103.32 -32.98Q106.21 -31.37 107.82 -28.49Q109.43 -25.61 109.43 -21.76V0.00H100.13V-19.78Q100.13 -21.76 99.35 -23.19Q98.58 -24.61 97.19 -25.42Q95.79 -26.23 93.93 -26.23Q92.13 -26.23 90.71 -25.42Q89.28 -24.61 88.50 -23.19Q87.73 -21.76 87.73 -19.78V0.00ZM130.51 0.74Q125.49 0.74 121.37 -1.55Q117.24 -3.84 114.79 -7.84Q112.34 -11.84 112.34 -16.93Q112.34 -22.07 114.79 -26.04Q117.24 -30.01 121.37 -32.30Q125.49 -34.60 130.51 -34.60Q135.53 -34.60 139.62 -32.30Q143.72 -30.01 146.17 -26.04Q148.61 -22.07 148.61 -16.93Q148.61 -11.84 146.17 -7.84Q143.72 -3.84 139.62 -1.55Q135.53 0.74 130.51 0.74ZM130.51 -7.63Q133.05 -7.63 134.94 -8.80Q136.83 -9.98 137.92 -12.09Q139.00 -14.20 139.00 -16.93Q139.00 -19.65 137.92 -21.73Q136.83 -23.81 134.94 -25.02Q133.05 -26.23 130.51 -26.23Q127.97 -26.23 126.05 -25.02Q124.12 -23.81 123.04 -21.73Q121.95 -19.65 121.95 -16.93Q121.95 -14.20 123.04 -12.09Q124.12 -9.98 126.05 -8.80Q127.97 -7.63 130.51 -7.63ZM152.21 0.00V-33.85H160.89V-27.16L160.39 -28.64Q161.57 -31.68 164.21 -33.14Q166.84 -34.60 170.38 -34.60Q174.22 -34.60 177.10 -32.98Q179.99 -31.37 181.60 -28.49Q183.21 -25.61 183.21 -21.76V0.00H173.91V-19.78Q173.91 -21.76 173.14 -23.19Q172.36 -24.61 170.97 -25.42Q169.57 -26.23 167.71 -26.23Q165.91 -26.23 164.49 -25.42Q163.06 -24.61 162.29 -23.19Q161.51 -21.76 161.51 -19.78V0.00Z';

const MarkPaths = ({ small }) => (
  <>
    <path d={MARK_BODY} fill="var(--mark-body)" />
    {!small && <path d={MARK_SHADE} fill="var(--mark-shade)" />}
    <path d={MARK_TOP} fill="var(--mark-top)" />
  </>
);

export function Logo({ size = 26 }) {
  return (
    <svg className="logo" viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
      <MarkPaths small={size < 44} />
    </svg>
  );
}

// Mark and wordmark, with the box centred on the letters' cap height.
export function Lockup({ height = 28 }) {
  return (
    <svg className="logo" viewBox="0 0 254.98 60" height={height} width={height * 254.98 / 60} role="img" aria-label="Kahon">
      <g transform="translate(-10 -7.65) scale(0.625)"><MarkPaths small={height < 44} /></g>
      <path transform="translate(70.9 53.21)" d={WORDMARK} fill="var(--wordmark)" />
    </svg>
  );
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ profile, size = 26, title }) {
  if (!profile) {
    return <span className="avatar avatar-empty" style={{ width: size, height: size }} title={title || 'Unassigned'} />;
  }
  const photo = avatarUrl(profile.avatar_path);
  return (
    <span className="avatar" title={title || profile.full_name}
      style={{ width: size, height: size, background: profile.color, fontSize: size * 0.4 }}>
      {photo ? <img src={photo} alt="" loading="lazy" /> : initials(profile.full_name || profile.email)}
    </span>
  );
}

// The square checkbox: completing a task "closes the box".
export function Check({ checked, onChange, label, disabled, decorative = false }) {
  // Inside another button (Mark complete), only the look: a button can't hold a button.
  if (decorative) {
    return (
      <span className={`check${checked ? ' is-done' : ''}${disabled ? ' is-disabled' : ''}`} aria-hidden="true">
        <span className="check-lid" />
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      className={`check${checked ? ' is-done' : ''}`}
      aria-pressed={checked}
      aria-label={label || (checked ? 'Mark incomplete' : 'Mark complete')}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="check-lid" />
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
    </button>
  );
}

export function PriorityTag({ value }) {
  if (!value) return null;
  const label = PRIORITIES.find((p) => p.value === value)?.label;
  return <span className={`tag tag-${value}`}>{label}</span>;
}

export function DueLabel({ value, completed }) {
  if (!value) return null;
  return <span className={`due ${dueTone(value, completed)}`}>{formatDue(value)}</span>;
}

export function CreatedLabel({ value, prefix = '' }) {
  if (!value) return null;
  return <span className="created" title={`Created ${new Date(value).toLocaleString()}`}>{prefix}{formatCreatedShort(value)}</span>;
}

export function Modal({ title, onClose, children, width = 440 }) {
  const ref = useRef(null);
  useEffect(() => {
    // With modals stacked (a profile opened from the members list), Escape closes the top one only.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const backdrops = document.querySelectorAll('.modal-backdrop');
      if (backdrops[backdrops.length - 1] === ref.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div ref={ref} className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon.x /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Text that becomes an input when clicked. Saves on Enter or blur.
export function EditableText({ value, onSave, className = '', placeholder, disabled, as: Tag = 'span' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };

  if (disabled) return <Tag className={className}>{value}</Tag>;
  if (!editing) {
    return (
      <Tag className={`${className} editable`} tabIndex={0} role="button" title="Click to rename"
        onClick={() => setEditing(true)}
        onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}>
        {value || placeholder}
      </Tag>
    );
  }
  return (
    <input
      ref={inputRef}
      className={`${className} editable-input`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      aria-label={placeholder || 'Name'}
    />
  );
}

// "Add task" control that turns into an input and stays open for fast entry.
export function InlineAdd({ label, placeholder, onAdd, className = '' }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const submit = async () => {
    const title = text.trim();
    if (!title) {
      setOpen(false);
      return;
    }
    setText('');
    await onAdd(title);
  };

  if (!open) {
    return (
      <button type="button" className={`inline-add ${className}`} onClick={() => setOpen(true)}>
        <Icon.plus width="16" height="16" /> {label}
      </button>
    );
  }
  return (
    <div className={`inline-add-form ${className}`}>
      <input
        autoFocus
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => !text.trim() && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setText('');
            setOpen(false);
          }
        }}
        aria-label={placeholder}
      />
      <span className="hint">Enter to add, Esc to close</span>
    </div>
  );
}

export function AssigneeSelect({ value, members, onChange, compact, disabled }) {
  return (
    <label className={`field-select${compact ? ' compact' : ''}`} onClick={(e) => e.stopPropagation()}>
      <Avatar profile={members.find((m) => m.user_id === value)?.profile} size={22} />
      {!compact && <span className="truncate">{members.find((m) => m.user_id === value)?.profile?.full_name || 'Unassigned'}</span>}
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Assignee" disabled={disabled}>
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || m.profile?.email}</option>
        ))}
      </select>
    </label>
  );
}

export function PrioritySelect({ value, onChange, disabled }) {
  return (
    <label className="field-select" onClick={(e) => e.stopPropagation()}>
      {value ? <PriorityTag value={value} /> : <span className="muted">None</span>}
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Priority" disabled={disabled}>
        <option value="">None</option>
        {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
    </label>
  );
}

export function DueInput({ value, completed, onChange, disabled }) {
  return (
    <label className="field-select" onClick={(e) => e.stopPropagation()}>
      {value ? <DueLabel value={value} completed={completed} /> : <span className="muted">No date</span>}
      <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Due date" disabled={disabled} />
    </label>
  );
}
