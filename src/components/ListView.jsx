import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, MeasuringStrategy, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { byPosition } from '../lib/position';
import { flash, lift, settle } from '../lib/motion';
import { columnDndId, dropPosition, sectionDndId, taskDrop, typedCollisions, useDndSensors } from '../lib/dnd';
import { AssigneeSelect, Avatar, Check, DueInput, EditableText, Icon, InlineAdd, PrioritySelect } from './ui';
import { confirmDialog } from '../lib/dialog';
import { LabelChips } from './LabelsModal';

export function subtaskCounts(tasks) {
  const counts = {};
  for (const t of tasks) {
    if (!t.parent_id) continue;
    counts[t.parent_id] ??= { done: 0, total: 0 };
    counts[t.parent_id].total += 1;
    if (t.completed) counts[t.parent_id].done += 1;
  }
  return counts;
}

const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };

// Selection (for bulk actions) and per-task labels/assignees, shared with the rows.
const ListContext = createContext({ selected: new Set(), toggle: () => {}, deco: {}, readOnly: false });

export default function ListView({ sections, tasks, members, hideCompleted, actions, onOpen, labels = [], labelsByTask, extrasByTask, readOnly }) {
  const [active, setActive] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const toggle = useCallback((id) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);
  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m.profile])), [members]);
  const ctx = useMemo(() => ({ selected, toggle, readOnly, deco: { labels, labelsByTask, extrasByTask, memberById } }),
    [selected, toggle, readOnly, labels, labelsByTask, extrasByTask, memberById]);
  const listRef = useRef(null);
  const counts = useMemo(() => subtaskCounts(tasks), [tasks]);
  const top = tasks.filter((t) => !t.parent_id && !(hideCompleted && t.completed));
  const sensors = useDndSensors();

  const sectionTasks = (sectionId) => top.filter((t) => t.section_id === sectionId).sort(byPosition);

  const onDragEnd = ({ active: drag, over }) => {
    setActive(null);
    if (!over || drag.id === over.id) return;

    if (drag.data.current?.type === 'section') {
      const id = drag.data.current.sectionId;
      actions.moveSection(id, dropPosition(sections, id, over.data.current.sectionId));
      settle(listRef.current, sectionDndId(id), { from: { y: [-12, 0] } });
      return;
    }

    const moving = drag.data.current?.task;
    const target = moving && taskDrop(moving, over, sectionTasks);
    if (!target) return;
    actions.updateTask(moving.id, target);
    flash(listRef.current, moving.id);
  };

  const activeSection = active?.type === 'section' ? sections.find((s) => s.id === active.sectionId) : null;

  // Drop selections for tasks that are no longer shown (deleted, filtered out, completed and hidden).
  const visibleIds = new Set(top.map((t) => t.id));
  const chosen = [...selected].filter((id) => visibleIds.has(id));

  return (
    <ListContext.Provider value={ctx}>
    <DndContext sensors={sensors} collisionDetection={typedCollisions} measuring={MEASURING}
      onDragStart={({ active: drag }) => setActive(drag.data.current)} onDragCancel={() => setActive(null)} onDragEnd={onDragEnd}>
      <div className="list" ref={listRef}>
        <div className="list-head row-grid" aria-hidden="true">
          <span>Task</span><span>Assignee</span><span>Due date</span><span>Priority</span>
        </div>
        <SortableContext items={sections.map((s) => sectionDndId(s.id))} strategy={verticalListSortingStrategy}>
          {sections.map((s) => (
            <ListSection
              key={s.id}
              section={s}
              tasks={sectionTasks(s.id)}
              counts={counts}
              members={members}
              actions={actions}
              onOpen={onOpen}
              folded={active?.type === 'section'}
            />
          ))}
        </SortableContext>
        {!readOnly && (
          <div className="add-section">
            <InlineAdd label="Add section" placeholder="Section name" onAdd={actions.createSection} />
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={{ duration: 180 }}>
        {active?.type === 'task' && (
          <Lifted className="task-row row-grid is-lifted" rotate={-1}>
            <div className="task-cell-title">
              <span className="drag-handle"><Icon.grip /></span>
              <Check checked={active.task.completed} onChange={() => {}} />
              <span className="task-title">{active.task.title}</span>
            </div>
          </Lifted>
        )}
        {activeSection && (
          <Lifted as="header" className="list-section-head is-lifted" rotate={-1}>
            <span className="drag-handle"><Icon.grip /></span>
            <h3>{activeSection.name}</h3>
            <span className="count">{sectionTasks(activeSection.id).length}</span>
          </Lifted>
        )}
      </DragOverlay>
    </DndContext>
    {chosen.length > 0 && !readOnly && (
      <BulkBar ids={chosen} sections={sections} members={members} actions={actions} onClear={() => setSelected(new Set())} />
    )}
    </ListContext.Provider>
  );
}

function Lifted({ as: Tag = 'div', rotate, children, ...props }) {
  const ref = useRef(null);
  useEffect(() => lift(ref.current, { rotate }), [rotate]);
  return <Tag ref={ref} {...props}>{children}</Tag>;
}

function ListSection({ section, tasks, counts, members, actions, onOpen, folded }) {
  const { readOnly } = useContext(ListContext);
  const [collapsed, setCollapsed] = useState(false);
  const sortable = useSortable({ id: sectionDndId(section.id), data: { type: 'section', sectionId: section.id }, disabled: readOnly });
  const { setNodeRef, isOver } = useDroppable({ id: columnDndId(section.id), data: { type: 'column', sectionId: section.id } });
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition };
  // While any section is being dragged, show headers only so sections are easy to reorder.
  const showTasks = !collapsed && !folded;

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete "${section.name}"?`,
      text: tasks.length
        ? `Its ${tasks.length} task${tasks.length === 1 ? '' : 's'} will be deleted too. This can't be undone.`
        : "This can't be undone.",
      confirmText: 'Delete section',
      danger: true,
    });
    if (ok) actions.deleteSection(section.id);
  };

  return (
    <section ref={sortable.setNodeRef} style={style}
      className={`list-section${sortable.isDragging ? ' is-dragging' : ''}`}>
      <div ref={setNodeRef} className={isOver ? 'is-over' : undefined} data-settle={sectionDndId(section.id)}>
        <header className="list-section-head">
          {!readOnly && (
            <button ref={sortable.setActivatorNodeRef} className="drag-handle" {...sortable.attributes} {...sortable.listeners}
              aria-label={`Move section ${section.name}`} title="Drag to reorder">
              <Icon.grip />
            </button>
          )}
          <button className={`collapse${collapsed ? '' : ' is-open'}`} onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed} aria-label={collapsed ? 'Expand section' : 'Collapse section'}>
            <Icon.chevron />
          </button>
          <EditableText as="h3" value={section.name} onSave={(name) => actions.renameSection(section.id, name)} placeholder="Section name" disabled={readOnly} />
          <span className="count">{tasks.length}</span>
          {!readOnly && <button className="icon-btn reveal" onClick={remove} aria-label="Delete section" title="Delete section"><Icon.trash /></button>}
        </header>
        {showTasks && (
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} count={counts[t.id]} members={members} actions={actions} onOpen={onOpen} />
            ))}
          </SortableContext>
        )}
      </div>
      {showTasks && !readOnly && (
        <InlineAdd className="row-add" label="Add task" placeholder="Task name"
          onAdd={(title) => actions.createTask({ section_id: section.id, title })} />
      )}
    </section>
  );
}

