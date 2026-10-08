// Plain text from task attachments, so Ask AI can read them. Returns null for files it
// doesn't read (images, old binary Office formats like .doc, .xls, .ppt).
// Office files are zip archives of XML, read here with JSZip; no spreadsheet library needed.

import JSZip from 'npm:jszip@3';
import { extractText, getDocumentProxy } from 'npm:unpdf@1';

const decode = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Text runs from Office Open XML, one line per paragraph.
function xmlText(xml: string, run: string, paragraph: string) {
  return xml
    .split(new RegExp(`</${paragraph}>`))
    .map((p) => [...p.matchAll(new RegExp(`<${run}(?: [^>]*)?>([^<]*)</${run}>`, 'g'))].map((m) => unescapeXml(m[1])).join(''))
    .filter((line) => line.trim())
    .join('\n');
}

export async function readAttachmentText(name: string, bytes: Uint8Array): Promise<string | null> {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'txt':
    case 'md':
    case 'csv':
      return decode(bytes);
    case 'docx': {
      const zip = await JSZip.loadAsync(bytes);
      const xml = await zip.file('word/document.xml')?.async('string');
      return xml ? xmlText(xml, 'w:t', 'w:p') : '';
    }
    case 'pptx': {
      const zip = await JSZip.loadAsync(bytes);
      const slides = Object.keys(zip.files)
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
      const parts: string[] = [];
      for (const [i, f] of slides.entries()) {
        const text = xmlText(await zip.file(f)!.async('string'), 'a:t', 'a:p');
        parts.push(`Slide ${i + 1}:\n${text}`);
      }
      return parts.join('\n\n');
    }
    case 'xlsx':
      return xlsxText(await JSZip.loadAsync(bytes));
    case 'ods': {
      const xml = await (await JSZip.loadAsync(bytes)).file('content.xml')?.async('string');
      if (!xml) return '';
      // One line per table row, cells separated by commas.
      return xml.split('</table:table-row>')
        .map((row) => [...row.matchAll(/<text:p(?: [^>]*)?>([^<]*)<\/text:p>/g)].map((m) => unescapeXml(m[1])).join(', '))
        .filter((line) => line.trim())
        .join('\n');
    }
    case 'pdf': {
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join('\n') : text;
    }
    default:
      return null;
  }
}

// Sheets of an .xlsx as "Sheet name:" followed by comma-separated rows.
async function xlsxText(zip: JSZip) {
  const shared = await zip.file('xl/sharedStrings.xml')?.async('string');
  const strings = shared
    ? shared.split('</si>').slice(0, -1).map((si) => [...si.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((m) => unescapeXml(m[1])).join(''))
    : [];
  const workbook = (await zip.file('xl/workbook.xml')?.async('string')) ?? '';
  const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => unescapeXml(m[1]));
  const files = Object.keys(zip.files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  const parts: string[] = [];
  for (const [i, f] of files.entries()) {
    const xml = await zip.file(f)!.async('string');
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(([, row]) =>
      [...row.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, inner = '']) => {
        const value = inner.match(/<v>([^<]*)<\/v>/)?.[1];
        if (/t="s"/.test(attrs) && value !== undefined) return strings[Number(value)] ?? '';
        if (/t="inlineStr"/.test(attrs)) return [...inner.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
        return value !== undefined ? unescapeXml(value) : '';
      }).join(','),
    ).filter((line) => line.replace(/,/g, '').trim());
    parts.push(`Sheet "${names[i] ?? i + 1}":\n${rows.join('\n')}`);
  }
  return parts.join('\n\n');
}
