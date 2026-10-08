import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, filterTasks, groupBy, isFiltering, matchesFilters } from '../filters';

const iso = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const task = (over) => ({ id: 't1', title: 'Write spec', description: '', assignee_id: null, priority: null, due_date: null, parent_id: null, ...over });
const ctx = { me: 'me', extraAssignees: new Map([['t1', ['bea']]]), taskLabels: new Map([['t1', ['bug', 'ui']]]) };
const f = (over) => ({ ...EMPTY_FILTERS, ...over });

describe('matchesFilters', () => {
  it('searches title, description and subtask titles, every word', () => {
    expect(matchesFilters(task(), f({ query: 'spec' }), ctx)).toBe(true);
    expect(matchesFilters(task({ description: 'for the API' }), f({ query: 'write api' }), ctx)).toBe(true);
    expect(matchesFilters(task(), f({ query: 'deploy' }), { ...ctx, subtaskTitles: new Map([['t1', ['Deploy to prod']]]) })).toBe(true);
    expect(matchesFilters(task(), f({ query: 'spec deploy' }), ctx)).toBe(false);
  });

  it('filters by assignee including extra assignees', () => {
    expect(matchesFilters(task({ assignee_id: 'me' }), f({ assignee: 'me' }), ctx)).toBe(true);
    expect(matchesFilters(task(), f({ assignee: 'bea' }), ctx)).toBe(true);
    expect(matchesFilters(task(), f({ assignee: 'none' }), ctx)).toBe(false);
    expect(matchesFilters(task({ id: 't2' }), f({ assignee: 'none' }), ctx)).toBe(true);
  });

  it('filters by priority and due date', () => {
    expect(matchesFilters(task({ priority: 'high' }), f({ priority: 'high' }), ctx)).toBe(true);
    expect(matchesFilters(task(), f({ priority: 'none' }), ctx)).toBe(true);
    expect(matchesFilters(task({ due_date: iso(-1) }), f({ due: 'overdue' }), ctx)).toBe(true);
    expect(matchesFilters(task({ due_date: iso(0) }), f({ due: 'today' }), ctx)).toBe(true);
    expect(matchesFilters(task({ due_date: iso(3) }), f({ due: 'week' }), ctx)).toBe(true);
    expect(matchesFilters(task({ due_date: iso(30) }), f({ due: 'week' }), ctx)).toBe(false);
    expect(matchesFilters(task(), f({ due: 'none' }), ctx)).toBe(true);
  });

  it('requires every chosen label', () => {
    expect(matchesFilters(task(), f({ labels: ['bug'] }), ctx)).toBe(true);
    expect(matchesFilters(task(), f({ labels: ['bug', 'docs'] }), ctx)).toBe(false);
  });
});

describe('filterTasks', () => {
  it('keeps subtasks and returns everything when not filtering', () => {
    const list = [task(), task({ id: 's1', parent_id: 't1', title: 'other' }), task({ id: 't3', title: 'Other' })];
    expect(filterTasks(list, EMPTY_FILTERS, ctx)).toBe(list);
    expect(filterTasks(list, f({ query: 'spec' }), ctx).map((t) => t.id)).toEqual(['t1', 's1']);
    expect(isFiltering(f({ query: '  ' }))).toBe(false);
  });

  it('groups rows', () => {
    expect(groupBy([{ a: 1, b: 'x' }, { a: 1, b: 'y' }], 'a', 'b').get(1)).toEqual(['x', 'y']);
  });
});
