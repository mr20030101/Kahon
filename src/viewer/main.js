// Renders a document handed over by the app (FileViewer.jsx) via postMessage.
//
// This page runs in an iframe sandboxed WITHOUT allow-same-origin, so it has an
// opaque origin: whatever a crafted file manages to execute here (the slide and
// chart renderers are third-party code) can't read Kahon's session, storage or DOM.
import './viewer.css';

const MAX_SHEET_ROWS = 2000;
const status = document.getElementById('status');
const doc = document.getElementById('doc');
const tabs = document.getElementById('tabs');

const post = (msg) => window.parent.postMessage(msg, '*');

window.addEventListener('message', async (e) => {
  if (e.source !== window.parent || e.data?.type !== 'render') return;
  const { kind, buffer } = e.data;
  try {
    await RENDERERS[kind](buffer);
    status.hidden = true;
    neutralizeLinks();
    post({ type: 'rendered' });
  } catch (err) {
    console.error(err);
    status.textContent = "This file couldn't be previewed. Download it to open it instead.";
    status.classList.add('is-error');
    post({ type: 'error', message: String(err?.message || err) });
  }
});

// Escape closes the viewer even while focus is inside this frame.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') post({ type: 'escape' });
});

const RENDERERS = {
  async docx(buffer) {
    const { renderAsync } = await import('docx-preview');
    await renderAsync(buffer, doc, undefined, {
      inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, useBase64URL: true,
    });
  },

  async sheet(buffer) {
    const XLSX = await import('xlsx');
    const book = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    const show = (name) => {
      const ws = book.Sheets[name];
      doc.replaceChildren();
      if (ws['!ref']) {
        const range = XLSX.utils.decode_range(ws['!ref']);
        const rows = range.e.r - range.s.r + 1;
        if (rows > MAX_SHEET_ROWS) {
          range.e.r = range.s.r + MAX_SHEET_ROWS - 1;
          ws['!ref'] = XLSX.utils.encode_range(range);
          const note = document.createElement('p');
          note.className = 'note';
          note.textContent = `Showing the first ${MAX_SHEET_ROWS.toLocaleString()} of ${rows.toLocaleString()} rows. Download the file to see all of it.`;
          doc.append(note);
        }
      }
      const wrap = document.createElement('div');
      wrap.className = 'sheet';
      // sheet_to_html escapes cell text; links are neutralized below.
      wrap.innerHTML = XLSX.utils.sheet_to_html(ws, { header: '', footer: '' });
      doc.append(wrap);
      neutralizeLinks();
      [...tabs.children].forEach((b) => b.classList.toggle('is-on', b.textContent === name));
    };
    if (book.SheetNames.length > 1) {
      tabs.hidden = false;
      book.SheetNames.forEach((name) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.onclick = () => show(name);
        tabs.append(b);
      });
    }
    show(book.SheetNames[0]);
  },

  async pptx(buffer) {
    const { init } = await import('pptx-preview');
    const host = document.createElement('div');
    host.className = 'slides';
    doc.append(host);
    const width = Math.min(960, document.documentElement.clientWidth - 40);
    const previewer = init(host, { width, height: Math.round((width * 9) / 16), mode: 'list' });
    await previewer.preview(buffer);
    // pptx-preview swallows parse errors and renders nothing; report that as a failure.
    if (!previewer.slideCount) throw new Error('No slides could be read from this file');
  },

  async text(buffer) {
    const pre = document.createElement('pre');
    pre.className = 'text';
    pre.textContent = new TextDecoder('utf-8').decode(buffer);
    doc.append(pre);
  },
};

// Web links open in a new tab; anything else (javascript:, file:, relative paths
// that would navigate this frame) is disabled.
function neutralizeLinks() {
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (/^(https?:|mailto:)/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else if (!href.startsWith('#')) {
      a.removeAttribute('href');
    }
  });
}

post({ type: 'ready' });
