import { describe, expect, it } from 'vitest';
import { decodeMentions, embedOf, encodeMentions, parseBlocks, parseInline, plainMentions } from '../richtext';

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

describe('formatting', () => {
  it('finds underline, strikethrough, highlight and named links', () => {
    const nodes = parseInline('++u++ ~~s~~ ==h== [the spec](https://kahon.app/spec?a=1)');
    expect(nodes.filter((n) => n.type !== 'text')).toEqual([
      { type: 'underline', text: 'u' }, { type: 'strike', text: 's' }, { type: 'highlight', text: 'h' },
      { type: 'link', text: 'the spec', href: 'https://kahon.app/spec?a=1' },
    ]);
  });

  it('only names links to web addresses', () => {
    expect(parseInline('[x](javascript:alert(1))').some((n) => n.type === 'link')).toBe(false);
  });

  it('reads headings, quotes, dividers, code blocks and tables', () => {
    const blocks = parseBlocks([
      '# Big', '### Small', '> quoted', '> more', '---', '```', '**not bold**', '```',
      '| A | B |', '| --- | --- |', '| 1 | **2** |',
    ].join('\n'));
    expect(blocks.map((b) => b.type)).toEqual(['h', 'h', 'quote', 'hr', 'codeblock', 'table']);
    expect(blocks[1].level).toBe(3);
    expect(blocks[2].lines).toHaveLength(2);
    expect(blocks[4].text).toBe('**not bold**');
    expect(blocks[5].head.map((c) => c[0].text)).toEqual(['A', 'B']);
    expect(blocks[5].rows[0][1]).toEqual([{ type: 'bold', text: '2' }]);
  });

  it('embeds YouTube, Vimeo and Loom links alone on a line, from the video id only', () => {
    expect(embedOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(embedOf('https://youtu.be/dQw4w9WgXcQ')?.provider).toBe('YouTube');
    expect(embedOf('https://vimeo.com/123456789')?.src).toBe('https://player.vimeo.com/video/123456789');
    expect(embedOf(`https://www.loom.com/share/${'a'.repeat(32)}`)?.provider).toBe('Loom');
    expect(embedOf('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseBlocks('see https://youtu.be/dQw4w9WgXcQ')[0].type).toBe('p');
  });

  it('embeds ok.ru, Dailymotion, Google Drive and Figma, and pasted iframe code', () => {
    expect(embedOf('https://ok.ru/video/4492604541637')?.src).toBe('https://ok.ru/videoembed/4492604541637');
    const pasted = embedOf('<iframe width="560" height="315" src="//ok.ru/videoembed/4492604541637?nochat=1" frameborder="0" allow="autoplay" allowfullscreen></iframe>');
    expect(pasted).toMatchObject({ provider: 'OK.ru', src: 'https://ok.ru/videoembed/4492604541637', url: 'https://ok.ru/video/4492604541637' });
    expect(embedOf('https://www.dailymotion.com/video/x8abcd1')?.src).toBe('https://www.dailymotion.com/embed/video/x8abcd1');
    expect(embedOf('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing')?.src)
      .toBe('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/preview');
    expect(embedOf('https://www.figma.com/design/AbCdEfGhIjKl123/My-File?node-id=1-2&t=x')?.src)
      .toBe(`https://www.figma.com/embed?embed_host=kahon&url=${encodeURIComponent('https://www.figma.com/design/AbCdEfGhIjKl123?node-id=1-2')}`);
    // An iframe from anywhere else stays text.
    expect(embedOf('<iframe src="https://evil.example/x"></iframe>')).toBeNull();
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
