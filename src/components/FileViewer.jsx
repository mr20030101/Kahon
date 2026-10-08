import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';

// In-app preview for attachments. PDFs use the browser's own viewer; Word, sheets,
// slides and text are rendered by /viewer.html inside a sandboxed iframe, which gets
// the file's bytes by postMessage and has no access to the app's session or storage.
export const PREVIEW_KIND = {
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'sheet', xls: 'sheet', ods: 'sheet', csv: 'sheet',
  pptx: 'pptx',
  txt: 'text', md: 'text',
};

export const previewKindOf = (name = '') => PREVIEW_KIND[name.split('.').pop().toLowerCase()] || null;

export default function FileViewer({ file, onClose }) {
  const kind = previewKindOf(file.name);
  const frameRef = useRef(null);
  const [state, setState] = useState(kind === 'pdf' ? 'ready' : 'loading');
  // Latest onClose without re-running the effects below when its identity changes.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Hand the file to the sandbox once it says it's ready.
  useEffect(() => {
    if (kind === 'pdf') return undefined;
    let cancelled = false;
    const onMessage = async (e) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame || e.source !== frame) return;
      const { type } = e.data || {};
      if (type === 'escape') closeRef.current();
      else if (type === 'rendered') setState('ready');
      else if (type === 'error') setState('error');
      else if (type === 'ready') {
        try {
          const res = await fetch(file.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          // The frame's origin is opaque ("null"), so '*' is the only usable target.
          if (!cancelled) frame.postMessage({ type: 'render', kind, buffer }, '*', [buffer]);
        } catch {
          if (!cancelled) setState('error');
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
    };
  }, [file.url, kind]);

  // Escape closes the viewer, not the task panel behind it.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="viewer" role="dialog" aria-label={`Preview of ${file.name}`}>
      <div className="viewer-bar">
        <span className="viewer-name grow" title={file.name}>{file.name}</span>
        {file.downloadUrl && (
          <a className="btn btn-ghost" href={file.downloadUrl}><Icon.download /> Download</a>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close preview" title="Close"><Icon.x /></button>
      </div>
      <div className="viewer-body">
        {kind === 'pdf' ? (
          <iframe className="viewer-frame" src={file.url} title={file.name} />
        ) : (
          <iframe ref={frameRef} className="viewer-frame" src="/viewer.html" title={file.name}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" />
        )}
        {state === 'loading' && <div className="viewer-status">Loading preview…</div>}
        {state === 'error' && (
          <div className="viewer-status">
            <p>This file couldn't be previewed.</p>
            {file.downloadUrl && <a className="btn btn-primary" href={file.downloadUrl}>Download instead</a>}
          </div>
        )}
      </div>
    </div>
  );
}
