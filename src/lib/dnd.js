import {
  KeyboardSensor, PointerSensor, TouchSensor, closestCenter, closestCorners, useSensor, useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { between } from './position';

// Draggables carry data.type: 'task' (with data.task), 'section', or 'column'
// (a section's drop area for tasks, with data.sectionId). Section ids are prefixed
// so they never collide with task ids.
export const sectionDndId = (id) => `sec:${id}`;
export const columnDndId = (id) => `col:${id}`;

export function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

// Sections only collide with sections; tasks only with tasks and section drop areas.
export function typedCollisions(args) {
  const isSection = args.active.data.current?.type === 'section';
  const droppableContainers = args.droppableContainers.filter(
    (c) => (c.data.current?.type === 'section') === isSection,
  );
  return (isSection ? closestCenter : closestCorners)({ ...args, droppableContainers });
}

// New position for `movingId` dropped onto `overId` in an ordered list. Moving down
// lands after the item you drop on, moving up (or in from elsewhere) lands before it.
export function dropPosition(items, movingId, overId) {
  const from = items.findIndex((i) => i.id === movingId);
  const to = items.findIndex((i) => i.id === overId);
  const others = items.filter((i) => i.id !== movingId);
  const idx = others.findIndex((i) => i.id === overId);
  return from !== -1 && from < to
    ? between(others[idx].position, others[idx + 1]?.position)
    : between(others[idx - 1]?.position, others[idx].position);
}

// Where a dragged task lands: { section_id, position }, or null when there's no target.
export function taskDrop(moving, over, tasksInSection) {
  const data = over.data.current;
  if (data?.type === 'column') {
    const list = tasksInSection(data.sectionId).filter((t) => t.id !== moving.id);
    return { section_id: data.sectionId, position: between(list.at(-1)?.position, null) };
  }
  if (data?.type === 'task') {
    const target = data.task;
    return { section_id: target.section_id, position: dropPosition(tasksInSection(target.section_id), moving.id, target.id) };
  }
  return null;
}
