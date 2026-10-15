import { useState } from 'react';
import { confirmDialog } from '../lib/dialog';
import { Modal } from './ui';

const tasksLabel = (n) => `${n} task${n === 1 ? '' : 's'}`;

// Deleting a section. An empty one just asks to confirm. One with tasks asks where to move
// them, and only deletes the tasks after a second, explicit confirmation.
export function useDeleteSection(sections, actions) {
  const [target, setTarget] = useState(null); // { section, count }

  const ask = async (section) => {
    const count = actions.sectionTaskCount(section.id);
    if (count) {
      setTarget({ section, count });
      return;
    }
    const ok = await confirmDialog({ title: `Delete "${section.name}"?`, text: 'It has no tasks.', confirmText: 'Delete section', danger: true });
    if (ok) actions.deleteSection(section.id);
  };

  const dialog = target && (
    <DeleteSectionDialog section={target.section} count={target.count}
      others={sections.filter((s) => s.id !== target.section.id)}
      onClose={() => setTarget(null)}
      onMove={(to) => {
        setTarget(null);
        actions.deleteSection(target.section.id, to);
      }}
      onDelete={() => {
        setTarget(null);
        actions.deleteSection(target.section.id);
      }} />
  );

  return { ask, dialog };
}

function DeleteSectionDialog({ section, count, others, onClose, onMove, onDelete }) {
  const [to, setTo] = useState(others[0]?.id || '');
  const [confirming, setConfirming] = useState(false);

  const deleteAll = async () => {
    setConfirming(true); // hide this dialog while the second confirmation is open
    const ok = await confirmDialog({
      title: `Delete "${section.name}" and its ${tasksLabel(count)}?`,
      text: "The tasks, their subtasks, comments and attached files are deleted for everyone. This can't be undone.",
      confirmText: `Delete ${tasksLabel(count)}`,
      danger: true,
    });
    setConfirming(false);
    if (ok) onDelete();
  };

  if (confirming) return null;

  return (
    <Modal title={`Delete "${section.name}"?`} onClose={onClose}>
      <form className="settings-form" onSubmit={(e) => { e.preventDefault(); if (to) onMove(to); }}>
        {others.length ? (
          <>
            <p className="muted">It has {tasksLabel(count)}. Move them to another section so they're kept.</p>
            <label className="label">Move tasks to
              <select className="input" value={to} onChange={(e) => setTo(e.target.value)} autoFocus>
                {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </>
        ) : (
          <p className="muted">
            It has {tasksLabel(count)} and it's the only section, so there's nowhere to move them.
            Add another section first to keep them.
          </p>
        )}
        <div className="settings-actions delete-section-actions">
          <button type="button" className="btn btn-ghost danger-text" onClick={deleteAll}>
            Delete the tasks too
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {others.length > 0 && <button type="submit" className="btn btn-primary">Move tasks and delete</button>}
        </div>
      </form>
    </Modal>
  );
}
