// A small, safe subset of Markdown for descriptions and comments, parsed into a tree the UI
// renders as React elements (never as HTML).
//   Blocks: paragraphs, "- " and "1. " lists, "#"/"##"/"###" headings, "> " quotes, ``` code
//           blocks, "---" dividers, | tables |, and a YouTube, Vimeo or Loom link alone on a
//           line, which shows the video.
//   Inline: **bold**, *italic*, ++underline++, ~~strikethrough~~, ==highlight==, `code`,
//           [named links](https://…), web links, and @mentions written as @[Name](user-id).

const INLINE = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|\+\+[^+\n]+\+\+|==[^=\n]+==|\*[^*\n]+\*|`[^`\n]+`|@\[[^\]\n]{1,120}\]\([0-9a-f-]{36}\)|\[[^\]\n]{1,200}\]\(https?:\/\/[^\s()<>]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

const WRAPPED = [['**', 'bold'], ['~~', 'strike'], ['++', 'underline'], ['==', 'highlight']];

export function parseInline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    const tok = m[0];
    const wrapped = WRAPPED.find(([mark]) => tok.startsWith(mark));
    if (wrapped) out.push({ type: wrapped[1], text: tok.slice(2, -2) });
    else if (tok.startsWith('`')) out.push({ type: 'code', text: tok.slice(1, -1) });
    else if (tok.startsWith('*')) out.push({ type: 'italic', text: tok.slice(1, -1) });
    else if (tok.startsWith('@[')) {
      const [, name, id] = tok.match(/^@\[(.+)\]\(([0-9a-f-]{36})\)$/);
      out.push({ type: 'mention', text: name, id });
    } else if (tok.startsWith('[')) {
      const [, label, href] = tok.match(/^\[(.+)\]\((https?:\/\/.+)\)$/);
      out.push({ type: 'link', text: label, href });
    } else out.push({ type: 'link', text: tok, href: tok });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/**
 * A player for a video or design link: { provider, src, url }, else null. YouTube, Vimeo, Loom,
 * ok.ru, Dailymotion, Google Drive files and Figma. Pasted <iframe> embed code works too, for
 * the same sites. The player's address is built from the item's id, never taken from the link.
 */
export function embedOf(input) {
  const iframe = input.match(/^<iframe\b[^>]*?\ssrc=["']([^"'\s]+)["'][^>]*>\s*(?:<\/iframe>)?$/i);
  if (iframe) {
    const src = iframe[1].startsWith('//') ? `https:${iframe[1]}` : iframe[1];
    const found = embedOf(src);
    return found && { ...found, url: found.page };
  }
  const url = input;
  let m = url.match(/^https?:\/\/(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/watch\?(?:\S*&)?v=([\w-]{11})(?:[&#]\S*)?$/)
    || url.match(/^https?:\/\/youtu\.be\/([\w-]{11})(?:[?#]\S*)?$/)
    || url.match(/^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/(?:shorts|embed|live)\/([\w-]{11})(?:[?#]\S*)?$/);
  if (m) return found('YouTube', `https://www.youtube-nocookie.com/embed/${m[1]}`, url, `https://www.youtube.com/watch?v=${m[1]}`);
  m = url.match(/^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})(?:[/?#]\S*)?$/);
  if (m) return found('Vimeo', `https://player.vimeo.com/video/${m[1]}`, url, `https://vimeo.com/${m[1]}`);
  m = url.match(/^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([0-9a-f]{32})(?:[?#]\S*)?$/);
  if (m) return found('Loom', `https://www.loom.com/embed/${m[1]}`, url, `https://www.loom.com/share/${m[1]}`);
  m = url.match(/^https?:\/\/(?:www\.|m\.)?ok\.ru\/(?:video|videoembed|live)\/(\d{5,20})(?:[/?#]\S*)?$/);
  if (m) return found('OK.ru', `https://ok.ru/videoembed/${m[1]}`, url, `https://ok.ru/video/${m[1]}`);
  m = url.match(/^https?:\/\/(?:www\.)?dailymotion\.com\/(?:embed\/)?video\/([a-zA-Z0-9]{5,12})(?:[_/?#]\S*)?$/)
    || url.match(/^https?:\/\/dai\.ly\/([a-zA-Z0-9]{5,12})(?:[?#]\S*)?$/);
  if (m) return found('Dailymotion', `https://www.dailymotion.com/embed/video/${m[1]}`, url, `https://www.dailymotion.com/video/${m[1]}`);
  m = url.match(/^https:\/\/drive\.google\.com\/file\/d\/([\w-]{20,80})(?:\/(?:view|preview|edit))?(?:[?#]\S*)?$/);
  if (m) return found('Google Drive', `https://drive.google.com/file/d/${m[1]}/preview`, url, `https://drive.google.com/file/d/${m[1]}/view`);
  m = url.match(/^https:\/\/(?:www\.)?figma\.com\/(file|design|proto|board)\/([A-Za-z0-9]{10,64})(?:\/[^\s?#]*)?(?:\?(\S*))?$/);
  if (m) {
    const node = (m[3] || '').match(/(?:^|&)node-id=([\w:-]{1,40})(?:&|$)/)?.[1];
    const page = `https://www.figma.com/${m[1]}/${m[2]}${node ? `?node-id=${node}` : ''}`;
    return found('Figma', `https://www.figma.com/embed?embed_host=kahon&url=${encodeURIComponent(page)}`, url, page);
  }
  return null;
}

// url: the link as written (shown under the player); page: the item's own page, from its id.
const found = (provider, src, url, page) => ({ provider, src, url, page });

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const cellsOf = (row) => row.trim().slice(1, -1).split('|').map((c) => c.trim());
const isDivider = (row) => cellsOf(row).every((c) => /^:?-+:?$/.test(c));

/**
 * Blocks: { type: 'p' | 'quote', lines: inline[][] } | { type: 'ul' | 'ol', items: inline[][] }
 *   | { type: 'h', level: 1-3, nodes } | { type: 'codeblock', text } | { type: 'hr' }
 *   | { type: 'table', head: inline[][] | null, rows: inline[][][] } | { type: 'embed', provider, src, url }
 */
export function parseBlocks(text = '') {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const prev = blocks[blocks.length - 1];

    if (/^\s*```/.test(line)) {
      const body = [];
      for (i += 1; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i += 1) body.push(lines[i]);
      blocks.push({ type: 'codeblock', text: body.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*\S)\s*$/);
    if (heading) {
      blocks.push({ type: 'h', level: heading[1].length, nodes: parseInline(heading[2]) });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      if (prev?.type === 'quote') prev.lines.push(parseInline(quote[1]));
      else blocks.push({ type: 'quote', lines: [parseInline(quote[1])] });
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const rows = [];
      for (; i < lines.length && TABLE_ROW.test(lines[i]); i += 1) rows.push(lines[i]);
      i -= 1;
      const hasHead = rows.length > 1 && isDivider(rows[1]);
      blocks.push({
        type: 'table',
        head: hasHead ? cellsOf(rows[0]).map(parseInline) : null,
        rows: rows.slice(hasHead ? 2 : 0).filter((r) => !isDivider(r)).map((r) => cellsOf(r).map(parseInline)),
      });
      continue;
    }
    const embed = embedOf(line.trim());
    if (embed) {
      blocks.push({ type: 'embed', ...embed });
      continue;
    }

    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
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

// Mentions as plain "@Name" (for editing), and whole texts without formatting (for previews).
export { plainMentions, plainText } from '../../supabase/functions/_shared/plaintext.ts';

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
