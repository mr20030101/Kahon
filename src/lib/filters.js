import { PRIORITIES } from './constants';

// Task search and filters for a project's views. Pure functions so they're easy to test.
//
// filters = { query, quick: string[], rules: [{ id, field, op, value }] }
//   quick: 'incomplete', 'completed' (or 'completed:today' | 'completed:7' | 'completed:30'),
//          'mine', 'due_this_week', 'due_next_week'
//   rules: every one must match. `field` is a built-in key (FIELDS) or 'cf:<custom field id>'.

export const EMPTY_FILTERS = { query: '', quick: [], rules: [] };

export const isFiltering = (f) => !!f.query.trim() || f.quick.length > 0 || f.rules.length > 0;
export const activeCount = (f) => f.quick.length + f.rules.length;

// ---------------------------------------------------------------------------------------------
// Fields and their conditions
// ---------------------------------------------------------------------------------------------

/** Built-in fields, in the order Add filter lists them. `kind` decides the conditions. */
export const FIELDS = [
  { key: 'completion', name: 'Completion status', kind: 'completion', icon: 'check' },
  { key: 'assignee', name: 'Assignee', kind: 'person', icon: 'user' },
  { key: 'due_date', name: 'Due date', kind: 'date', icon: 'calendar' },
  { key: 'created_by', name: 'Created by', kind: 'person', icon: 'user' },
  { key: 'created_at', name: 'Created on', kind: 'date', icon: 'clock' },
  { key: 'updated_at', name: 'Last modified on', kind: 'date', icon: 'edit' },
  { key: 'completed_at', name: 'Completed on', kind: 'date', icon: 'check' },
  { key: 'priority', name: 'Priority', kind: 'select', icon: 'info' },
  { key: 'labels', name: 'Labels', kind: 'multi_select', icon: 'tag' },
];

const DATE_OPS = [
  ['overdue', 'is overdue'], ['today', 'is today'], ['this_week', 'is this week'], ['next_week', 'is next week'],
  ['last_7', 'in the last 7 days'], ['last_30', 'in the last 30 days'],
  ['before', 'is before'], ['after', 'is after'], ['on', 'is on'], ['empty', 'is empty'], ['not_empty', 'is set'],
];

/** Conditions for each kind, as [op, label]. */
export const OPS = {
  completion: [['is', 'is']],
  person: [['is', 'is'], ['is_not', 'is not'], ['empty', 'is empty'], ['not_empty', 'is set']],
  select: [['is', 'is'], ['is_not', 'is not'], ['empty', 'is empty'], ['not_empty', 'is set']],
  multi_select: [['has', 'includes'], ['has_not', "doesn't include"], ['empty', 'is empty'], ['not_empty', 'is set']],
  text: [['contains', 'contains'], ['not_contains', "doesn't contain"], ['empty', 'is empty'], ['not_empty', 'is set']],
  number: [['eq', 'is'], ['gt', 'is more than'], ['lt', 'is less than'], ['empty', 'is empty'], ['not_empty', 'is set']],
  date: DATE_OPS,
};

/** Conditions that take a value from the person (the rest are complete on their own). */
export const NEEDS_VALUE = new Set(['is', 'is_not', 'has', 'has_not', 'contains', 'not_contains', 'eq', 'gt', 'lt', 'before', 'after', 'on']);

/** A field by key: a built-in, or a project's custom field ('cf:<id>'). */
export function fieldOf(key, customFields = []) {
  if (key.startsWith('cf:')) {
    const f = customFields.find((c) => c.id === key.slice(3));
    return f && { key, name: f.name, kind: f.type, icon: 'tag', custom: f };
  }
  return FIELDS.find((f) => f.key === key) ?? null;
}

/** The conditions a field offers; overdue only makes sense for due dates. */
export function opsFor(field) {
  const ops = OPS[field.kind] ?? [];
  return field.kind === 'date' && field.key !== 'due_date' ? ops.filter(([op]) => op !== 'overdue') : ops;
}

/** A new rule for a field, with its first condition and value ready to use. */
export function newRule(field) {
  const op = field.kind === 'date' ? (field.key === 'due_date' ? 'this_week' : 'last_7') : opsFor(field)[0][0];
  const value = field.kind === 'completion' ? 'incomplete' : field.kind === 'person' ? 'me' : '';
  return { id: Math.random().toString(36).slice(2, 10), field: field.key, op, value };
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// "2026-11-04" (a due date) or an ISO timestamp, as that day here.
const dayOf = (value) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return startOfDay(new Date(value));
};
// Weeks run Monday to Sunday.
const mondayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

/** Whether a date value meets a date condition. `today` is a Date at local midnight. */
export function matchDate(value, op, arg, today) {
  const day = dayOf(value);
  if (op === 'empty') return !day;
  if (op === 'not_empty') return !!day;
  if (!day) return false;
  const t = today.getTime();
  const x = day.getTime();
  const monday = mondayOf(today).getTime();
  switch (op) {
    case 'overdue': return x < t;
    case 'today': return x === t;
    case 'this_week': return x >= monday && x < monday + 7 * DAY;
    case 'next_week': return x >= monday + 7 * DAY && x < monday + 14 * DAY;
    case 'last_7': return x <= t && x > t - 7 * DAY;
    case 'last_30': return x <= t && x > t - 30 * DAY;
    case 'before': return !!arg && x < dayOf(arg).getTime();
    case 'after': return !!arg && x > dayOf(arg).getTime();
    case 'on': return !!arg && x === dayOf(arg).getTime();
    default: return true;
  }
}