function TaskRow({ task, count, members, actions, onOpen }) {
  const { selected, toggle, deco, readOnly } = useContext(ListContext);
  const isSelected = selected.has(task.id);
  const extras = (deco.extrasByTask?.get(task.id) ?? []).map((id) => deco.memberById?.[id]).filter(Boolean);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { type: 'task', task }, disabled: readOnly });
  const style = { transform: CSS.Translate.toString(transform), transition };
  const set = (patch) => actions.updateTask(task.id, patch);
  return (
    <div ref={setNodeRef} style={style} onClick={() => onOpen(task.id)} data-settle={task.id}
      className={`task-row row-grid${task.completed ? ' is-done' : ''}${isDragging ? ' is-dragging' : ''}${isSelected ? ' is-selected' : ''}`}>
      <div className="task-cell-title">
        {!readOnly && (
          <>
            <input type="checkbox" className={`row-select${selected.size ? ' is-visible' : ''}`} checked={isSelected}
              onClick={(e) => e.stopPropagation()} onChange={() => toggle(task.id)} aria-label={`Select ${task.title}`} />
            <button ref={setActivatorNodeRef} className="drag-handle reveal" {...attributes} {...listeners}
              onClick={(e) => e.stopPropagation()} aria-label={`Move ${task.title}`} title="Drag to move">
              <Icon.grip />
            </button>
          </>
        )}
        <Check checked={task.completed} onChange={(v) => set({ completed: v })} disabled={readOnly} />
        <button className="task-title" onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}>{task.title}</button>
        <LabelChips ids={deco.labelsByTask?.get(task.id)} labels={deco.labels} max={2} />
        {task.recurrence && <span className="mini-count" title={`Repeats ${task.recurrence}`}><Icon.repeat width="14" height="14" /></span>}
        {extras.length > 0 && (
          <span className="avatar-row" title={`Also assigned: ${extras.map((p) => p.full_name).join(', ')}`}>
            {extras.slice(0, 2).map((p) => <Avatar key={p.id} profile={p} size={20} />)}
          </span>
        )}
        {count && (
          <span className="mini-count" title="Subtasks done">
            <Icon.subtasks width="14" height="14" /> {count.done}/{count.total}
          </span>
        )}
      </div>
      <AssigneeSelect value={task.assignee_id} members={members} onChange={(v) => set({ assignee_id: v })} disabled={readOnly} />
      <DueInput value={task.due_date} completed={task.completed} onChange={(v) => set({ due_date: v })} disabled={readOnly} />
      <PrioritySelect value={task.priority} onChange={(v) => set({ priority: v })} disabled={readOnly} />
    </div>
  );
}

