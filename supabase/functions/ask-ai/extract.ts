// Plain text from task attachments, so Ask AI can read them. Returns null for files it
// doesn't read (images, old binary Office formats).

import JSZip from 'npm:jszip@3';
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
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
    case 'xls':
    case 'ods': {
      const book = XLSX.read(bytes, { type: 'array' });
      return book.SheetNames.map((s) => `Sheet "${s}":\n${XLSX.utils.sheet_to_csv(book.Sheets[s], { blankrows: false })}`).join('\n\n');
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