const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** A task's value for a field: what rules compare against. */
function valueOf(task, field, ctx) {
  switch (field.key) {
    case 'assignee': return [task.assignee_id, ...(ctx.extraAssignees?.get(task.id) ?? [])].filter(Boolean);
    case 'labels': return ctx.taskLabels?.get(task.id) ?? [];
    case 'completion': return task.completed ? 'complete' : 'incomplete';
    default:
      if (field.custom) return ctx.fieldValues?.get(task.id)?.get(field.custom.id) ?? null;
      return task[field.key] ?? null;
  }
}

/** Whether a task meets one rule. Rules for fields that no longer exist match everything. */
export function matchRule(task, rule, ctx) {
  const field = fieldOf(rule.field, ctx.fields);
  if (!field) return true;
  const value = valueOf(task, field, ctx);
  const { op } = rule;
  if (NEEDS_VALUE.has(op) && isEmpty(rule.value)) return true; // not filled in yet
  if (field.kind === 'date') return matchDate(value, op, rule.value, ctx.today);
  if (op === 'empty') return isEmpty(value);
  if (op === 'not_empty') return !isEmpty(value);
  const want = rule.value === 'me' ? ctx.me : rule.value;

  switch (field.kind) {
    case 'completion': return value === rule.value;
    case 'person': {
      const people = Array.isArray(value) ? value : [value].filter(Boolean);
      return op === 'is' ? people.includes(want) : !people.includes(want);
    }
    case 'select': return op === 'is' ? value === want : value !== want;
    case 'multi_select': {
      const list = Array.isArray(value) ? value : [];
      return op === 'has' ? list.includes(want) : !list.includes(want);
    }
    case 'text': {
      const has = String(value ?? '').toLowerCase().includes(String(want).toLowerCase());
      return op === 'contains' ? has : !has;
    }
    case 'number': {
      if (typeof value !== 'number') return false;
      const n = Number(want);
      return op === 'eq' ? value === n : op === 'gt' ? value > n : value < n;
    }
    default: return true;
  }
}

/** Whether a task meets a quick filter. */
export function matchQuick(task, quick, ctx) {
  const [kind, within] = quick.split(':');
  switch (kind) {
    case 'incomplete': return !task.completed;
    case 'completed':
      if (!task.completed) return false;
      if (!within) return true;
      return matchDate(task.completed_at, within === 'today' ? 'today' : `last_${within}`, null, ctx.today);
    case 'mine': return [task.assignee_id, ...(ctx.extraAssignees?.get(task.id) ?? [])].includes(ctx.me);
    case 'due_this_week': return matchDate(task.due_date, 'this_week', null, ctx.today);
    case 'due_next_week': return matchDate(task.due_date, 'next_week', null, ctx.today);
    default: return true;
  }
}

/**
 * Whether a top-level task matches the filters.
 * `ctx`: { me, today?, fields, extraAssignees: Map<taskId, userId[]>, taskLabels: Map<taskId, labelId[]>,
 *          fieldValues: Map<taskId, Map<fieldId, value>>, subtaskTitles: Map<taskId, string[]> }
 */
export function matchesFilters(task, f, ctx) {
  const full = { ...ctx, today: ctx.today ?? startOfDay(new Date()) };
  const query = f.query.trim().toLowerCase();
  if (query) {
    const haystack = [task.title, task.description, ...(full.subtaskTitles?.get(task.id) ?? [])].join('\n').toLowerCase();
    if (!query.split(/\s+/).every((word) => haystack.includes(word))) return false;
  }
  return f.quick.every((q) => matchQuick(task, q, full)) && f.rules.every((r) => matchRule(task, r, full));
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

/** task_field_values rows -> Map<taskId, Map<fieldId, value>> */
export function valuesByTask(rows) {
  const map = new Map();
  for (const { task_id: t, field_id: f, value } of rows) {
    if (!map.has(t)) map.set(t, new Map());
    map.get(t).set(f, value);
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
  const full = { ...ctx, subtaskTitles, today: ctx.today ?? startOfDay(new Date()) };
  return tasks.filter((t) => t.parent_id || matchesFilters(t, f, full));
}

/** The choices for a select-like field's value: [value, label, color?]. */
export function choicesFor(field, { members = [], labels = [] } = {}) {
  if (field.key === 'priority') return PRIORITIES.map((p) => [p.value, p.label]);
  if (field.key === 'labels') return labels.map((l) => [l.id, l.name, l.color]);
  if (field.kind === 'person') {
    return [['me', 'Me'], ...members.map((m) => [m.user_id, m.profile?.full_name || m.profile?.email || 'Someone'])];
  }
  if (field.custom) return (field.custom.options ?? []).map((o) => [o.id, o.name, o.color]);
  return [];
}
