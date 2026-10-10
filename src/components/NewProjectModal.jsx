import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PROJECT_COLORS } from '../lib/constants';
import { useWorkspace } from '../context/WorkspaceContext';
import { Modal } from './ui';

export default function NewProjectModal({ onClose }) {
  const navigate = useNavigate();
  const { current, refreshProjects } = useWorkspace();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const { data, error: err } = await supabase.rpc('create_project', { p_workspace: current?.id, p_name: name.trim(), p_color: color });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    await refreshProjects();
    onClose();
    navigate(`/p/${data}`);
  };

  return (
    <Modal title={current ? `New project in ${current.name}` : 'New project'} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label className="label">
          Project name
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Website relaunch" maxLength={120} />
        </label>
        <fieldset className="label">
          <legend>Color</legend>
          <div className="swatches">
            {PROJECT_COLORS.map((c) => (
              <button type="button" key={c} className={`swatch-btn${c === color ? ' is-on' : ''}`} style={{ background: c }}
                onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={c === color} />
            ))}
          </div>
        </fieldset>
        <p className="muted small">New projects start with three sections: To do, In progress and Done. You can rename them anytime.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
}
