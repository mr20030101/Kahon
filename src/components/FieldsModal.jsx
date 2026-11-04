import { useState } from 'react';
import { AVATAR_COLORS } from '../lib/profiles';
import { confirmDialog } from '../lib/dialog';
import { EditableText, Icon, Modal } from './ui';

// A project's custom fields: add, rename and delete them, and edit a select field's options.
// Editors and project admins. See supabase/migrations/20261104_custom_fields.sql.

export const FIELD_TYPES = [
  ['select', 'Single select', 'One option from a list, like Task type'],
  ['multi_select', 'Multi-select', 'Any options from a list, like Sites'],
  ['person', 'Person', 'Someone in the project, like Reporter'],
  ['text', 'Text', 'A short note, like a client reference'],
  ['number', 'Number', 'Like an estimate in hours'],
  ['date', 'Date', 'Like a start date'],
];
export const typeName = (type) => FIELD_TYPES.find(([t]) => t === type)?.[1] ?? type;
const hasOptions = (type) => type === 'select' || type === 'multi_select';
const optionId = () => Math.random().toString(36).slice(2, 10);

export default function FieldsModal({ fields, fieldValues, actions, onClose }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('select');
  const uses = (id) => fieldValues.filter((v) => v.field_id === id).length;

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await actions.createField({ name: name.slice(0, 40), type })) setName('');
  };

  const remove = async (field) => {
    const n = uses(field.id);
    const ok = await confirmDialog({
      title: `Delete the "${field.name}" field?`,
      text: n ? `Its value on ${n} task${n === 1 ? '' : 's'} is deleted too. The tasks themselves stay.` : 'No tasks have a value for it.',
      confirmText: 'Delete field',
      danger: true,
    });
    if (ok) actions.deleteField(field.id);
  };

  return (
    <Modal title="Custom fields" onClose={onClose} width={580}>
      <p className="muted small">Fields every task in this project can have, shown in the task panel and usable as filters.</p>
      <form className="field-create" onSubmit={create}>
        <input className="input" placeholder="New field, e.g. Task type, Reporter, Site" maxLength={40} value={name}
          onChange={(e) => setName(e.target.value)} aria-label="Field name" />
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Field type">
          {FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className="btn btn-primary" disabled={!name.trim()}>Add</button>
      </form>
      <p className="hint">{FIELD_TYPES.find(([t]) => t === type)?.[2]}</p>

      {fields.length === 0 && <p className="muted small">No custom fields yet.</p>}
      <ul className="field-list">
        {fields.map((f) => (
          <li key={f.id}>
            <div className="field-row">
              <EditableText value={f.name} onSave={(v) => v.trim() && actions.updateField(f.id, { name: v.trim().slice(0, 40) })} placeholder="Field name" />
              <span className="field-type">{typeName(f.type)}</span>
              <span className="muted small">{uses(f.id)} task{uses(f.id) === 1 ? '' : 's'}</span>
              <button type="button" className="icon-btn" onClick={() => remove(f)} aria-label={`Delete ${f.name}`} title="Delete"><Icon.trash /></button>
            </div>
            {hasOptions(f.type) && <Options field={f} onChange={(options) => actions.updateField(f.id, { options })} />}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// A select field's options: add, rename, recolor and remove.
function Options({ field, onChange }) {
  const [name, setName] = useState('');
  const options = field.options ?? [];
  const add = (e) => {
    e.preventDefault();
    const n = name.trim().slice(0, 40);
    if (!n) return;
    if (options.some((o) => o.name.toLowerCase() === n.toLowerCase())) return;
    onChange([...options, { id: optionId(), name: n, color: AVATAR_COLORS[options.length % AVATAR_COLORS.length] }]);
    setName('');
  };
  const update = (id, patch) => onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  return (
    <div className="field-options">
      {options.map((o) => (
        <span key={o.id} className="field-option" style={{ '--chip': o.color }}>
          <label className="color-pick" title="Color" style={{ background: o.color }}>
            <select value={o.color} onChange={(e) => update(o.id, { color: e.target.value })} aria-label={`${o.name} color`}>
              {AVATAR_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <EditableText value={o.name} onSave={(v) => v.trim() && update(o.id, { name: v.trim().slice(0, 40) })} placeholder="Option" />
          <button type="button" className="icon-btn" onClick={() => onChange(options.filter((x) => x.id !== o.id))}
            aria-label={`Remove ${o.name}`} title="Remove option"><Icon.x width="14" height="14" /></button>
        </span>
      ))}
      <form onSubmit={add} className="field-option-add">
        <input className="input" placeholder="Add an option" maxLength={40} value={name} onChange={(e) => setName(e.target.value)}
          aria-label={`New ${field.name} option`} />
      </form>
    </div>
  );
}

/** Chips for a task's select and multi-select values (cards and list rows). */
export function FieldChips({ fields, values, max = 3 }) {
  if (!values || !fields?.length) return null;
  const chips = [];
  for (const f of fields) {
    if (!hasOptions(f.type)) continue;
    const v = values.get(f.id);
    const ids = Array.isArray(v) ? v : v ? [v] : [];
    for (const id of ids) {
      const o = f.options?.find((x) => x.id === id);
      if (o) chips.push({ key: `${f.id}:${o.id}`, name: o.name, color: o.color, title: `${f.name}: ${o.name}` });
    }
  }
  if (!chips.length) return null;
  return (
    <span className="label-chips">
      {chips.slice(0, max).map((c) => <span key={c.key} className="label-chip is-on" style={{ '--chip': c.color }} title={c.title}>{c.name}</span>)}
      {chips.length > max && <span className="label-chip more">+{chips.length - max}</span>}
    </span>
  );
}
