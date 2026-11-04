import { describe, expect, it } from 'vitest';
import { plainText } from '../richtext';

const ID = '33e1a922-25da-49a3-8967-d929ab29bfa9';

describe('plainText', () => {
  it('drops formatting marks and keeps the words', () => {
    expect(plainText(`## Update\n**Done** with ~~old~~ ++new++ ==bits== and *care*. Ask @[Des Allen](${ID}) about \`deploy\`.`))
      .toBe('Update\nDone with old new bits and care. Ask @Des Allen about deploy.');
  });

  it('keeps link addresses, list markers, code and quotes; turns tables into lines', () => {
    const text = '> quoted\n- [the spec](https://kahon.app/spec)\n---\n```\nnpm run build\n```\n| A | B |\n| --- | --- |\n| 1 | **2** |';
    expect(plainText(text)).toBe('quoted\n- the spec (https://kahon.app/spec)\nnpm run build\nA · B\n1 · 2');
  });
});
