import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, MeasuringStrategy, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { byPosition } from '../lib/position';
import { flash, lift, settle } from '../lib/motion';
import { columnDndId, dropPosition, sectionDndId, taskDrop, typedCollisions, useDndSensors } from '../lib/dnd';
import { AssigneeSelect, Avatar, Check, CreatedLabel, DueInput, EditableText, Icon, InlineAdd, PrioritySelect } from './ui';
import { useDeleteSection } from './DeleteSectionDialog';
import { LabelChips } from './LabelsModal';
import { FieldChips } from './FieldsModal';
import BulkBar, { useTaskSelection } from './BulkBar';

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
const ListContext = createContext({ selected: new Set(), pick: () => {}, deco: {}, readOnly: false });

export default function ListView({ sections, tasks, members, hideCompleted, actions, onOpen, labels = [], labelsByTask, extrasByTask, fields = [], fieldValuesByTask, readOnly }) {
  const [active, setActive] = useState(null);
  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m.profile])), [members]);
  const listRef = useRef(null);
  const counts = useMemo(() => subtaskCounts(tasks), [tasks]);
  const top = tasks.filter((t) => !t.parent_id && !(hideCompleted && t.completed));
  const sensors = useDndSensors();

  const sectionTasks = (sectionId) => top.filter((t) => t.section_id === sectionId).sort(byPosition);
  const order = sections.flatMap((s) => sectionTasks(s.id).map((t) => t.id));
  const selection = useTaskSelection(order);
  const selected = new Set(selection.ids);
  const ctx = { selected, pick: selection.pick, readOnly, deco: { labels, labelsByTask, extrasByTask, memberById, fields, fieldValuesByTask } };

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
  const deleteSection = useDeleteSection(sections, actions);

  return (
    <ListContext.Provider value={ctx}>
    <DndContext sensors={sensors} collisionDetection={typedCollisions} measuring={MEASURING}
      onDragStart={({ active: drag }) => setActive(drag.data.current)} onDragCancel={() => setActive(null)} onDragEnd={onDragEnd}>
      <div className="list" ref={listRef}>
        <div className="list-head row-grid" aria-hidden="true">
          <span>Task</span><span>Assignee</span><span>Due date</span><span>Priority</span><span>Created</span>
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
              onDeleteSection={deleteSection.ask}
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
    {selected.size > 0 && !readOnly && (
      <BulkBar ids={selection.ids} total={order.length} tasks={tasks} sections={sections} members={members} actions={actions}
        onClear={selection.clear} onSelectAll={selection.selectAll} />
    )}
    {deleteSection.dialog}
    </ListContext.Provider>
  );
}

function Lifted({ as: Tag = 'div', rotate, children, ...props }) {
  const ref = useRef(null);
  useEffect(() => lift(ref.current, { rotate }), [rotate]);
  return <Tag ref={ref} {...props}>{children}</Tag>;
}

function ListSection({ section, tasks, counts, members, actions, onOpen, folded, onDeleteSection }) {
  const { readOnly } = useContext(ListContext);
  const [collapsed, setCollapsed] = useState(false);
  const sortable = useSortable({ id: sectionDndId(section.id), data: { type: 'section', sectionId: section.id }, disabled: readOnly });
  const { setNodeRef, isOver } = useDroppable({ id: columnDndId(section.id), data: { type: 'column', sectionId: section.id } });
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition };
  // While any section is being dragged, show headers only so sections are easy to reorder.
  const showTasks = !collapsed && !folded;

  const remove = () => onDeleteSection(section);

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
  const { selected, pick, deco, readOnly } = useContext(ListContext);
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
              onClick={(e) => e.stopPropagation()} onChange={(e) => pick(task.id, { range: !!e.nativeEvent.shiftKey })}
              aria-label={`Select ${task.title}`} />
            <button ref={setActivatorNodeRef} className="drag-handle reveal" {...attributes} {...listeners}
              onClick={(e) => e.stopPropagation()} aria-label={`Move ${task.title}`} title="Drag to move">
              <Icon.grip />
            </button>
          </>
        )}
        <Check checked={task.completed} onChange={(v) => set({ completed: v })} disabled={readOnly} />
        <button className="task-title" onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}>{task.title}</button>
        <LabelChips ids={deco.labelsByTask?.get(task.id)} labels={deco.labels} max={2} />
        <FieldChips fields={deco.fields} values={deco.fieldValuesByTask?.get(task.id)} max={2} />
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
      <CreatedLabel value={task.created_at} />
    </div>
  );
}
