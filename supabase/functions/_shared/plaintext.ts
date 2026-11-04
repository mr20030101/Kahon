// Comments and descriptions as plain text, for places that can't show formatting: email
// quotes, Inbox and Home previews, and what Ask AI reads. Undoes the Markdown subset in
// src/lib/richtext.js: mentions become "@Name", marks are dropped, links keep their address,
// and tables become "a · b" lines. Plain TypeScript, shared by the app and the Edge Functions.

const MENTION = /@\[([^\]\n]{1,120})\]\([0-9a-f-]{36}\)/g;

/** Just the mentions as "@Name". */
export const plainMentions = (text = '') => text.replace(MENTION, '@$1');

function inline(line: string) {
  return line
    .replace(MENTION, '@$1')
    .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s()<>]+)\)/g, (_m, label, url) => (label === url ? url : `${label} (${url})`))
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/\+\+([^+\n]+)\+\+/g, '$1')
    .replace(/==([^=\n]+)==/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1');
}

/** The text without formatting marks. */
export function plainText(text = '') {
  const out: string[] = [];
  let inCode = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue; // divider
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // the line under a table's header
      out.push(cells.map(inline).join(' · '));
      continue;
    }
    out.push(inline(line.replace(/^#{1,3}\s+/, '').replace(/^(\s*)>\s?/, '$1')));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
