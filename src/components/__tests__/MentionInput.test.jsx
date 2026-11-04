// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MentionInput from '../MentionInput';

const ID = '33e1a922-25da-49a3-8967-d929ab29bfa9';
const members = [{ user_id: ID, profile: { id: ID, full_name: 'Des Allen' } }];

function setup(initial = '') {
  const ref = createRef();
  render(<MentionInput ref={ref} toolbar members={members} initial={initial} aria-label="Comment" />);
  const box = screen.getByLabelText('Comment');
  const select = (from, to) => {
    box.focus();
    box.setSelectionRange(from, to);
  };
  return { ref, box, select };
}

afterEach(cleanup);

describe('MentionInput toolbar', () => {
  it('wraps the selection in bold, and takes it off again', () => {
    const { ref, box, select } = setup('make this loud');
    select(10, 14);
    fireEvent.click(screen.getByLabelText('Bold (Ctrl + B)'));
    expect(ref.current.getValue()).toBe('make this **loud**');
    select(12, 16);
    fireEvent.click(screen.getByLabelText('Bold (Ctrl + B)'));
    expect(box.value).toBe('make this loud');
  });

  it('has keyboard shortcuts', () => {
    const { ref, box, select } = setup('word');
    select(0, 4);
    fireEvent.keyDown(box, { key: 'i', ctrlKey: true });
    expect(ref.current.getValue()).toBe('*word*');
  });

  it('makes and unmakes lists line by line', () => {
    const { box, select } = setup('one\ntwo');
    select(0, 7);
    fireEvent.click(screen.getByLabelText('Numbered list'));
    expect(box.value).toBe('1. one\n2. two');
    select(0, box.value.length);
    fireEvent.click(screen.getByLabelText('Bulleted list'));
    expect(box.value).toBe('- one\n- two');
  });

  it('inserts blocks from the + menu on lines of their own', () => {
    const { box, select } = setup('Intro');
    select(5, 5);
    fireEvent.click(screen.getByLabelText('Insert'));
    fireEvent.click(screen.getByRole('button', { name: /Table/ }));
    expect(box.value).toBe('Intro\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |');
  });

  it('keeps mentions as tokens when saving', () => {
    const { ref } = setup(`Thanks @[Des Allen](${ID})`);
    expect(screen.getByLabelText('Comment').value).toBe('Thanks @Des Allen');
    expect(ref.current.getValue()).toBe(`Thanks @[Des Allen](${ID})`);
  });
});
