import { useState } from 'react';
import { AVATAR_COLORS } from '../lib/profiles';
import { confirmDialog } from '../lib/dialog';
import { EditableText, Icon, Modal } from './ui';

// A project's labels: create, rename, recolor and delete. Any member can manage them.
export default function LabelsModal({ labels, taskLabels, actions, onClose }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(AVATAR_COLORS[2]);
  const uses = (id) => taskLabels.filter((tl) => tl.label_id === id).length;

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await actions.createLabel(name, color)) {
      setName('');
      setColor(AVATAR_COLORS[(AVATAR_COLORS.indexOf(color) + 1) % AVATAR_COLORS.length]);
    }
  };

  const remove = async (label) => {
    const n = uses(label.id);
    const ok = await confirmDialog({
      title: `Delete the "${label.name}" label?`,
      text: n ? `It's removed from ${n} task${n === 1 ? '' : 's'}. The tasks themselves stay.` : 'No tasks use it.',
      confirmText: 'Delete label',
      danger: true,
    });
    if (ok) actions.deleteLabel(label.id);
  };

  return (
    <Modal title="Labels" onClose={onClose} width={520}>
      <form className="label-create" onSubmit={create}>
        <input className="input" placeholder="New label, e.g. Bug, Design, Client" maxLength={40} value={name}
          onChange={(e) => setName(e.target.value)} aria-label="Label name" />
        <ColorPick value={color} onChange={setColor} />
        <button className="btn btn-primary" disabled={!name.trim()}>Add</button>
      </form>
      {labels.length === 0 && <p className="muted small">No labels yet. Labels help you sort and filter tasks.</p>}
      <ul className="label-list">
        {labels.map((l) => (
          <li key={l.id}>
            <ColorPick value={l.color} onChange={(c) => actions.updateLabel(l.id, { color: c })} />
            <EditableText value={l.name} onSave={(v) => actions.updateLabel(l.id, { name: v.slice(0, 40) })} placeholder="Label name" />
            <span className="muted small">{uses(l.id)} task{uses(l.id) === 1 ? '' : 's'}</span>
            <button type="button" className="icon-btn" onClick={() => remove(l)} aria-label={`Delete ${l.name}`} title="Delete"><Icon.trash /></button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ColorPick({ value, onChange }) {
  return (
    <label className="color-pick" title="Color" style={{ background: value }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Label color">
        {AVATAR_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
}

// Small colored chips for a task's labels (cards, rows, the task panel).
export function LabelChips({ ids, labels, max = 3 }) {
  if (!ids?.length) return null;
  const list = ids.map((id) => labels.find((l) => l.id === id)).filter(Boolean);
  return (
    <span className="label-chips">
      {list.slice(0, max).map((l) => <span key={l.id} className="label-chip is-on" style={{ '--chip': l.color }}>{l.name}</span>)}
      {list.length > max && <span className="label-chip more">+{list.length - max}</span>}
    </span>
  );
}
