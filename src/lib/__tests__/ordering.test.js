import { describe, expect, it } from 'vitest';
import { between, byPosition } from '../position';
import { dropPosition, taskDrop } from '../dnd';

const items = [{ id: 'a', position: 1000 }, { id: 'b', position: 2000 }, { id: 'c', position: 3000 }];

describe('fractional positions', () => {
  it('fits a position between neighbours or at the ends', () => {
    expect(between(null, null)).toBe(1000);
    expect(between(1000, 2000)).toBe(1500);
    expect(between(null, 1000)).toBe(0);
    expect(between(3000, null)).toBe(4000);
    expect([...items].reverse().sort(byPosition).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops after the target when moving down and before it when moving up', () => {
    expect(dropPosition(items, 'a', 'b')).toBe(2500); // a lands after b
    expect(dropPosition(items, 'c', 'b')).toBe(1500); // c lands before b
    expect(dropPosition(items, 'x', 'a')).toBe(0); // from elsewhere: before the first
  });

  it('places a task dropped on an empty column at the end', () => {
    const over = { data: { current: { type: 'column', sectionId: 's2' } } };
    const target = taskDrop({ id: 'a' }, over, () => [{ id: 'z', position: 500 }]);
    expect(target).toEqual({ section_id: 's2', position: 1500 });
  });
});
