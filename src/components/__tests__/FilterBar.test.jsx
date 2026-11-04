// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import FilterBar from '../FilterBar';
import { EMPTY_FILTERS } from '../../lib/filters';

const members = [{ user_id: 'bea', profile: { full_name: 'Bea Cruz' } }];
const fields = [{ id: 'type', name: 'Task type', type: 'select', options: [{ id: 'bug', name: 'Bug', color: '#c00' }] }];
let latest;

function Harness() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  latest = filters;
  return <FilterBar filters={filters} onChange={setFilters} members={members} labels={[]} fields={fields} resultCount={3} onManageFields={() => {}} />;
}

afterEach(cleanup);

describe('FilterBar', () => {
  it('toggles quick filters, keeping incomplete and completed apart', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Filter'));
    fireEvent.click(screen.getByText('Incomplete tasks'));
    fireEvent.click(screen.getByText('Just my tasks'));
    expect(latest.quick).toEqual(['incomplete', 'mine']);
    fireEvent.click(screen.getByLabelText('When completed'));
    fireEvent.click(screen.getByText('In the last 7 days'));
    expect(latest.quick).toEqual(['mine', 'completed:7']);
    expect(screen.getByText('Completed in the last 7 days')).toBeTruthy();
  });

  it('adds a filter for a custom field and picks its value', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Filter'));
    fireEvent.click(screen.getByText('Add filter'));
    const menu = screen.getByRole('dialog', { name: 'Add a filter' });
    expect(within(menu).getByText('Last modified on')).toBeTruthy();
    expect(within(menu).getByText('Manage custom fields')).toBeTruthy();
    fireEvent.click(within(menu).getByText('Task type'));
    expect(latest.rules).toMatchObject([{ field: 'cf:type', op: 'is', value: '' }]);
    fireEvent.change(screen.getByLabelText('Task type'), { target: { value: 'bug' } });
    expect(latest.rules[0].value).toBe('bug');
    fireEvent.change(screen.getByLabelText('Task type condition'), { target: { value: 'empty' } });
    expect(screen.queryByLabelText('Task type')).toBeNull();
    fireEvent.click(screen.getByLabelText('Remove the Task type filter'));
    expect(latest.rules).toEqual([]);
  });
});
