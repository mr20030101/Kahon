// A small, safe subset of Markdown for descriptions and comments, parsed into a tree the UI
// renders as React elements (never as HTML): paragraphs, "- " and "1. " lists, **bold**,
// *italic*, `code`, web links, and @mentions written as @[Name](user-id).

const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|@\[[^\]\n]{1,120}\]\([0-9a-f-]{36}\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

export function parseInline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('**')) out.push({ type: 'bold', text: tok.slice(2, -2) });
    else if (tok.startsWith('`')) out.push({ type: 'code', text: tok.slice(1, -1) });
    else if (tok.startsWith('*')) out.push({ type: 'italic', text: tok.slice(1, -1) });
    else if (tok.startsWith('@[')) {
      const [, name, id] = tok.match(/^@\[(.+)\]\(([0-9a-f-]{36})\)$/);
      out.push({ type: 'mention', text: name, id });
    } else out.push({ type: 'link', text: tok, href: tok });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** Blocks: { type: 'p', lines: inline[][] } | { type: 'ul' | 'ol', items: inline[][] } */
export function parseBlocks(text = '') {
  const blocks = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const prev = blocks[blocks.length - 1];
    if (bullet || number) {
      const type = bullet ? 'ul' : 'ol';
      const item = parseInline((bullet || number)[1]);
      if (prev?.type === type) prev.items.push(item);
      else blocks.push({ type, items: [item] });
    } else if (!line.trim()) {
      blocks.push({ type: 'break' });
    } else if (prev?.type === 'p') {
      prev.lines.push(parseInline(line));
    } else {
      blocks.push({ type: 'p', lines: [parseInline(line)] });
    }
  }
  return blocks.filter((b, i, all) => b.type !== 'break' || (i > 0 && i < all.length - 1 && all[i - 1].type !== 'break'));
}

/** Mention tokens shown as plain "@Name" (for previews and editing). */
export const plainMentions = (text = '') => text.replace(/@\[([^\]\n]{1,120})\]\([0-9a-f-]{36}\)/g, '@$1');

/** Mentions picked while typing ({name, id}) turned into tokens, first unconverted match each. */
export function encodeMentions(text, picked) {
  let out = text;
  for (const { name, id } of picked) {
    const plain = `@${name}`;
    const at = out.indexOf(plain);
    if (at !== -1 && !out.startsWith(`@[${name}]`, at)) out = `${out.slice(0, at)}@[${name}](${id})${out.slice(at + plain.length)}`;
  }
  return out;
}

/** {name, id} for every mention token in a text, to restore them when editing. */
export function decodeMentions(text = '') {
  return [...text.matchAll(/@\[([^\]\n]{1,120})\]\(([0-9a-f-]{36})\)/g)].map((m) => ({ name: m[1], id: m[2] }));
}
