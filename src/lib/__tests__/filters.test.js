import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS, FIELDS, choicesFor, fieldOf, filterTasks, groupBy, isFiltering, matchDate, matchQuick, matchRule,
  matchesFilters, newRule, opsFor, valuesByTask,
} from '../filters';

// Wednesday 4 November 2026: its week runs Mon 2 to Sun 8.
const TODAY = new Date(2026, 10, 4);
const task = (over) => ({
  id: 't1', title: 'Write spec', description: '', assignee_id: null, created_by: 'bea', priority: null, due_date: null,
  completed: false, completed_at: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-04T09:00:00Z', parent_id: null, ...over,
});
const fields = [
  { id: 'type', name: 'Task type', type: 'select', options: [{ id: 'bug', name: 'Bug', color: '#f00' }, { id: 'feat', name: 'Feature' }] },
  { id: 'sites', name: 'Site', type: 'multi_select', options: [{ id: 'geo', name: 'Geotesta' }, { id: 'ric', name: 'Richa' }] },
  { id: 'rep', name: 'Reporter', type: 'person', options: [] },
  { id: 'est', name: 'Estimate', type: 'number', options: [] },
  { id: 'note', name: 'Client ref', type: 'text', options: [] },
];
const ctx = {
  me: 'me', today: TODAY, fields,
  extraAssignees: new Map([['t1', ['bea']]]),
  taskLabels: new Map([['t1', ['bug-label', 'ui']]]),
  fieldValues: valuesByTask([
    { task_id: 't1', field_id: 'type', value: 'bug' },
    { task_id: 't1', field_id: 'sites', value: ['geo'] },
    { task_id: 't1', field_id: 'rep', value: 'me' },
    { task_id: 't1', field_id: 'est', value: 3 },
    { task_id: 't1', field_id: 'note', value: 'ACME-42' },
  ]),
};
const f = (over) => ({ ...EMPTY_FILTERS, ...over });
const rule = (field, op, value = '') => ({ id: field, field, op, value });

describe('dates', () => {
  it('knows this week, next week, the last days, and before/after/on', () => {
    expect(matchDate('2026-11-02', 'this_week', null, TODAY)).toBe(true);
    expect(matchDate('2026-11-08', 'this_week', null, TODAY)).toBe(true);
    expect(matchDate('2026-11-09', 'this_week', null, TODAY)).toBe(false);
    expect(matchDate('2026-11-09', 'next_week', null, TODAY)).toBe(true);
    expect(matchDate('2026-11-16', 'next_week', null, TODAY)).toBe(false);
    expect(matchDate('2026-11-03', 'overdue', null, TODAY)).toBe(true);
    expect(matchDate('2026-10-29T12:00:00', 'last_7', null, TODAY)).toBe(true);
    expect(matchDate('2026-10-28T12:00:00', 'last_7', null, TODAY)).toBe(false);
    expect(matchDate('2026-11-01', 'before', '2026-11-02', TODAY)).toBe(true);
    expect(matchDate('2026-11-03', 'after', '2026-11-02', TODAY)).toBe(true);
    expect(matchDate('2026-11-02', 'on', '2026-11-02', TODAY)).toBe(true);
    expect(matchDate(null, 'empty', null, TODAY)).toBe(true);
    expect(matchDate(null, 'this_week', null, TODAY)).toBe(false);
  });
});

describe('quick filters', () => {
  it('incomplete, completed (and when), mine, due this and next week', () => {
    expect(matchQuick(task(), 'incomplete', ctx)).toBe(true);
    const done = task({ completed: true, completed_at: '2026-11-04T08:00:00' });
    expect(matchQuick(done, 'completed', ctx)).toBe(true);
    expect(matchQuick(done, 'completed:today', ctx)).toBe(true);
    expect(matchQuick(task({ completed: true, completed_at: '2026-10-20T08:00:00' }), 'completed:7', ctx)).toBe(false);
    expect(matchQuick(task({ id: 't2', assignee_id: 'me' }), 'mine', ctx)).toBe(true);
    expect(matchQuick(task({ id: 't2' }), 'mine', ctx)).toBe(false);
    expect(matchQuick(task({ due_date: '2026-11-06' }), 'due_this_week', ctx)).toBe(true);
    expect(matchQuick(task({ due_date: '2026-11-10' }), 'due_next_week', ctx)).toBe(true);
  });
});

