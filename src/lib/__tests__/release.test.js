import { describe, expect, it } from 'vitest';
import { isNewerVersion } from '../version';
import { boldSegments, parseChangelog } from '../changelog';
import { monthGrid } from '../../components/CalendarView';

describe('isNewerVersion', () => {
  it('compares x.y.z numerically', () => {
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.2.1', '0.3.0')).toBe(false);
    expect(isNewerVersion('garbage', '0.1.0')).toBe(false);
  });
});

describe('parseChangelog', () => {
  it('reads releases and skips Unreleased', () => {
    const releases = parseChangelog('# Changelog\n\n## Unreleased\n\n### Added\n\n- Soon\n\n## 0.2.0 — 2026-10-08\n\nIntro.\n\n### Added\n\n- **Ask AI** in tasks\n');
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ version: '0.2.0', date: '2026-10-08', notes: ['Intro.'] });
    expect(releases[0].groups[0]).toEqual({ title: 'Added', items: ['**Ask AI** in tasks'] });
    expect(boldSegments('**Ask AI** in tasks')).toEqual([{ value: '', bold: false }, { value: 'Ask AI', bold: true }, { value: ' in tasks', bold: false }]);
  });
});

describe('monthGrid', () => {
  it('shows six Monday-first weeks covering the month', () => {
    const days = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(days).toHaveLength(42);
    expect(days[0].getDay()).toBe(1);
    expect(days[0].getDate()).toBe(28); // Monday 28 September
    expect(days.some((d) => d.getMonth() === 9 && d.getDate() === 31)).toBe(true);
  });
});
