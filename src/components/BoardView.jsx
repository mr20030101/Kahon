import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { byPosition } from '../lib/position';
import { lift, settle } from '../lib/motion';
import { columnDndId, dropPosition, sectionDndId, taskDrop, typedCollisions, useDndSensors } from '../lib/dnd';
import { subtaskCounts } from './ListView';
import { LabelChips } from './LabelsModal';
import { Avatar, Check, DueLabel, EditableText, Icon, InlineAdd, PriorityTag } from './ui';
import { confirmDialog } from '../lib/dialog';

export default function BoardView({ sections, tasks, members, hideCompleted, actions, onOpen, labels = [], labelsByTask, extrasByTask }) {
  const [active, setActive] = useState(null);
  const boardRef = useRef(null);
  const counts = useMemo(() => subtaskCounts(tasks), [tasks]);
  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m.profile])), [members]);
  const top = tasks.filter((t) => !t.parent_id && !(hideCompleted && t.completed));
  const sensors = useDndSensors();
  const deco = { labels, labelsByTask, extrasByTask };

  // The board has no visible scrollbar: a vertical wheel over empty board space scrolls
  // sideways. Inside a column the wheel still scrolls that column's cards.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const body = e.target.closest?.('.column-body');
      if (body && body.scrollHeight > body.clientHeight) return;
      if (board.scrollWidth <= board.clientWidth) return;
      e.preventDefault();
      board.scrollLeft += e.deltaY;
    };
    board.addEventListener('wheel', onWheel, { passive: false });
    return () => board.removeEventListener('wheel', onWheel);
  }, []);

  const columnTasks = (sectionId) => top.filter((t) => t.section_id === sectionId).sort(byPosition);

  const onDragEnd = ({ active: drag, over }) => {
    setActive(null);
    if (!over || drag.id === over.id) return;

    if (drag.data.current?.type === 'section') {
      const id = drag.data.current.sectionId;
      actions.moveSection(id, dropPosition(sections, id, over.data.current.sectionId));
      settle(boardRef.current, sectionDndId(id), { from: { y: [-14, 0] } });
      return;
    }

    const moving = drag.data.current?.task;
    const target = moving && taskDrop(moving, over, columnTasks);
    if (!target) return;
    actions.updateTask(moving.id, target);
    settle(boardRef.current, moving.id);
  };

  const activeTask = active?.type === 'task' ? active.task : null;
  const activeSection = active?.type === 'section' ? sections.find((s) => s.id === active.sectionId) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={typedCollisions}
      onDragStart={({ active: drag }) => setActive(drag.data.current)} onDragCancel={() => setActive(null)} onDragEnd={onDragEnd}>
      <div className="board" ref={boardRef}>
        <SortableContext items={sections.map((s) => sectionDndId(s.id))} strategy={horizontalListSortingStrategy}>
          {sections.map((s) => (
            <Column key={s.id} section={s} tasks={columnTasks(s.id)} counts={counts} memberById={memberById} deco={deco}
              actions={actions} onOpen={onOpen} />
          ))}
        </SortableContext>
        <div className="board-add-col">
          <InlineAdd label="Add section" placeholder="Section name" onAdd={actions.createSection} />
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 180 }}>
        {activeTask && <CardBody task={activeTask} count={counts[activeTask.id]} memberById={memberById} deco={deco} lifted />}
        {activeSection && (
          <LiftedColumn>
            <header className="column-head">
              <span className="drag-handle"><Icon.grip /></span>
              <h3>{activeSection.name}</h3>
              <span className="count">{columnTasks(activeSection.id).length}</span>
            </header>
          </LiftedColumn>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ section, tasks, counts, memberById, deco, actions, onOpen }) {
  const sortable = useSortable({ id: sectionDndId(section.id), data: { type: 'section', sectionId: section.id } });
  const { setNodeRef, isOver } = useDroppable({ id: columnDndId(section.id), data: { type: 'column', sectionId: section.id } });
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition };

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
      className={`column${isOver ? ' is-over' : ''}${sortable.isDragging ? ' is-dragging' : ''}`}>
      <header className="column-head" data-settle={sectionDndId(section.id)}>
        <button ref={sortable.setActivatorNodeRef} className="drag-handle" {...sortable.attributes} {...sortable.listeners}
          aria-label={`Move section ${section.name}`} title="Drag to reorder">
          <Icon.grip />
        </button>
        <EditableText as="h3" value={section.name} onSave={(name) => actions.renameSection(section.id, name)} placeholder="Section name" />
        <span className="count">{tasks.length}</span>
        <button className="icon-btn reveal" onClick={remove} aria-label="Delete section" title="Delete section"><Icon.trash /></button>
      </header>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="column-body" data-settle={sectionDndId(section.id)}>
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} count={counts[t.id]} memberById={memberById} deco={deco} actions={actions} onOpen={onOpen} />
          ))}
          {tasks.length === 0 && <p className="column-empty">Drop tasks here</p>}
        </div>
      </SortableContext>
      <InlineAdd className="card-add" label="Add task" placeholder="Task name"
        onAdd={(title) => actions.createTask({ section_id: section.id, title })} />
    </section>
  );
}

function SortableCard({ task, count, memberById, deco, actions, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: 'task', task } });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`card-slot${isDragging ? ' is-dragging' : ''}`}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(task.id);
        listeners?.onKeyDown?.(e);
      }}>
      <CardBody task={task} count={count} memberById={memberById} deco={deco}
        onToggle={(v) => actions.updateTask(task.id, { completed: v })} />
    </div>
  );
}

function LiftedColumn({ children }) {
  const ref = useRef(null);
  useEffect(() => lift(ref.current, { rotate: -1 }), []);
  return <section ref={ref} className="column is-lifted">{children}</section>;
}

function CardBody({ task, count, memberById, deco, onToggle, lifted }) {
  const ref = useRef(null);
  const assignee = memberById[task.assignee_id];
  const extras = (deco?.extrasByTask?.get(task.id) ?? []).map((id) => memberById[id]).filter(Boolean);
  const labelIds = deco?.labelsByTask?.get(task.id);
  useEffect(() => {
    if (lifted) lift(ref.current);
  }, [lifted]);
  return (
    <article ref={ref} data-settle={lifted ? undefined : task.id} className={`card${task.completed ? ' is-done' : ''}${lifted ? ' is-lifted' : ''}`}>
      <div className="card-top">
        <Check checked={task.completed} onChange={onToggle || (() => {})} />
        <p className="card-title">{task.title}</p>
      </div>
      {labelIds?.length > 0 && <LabelChips ids={labelIds} labels={deco.labels} />}
      {(task.priority || task.due_date || count || assignee || extras.length > 0 || task.recurrence) && (
        <div className="card-meta">
          <PriorityTag value={task.priority} />
          <DueLabel value={task.due_date} completed={task.completed} />
          {task.recurrence && <span className="mini-count" title={`Repeats ${task.recurrence}`}><Icon.repeat width="14" height="14" /></span>}
          {count && <span className="mini-count"><Icon.subtasks width="14" height="14" /> {count.done}/{count.total}</span>}
          <span className="spacer" />
          <span className="avatar-row">
            {assignee && <Avatar profile={assignee} size={22} />}
            {extras.slice(0, 2).map((p) => <Avatar key={p.id} profile={p} size={22} />)}
            {extras.length > 2 && <span className="avatar more" style={{ width: 22, height: 22 }}>+{extras.length - 2}</span>}
          </span>
        </div>
      )}
    </article>
  );
}