describe('rules on built-in fields', () => {
  it('completion, people (with extra assignees and "me"), priority and labels', () => {
    expect(matchRule(task(), rule('completion', 'is', 'incomplete'), ctx)).toBe(true);
    expect(matchRule(task(), rule('assignee', 'is', 'bea'), ctx)).toBe(true);
    expect(matchRule(task({ id: 't2' }), rule('assignee', 'empty'), ctx)).toBe(true);
    expect(matchRule(task({ assignee_id: 'me' }), rule('assignee', 'is', 'me'), ctx)).toBe(true);
    expect(matchRule(task(), rule('created_by', 'is_not', 'me'), ctx)).toBe(true);
    expect(matchRule(task({ priority: 'high' }), rule('priority', 'is', 'high'), ctx)).toBe(true);
    expect(matchRule(task(), rule('priority', 'empty'), ctx)).toBe(true);
    expect(matchRule(task(), rule('labels', 'has', 'ui'), ctx)).toBe(true);
    expect(matchRule(task(), rule('labels', 'has_not', 'ui'), ctx)).toBe(false);
  });

  it('dates on created, modified and completed, and overdue only for due dates', () => {
    expect(matchRule(task(), rule('created_at', 'this_week'), ctx)).toBe(false); // Sunday 1 Nov is last week
    expect(matchRule(task(), rule('updated_at', 'today'), ctx)).toBe(true);
    expect(matchRule(task(), rule('completed_at', 'empty'), ctx)).toBe(true);
    expect(opsFor(fieldOf('due_date')).map(([op]) => op)).toContain('overdue');
    expect(opsFor(fieldOf('created_at')).map(([op]) => op)).not.toContain('overdue');
  });

  it('ignores a rule whose value is still to be picked', () => {
    expect(matchRule(task(), rule('priority', 'is', ''), ctx)).toBe(true);
  });
});

describe('rules on custom fields', () => {
  it('select, multi-select, person, number and text', () => {
    expect(matchRule(task(), rule('cf:type', 'is', 'bug'), ctx)).toBe(true);
    expect(matchRule(task(), rule('cf:type', 'is_not', 'bug'), ctx)).toBe(false);
    expect(matchRule(task(), rule('cf:sites', 'has', 'geo'), ctx)).toBe(true);
    expect(matchRule(task(), rule('cf:sites', 'has', 'ric'), ctx)).toBe(false);
    expect(matchRule(task(), rule('cf:rep', 'is', 'me'), ctx)).toBe(true);
    expect(matchRule(task(), rule('cf:est', 'gt', '2'), ctx)).toBe(true);
    expect(matchRule(task(), rule('cf:est', 'lt', '2'), ctx)).toBe(false);
    expect(matchRule(task(), rule('cf:note', 'contains', 'acme'), ctx)).toBe(true);
    expect(matchRule(task({ id: 't2' }), rule('cf:type', 'empty'), ctx)).toBe(true);
  });

  it('lists custom fields with their options, and ignores rules for deleted ones', () => {
    expect(fieldOf('cf:type', fields)).toMatchObject({ name: 'Task type', kind: 'select' });
    expect(choicesFor(fieldOf('cf:type', fields))).toEqual([['bug', 'Bug', '#f00'], ['feat', 'Feature', undefined]]);
    expect(matchRule(task(), rule('cf:gone', 'is', 'x'), ctx)).toBe(true);
  });

  it('starts new rules with a sensible condition', () => {
    expect(newRule(fieldOf('due_date'))).toMatchObject({ op: 'this_week' });
    expect(newRule(fieldOf('assignee'))).toMatchObject({ op: 'is', value: 'me' });
    expect(newRule(fieldOf('completion'))).toMatchObject({ op: 'is', value: 'incomplete' });
    expect(FIELDS.map((x) => x.name)).toContain('Last modified on');
  });
});

describe('matchesFilters and filterTasks', () => {
  it('searches title, description and subtask titles, every word', () => {
    expect(matchesFilters(task(), f({ query: 'spec' }), ctx)).toBe(true);
    expect(matchesFilters(task(), f({ query: 'deploy' }), { ...ctx, subtaskTitles: new Map([['t1', ['Deploy to prod']]]) })).toBe(true);
    expect(matchesFilters(task(), f({ query: 'spec deploy' }), ctx)).toBe(false);
  });

  it('needs every quick filter and rule', () => {
    expect(matchesFilters(task(), f({ quick: ['incomplete'], rules: [rule('cf:type', 'is', 'bug')] }), ctx)).toBe(true);
    expect(matchesFilters(task(), f({ quick: ['incomplete', 'mine'] }), ctx)).toBe(false);
  });

  it('keeps subtasks, and returns everything when not filtering', () => {
    const list = [task(), task({ id: 's1', parent_id: 't1', title: 'other' }), task({ id: 't3', title: 'Other' })];
    expect(filterTasks(list, EMPTY_FILTERS, ctx)).toBe(list);
    expect(filterTasks(list, f({ query: 'spec' }), ctx).map((t) => t.id)).toEqual(['t1', 's1']);
    expect(isFiltering(f({ query: '  ' }))).toBe(false);
    expect(groupBy([{ a: 1, b: 'x' }, { a: 1, b: 'y' }], 'a', 'b').get(1)).toEqual(['x', 'y']);
  });
});