// Actions for the selected rows.
function BulkBar({ ids, sections, members, actions, onClear }) {
  const n = ids.length;
  const done = (patch) => {
    actions.bulkUpdate(ids, patch);
    onClear();
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete ${n} task${n === 1 ? '' : 's'}?`,
      text: "Their subtasks, comments and attachments are deleted too. This can't be undone.",
      confirmText: `Delete ${n} task${n === 1 ? '' : 's'}`,
      danger: true,
    });
    if (!ok) return;
    actions.bulkDelete(ids);
    onClear();
  };

  return (
    <div className="bulk-bar" role="toolbar" aria-label="Selected tasks">
      <strong>{n} selected</strong>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => done({ completed: true })}><Check checked onChange={() => {}} /> Complete</button>
      <label className="btn btn-ghost btn-small bulk-select">Move to…
        <select value="" onChange={(e) => e.target.value && done({ section_id: e.target.value, position: Date.now() / 1000 })}>
          <option value="">Move to section</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="btn btn-ghost btn-small bulk-select">Assign…
        <select value="" onChange={(e) => e.target.value && done({ assignee_id: e.target.value === 'none' ? null : e.target.value })}>
          <option value="">Assign to</option>
          <option value="none">Nobody</option>
          {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || m.profile?.email}</option>)}
        </select>
      </label>
      <label className="btn btn-ghost btn-small bulk-select">Due date…
        <input type="date" onChange={(e) => e.target.value && done({ due_date: e.target.value })} aria-label="Set due date" />
      </label>
      <button type="button" className="btn btn-ghost btn-small danger-text" onClick={remove}><Icon.trash /> Delete</button>
      <button type="button" className="link-btn push-right" onClick={onClear}>Clear</button>
    </div>
  );
}
