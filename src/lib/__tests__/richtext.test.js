import { describe, expect, it } from 'vitest';
import { decodeMentions, encodeMentions, parseBlocks, parseInline, plainMentions } from '../richtext';

const ID = '33e1a922-25da-49a3-8967-d929ab29bfa9';

describe('parseInline', () => {
  it('finds bold, italic, code, links and mentions', () => {
    const nodes = parseInline(`**Bold** and *it* with \`code\` see https://kahon.app/x. Hi @[Des Allen](${ID})`);
    expect(nodes.map((n) => n.type)).toEqual(['bold', 'text', 'italic', 'text', 'code', 'text', 'link', 'text', 'mention']);
    expect(nodes.find((n) => n.type === 'link').href).toBe('https://kahon.app/x');
    expect(nodes.find((n) => n.type === 'mention')).toMatchObject({ text: 'Des Allen', id: ID });
  });

  it('never turns other schemes into links', () => {
    expect(parseInline('javascript:alert(1)').every((n) => n.type === 'text')).toBe(true);
  });
});

describe('parseBlocks', () => {
  it('groups lists and paragraphs', () => {
    const blocks = parseBlocks('Intro line\nsecond line\n\n- one\n- two\n1. first\n2. second');
    expect(blocks.map((b) => b.type)).toEqual(['p', 'break', 'ul', 'ol']);
    expect(blocks[0].lines).toHaveLength(2);
    expect(blocks[2].items).toHaveLength(2);
  });
});

describe('mentions', () => {
  it('round-trips between the typed form and stored tokens', () => {
    const stored = encodeMentions('Thanks @Des Allen, see @Nobody', [{ name: 'Des Allen', id: ID }]);
    expect(stored).toBe(`Thanks @[Des Allen](${ID}), see @Nobody`);
    expect(plainMentions(stored)).toBe('Thanks @Des Allen, see @Nobody');
    expect(decodeMentions(stored)).toEqual([{ name: 'Des Allen', id: ID }]);
  });

  it("doesn't encode the same mention twice", () => {
    const once = encodeMentions(`@[Des Allen](${ID})`, [{ name: 'Des Allen', id: ID }]);
    expect(once).toBe(`@[Des Allen](${ID})`);
  });
});
