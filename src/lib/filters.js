import { dayDiff } from './dates';

// Task search and filters for a project's views. Pure functions so they're easy to test.

export const EMPTY_FILTERS = { query: '', assignee: 'any', priority: 'any', due: 'any', labels: [] };

export const isFiltering = (f) =>
  !!f.query.trim() || f.assignee !== 'any' || f.priority !== 'any' || f.due !== 'any' || f.labels.length > 0;

const DUE_TESTS = {
  overdue: (d) => d !== null && d < 0,
  today: (d) => d === 0,
  week: (d) => d !== null && d >= 0 && d <= 7,
  none: (d) => d === null,
};

/**
 * Whether a top-level task matches the filters.
 * `ctx`: { me, extraAssignees: Map<taskId, userId[]>, taskLabels: Map<taskId, labelId[]>, subtaskTitles: Map<taskId, string[]> }
 */
export function matchesFilters(task, f, ctx) {
  const query = f.query.trim().toLowerCase();
  if (query) {
    const haystack = [task.title, task.description, ...(ctx.subtaskTitles?.get(task.id) ?? [])].join('\n').toLowerCase();
    if (!query.split(/\s+/).every((word) => haystack.includes(word))) return false;
  }

  if (f.assignee !== 'any') {
    const people = [task.assignee_id, ...(ctx.extraAssignees?.get(task.id) ?? [])].filter(Boolean);
    if (f.assignee === 'none' ? people.length > 0 : !people.includes(f.assignee === 'me' ? ctx.me : f.assignee)) return false;
  }

  if (f.priority !== 'any' && (f.priority === 'none' ? task.priority : task.priority !== f.priority)) return false;

  if (f.due !== 'any' && !DUE_TESTS[f.due]?.(dayDiff(task.due_date))) return false;

  if (f.labels.length) {
    const mine = ctx.taskLabels?.get(task.id) ?? [];
    if (!f.labels.every((id) => mine.includes(id))) return false;
  }
  return true;
}

/** rows of { key, value } -> Map<key, value[]> */
export function groupBy(rows, key, value) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]) ?? [];
    list.push(row[value]);
    map.set(row[key], list);
  }
  return map;
}

/** Keeps every subtask (views use them for counts) and the top-level tasks that match. */
export function filterTasks(tasks, f, ctx) {
  if (!isFiltering(f)) return tasks;
  const subtaskTitles = new Map();
  for (const t of tasks) {
    if (!t.parent_id) continue;
    const list = subtaskTitles.get(t.parent_id) ?? [];
    list.push(t.title);
    subtaskTitles.set(t.parent_id, list);
  }
  const full = { ...ctx, subtaskTitles };
  return tasks.filter((t) => t.parent_id || matchesFilters(t, f, full));
}
