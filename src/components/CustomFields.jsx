import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { AssigneeSelect } from './ui';

// The task panel's custom field rows (a <dt>/<dd> pair each, inside the fields list): the
// project's fields and this task's values, edited in place. See FieldsModal for the fields.

export default function CustomFields({ task, members, editable }) {
  const toast = useToast();
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [f, v] = await Promise.all([
        supabase.from('project_fields').select('*').eq('project_id', task.project_id).order('position').order('created_at'),
        supabase.from('task_field_values').select('field_id, value').eq('task_id', task.id),
      ]);
      if (!alive) return;
      setFields(f.data || []);
      setValues(Object.fromEntries((v.data || []).map((r) => [r.field_id, r.value])));
    };
    load();
    const channel = supabase
      .channel(`fields-${task.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_field_values', filter: `task_id=eq.${task.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_fields', filter: `project_id=eq.${task.project_id}` }, load)
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [task.id, task.project_id]);

  const save = async (field, value) => {
    const empty = value === null || value === '' || (Array.isArray(value) && !value.length);
    const before = values[field.id];
    setValues((all) => {
      const next = { ...all };
      if (empty) delete next[field.id];
      else next[field.id] = value;
      return next;
    });
    const { error } = empty
      ? await supabase.from('task_field_values').delete().eq('task_id', task.id).eq('field_id', field.id)
      : await supabase.from('task_field_values').upsert({ task_id: task.id, field_id: field.id, value });
    if (error) {
      setValues((all) => ({ ...all, [field.id]: before }));
      toast(error.message, 'error');
    }
  };

  return fields.map((field) => (
    <FieldRow key={field.id} field={field} value={values[field.id]} members={members} editable={editable} onSave={(v) => save(field, v)} />
  ));
}

function FieldRow({ field, value, members, editable, onSave }) {
  return (
    <>
      <dt title={field.name}>{field.name}</dt>
      <dd><FieldInput field={field} value={value} members={members} disabled={!editable} onSave={onSave} /></dd>
    </>
  );
}

function FieldInput({ field, value, members, disabled, onSave }) {
  const options = field.options ?? [];
  switch (field.type) {
    case 'select': {
      const chosen = options.find((o) => o.id === value);
      return (
        <label className="field-select">
          {chosen ? <span className="label-chip is-on" style={{ '--chip': chosen.color }}>{chosen.name}</span> : <span className="muted">{disabled ? 'None' : 'Choose'}</span>}
          <select value={value ?? ''} disabled={disabled} onChange={(e) => onSave(e.target.value || null)} aria-label={field.name}>
            <option value="">None</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      );
    }
    case 'multi_select':
      return <MultiSelect field={field} value={Array.isArray(value) ? value : []} disabled={disabled} onSave={onSave} />;
    case 'person':
      return <AssigneeSelect value={value ?? null} members={members} onChange={(v) => onSave(v || null)} disabled={disabled} label={field.name} emptyText="Nobody" />;
    case 'date':
      return <input className="input field-input" type="date" value={value ?? ''} disabled={disabled} onChange={(e) => onSave(e.target.value || null)} aria-label={field.name} />;
    case 'number':
    case 'text':
      return <TextInput field={field} value={value} disabled={disabled} onSave={onSave} />;
    default:
      return null;
  }
}

// Text and numbers save when you leave the box (or press Enter).
function TextInput({ field, value, disabled, onSave }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => {
    if (field.type === 'number') {
      const n = draft === '' ? null : Number(draft);
      if (n !== null && Number.isNaN(n)) return setDraft(value ?? '');
      if (n !== (value ?? null)) onSave(n);
    } else if (draft.trim() !== (value ?? '')) {
      onSave(draft.trim().slice(0, 500) || null);
    }
    return undefined;
  };
  return (
    <input className="input field-input" type={field.type === 'number' ? 'number' : 'text'} value={draft} disabled={disabled}
      placeholder={disabled ? '' : field.type === 'number' ? 'Add a number' : 'Add text'} aria-label={field.name}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
  );
}

function MultiSelect({ field, value, disabled, onSave }) {
  const [open, setOpen] = useState(false);
  const options = field.options ?? [];
  const chosen = options.filter((o) => value.includes(o.id));
  const toggle = (id) => onSave(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="menu-wrap">
      <button type="button" className="field-select chip-field" onClick={() => setOpen((o) => !o)} disabled={disabled} aria-expanded={open}>
        {chosen.length
          ? chosen.map((o) => <span key={o.id} className="label-chip is-on" style={{ '--chip': o.color }}>{o.name}</span>)
          : <span className="muted">{disabled ? 'None' : 'Choose'}</span>}
      </button>
      {open && (
        <div className="menu picker-menu" onMouseLeave={() => setOpen(false)}>
          {options.length === 0 && <p className="muted small">No options yet. Add them from the project's ⋯ menu → Custom fields.</p>}
          {options.map((o) => (
            <label key={o.id} className="picker-row">
              <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
              <span className="label-chip is-on" style={{ '--chip': o.color }}>{o.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
